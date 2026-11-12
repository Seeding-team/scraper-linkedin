package bridge

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// RequireKey rejects requests whose X-Bridge-Key header doesn't match key (constant-time).
func RequireKey(key string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("X-Bridge-Key")
		if key == "" || subtle.ConstantTimeCompare([]byte(got), []byte(key)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// NewHandler builds the HTTP API from plan.md ("Hợp đồng giữa các phần").
func NewHandler(m *Manager, key string) http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("POST /accounts/{account_id}/connect", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			FBUserID  string `json:"fb_user_id"`
			Cookie    string `json:"cookie"`
			UserAgent string `json:"user_agent"`
			ProxyURL  string `json:"proxy_url"`
		}
		if !readJSON(w, r, &req) {
			return
		}
		st, err := m.Connect(r.PathValue("account_id"), &StoredAccount{
			FBUserID: strings.TrimSpace(req.FBUserID), Cookie: req.Cookie, ProxyURL: req.ProxyURL, UserAgent: req.UserAgent,
		})
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "status": st, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": st})
	})
	api.HandleFunc("DELETE /accounts/{account_id}", func(w http.ResponseWriter, r *http.Request) {
		m.Delete(r.PathValue("account_id"))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	api.HandleFunc("GET /accounts/{account_id}/status", func(w http.ResponseWriter, r *http.Request) {
		sess := m.Get(r.PathValue("account_id"))
		if sess == nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "status": StatusDisconnected, "e2ee": false, "error": "account not found"})
			return
		}
		st, e2ee, lastErr := sess.Status()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": st, "e2ee": e2ee, "error": strPtr(lastErr)})
	})
	api.HandleFunc("POST /accounts/{account_id}/send", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RecipientID string `json:"recipient_id"`
			Text        string `json:"text"`
			// client_msg_id is intentionally ignored: backend's 19-digit random id can overflow int64
			// and is not a valid Facebook OTID. Bridge generates its own OTID with methods.GenerateEpochID().
			ClientMsgID string `json:"client_msg_id"`
		}
		if !readJSON(w, r, &req) {
			return
		}
		recipient, err := strconv.ParseInt(strings.TrimSpace(req.RecipientID), 10, 64)
		if err != nil || recipient <= 0 || strings.TrimSpace(req.Text) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "recipient_id phải là UID số và text không được rỗng"})
			return
		}
		sess := m.Get(r.PathValue("account_id"))
		if sess == nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "account not found"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
		defer cancel()
		msgID, e2ee, err := sess.Send(ctx, recipient, req.Text)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message_id": msgID, "e2ee": e2ee})
	})

	root := http.NewServeMux()
	root.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "accounts": m.Count()})
	})
	root.Handle("/", RequireKey(key, api))
	return root
}

func readJSON(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(into); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid JSON body"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
