// poc: connect one account from a cookie file, print every incoming message as one JSON line
// on stdout, optionally send one text. Logs go to stderr. Used to verify E2EE without a backend.
//
//	poc [--proxy URL] [--data-dir DIR] [--send-to UID --text TEXT] cookies.txt
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/seeding-team/messenger-bridge/internal/bridge"
)

func main() {
	proxy := flag.String("proxy", "", "proxy URL (http://, socks5://)")
	dataDir := flag.String("data-dir", "./poc-data", "where the E2EE device store is kept")
	sendTo := flag.String("send-to", "", "numeric Facebook UID to send --text to")
	text := flag.String("text", "", "text to send")
	flag.Parse()
	log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr}).With().Timestamp().Logger().Level(zerolog.InfoLevel)
	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: poc [--proxy URL] [--data-dir DIR] [--send-to UID --text TEXT] cookies.txt")
		os.Exit(2)
	}
	raw, err := os.ReadFile(flag.Arg(0))
	if err != nil {
		log.Fatal().Err(err).Msg("Cannot read cookie file")
	}
	values, err := bridge.ParseCookieString(strings.TrimSpace(string(raw)))
	if err != nil {
		log.Fatal().Err(err).Msg("Invalid cookie file")
	}
	cookies := map[string]string{}
	for k, v := range values {
		cookies[string(k)] = v
	}

	devices, err := bridge.OpenDeviceStore(context.Background(), *dataDir, log)
	if err != nil {
		log.Fatal().Err(err).Msg("Cannot open device store")
	}
	// The E2EE device id is kept next to the device store so reruns reuse the same device.
	idFile := *dataDir + "/wa_device_id"
	var deviceID uint16
	if b, err := os.ReadFile(idFile); err == nil {
		n, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 16)
		deviceID = uint16(n)
	}

	out := json.NewEncoder(os.Stdout)
	sess := &bridge.Session{
		AccountID: "poc",
		Cookies:   cookies,
		Proxy:     *proxy,
		Devices:   devices,
		DeviceID:  deviceID,
		Log:       log,
		OnMessage: func(p *bridge.MessagePayload) { _ = out.Encode(p) },
		OnStatus:  func(p *bridge.StatusPayload) { _ = out.Encode(p) },
	}
	sess.OnPersist = func() {
		if _, id := sess.Snapshot(); id != 0 {
			_ = os.WriteFile(idFile, []byte(strconv.Itoa(int(id))), 0o600)
		}
	}
	st, err := sess.Start()
	if err != nil {
		log.Fatal().Err(err).Str("status", st).Msg("Connect failed")
	}
	log.Info().Str("status", st).Msg("Connected; waiting for messages (Ctrl+C to quit)")

	if *sendTo != "" {
		uid, err := strconv.ParseInt(*sendTo, 10, 64)
		if err != nil || *text == "" {
			log.Fatal().Msg("--send-to must be a numeric UID and --text non-empty")
		}
		for i := 0; i < 30; i++ { // give the E2EE socket time to come up
			if _, e2ee, _ := sess.Status(); e2ee {
				break
			}
			time.Sleep(time.Second)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		id, e2ee, err := sess.Send(ctx, uid, *text)
		cancel()
		res := map[string]any{"type": "send_result", "ok": err == nil, "message_id": id, "e2ee": e2ee}
		if err != nil {
			res["error"] = err.Error()
		}
		_ = out.Encode(res)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	sess.Stop()
}
