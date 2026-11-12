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
	"strconv"
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

// Webhook delivers payloads to the backend in order, retrying failed deliveries.
type Webhook struct {
	URL    string
	Key    string
	Log    zerolog.Logger
	Client *http.Client

	queue   chan any
	done    chan struct{}
	once    sync.Once
	closed  bool
	closeMu sync.Mutex
}

func (w *Webhook) Enqueue(payload any) {
	w.once.Do(func() {
		w.queue = make(chan any, 1000)
		w.done = make(chan struct{})
		if w.Client == nil {
			w.Client = &http.Client{Timeout: 15 * time.Second}
		}
		go func() {
			defer close(w.done)
			for p := range w.queue {
				w.deliver(p)
			}
		}()
	})
	w.closeMu.Lock()
	defer w.closeMu.Unlock()
	if w.closed {
		w.Log.Warn().Str("account_id", accountIDOf(payload)).Msg("Webhook closed, dropping event")
		return
	}
	select {
	case w.queue <- payload:
	default:
		w.Log.Warn().Str("account_id", accountIDOf(payload)).Msg("Webhook queue full, dropping event")
	}
}

// CloseAndWait closes the webhook queue and waits up to timeout for pending deliveries.
func (w *Webhook) CloseAndWait(timeout time.Duration) {
	w.closeMu.Lock()
	if w.closed {
		w.closeMu.Unlock()
		return
	}
	w.closed = true
	q := w.queue
	done := w.done
	if q != nil {
		close(q)
	}
	w.closeMu.Unlock()

	if done != nil {
		select {
		case <-done:
		case <-time.After(timeout):
			w.Log.Warn().Msg("Webhook drain timed out")
		}
	}
}

// deliver sends once and retries 3 more times (1s, 2s, 4s) on network errors or 5xx.
// The backend dedupes on message_id.
func (w *Webhook) deliver(payload any) error {
	if w.URL == "" {
		return nil
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	delay := time.Second
	for attempt := 0; ; attempt++ {
		retryable, postErr := w.post(body)
		err = postErr
		if err == nil || !retryable || attempt == 3 {
			break
		}
		time.Sleep(delay)
		delay *= 2
	}
	if err != nil {
		w.Log.Err(err).Str("account_id", accountIDOf(payload)).Msg("Webhook delivery failed after retries")
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
