// messenger-bridge: keeps one Facebook Messenger session per personal account (normal + E2EE
// chats via go.mau.fi/mautrix-meta/pkg/messagix and whatsmeow), forwards incoming messages to the
// backend webhook and sends text on request. AGPL-3.0 — see README.md.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/seeding-team/messenger-bridge/internal/bridge"
)

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func main() {
	log := zerolog.New(os.Stdout).With().Timestamp().Logger().Level(zerolog.InfoLevel)
	key := env("BRIDGE_KEY", strings.TrimSpace(os.Getenv("MESSENGER_BRIDGE_KEY"))) // compose passes the backend .env
	if key == "" {
		log.Fatal().Msg("BRIDGE_KEY (or MESSENGER_BRIDGE_KEY) is required")
	}
	listen := env("BRIDGE_LISTEN", ":8090")
	dataDir := env("BRIDGE_DATA_DIR", "/data")
	hookURL := strings.TrimSpace(os.Getenv("BACKEND_WEBHOOK_URL"))
	if hookURL == "" {
		log.Warn().Msg("BACKEND_WEBHOOK_URL is empty: incoming messages will be dropped")
	}

	ctx := context.Background()
	devices, err := bridge.OpenDeviceStore(ctx, dataDir, log)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to open E2EE device store")
	}
	mgr := &bridge.Manager{
		DataDir: dataDir,
		Devices: devices,
		Hook:    &bridge.Webhook{URL: hookURL, Key: key, Dir: filepath.Join(dataDir, "outbox"), Log: log.With().Str("component", "webhook").Logger()},
		Log:     log,
	}
	mgr.Hook.Start() // resend events left in the outbox by the previous run
	if err = mgr.Load(); err != nil {
		log.Fatal().Err(err).Msg("Failed to load accounts")
	}

	srv := &http.Server{Addr: listen, Handler: bridge.NewHandler(mgr, key), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Info().Str("listen", listen).Int("accounts", mgr.Count()).Msg("messenger-bridge started")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("HTTP server failed")
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	mgr.Stop()
}
