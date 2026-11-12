package bridge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.mau.fi/mautrix-meta/pkg/messagix/table"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waConsumerApplication"
	waTypes "go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func TestParseCookieString(t *testing.T) {
	got, err := ParseCookieString(" c_user=1000123; xs=12%3Aab==; datr=d1 ;; fr=; sb ; wd=1920x1080")
	if err != nil {
		t.Fatal(err)
	}
	if got["c_user"] != "1000123" || got["xs"] != "12%3Aab==" || got["datr"] != "d1" || got["wd"] != "1920x1080" {
		t.Fatalf("bad parse: %v", got)
	}
	if _, ok := got["fr"]; ok {
		t.Fatal("empty values must be skipped")
	}
	if _, err = ParseCookieString("c_user=1; datr=x"); err == nil || !strings.Contains(err.Error(), "xs") {
		t.Fatalf("expected missing xs error, got %v", err)
	}
}

func TestRequireKey(t *testing.T) {
	m := &Manager{}
	_ = m.Load() // DataDir "" -> no file; initialises maps
	h := NewHandler(m, "secret")
	cases := []struct {
		method, path, key string
		want              int
	}{
		{"GET", "/health", "", 200},
		{"GET", "/accounts/a/status", "", 401},
		{"GET", "/accounts/a/status", "wrong", 401},
		{"GET", "/accounts/a/status", "secretx", 401},
		{"GET", "/accounts/a/status", "secret", 404}, // authorised, unknown account
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, nil)
		if c.key != "" {
			req.Header.Set("X-Bridge-Key", c.key)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s key=%q: got %d want %d", c.method, c.path, c.key, rec.Code, c.want)
		}
	}
	// An empty configured key must never authorise.
	rec := httptest.NewRecorder()
	RequireKey("", http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 401 {
		t.Fatalf("empty key: got %d", rec.Code)
	}
}

func TestMapLSMessage(t *testing.T) {
	const self, peer = int64(111), int64(222)
	in := &table.WrappedMessage{LSInsertMessage: &table.LSInsertMessage{
		Text: "xin chào", ThreadKey: peer, SenderId: peer, MessageId: "mid.$abc", TimestampMs: 1794000000000,
	}}
	p, ok := mapLSMessage("acc1", self, in, "Lan")
	if !ok {
		t.Fatal("expected message")
	}
	b, _ := json.Marshal(p)
	want := `{"type":"message","account_id":"acc1","peer_id":"222","peer_name":"Lan","message_id":"mid.$abc","text":"xin chào","is_self":false,"e2ee":false,"timestamp_ms":1794000000000,"attachments":[]}`
	if string(b) != want {
		t.Fatalf("payload\n got %s\nwant %s", b, want)
	}

	in.SenderId = self // sent from the account's phone / echo
	if p, _ = mapLSMessage("acc1", self, in, "Lan"); !p.IsSelf || p.PeerID != "222" || p.PeerName != nil {
		t.Fatalf("self message mapped wrong: %+v", p)
	}

	in.SenderId = 333 // third party => group thread
	if _, ok = mapLSMessage("acc1", self, in, ""); ok {
		t.Fatal("group message must be skipped")
	}

	in.SenderId, in.Text = peer, ""
	in.BlobAttachments = []*table.LSInsertBlobAttachment{{AttachmentType: table.AttachmentTypeImage, PreviewUrl: "https://x/img.jpg", Filename: "a.jpg"}}
	p, ok = mapLSMessage("acc1", self, in, "")
	if !ok || p.Text != attachmentPlaceholder || len(p.Attachments) != 1 || p.Attachments[0].Kind != "image" || p.Attachments[0].URL != "https://x/img.jpg" {
		t.Fatalf("attachment mapped wrong: %+v", p)
	}
	if p.PeerName != nil {
		t.Fatal("empty name must be null")
	}
}

func TestMapE2EEMessage(t *testing.T) {
	text := "chào E2EE"
	evt := &events.FBMessage{
		Info: waTypes.MessageInfo{
			MessageSource: waTypes.MessageSource{Chat: waTypes.NewJID("222", waTypes.MessengerServer), IsFromMe: false},
			ID:            "7123", PushName: "Lan", Timestamp: time.UnixMilli(1794000000000),
		},
		Message: &waConsumerApplication.ConsumerApplication{Payload: &waConsumerApplication.ConsumerApplication_Payload{
			Payload: &waConsumerApplication.ConsumerApplication_Payload_Content{Content: &waConsumerApplication.ConsumerApplication_Content{
				Content: &waConsumerApplication.ConsumerApplication_Content_MessageText{MessageText: &waCommon.MessageText{Text: &text}},
			}},
		}},
	}
	p, ok := mapE2EEMessage("acc1", evt)
	if !ok || p.PeerID != "222" || p.Text != text || !p.E2EE || p.IsSelf || p.MessageID != "7123" ||
		p.TimestampMS != 1794000000000 || p.PeerName == nil || *p.PeerName != "Lan" {
		t.Fatalf("bad e2ee payload: %+v", p)
	}
	evt.Info.Chat = waTypes.NewJID("999", waTypes.GroupServer)
	if _, ok = mapE2EEMessage("acc1", evt); ok {
		t.Fatal("group E2EE message must be skipped")
	}
}

func TestWebhookRetries(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-Bridge-Key") != "k" {
			t.Errorf("missing key header")
		}
		if calls < 2 {
			w.WriteHeader(500)
			return
		}
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer srv.Close()
	w := &Webhook{URL: srv.URL, Key: "k"}
	if err := w.deliver(&StatusPayload{Type: "status", AccountID: "a", Status: StatusConnected}); err != nil || calls != 2 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}
