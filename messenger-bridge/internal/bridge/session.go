// Package bridge manages per-account Facebook Messenger sessions (LightSpeed + E2EE).
//
// Implementation audit (verified vs. best-effort against go.mau.fi/mautrix-meta v0.2610.0):
//
//   - VERIFIED against mautrix-meta (pkg/connector/client.go & pkg/messagix):
//     * LightSpeed session lifecycle: messagix.NewClient, LoadMessagesPage, SetEventHandler,
//       Connect, cookie rotation via GetCookies().GetAll(), and proxy setup via UpdateProxy.
//     * Error mapping from httpclient sentinel errors (ErrTokenInvalidated -> expired;
//       ErrCheckpointRequired / ErrChallengeRequired / ErrConsentRequired / ErrAccountSuspended
//       -> checkpoint) and PermanentErrorEvent websocket close code dgw.CloseStatusUnauthorized.
//     * E2EE device lifecycle: sqlstore device lookup under waTypes.MessengerServer,
//       cli.SetDevice, first-time cli.RegisterE2EE(ctx, fbid) + dev.Save(ctx),
//       cli.PrepareE2EEClient(), SetProxyAddress, SynchronousAck = true,
//       AddEventHandlerWithSuccessStatus, and handling events.ConnectFailureNotFound (HTTP 415)
//       by deleting the stale device and re-registering once.
//     * Sending messages: LightSpeed socket.SendMessageTask via cli.ExecuteTasks (matching
//       LSReplaceOptimsiticMessage on OfflineThreadingId) and E2EE e2ee.SendFBMessage with
//       waConsumerApplication.ConsumerApplication (MessageText) + MessageApplication_Metadata.
//
//   - BEST-EFFORT / simplified for this service (requires real-account PoC verification):
//     * E2EE peer detection (e2eePeers): inferred from LSTable thread rows
//       (ThreadType.IsWhatsApp, LSVerifyHybridThreadExists,
//       LSUpdateThreadAuthorityAndMappingWithOTIDFromJID, LSMoveThreadToE2EECutoverFolder)
//       and incoming *events.FBMessage events. If a cold session sends to an E2EE peer not yet
//       present in the initial inbox table or incoming E2EE stream, it may try LightSpeed first.
//     * E2EE media attachments are not downloaded/decrypted/re-uploaded; media-only E2EE
//       messages are forwarded with a text placeholder ("(Tệp đính kèm)") and attachments: [].
//     * Reconnect backoff (retryLoop) and the 30s initial socket wait in Start() are
//       bridge-specific wrappers around messagix.
package bridge

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/rs/zerolog"
	"go.mau.fi/util/exhttp"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waConsumerApplication"
	"go.mau.fi/whatsmeow/proto/waMsgApplication"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waTypes "go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"go.mau.fi/mautrix-meta/pkg/messagix"
	"go.mau.fi/mautrix-meta/pkg/messagix/dgw"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/methods"
	"go.mau.fi/mautrix-meta/pkg/messagix/socket"
	"go.mau.fi/mautrix-meta/pkg/messagix/table"
)

const (
	StatusConnected    = "connected"
	StatusConnecting   = "connecting"
	StatusDisconnected = "disconnected"
	StatusCheckpoint   = "checkpoint"
	StatusExpired      = "expired"
	StatusError        = "error" // only in /connect responses
)

// Session is one Facebook account: a messagix (MQTT/LightSpeed) connection for normal chats
// plus a whatsmeow connection for end-to-end encrypted chats. Mirrors pkg/connector/client.go
// of mautrix-meta, minus everything Matrix-specific.
type Session struct {
	AccountID string
	FBID      int64
	Cookies   map[string]string // updated in place as Facebook rotates cookies
	Proxy     string
	Devices   *sqlstore.Container
	DeviceID  uint16 // whatsmeow device id, persisted by the owner
	Log       zerolog.Logger

	OnMessage func(*MessagePayload)
	OnStatus  func(*StatusPayload)
	OnPersist func() // cookies or DeviceID changed

	mu        sync.Mutex
	cli       *messagix.Client
	e2ee      *whatsmeow.Client
	device    *store.Device
	status    string
	lastErr   string
	lastSent  string // last status sent via OnStatus, to avoid repeats
	connected      chan struct{}
	e2eePeers      map[int64]bool
	plainPeers     map[int64]bool
	groups         map[int64]bool
	names          map[int64]string
	ctx            context.Context
	stop           context.CancelFunc
	retrying          bool
	e2eeRetry         bool
	e2eeConnecting    bool
	e2eeDisabled      bool // device locked/banned (403/406): stop registering new devices
	lastFullReconnect time.Time
}

// Start connects (first attempt synchronously) and keeps reconnecting in the background
// until Stop is called or the credentials are rejected.
func (s *Session) Start() (string, error) {
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.ctx, s.stop = ctx, cancel
	s.e2eePeers, s.plainPeers, s.groups, s.names = map[int64]bool{}, map[int64]bool{}, map[int64]bool{}, map[int64]string{}
	s.mu.Unlock()

	st, err := s.connectOnce(ctx)
	if st == StatusError {
		go s.retryLoop()
	}
	if st == StatusConnecting {
		// Wait briefly for the socket so /connect can usually answer "connected".
		s.mu.Lock()
		ch := s.connected
		s.mu.Unlock()
		select {
		case <-ch:
		case <-time.After(30 * time.Second):
		case <-ctx.Done():
		}
		curSt, _, lastErr := s.Status()
		if lastErr != "" && curSt != StatusConnected {
			if curSt == StatusDisconnected {
				curSt = StatusError
			}
			return curSt, errors.New(lastErr)
		}
		st = curSt
	}
	return st, err
}

func (s *Session) Stop() {
	s.mu.Lock()
	if s.stop != nil {
		s.stop()
	}
	cli, e2ee := s.cli, s.e2ee
	s.cli, s.e2ee = nil, nil
	s.mu.Unlock()
	if e2ee != nil {
		e2ee.Disconnect()
	}
	if cli != nil {
		cli.SetEventHandler(nil)
		cli.Disconnect()
	}
}

func (s *Session) Status() (status string, e2ee bool, lastErr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.status
	if st == "" {
		st = StatusConnecting
	}
	return st, s.e2ee != nil && s.e2ee.IsConnected(), s.lastErr
}

// Snapshot returns the current cookie string and E2EE device id for persistence.
func (s *Session) Snapshot() (cookie string, deviceID uint16) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return joinCookies(s.Cookies), s.DeviceID
}

// retryLoop does full reconnects with exponential backoff until one succeeds or fails for good.
func (s *Session) retryLoop() {
	s.mu.Lock()
	ctx := s.ctx
	if s.retrying || ctx == nil {
		s.mu.Unlock()
		return
	}
	s.retrying = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.retrying = false
		s.mu.Unlock()
	}()
	for attempt := 1; ; attempt++ {
		wait := time.Duration(1<<min(attempt, 8)) * time.Second // capped at ~4 min
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return
		}
		s.mu.Lock()
		if time.Since(s.lastFullReconnect) < 60*time.Second {
			s.mu.Unlock()
			continue
		}
		s.mu.Unlock()
		if st, _ := s.connectOnce(ctx); st != StatusError {
			return
		}
	}
}

// connectOnce loads the messages page and starts the socket. Returns StatusConnecting on
// success (ConnectedEvent follows), StatusCheckpoint/StatusExpired for dead sessions and
// StatusError for anything worth retrying.
func (s *Session) connectOnce(ctx context.Context) (string, error) {
	s.mu.Lock()
	s.lastFullReconnect = time.Now()
	old, oldE2EE := s.cli, s.e2ee
	s.cli, s.e2ee = nil, nil
	values := make(map[string]string, len(s.Cookies))
	for k, v := range s.Cookies {
		values[k] = v
	}
	s.mu.Unlock()
	if oldE2EE != nil {
		oldE2EE.Disconnect()
	}
	if old != nil {
		old.SetEventHandler(nil)
		old.Disconnect()
	}

	parsed, err := ParseCookieString(joinCookies(values))
	if err != nil {
		return s.fail(StatusExpired, err)
	}
	cli := messagix.NewClient(newFBCookies(parsed), s.Log.With().Str("component", "messagix").Logger(),
		&messagix.Config{ClientSettings: exhttp.SensibleClientSettings})
	if s.Proxy != "" {
		proxy := s.Proxy
		cli.GetHTTP().GetNewProxy = func(string) (string, error) { return proxy, nil }
		if !cli.GetHTTP().UpdateProxy("connect") {
			return s.fail(StatusError, errors.New("proxy không hợp lệ"))
		}
	}
	cli.SetEventHandler(s.handleMetaEvent)
	s.setStatus(StatusConnecting, "", false)

	_, initial, err := cli.LoadMessagesPage(ctx)
	if err != nil {
		switch {
		case errors.Is(err, httpclient.ErrTokenInvalidated):
			return s.fail(StatusExpired, err)
		case errors.Is(err, httpclient.ErrCheckpointRequired), errors.Is(err, httpclient.ErrChallengeRequired),
			errors.Is(err, httpclient.ErrConsentRequired), errors.Is(err, httpclient.ErrAccountSuspended):
			return s.fail(StatusCheckpoint, err)
		}
		if ctx.Err() != nil {
			return StatusDisconnected, ctx.Err()
		}
		return s.fail(StatusError, err)
	}
	got := cli.GetCookies().GetUserID()
	s.mu.Lock()
	if s.FBID == 0 {
		s.FBID = got
	}
	fbid := s.FBID
	s.mu.Unlock()
	if got != fbid {
		return s.fail(StatusExpired, fmt.Errorf("cookie thuộc tài khoản %d, không phải %d", got, fbid))
	}
	s.learnTable(initial) // thread types and names only; old messages are not forwarded

	s.mu.Lock()
	if ctx.Err() != nil {
		s.mu.Unlock()
		cli.SetEventHandler(nil)
		cli.Disconnect()
		return StatusDisconnected, ctx.Err()
	}
	s.cli = cli
	s.connected = make(chan struct{})
	s.mu.Unlock()
	if err = cli.Connect(ctx); err != nil {
		return s.fail(StatusError, err)
	}
	return StatusConnecting, nil
}

func (s *Session) fail(status string, err error) (string, error) {
	notify := status
	if status == StatusError {
		notify = StatusDisconnected
	}
	s.setStatus(notify, err.Error(), true)
	s.Log.Warn().Err(err).Str("status", status).Msg("Connect failed")
	return status, err
}

func (s *Session) setStatus(status, errMsg string, notify bool) {
	s.mu.Lock()
	s.status, s.lastErr = status, errMsg
	send := notify && s.lastSent != status && status != StatusConnecting
	if send {
		s.lastSent = status
	}
	s.mu.Unlock()
	if send && s.OnStatus != nil {
		s.OnStatus(&StatusPayload{Type: "status", AccountID: s.AccountID, Status: status, Error: strPtr(errMsg)})
	}
}

func (s *Session) handleMetaEvent(ctx context.Context, rawEvt any) {
	switch evt := rawEvt.(type) {
	case *table.LSTable:
		s.handleTable(evt)
	case *messagix.ConnectedEvent, *messagix.ReconnectedEvent:
		s.setStatus(StatusConnected, "", true)
		s.mu.Lock()
		if s.connected != nil {
			select {
			case <-s.connected:
			default:
				close(s.connected)
			}
		}
		needE2EE := s.e2ee == nil && !s.e2eeConnecting && !s.e2eeDisabled && s.cli != nil
		if needE2EE {
			s.e2eeConnecting = true
		}
		cli := s.cli
		if cli != nil {
			for k, v := range cli.GetCookies().GetAll() {
				s.Cookies[string(k)] = v
			}
		}
		s.mu.Unlock()
		if s.OnPersist != nil {
			s.OnPersist()
		}
		if needE2EE && cli != nil {
			go s.connectE2EE(cli)
		}
	case *messagix.TransientDisconnectEvent:
		s.setStatus(StatusConnecting, "", false) // messagix reconnects by itself
	case *messagix.PermanentErrorEvent:
		if websocket.CloseStatus(evt.Err) == dgw.CloseStatusUnauthorized {
			s.setStatus(StatusExpired, evt.Err.Error(), true)
			return
		}
		s.setStatus(StatusDisconnected, evt.Err.Error(), true)
		go s.retryLoop()
	}
}

func (s *Session) learnTable(tbl *table.LSTable) {
	if tbl == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	mark := func(key int64, tt table.ThreadType) {
		if tt.IsWhatsApp() {
			s.e2eePeers[key] = true
			delete(s.plainPeers, key)
		} else if tt.IsOneToOne() {
			s.plainPeers[key] = true
		}
		if tt != 0 && !tt.IsOneToOne() {
			s.groups[key] = true
		}
	}
	for _, t := range tbl.LSDeleteThenInsertThread {
		mark(t.ThreadKey, t.ThreadType)
	}
	for _, t := range tbl.LSVerifyThreadExists {
		mark(t.ThreadKey, t.ThreadType)
	}
	// A "hybrid" FB thread has moved to an E2EE (WhatsApp-protocol) chat.
	for _, t := range tbl.LSVerifyHybridThreadExists {
		s.e2eePeers[t.ThreadKey], s.e2eePeers[t.ThreadJID] = true, true
		delete(s.plainPeers, t.ThreadKey)
		delete(s.plainPeers, t.ThreadJID)
	}
	for _, t := range tbl.LSUpdateThreadAuthorityAndMappingWithOTIDFromJID {
		s.e2eePeers[t.ThreadKey], s.e2eePeers[t.ThreadJID] = true, true
		delete(s.plainPeers, t.ThreadKey)
		delete(s.plainPeers, t.ThreadJID)
	}
	for _, t := range tbl.LSMoveThreadToE2EECutoverFolder {
		s.e2eePeers[t.ThreadKey] = true
		delete(s.plainPeers, t.ThreadKey)
	}
	for _, c := range tbl.LSVerifyContactRowExists {
		if c.Name != "" {
			s.names[c.ContactId] = c.Name
		}
	}
	for _, c := range tbl.LSDeleteThenInsertContact {
		if c.Name != "" {
			s.names[c.Id] = c.Name
		}
	}
}

func (s *Session) handleTable(tbl *table.LSTable) {
	s.learnTable(tbl)
	_, inserts := tbl.WrapMessages()
	for _, msg := range inserts {
		s.mu.Lock()
		group := s.groups[msg.ThreadKey]
		name := s.names[msg.ThreadKey]
		s.mu.Unlock()
		if group {
			continue
		}
		if p, ok := mapLSMessage(s.AccountID, s.FBID, msg, name); ok && s.OnMessage != nil {
			s.OnMessage(p)
		}
	}
}

func (s *Session) connectE2EE(cli *messagix.Client) {
	defer func() {
		s.mu.Lock()
		s.e2eeConnecting = false
		s.mu.Unlock()
	}()
	ctx := s.Log.WithContext(context.Background())
	log := s.Log.With().Str("component", "e2ee").Logger()
	s.mu.Lock()
	dev, deviceID := s.device, s.DeviceID
	s.mu.Unlock()
	var err error
	if dev == nil && deviceID != 0 {
		dev, err = s.Devices.GetDevice(ctx, waTypes.JID{User: strconv.FormatInt(s.FBID, 10), Device: deviceID, Server: waTypes.MessengerServer})
		if err != nil {
			log.Err(err).Msg("Failed to load E2EE device")
			return
		}
	}
	isNew := dev == nil
	if isNew {
		dev = s.Devices.NewDevice()
	}
	cli.SetDevice(dev)
	if isNew {
		log.Info().Msg("Registering new E2EE device")
		if err = cli.RegisterE2EE(ctx, s.FBID); err != nil {
			log.Err(err).Msg("Failed to register E2EE device")
			return
		}
		if err = dev.Save(ctx); err != nil {
			log.Err(err).Msg("Failed to save E2EE device")
			return
		}
		s.mu.Lock()
		s.DeviceID = dev.ID.Device
		s.mu.Unlock()
		if s.OnPersist != nil {
			s.OnPersist()
		}
	}
	e2ee, err := cli.PrepareE2EEClient()
	if err != nil {
		log.Err(err).Msg("Failed to prepare E2EE client")
		return
	}
	if s.Proxy != "" {
		if err = e2ee.SetProxyAddress(s.Proxy); err != nil {
			log.Warn().Msg("Invalid proxy for E2EE")
			return
		}
	}
	e2ee.SynchronousAck = true
	e2ee.AddEventHandlerWithSuccessStatus(func(evt any) bool { return s.handleE2EEEvent(e2ee, evt) })
	s.mu.Lock()
	if s.cli != cli { // reconnected/stopped meanwhile
		s.mu.Unlock()
		return
	}
	s.device, s.e2ee = dev, e2ee
	s.mu.Unlock()
	if err = e2ee.Connect(); err != nil {
		log.Err(err).Msg("Failed to connect E2EE socket")
	}
}

func (s *Session) resetE2EE(e2ee *whatsmeow.Client) *messagix.Client {
	e2ee.Disconnect()
	s.mu.Lock()
	if s.e2ee != nil && s.e2ee != e2ee {
		s.mu.Unlock()
		return nil
	}
	s.e2ee = nil
	s.device = nil
	s.DeviceID = 0
	var cli *messagix.Client
	if !s.e2eeConnecting && s.cli != nil {
		s.e2eeConnecting = true
		cli = s.cli
	}
	s.mu.Unlock()
	if s.OnPersist != nil {
		s.OnPersist()
	}
	return cli
}

func (s *Session) handleE2EEEvent(e2ee *whatsmeow.Client, rawEvt any) bool {
	switch evt := rawEvt.(type) {
	case *events.FBMessage:
		if evt.Info.Chat.Server == waTypes.MessengerServer {
			if peer, err := strconv.ParseInt(evt.Info.Chat.User, 10, 64); err == nil {
				s.mu.Lock()
				s.e2eePeers[peer] = true
				delete(s.plainPeers, peer)
				s.mu.Unlock()
			}
		}
		if p, ok := mapE2EEMessage(s.AccountID, evt); ok && s.OnMessage != nil {
			// E2EE PushName is a placeholder ("username") on Messenger; prefer the contact name learnt from LightSpeed.
			if peer, err := strconv.ParseInt(p.PeerID, 10, 64); err == nil {
				s.mu.Lock()
				name := s.names[peer]
				s.mu.Unlock()
				if name != "" {
					p.PeerName = strPtr(name)
				} else if p.PeerName != nil && *p.PeerName == "username" {
					p.PeerName = nil
				}
			}
			s.OnMessage(p)
		}
	case *events.Connected:
		s.Log.Info().Msg("E2EE socket connected")
		s.mu.Lock()
		s.e2eeRetry = false
		s.mu.Unlock()
	case *events.ConnectFailure:
		// 415: the device is gone server-side; register a fresh one once (same as the bridge).
		if evt.Reason == events.ConnectFailureNotFound {
			s.mu.Lock()
			// Joins e2eeConnecting so a concurrent reconnect cannot register a second device.
			retry := !s.e2eeRetry && s.e2ee == e2ee && !s.e2eeConnecting && s.cli != nil
			s.e2eeRetry = true
			cli, dev := s.cli, s.device
			if retry {
				s.e2ee, s.device, s.DeviceID = nil, nil, 0
				s.e2eeConnecting = true
			}
			s.mu.Unlock()
			if s.OnPersist != nil {
				s.OnPersist()
			}
			if retry && cli != nil {
				go func() {
					e2ee.Disconnect()
					if dev != nil {
						_ = dev.Delete(context.Background())
					}
					s.connectE2EE(cli)
				}()
			}
			return true
		}
		if evt.Reason == 418 || evt.Reason == events.ConnectFailureClientUnknown {
			s.mu.Lock()
			retry := !s.e2eeRetry && s.e2ee == e2ee
			s.e2eeRetry = true
			s.mu.Unlock()
			if retry {
				s.Log.Warn().Str("reason", evt.Reason.String()).Msg("E2EE client unknown, re-registering")
				if cli := s.resetE2EE(e2ee); cli != nil {
					go s.connectE2EE(cli)
				}
			} else {
				s.Log.Warn().Str("reason", evt.Reason.String()).Msg("E2EE client unknown, retry already attempted")
			}
			return true
		}
		if evt.Reason == 400 || evt.Reason == events.ConnectFailureGeneric {
			e2ee.Disconnect()
			if !s.dropCurrentE2EE(e2ee) {
				return true // stale client already replaced: no full reconnect
			}
			s.Log.Warn().Str("reason", evt.Reason.String()).Msg("E2EE connect failure 400, reconnecting")
			s.setStatus(StatusDisconnected, evt.Reason.String(), true)
			go s.retryLoop()
			return true
		}
		s.Log.Warn().Str("reason", evt.Reason.String()).Msg("E2EE connect failure")
	case *events.CATRefreshError:
		e2ee.Disconnect()
		if !s.dropCurrentE2EE(e2ee) {
			return true
		}
		s.Log.Warn().Msg("E2EE CAT refresh error, reconnecting")
		s.setStatus(StatusDisconnected, "CAT refresh error", true)
		go s.retryLoop()
	case *events.LoggedOut:
		if evt.Reason == events.ConnectFailureLoggedOut && !evt.OnConnect {
			s.mu.Lock()
			retry := !s.e2eeRetry && s.e2ee == e2ee
			s.e2eeRetry = true
			s.mu.Unlock()
			if retry {
				s.Log.Warn().Msg("E2EE device logged out, re-registering")
				if cli := s.resetE2EE(e2ee); cli != nil {
					go s.connectE2EE(cli)
				}
				return true
			}
		}
		e2ee.Disconnect()
		s.mu.Lock()
		if s.e2ee != nil && s.e2ee != e2ee {
			s.mu.Unlock()
			return true
		}
		s.e2ee = nil
		s.device = nil
		s.DeviceID = 0
		if evt.Reason == events.ConnectFailureMainDeviceGone || evt.Reason == events.ConnectFailureUnknownLogout {
			s.e2eeDisabled = true
		}
		s.mu.Unlock()
		if s.OnPersist != nil {
			s.OnPersist()
		}
		s.Log.Warn().Str("account_id", s.AccountID).Int("reason", int(evt.Reason)).Msg("E2EE device logged out, not reconnecting")
	}
	return true
}

// dropCurrentE2EE clears s.e2ee if it is still e2ee; false means e2ee was already replaced.
func (s *Session) dropCurrentE2EE(e2ee *whatsmeow.Client) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.e2ee != e2ee {
		return false
	}
	s.e2ee = nil
	return true
}

// Send sends a text to a 1:1 chat. It uses the E2EE path when that chat is known to be
// end-to-end encrypted, otherwise the normal LightSpeed path. Returns (message_id, e2ee).
func (s *Session) Send(ctx context.Context, recipient int64, text string) (string, bool, error) {
	s.mu.Lock()
	cli, e2ee := s.cli, s.e2ee
	isE2EE := s.e2eePeers[recipient]
	isNonE2EE := s.plainPeers[recipient]
	s.mu.Unlock()
	if cli == nil {
		return "", false, errors.New("tài khoản chưa kết nối")
	}
	otid := methods.GenerateEpochID()
	otidStr := strconv.FormatInt(otid, 10)

	// shortcut: tuyến gửi cho peer chưa biết đoán là E2EE; xác nhận lại bằng PoC với nick thật.
	tryE2EE := isE2EE || (!isNonE2EE && e2ee != nil && e2ee.IsConnected())
	if tryE2EE {
		if e2ee == nil {
			return "", true, errors.New("kết nối E2EE chưa sẵn sàng")
		}
		if !e2ee.IsConnected() && !e2ee.WaitForConnection(15*time.Second) {
			return "", true, errors.New("kết nối E2EE chưa sẵn sàng")
		}
		msgID, err := s.sendE2EE(ctx, e2ee, recipient, text, otidStr)
		if err == nil {
			s.mu.Lock()
			s.e2eePeers[recipient] = true
			delete(s.plainPeers, recipient)
			s.mu.Unlock()
			return msgID, true, nil
		}
		if isE2EE {
			return "", true, err
		}
		s.Log.Warn().Err(err).Int64("recipient", recipient).Msg("E2EE send failed for unknown peer, falling back to LightSpeed")
	}

	msgID, err := s.sendLightSpeed(ctx, cli, recipient, otid, text, otidStr)
	if err != nil {
		return "", false, err
	}
	s.mu.Lock()
	if !isE2EE {
		s.plainPeers[recipient] = true
	}
	s.mu.Unlock()
	return msgID, false, nil
}

func (s *Session) sendE2EE(ctx context.Context, e2ee *whatsmeow.Client, recipient int64, text, otidStr string) (string, error) {
	msg := &waConsumerApplication.ConsumerApplication{
		Payload: &waConsumerApplication.ConsumerApplication_Payload{
			Payload: &waConsumerApplication.ConsumerApplication_Payload_Content{
				Content: &waConsumerApplication.ConsumerApplication_Content{
					Content: &waConsumerApplication.ConsumerApplication_Content_MessageText{
						MessageText: &waCommon.MessageText{Text: &text},
					},
				},
			},
		},
	}
	to := waTypes.NewJID(strconv.FormatInt(recipient, 10), waTypes.MessengerServer)
	resp, err := e2ee.SendFBMessage(ctx, to, msg, &waMsgApplication.MessageApplication_Metadata{}, whatsmeow.SendRequestExtra{ID: otidStr})
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (s *Session) sendLightSpeed(ctx context.Context, cli *messagix.Client, recipient, otid int64, text, otidStr string) (string, error) {
	if err := cli.WaitUntilCanSendMessages(ctx, 15*time.Second); err != nil {
		return "", err
	}
	resp, err := cli.ExecuteTasks(ctx, &socket.SendMessageTask{
		ThreadId:         recipient,
		Otid:             otid,
		Source:           table.MESSENGER_INBOX_IN_THREAD,
		InitiatingSource: table.FACEBOOK_INBOX,
		SendType:         table.TEXT,
		SyncGroup:        1,
		Text:             text,
	})
	if err != nil {
		return "", err
	}
	if resp != nil {
		for _, r := range resp.LSReplaceOptimsiticMessage {
			if r.OfflineThreadingId == otidStr {
				return r.MessageId, nil
			}
		}
		for _, f := range resp.LSMarkOptimisticMessageFailed {
			return "", fmt.Errorf("Facebook từ chối tin nhắn: %s", f.Message)
		}
		for _, f := range resp.LSHandleFailedTask {
			return "", fmt.Errorf("Facebook từ chối tin nhắn: %s", f.Message)
		}
	}
	return "", errors.New("Facebook không trả về message_id")
}

func joinCookies(values map[string]string) string {
	parts := make([]string, 0, len(values))
	for k, v := range values {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}
