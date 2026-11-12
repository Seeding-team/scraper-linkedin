package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "modernc.org/sqlite" // pure-Go driver "sqlite": no cgo needed in the image
)

// StoredAccount is one entry of /data/accounts.json (file mode 0600, contains cookies).
type StoredAccount struct {
	FBUserID   string `json:"fb_user_id"`
	Cookie     string `json:"cookie"`
	ProxyURL   string `json:"proxy_url,omitempty"`
	UserAgent  string `json:"user_agent,omitempty"`
	WADeviceID uint16 `json:"wa_device_id,omitempty"`
}

// OpenDeviceStore opens the whatsmeow E2EE device store (SQLite) under dataDir.
func OpenDeviceStore(ctx context.Context, dataDir string, log zerolog.Logger) (*sqlstore.Container, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.Join(dataDir, "e2ee.db") + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	return sqlstore.New(ctx, "sqlite", dsn, waLog.Zerolog(log.With().Str("component", "whatsmeow-db").Logger()))
}

type Manager struct {
	DataDir string
	Devices *sqlstore.Container
	Hook    *Webhook
	Log     zerolog.Logger

	mu       sync.Mutex
	saveMu   sync.Mutex
	accounts map[string]*StoredAccount
	sessions map[string]*Session
}

func (m *Manager) path() string { return filepath.Join(m.DataDir, "accounts.json") }

// Load reads accounts.json and reconnects every stored account in the background.
func (m *Manager) Load() error {
	m.mu.Lock()
	m.accounts, m.sessions = map[string]*StoredAccount{}, map[string]*Session{}
	m.mu.Unlock()
	data, err := os.ReadFile(m.path())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	stored := map[string]*StoredAccount{}
	if err = json.Unmarshal(data, &stored); err != nil {
		return fmt.Errorf("accounts.json hỏng: %w", err)
	}
	for id, acc := range stored {
		m.mu.Lock()
		m.accounts[id] = acc
		sess := m.newSession(id, acc)
		m.sessions[id] = sess
		m.mu.Unlock()
		go func() {
			if st, err := sess.Start(); err != nil {
				m.Log.Warn().Str("account_id", id).Str("status", st).Err(err).Msg("Reconnect on boot failed")
			}
		}()
	}
	return nil
}

func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

func (m *Manager) newSession(id string, acc *StoredAccount) *Session {
	fbid, _ := strconv.ParseInt(acc.FBUserID, 10, 64)
	values, _ := ParseCookieString(acc.Cookie) // validated again in connectOnce
	cookies := make(map[string]string, len(values))
	for k, v := range values {
		cookies[string(k)] = v
	}
	s := &Session{
		AccountID: id,
		FBID:      fbid,
		Cookies:   cookies,
		Proxy:     acc.ProxyURL,
		Devices:   m.Devices,
		DeviceID:  acc.WADeviceID,
		Log:       m.Log.With().Str("account_id", id).Logger(),
	}
	s.OnMessage = func(p *MessagePayload) { m.Hook.Enqueue(p) }
	s.OnStatus = func(p *StatusPayload) { m.Hook.Enqueue(p) }
	s.OnPersist = func() {
		cookie, dev := s.Snapshot()
		m.mu.Lock()
		if cur, ok := m.accounts[id]; ok && m.sessions[id] == s {
			if cookie != "" {
				cur.Cookie = cookie
			}
			cur.WADeviceID = dev
		}
		m.mu.Unlock()
		m.save()
	}
	return s
}

// Connect (re)connects an account with new credentials. Existing session is replaced.
func (m *Manager) Connect(id string, acc *StoredAccount) (string, error) {
	if _, err := ParseCookieString(acc.Cookie); err != nil {
		return StatusExpired, err
	}
	if _, err := strconv.ParseInt(acc.FBUserID, 10, 64); err != nil {
		return StatusError, errors.New("fb_user_id phải là số")
	}
	if acc.ProxyURL != "" {
		u, err := url.Parse(acc.ProxyURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5") {
			return StatusError, errors.New("proxy_url không hợp lệ")
		}
	}
	m.mu.Lock()
	if old := m.accounts[id]; old != nil && old.FBUserID == acc.FBUserID {
		acc.WADeviceID = old.WADeviceID // keep the registered E2EE device
	}
	oldSess := m.sessions[id]
	m.accounts[id] = acc
	sess := m.newSession(id, acc)
	m.sessions[id] = sess
	m.mu.Unlock()
	if oldSess != nil {
		oldSess.Stop()
	}
	m.save()
	return sess.Start()
}

func (m *Manager) Delete(id string) {
	m.mu.Lock()
	sess := m.sessions[id]
	delete(m.sessions, id)
	delete(m.accounts, id)
	m.mu.Unlock()
	if sess != nil {
		sess.Stop()
	}
	m.save()
}

func (m *Manager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

// Stop stops all active sessions and drains the webhook queue (up to 8s).
func (m *Manager) Stop() {
	m.mu.Lock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.Unlock()

	for _, s := range sessions {
		s.Stop()
	}
	if m.Hook != nil {
		m.Hook.CloseAndWait(8 * time.Second)
	}
}

func (m *Manager) save() {
	m.saveMu.Lock()
	defer m.saveMu.Unlock()
	m.mu.Lock()
	data, err := json.MarshalIndent(m.accounts, "", "  ")
	m.mu.Unlock()
	if err == nil {
		tmp := m.path() + ".tmp"
		if err = os.WriteFile(tmp, data, 0o600); err == nil {
			_ = os.Chmod(tmp, 0o600)
			err = os.Rename(tmp, m.path())
		}
	}
	if err != nil {
		m.Log.Err(err).Msg("Failed to save accounts.json")
	}
}

func accountIDOf(payload any) string {
	switch p := payload.(type) {
	case *MessagePayload:
		return p.AccountID
	case *StatusPayload:
		return p.AccountID
	default:
		return ""
	}
}

// Webhook delivers payloads to the backend in order. Every payload is written to Dir first
// (one JSON file per event), so a backend outage or a bridge restart does not lose it. A file
// is removed once the backend answers 2xx or 4xx (retrying a rejected request cannot help), or
// when it is older than MaxAge. The backend dedupes on message_id.
type Webhook struct {
	URL    string
	Key    string
	Dir    string        // outbox directory, e.g. /data/outbox
	MaxAge time.Duration // default 24h
	Log    zerolog.Logger
	Client *http.Client

	mu      sync.Mutex
	started bool
	closed  bool
	seq     uint64
	wake    chan struct{}
	stop    chan struct{}
	done    chan struct{}
}

// Start begins delivering, including events left in the outbox by a previous run.
func (w *Webhook) Start() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.started || w.closed || w.URL == "" {
		return
	}
	if err := os.MkdirAll(w.Dir, 0o700); err != nil {
		w.Log.Err(err).Msg("Cannot create webhook outbox")
	}
	if w.Client == nil {
		w.Client = &http.Client{Timeout: 15 * time.Second}
	}
	if w.MaxAge == 0 {
		w.MaxAge = 24 * time.Hour
	}
	w.wake, w.stop, w.done = make(chan struct{}, 1), make(chan struct{}), make(chan struct{})
	w.started = true
	go w.run()
}

func (w *Webhook) Enqueue(payload any) {
	if w.URL == "" {
		return
	}
	w.Start()
	body, err := json.Marshal(payload)
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		w.Log.Warn().Str("account_id", accountIDOf(payload)).Msg("Webhook closed, dropping event")
		return
	}
	if err == nil {
		w.seq++
		// Zero-padded nanos sort lexically in arrival order; seq breaks ties.
		name := fmt.Sprintf("%020d-%09d.json", time.Now().UnixNano(), w.seq%1e9)
		err = writeFileSync(filepath.Join(w.Dir, name), body)
	}
	if err != nil {
		w.Log.Err(err).Str("account_id", accountIDOf(payload)).Msg("Cannot write webhook outbox, dropping event")
		return
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// CloseAndWait stops delivering and waits up to timeout for an in-flight request.
// Undelivered events stay in the outbox for the next start.
func (w *Webhook) CloseAndWait(timeout time.Duration) {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.closed = true
	started := w.started
	w.mu.Unlock()
	if !started {
		return
	}
	close(w.stop)
	select {
	case <-w.done:
	case <-time.After(timeout):
		w.Log.Warn().Msg("Webhook stop timed out")
	}
}

func (w *Webhook) run() {
	defer close(w.done)
	delay := time.Second
	for {
		names, err := filepath.Glob(filepath.Join(w.Dir, "*.json"))
		if err != nil || len(names) == 0 {
			select {
			case <-w.wake:
				continue
			case <-w.stop:
				return
			}
		}
		sort.Strings(names)
		if w.deliverFile(names[0]) {
			delay = time.Second
			continue
		}
		select { // keep the oldest event first: retry it until it goes through or expires
		case <-time.After(delay):
		case <-w.stop:
			return
		}
		delay = min(delay*2, time.Minute)
	}
}

// deliverFile returns false when the event must be retried later.
func (w *Webhook) deliverFile(path string) bool {
	body, err := os.ReadFile(path)
	if err != nil {
		w.Log.Err(err).Str("file", filepath.Base(path)).Msg("Unreadable outbox file, dropping")
		_ = os.Remove(path)
		return true
	}
	if nanos, perr := strconv.ParseInt(strings.SplitN(filepath.Base(path), "-", 2)[0], 10, 64); perr == nil &&
		time.Since(time.Unix(0, nanos)) > w.MaxAge {
		w.Log.Error().Str("file", filepath.Base(path)).Msg("Webhook event expired before backend accepted it, dropping")
		_ = os.Remove(path)
		return true
	}
	retryable, err := w.post(body)
	if err != nil && retryable {
		w.Log.Warn().Err(err).Str("file", filepath.Base(path)).Msg("Webhook delivery failed, will retry")
		return false
	}
	if err != nil {
		w.Log.Err(err).Str("file", filepath.Base(path)).Msg("Webhook rejected event, dropping")
	}
	_ = os.Remove(path)
	return true
}

func writeFileSync(path string, data []byte) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

func (w *Webhook) post(body []byte) (retryable bool, err error) {
	req, err := http.NewRequest(http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bridge-Key", w.Key)
	client := w.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return true, err // network error: retryable
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 500 {
		return true, fmt.Errorf("webhook HTTP %d", resp.StatusCode) // 5xx: retryable
	}
	if resp.StatusCode >= 400 {
		return false, fmt.Errorf("webhook HTTP %d", resp.StatusCode) // 4xx: do not retry
	}
	return false, nil
}
