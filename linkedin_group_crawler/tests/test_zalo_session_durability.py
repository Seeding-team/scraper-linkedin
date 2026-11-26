"""Comprehensive offline test suite for Zalo Durable Server-Side QR Login,
Sticky VN Proxy, Cookie Health, Web-Slot Conflict Detection, and Extension Hardening.

All tests run 100% offline with mocks/tmp_path — ZERO Production DB or Zalo network calls!
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.routes.auth import router as zalo_auth_router
from app.modules.all_platform.zalo.schemas.session import SessionData
from app.modules.all_platform.zalo.services import (
    message_events,
    session_store,
    zca_auth_store,
    zca_persistent_listener,
    zca_qr_service,
)
from app.modules.all_platform.zalo.services.zca_auth_store import (
    extract_cookie_expiry,
    inspect_zca_auth_health,
    load_zca_auth,
    mask_proxy_url,
    save_zca_auth,
    validate_proxy_url,
)
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    ListenerState,
    WEB_SLOT_CONFLICT_MESSAGE,
    ZcaPersistentListenerManager,
    _is_web_slot_conflict,
)
from app.modules.all_platform.zalo.services.zca_qr_service import ZcaQrSessionManager

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = REPO_BACKEND_ROOT.parent
QR_LOGIN_JS_PATH = REPO_BACKEND_ROOT / "scripts" / "zca_qr_login.js"
LISTENER_JS_PATH = REPO_BACKEND_ROOT / "scripts" / "zca_persistent_listener.js"
EXT_DIR = REPO_ROOT / "extensions" / "extension-login-zalo"


# ──────────────────────────────────────────────────────────────────────────────
# 1. Chrome Extension Hardening Tests (manifest.json, background.js, popup.html)
# ──────────────────────────────────────────────────────────────────────────────


def test_extension_manifest_and_popup_hardening():
    manifest = json.loads((EXT_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert "https://dev.seeding.markeeai.com/*" in manifest["host_permissions"]
    assert "https://dev.seeding.markeeai.com/*" in manifest["content_scripts"][0]["matches"]

    bg_src = (EXT_DIR / "background.js").read_text(encoding="utf-8")
    assert '"https://dev.seeding.markeeai.com"' in bg_src
    assert "cachedImeiByAccount" in bg_src
    assert "removeTab" in bg_src

    popup_html = (EXT_DIR / "popup.html").read_text(encoding="utf-8")
    assert "Tab chat.zalo.me sẽ tự đóng sau khi đồng bộ" in popup_html
    assert "TUYỆT ĐỐI KHÔNG bấm Đăng xuất" in popup_html


def test_extension_background_per_account_imei_and_auto_close_behavior():
    """Run background.js in an isolated Node VM sandbox with mocked chrome.* APIs."""
    harness = r"""
    const fs = require("fs");
    const vm = require("vm");
    const bgPath = process.argv[1];
    const source = fs.readFileSync(bgPath, "utf8");

    const storage = {};
    const removedTabs = [];
    let nextFetchResponse = { ok: true, status: 200, text: async () => JSON.stringify({ status: "confirmed" }) };
    const postedBodies = [];
    let messageHandler = null;

    const chromeMock = {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { messageHandler = fn; } },
      },
      storage: {
        local: {
          get: async (keys) => {
            const out = {};
            for (const k of (Array.isArray(keys) ? keys : [keys])) {
              if (k in storage) out[k] = storage[k];
            }
            return out;
          },
          set: async (obj) => { Object.assign(storage, obj); },
        },
      },
      tabs: {
        query: (_q, cb) => cb([{ id: 77, url: "https://chat.zalo.me/", status: "complete" }]),
        get: (id, cb) => cb({ id, url: "https://chat.zalo.me/", status: "complete" }),
        create: (opts, cb) => cb({ id: 77, url: opts.url, status: "complete" }),
        remove: (id, cb) => { removedTabs.push(id); cb && cb(); },
        sendMessage: (_id, msg, cb) => {
          if (msg.action === "PING_ZALO_CONTENT") return cb({ success: true, data: { ok: true } });
          if (msg.action === "GET_ZALO_CONTEXT") {
            return cb({ success: true, data: { user_agent: "Mozilla/5.0 Chrome/145.0.0.0", imei: "" } });
          }
          cb({ success: true, data: {} });
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      cookies: {
        getAllCookieStores: (cb) => cb([{ id: "0" }]),
        getAll: (_d, cb) => cb([
          { name: "zpw_sek", value: "tok123", domain: ".zalo.me", path: "/", httpOnly: true, secure: true, expirationDate: 1900000000 },
        ]),
      },
      scripting: { executeScript: (_o, cb) => cb([]) },
    };

    const sandbox = {
      chrome: chromeMock,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      navigator: { userAgent: "Mozilla/5.0 Chrome/145.0.0.0" },
      crypto: require("crypto"),
      URL,
      Set,
      Map,
      Date,
      Math,
      JSON,
      Promise,
      setTimeout: (fn) => { fn(); return 0; },
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      fetch: async (_url, opts) => {
        postedBodies.push(JSON.parse(opts.body));
        return nextFetchResponse;
      },
    };
    vm.runInNewContext(source, sandbox);

    function callAction(action, data, senderOrigin = "https://dev.seeding.markeeai.com") {
      return new Promise((resolve) => {
        messageHandler({ action, data }, { tab: { url: senderOrigin + "/zalo" } }, resolve);
      });
    }

    (async () => {
      // 1. Origin dev.seeding.markeeai.com must be trusted
      const pingDev = await callAction("PING", {}, "https://dev.seeding.markeeai.com");
      const pingEvil = await callAction("PING", {}, "https://evil.example.com");

      // 2. Account A import: auto-closes tab (77) + creates account-scoped IMEI
      const resA = await callAction("IMPORT_ZALO_SESSION", { account_id: "zl_acc_a", backend_url: "http://localhost:8000" });

      // 3. Account B import with keepTab: true -> distinct IMEI, does NOT close tab
      const resB = await callAction("IMPORT_ZALO_SESSION", { account_id: "zl_acc_b", backend_url: "http://localhost:8000", keepTab: true });

      // 4. Account A re-import -> reuses exact same IMEI as step 2
      const resA2 = await callAction("IMPORT_ZALO_SESSION", { account_id: "zl_acc_a", backend_url: "http://localhost:8000" });

      // 5. Failed backend POST (500) -> does NOT close tab
      nextFetchResponse = { ok: false, status: 500, text: async () => JSON.stringify({ detail: "boom" }) };
      const resFail = await callAction("IMPORT_ZALO_SESSION", { account_id: "zl_acc_c", backend_url: "http://localhost:8000" });

      process.stdout.write(JSON.stringify({
        pingDev,
        pingEvil,
        resA,
        resB,
        resA2,
        resFail,
        removedTabs,
        postedImeis: postedBodies.map((b) => [b.account_id, b.imei]),
        cachedMapKeys: Object.keys(storage.cachedImeiByAccount || {}).sort(),
      }));
    })();
    """
    proc = subprocess.run(
        ["node", "-e", harness, str(EXT_DIR / "background.js")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=15,
    )
    out = json.loads(proc.stdout)

    assert out["pingDev"]["success"] is True
    assert out["pingEvil"]["success"] is False

    assert out["resA"]["success"] is True
    assert out["resA"]["data"]["tab_closed"] is True
    assert out["resB"]["success"] is True
    assert out["resB"]["data"]["tab_closed"] is False
    assert out["resA2"]["success"] is True
    assert out["resA2"]["data"]["tab_closed"] is True
    assert out["resFail"]["success"] is False

    # Tab closed on A and A2 ONLY (NOT on B keepTab=true and NOT on fail)
    assert out["removedTabs"] == [77, 77]

    # Per-account IMEI isolation + stability across re-imports
    imei_a1 = out["postedImeis"][0][1]
    imei_b = out["postedImeis"][1][1]
    imei_a2 = out["postedImeis"][2][1]
    assert imei_a1 == imei_a2
    assert imei_a1 != imei_b
    assert "zl_acc_a" in out["cachedMapKeys"]
    assert "zl_acc_b" in out["cachedMapKeys"]


# ──────────────────────────────────────────────────────────────────────────────
# 2. Node.js zca_qr_login.js & zca_persistent_listener.js Tests
# ──────────────────────────────────────────────────────────────────────────────


def test_zca_qr_login_dry_run_no_proxy_and_with_env_proxy():
    # Without proxy
    env_clean = {k: v for k, v in os.environ.items() if k != "ZALO_PROXY_URL"}
    proc1 = subprocess.run(
        ["node", str(QR_LOGIN_JS_PATH), "--dry-run"],
        cwd=str(REPO_BACKEND_ROOT),
        env=env_clean,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=15,
    )
    ev1 = json.loads(proc1.stdout.strip().splitlines()[-1])
    assert ev1["event"] == "ready"
    assert ev1["dry_run"] is True
    assert ev1["has_proxy"] is False
    assert 'v="145"' in ev1["sec_ch_ua"]

    # With proxy passed ONLY via env + persistent IMEI via CLI
    env_proxy = {**env_clean, "ZALO_PROXY_URL": "http://vnuser:supersecret99@103.10.20.30:8080"}
    proc2 = subprocess.run(
        ["node", str(QR_LOGIN_JS_PATH), "--dry-run", "--imei", "persist-imei-xyz"],
        cwd=str(REPO_BACKEND_ROOT),
        env=env_proxy,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=15,
    )
    assert "supersecret99" not in proc2.stdout
    ev2 = json.loads(proc2.stdout.strip().splitlines()[-1])
    assert ev2["event"] == "ready"
    assert ev2["dry_run"] is True
    assert ev2["has_proxy"] is True
    assert ev2["imei"] == "persist-imei-xyz"


def test_zca_qr_login_sec_ch_ua_sync_and_client_options():
    script = f"""
    const mod = require({json.dumps(str(QR_LOGIN_JS_PATH))});
    const ua145 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
    const ua138 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    const synced145 = mod.buildSyncedSecChUa(ua145);
    const synced138 = mod.buildSyncedSecChUa(ua138);

    const objHeaders = mod.syncSecChUaHeaders(
      {{ "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"', accept: "*/*" }},
      synced145,
      ua145
    );
    const hdrInst = new Headers({{ "sec-ch-ua": '"Chromium";v="130"' }});
    const syncedHdr = mod.syncSecChUaHeaders(hdrInst, synced138, ua138);

    const optsDirect = mod.createZcaClientOptions(ua145, "");
    const optsHttp = mod.createZcaClientOptions(ua145, "http://user:pw@127.0.0.1:8080");
    const optsSocks = mod.createZcaClientOptions(ua145, "socks5://user:pw@127.0.0.1:1080");
    optsDirect.__close();
    optsHttp.__close();
    optsSocks.__close();

    process.stdout.write(JSON.stringify({{
      synced145,
      synced138,
      objSecChUa: objHeaders["sec-ch-ua"],
      hdrSecChUa: syncedHdr.get("sec-ch-ua"),
      directHasPolyfill: typeof optsDirect.polyfill === "function",
      directHasProxy: optsDirect.__meta.has_proxy,
      httpKind: optsHttp.__meta.proxy_kind,
      socksKind: optsSocks.__meta.proxy_kind,
    }}));
    """
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_BACKEND_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=15,
    )
    res = json.loads(proc.stdout)
    assert '"Chromium";v="145"' in res["synced145"]
    assert '"Google Chrome";v="145"' in res["synced145"]
    assert '"Chromium";v="138"' in res["synced138"]
    assert res["objSecChUa"] == res["synced145"]
    assert res["hdrSecChUa"] == res["synced138"]
    assert res["directHasPolyfill"] is True
    assert res["directHasProxy"] is False
    assert res["httpKind"] == "http"
    assert res["socksKind"] == "socks"


# ──────────────────────────────────────────────────────────────────────────────
# 3. zca_auth_store.py: Proxy Validation/Masking & Cookie Expiry Health
# ──────────────────────────────────────────────────────────────────────────────


def test_proxy_validation_and_masking():
    assert validate_proxy_url(None) is None
    assert validate_proxy_url("   ") is None
    assert validate_proxy_url("http://u:p@1.2.3.4:8080") == "http://u:p@1.2.3.4:8080"
    assert validate_proxy_url("socks5://user:pass@vn.proxy.io:1080") == "socks5://user:pass@vn.proxy.io:1080"
    assert validate_proxy_url("socks5h://127.0.0.1:1080") == "socks5h://127.0.0.1:1080"

    for bad in ("ftp://1.2.3.4:21", "http://", "http://bad host:8080", "socks5://1.2.3.4\nX-Header: 1"):
        with pytest.raises(ValueError):
            validate_proxy_url(bad)

    assert mask_proxy_url("socks5://alice:topsecret@1.2.3.4:1080") == "socks5://***@1.2.3.4:1080"
    assert mask_proxy_url("http://user:pw@103.5.6.7:3128") == "http://***@103.5.6.7:3128"
    assert mask_proxy_url("http://103.5.6.7:3128") == "http://103.5.6.7:3128"
    assert mask_proxy_url(None) is None


def test_cookie_expiry_and_health_inspection():
    now = datetime(2026, 11, 26, 12, 0, 0, tzinfo=timezone.utc)

    # Priority auth cookie zpw_sek expiring in 10 hours -> expiring soon
    soon_ts = int((now + timedelta(hours=10)).timestamp())
    far_ts = int((now + timedelta(days=30)).timestamp())
    auth_soon = {
        "cookies": [
            {"key": "_ga", "value": "1", "expires": far_ts},
            {"key": "zpw_sek", "value": "abc", "expires": soon_ts},
        ],
        "proxy_url": "socks5://u:secret@103.1.2.3:1080",
    }
    health_soon = inspect_zca_auth_health(auth_soon, now=now)
    assert health_soon["cookie_expires_at"] == "2026-11-26T22:00:00Z"
    assert health_soon["cookie_expiring_soon"] is True
    assert health_soon["has_proxy"] is True
    assert health_soon["proxy_masked"] == "socks5://***@103.1.2.3:1080"
    assert "secret" not in str(health_soon)

    # Tough-cookie ISO string expiring in 5 days -> NOT expiring soon
    auth_ok = {
        "cookies": [
            {"key": "zpsid", "value": "xyz", "expires": "2026-12-01T12:00:00.000Z"},
        ]
    }
    exp_iso, expiring_soon = extract_cookie_expiry(auth_ok, now=now)
    assert exp_iso == "2026-12-01T12:00:00Z"
    assert expiring_soon is False


# ──────────────────────────────────────────────────────────────────────────────
# 4. zca_persistent_listener.py: Web-Slot Conflict (3000/3003/code 5) & Proxy Env
# ──────────────────────────────────────────────────────────────────────────────


def test_web_slot_conflict_detection_and_sse_broadcast():
    assert _is_web_slot_conflict(code=3000) is True
    assert _is_web_slot_conflict(code=3003) is True
    assert _is_web_slot_conflict(reason="DuplicateConnection") is True
    assert _is_web_slot_conflict(text="Overlimit connection error") is True
    assert _is_web_slot_conflict(code=1006, reason="normal network blip") is False

    async def _run():
        mgr = ZcaPersistentListenerManager()
        state = ListenerState(
            user_id="zl_conflict_1",
            auth={"cookies": [], "imei": "i1", "userAgent": "UA", "proxy_url": "http://u:p@1.2.3.4:8080"},
            desired=True,
            connected=True,
        )
        mgr._states["zl_conflict_1"] = state

        mock_pub_exp = AsyncMock(return_value=True)
        mock_pub_msg = AsyncMock(return_value=1)
        with (
            patch("app.modules.all_platform.zalo.services.message_events.publish_auth_expired", mock_pub_exp),
            patch("app.modules.all_platform.zalo.services.message_events.publish_zalo_message_event", mock_pub_msg),
        ):
            closed_line = json.dumps({"event": "closed", "code": 3000, "reason": "DuplicateConnection"})
            await mgr._handle_event(state, closed_line)

        st = mgr.status("zl_conflict_1")
        assert st["conflict_type"] == "web_slot_conflict"
        assert st["connected"] is False
        assert st["last_error"] == WEB_SLOT_CONFLICT_MESSAGE
        assert st["has_proxy"] is True
        assert st["proxy_masked"] == "http://***@1.2.3.4:8080"

        mock_pub_exp.assert_awaited_once_with("zl_conflict_1", WEB_SLOT_CONFLICT_MESSAGE)
        mock_pub_msg.assert_awaited_once()
        evt_payload = mock_pub_msg.await_args.args[1]
        assert evt_payload["type"] == "web_slot_conflict"
        assert evt_payload["conflict_type"] == "web_slot_conflict"
        assert evt_payload["message"] == WEB_SLOT_CONFLICT_MESSAGE

        # Reconnect / heartbeat clears conflict_type
        await mgr._handle_event(state, json.dumps({"event": "heartbeat"}))
        assert state.conflict_type is None

    asyncio.run(_run())


def test_listener_exit_code_5_stops_kick_war_and_passes_proxy_via_env():
    async def _run():
        mgr = ZcaPersistentListenerManager()
        state = ListenerState(
            user_id="zl_exit5",
            auth={"cookies": [], "imei": "im-5", "userAgent": "UA", "proxy_url": "socks5://u:pw@10.20.30.40:1080"},
            desired=True,
        )
        mgr._states["zl_exit5"] = state

        captured: Dict[str, Any] = {}

        class _FakeStream:
            async def readline(self):
                return b""

            async def read(self, n=-1):
                return b""

        class _FakeProc:
            returncode = 5
            pid = 4242
            stdout = _FakeStream()
            stderr = _FakeStream()
            stdin = None

            class _ProcInner:
                pid = 4242

            _proc = _ProcInner()

            async def wait(self):
                return 5

        def _fake_win_proc(cmd, cwd, env, stdin_input=None):
            captured["cmd"] = list(cmd)
            captured["env"] = dict(env)
            return _FakeProc()

        async def _fake_posix_proc(*cmd, cwd=None, stdin=None, stdout=None, stderr=None, env=None):
            captured["cmd"] = list(cmd)
            captured["env"] = dict(env or {})
            return _FakeProc()

        mock_pub_exp = AsyncMock(return_value=True)
        mock_pub_msg = AsyncMock(return_value=1)

        with (
            patch.object(mgr, "_refresh_group_names", AsyncMock(return_value=None)),
            patch("app.modules.all_platform.zalo.services.win_subprocess.WindowsSubprocessWrapper", side_effect=_fake_win_proc),
            patch("asyncio.create_subprocess_exec", side_effect=_fake_posix_proc),
            patch("app.modules.all_platform.zalo.services.message_events.publish_auth_expired", mock_pub_exp),
            patch("app.modules.all_platform.zalo.services.message_events.publish_zalo_message_event", mock_pub_msg),
        ):
            await mgr._run_supervised(state)

        # Proxy passed ONLY via env, NEVER in CLI args
        assert captured["env"].get("ZALO_PROXY_URL") == "socks5://u:pw@10.20.30.40:1080"
        assert all("10.20.30.40" not in str(arg) and "pw" not in str(arg) for arg in captured["cmd"])

        # Exit code 5 marks web_slot_conflict, stops loop (no kick-war!), broadcasts SSE
        assert state.conflict_type == "web_slot_conflict"
        assert state.desired is False
        assert state.last_error == WEB_SLOT_CONFLICT_MESSAGE
        assert mock_pub_exp.await_count == 1

    asyncio.run(_run())


# ──────────────────────────────────────────────────────────────────────────────
# 5. Server-Side QR Manager & FastAPI Routes + SSE No-Delete Mandate
# ──────────────────────────────────────────────────────────────────────────────


def _make_fake_ndjson_proc(lines: List[str], *, exit_code: int = 0, delay_s: float = 0.01):
    """Build a fake subprocess emitting NDJSON lines asynchronously."""

    class _FakeStdout:
        def __init__(self):
            self._idx = 0

        async def readline(self) -> bytes:
            if self._idx >= len(lines):
                return b""
            await asyncio.sleep(delay_s)
            raw = (lines[self._idx] + "\n").encode("utf-8")
            self._idx += 1
            return raw

    class _FakeStderr:
        async def readline(self) -> bytes:
            return b""

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout()
            self.stderr = _FakeStderr()
            self.returncode: Optional[int] = None
            self.terminated = False

        async def wait(self) -> int:
            self.returncode = exit_code
            return exit_code

        def terminate(self):
            self.terminated = True
            self.returncode = 0

        def kill(self):
            self.terminated = True
            self.returncode = -9

    return _FakeProc()


def test_qr_manager_relink_reuses_imei_and_proxy_and_confirms(tmp_path: Path):
    async def _run():
        zca_auth_store._ZCA_AUTH_CACHE.clear()
        with patch.object(zca_auth_store.settings, "zca_auth_store_dir", str(tmp_path)):
            # Pre-existing expired account auth with persistent IMEI + Sticky VN Proxy
            await save_zca_auth(
                "zl_relink01",
                {
                    "cookies": [{"key": "zpsid", "value": "old"}],
                    "imei": "persisted-imei-abc-123",
                    "userAgent": "Mozilla/5.0 Chrome/145.0.0.0",
                    "proxy_url": "http://vn:secretpass@103.99.88.77:8080",
                    "ownerId": "owner-example.com",
                },
            )

            ndjson_events = [
                json.dumps({"event": "qr", "qr_data_url": "data:image/png;base64,QR1", "attempt": 1, "max_attempts": 3, "expires_in_s": 100}),
                json.dumps({"event": "scanned", "display_name": "Nguyễn Văn A", "avatar": "https://ava.zadn.vn/a.jpg"}),
                json.dumps({
                    "event": "confirmed",
                    "cookies": [{"key": "zpw_sek", "value": "fresh_tok", "domain": ".zalo.me", "expires": 1950000000}],
                    "imei": "persisted-imei-abc-123",
                    "userAgent": "Mozilla/5.0 Chrome/145.0.0.0",
                    "uid": "84901234567",
                    "display_name": "Nguyễn Văn A",
                    "avatar": "https://ava.zadn.vn/a.jpg",
                }),
            ]
            fake_proc = _make_fake_ndjson_proc(ndjson_events, delay_s=0.01)
            spawn_capture: Dict[str, Any] = {}

            def _fake_win_proc(cmd, cwd, env, stdin_input=None):
                spawn_capture["cmd"] = list(cmd)
                spawn_capture["env"] = dict(env)
                return fake_proc

            async def _fake_posix_proc(*cmd, cwd=None, stdin=None, stdout=None, stderr=None, env=None):
                spawn_capture["cmd"] = list(cmd)
                spawn_capture["env"] = dict(env or {})
                return fake_proc

            confirmed_payloads: List[Dict[str, Any]] = []

            async def _on_confirm(sess, auth_dict):
                confirmed_payloads.append(dict(auth_dict))
                await save_zca_auth("zl_relink01", auth_dict)
                return "zl_relink01"

            mgr = ZcaQrSessionManager()
            with (
                patch("app.modules.all_platform.zalo.services.win_subprocess.WindowsSubprocessWrapper", side_effect=_fake_win_proc),
                patch("asyncio.create_subprocess_exec", side_effect=_fake_posix_proc),
            ):
                sess = await mgr.start_session(
                    account_id="zl_relink01",
                    owner_id="owner-example.com",
                    owner_email="owner@example.com",
                    initial_wait_s=2.0,
                    on_confirmed=_on_confirm,
                )
                start_resp = sess.to_start_response()
                assert start_resp["qr_session_id"].startswith("zqr_")
                assert start_resp["has_proxy"] is True
                assert start_resp["proxy_masked"] == "http://***@103.99.88.77:8080"
                assert "secretpass" not in json.dumps(start_resp)

                if sess.reader_task:
                    await asyncio.wait_for(sess.reader_task, timeout=5.0)

                status_resp = sess.to_status_response()
                assert status_resp["status"] == "confirmed"
                assert status_resp["account_id"] == "zl_relink01"
                assert status_resp["display_name"] == "Nguyễn Văn A"
                assert status_resp["avatar"] == "https://ava.zadn.vn/a.jpg"
                assert status_resp["scanned_user"] == {
                    "display_name": "Nguyễn Văn A",
                    "avatar": "https://ava.zadn.vn/a.jpg",
                }

            # Verify persistent IMEI passed via CLI & proxy passed ONLY via env
            assert "--imei" in spawn_capture["cmd"]
            imei_idx = spawn_capture["cmd"].index("--imei")
            assert spawn_capture["cmd"][imei_idx + 1] == "persisted-imei-abc-123"
            assert spawn_capture["env"].get("ZALO_PROXY_URL") == "http://vn:secretpass@103.99.88.77:8080"
            assert all("secretpass" not in str(a) for a in spawn_capture["cmd"])

            # Verify persisted auth kept both imei & proxy_url
            assert len(confirmed_payloads) == 1
            reloaded = await load_zca_auth("zl_relink01")
            assert reloaded is not None
            assert reloaded["imei"] == "persisted-imei-abc-123"
            assert reloaded["proxy_url"] == "http://vn:secretpass@103.99.88.77:8080"
            assert reloaded["source"] == "server_qr"

    asyncio.run(_run())


def test_qr_routes_and_auth_status_health_contract(tmp_path: Path):
    app = FastAPI()
    app.include_router(zalo_auth_router, prefix="/api/all-platform/zalo")

    # Verify exact route paths exist
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/all-platform/zalo/auth/qr/start" in paths
    assert "/api/all-platform/zalo/auth/qr/status/{qr_session_id}" in paths
    assert "/api/all-platform/zalo/auth/qr/cancel/{qr_session_id}" in paths
    assert "/api/all-platform/zalo/auth/status" in paths
    assert "/api/all-platform/zalo/auth/current-status" in paths

    client = TestClient(app)

    # 1. Unauthenticated /qr/start -> 401
    app.dependency_overrides[get_authenticated_caller_email] = lambda: None
    r_unauth = client.post("/api/all-platform/zalo/auth/qr/start", json={})
    assert r_unauth.status_code == 401

    # 2. Authenticated caller with invalid proxy_url -> 400
    app.dependency_overrides[get_authenticated_caller_email] = lambda: "sale@markeeai.com"
    with patch("app.modules.all_platform.zalo.api.routes.auth.get_app_user_id_by_email", AsyncMock(return_value="uuid-sale-1")):
        r_bad_proxy = client.post(
            "/api/all-platform/zalo/auth/qr/start",
            json={"proxy_url": "ftp://invalid-scheme:21"},
        )
        assert r_bad_proxy.status_code == 400

    # 3. Full start -> status -> cancel flow via mocked subprocess
    qr_mgr = ZcaQrSessionManager()

    class _BlockingStdout:
        def __init__(self):
            self._sent = False

        async def readline(self) -> bytes:
            if not self._sent:
                self._sent = True
                return (
                    json.dumps({
                        "event": "qr",
                        "qr_data_url": "data:image/png;base64,FAKEQR",
                        "attempt": 1,
                        "max_attempts": 3,
                        "expires_in_s": 100,
                    }) + "\n"
                ).encode("utf-8")
            await asyncio.sleep(5)
            return b""

    class _BlockingProc:
        def __init__(self):
            self.stdout = _BlockingStdout()
            self.stderr = None
            self.returncode = None
            self.terminated = False

        async def wait(self):
            return 0

        def terminate(self):
            self.terminated = True
            self.returncode = 0

        def kill(self):
            self.terminated = True
            self.returncode = -9

    blocking_proc = _BlockingProc()

    with (
        patch("app.modules.all_platform.zalo.api.routes.auth.get_qr_manager", return_value=qr_mgr),
        patch("app.modules.all_platform.zalo.api.routes.auth.get_app_user_id_by_email", AsyncMock(return_value="uuid-sale-1")),
        patch("app.modules.all_platform.zalo.services.win_subprocess.WindowsSubprocessWrapper", return_value=blocking_proc),
        patch("asyncio.create_subprocess_exec", AsyncMock(return_value=blocking_proc)),
    ):
        r_start = client.post(
            "/api/all-platform/zalo/auth/qr/start",
            json={"label": "Zalo Sale 1", "proxy_url": "socks5://user:pw@103.1.1.1:1080"},
        )
        assert r_start.status_code == 200
        start_body = r_start.json()
        sid = start_body["qr_session_id"]
        assert start_body["status"] == "qr_ready"
        assert start_body["qr_data_url"] == "data:image/png;base64,FAKEQR"
        assert start_body["attempt"] == 1
        assert start_body["max_attempts"] == 3
        assert start_body["has_proxy"] is True
        assert start_body["proxy_masked"] == "socks5://***@103.1.1.1:1080"
        assert "pw" not in json.dumps(start_body)

        r_st = client.get(f"/api/all-platform/zalo/auth/qr/status/{sid}")
        assert r_st.status_code == 200
        st_body = r_st.json()
        assert st_body["qr_session_id"] == sid
        assert st_body["status"] == "qr_ready"
        assert st_body["qr_data_url"] == "data:image/png;base64,FAKEQR"

        r_cancel = client.post(f"/api/all-platform/zalo/auth/qr/cancel/{sid}")
        assert r_cancel.status_code == 200
        assert r_cancel.json() == {"ok": True, "qr_session_id": sid, "status": "cancelled"}
        assert blocking_proc.terminated is True

    # 4. Enhanced /auth/status returns health fields + web_slot_conflict
    zca_auth_store._ZCA_AUTH_CACHE.clear()
    soon_ts = int((datetime.now(timezone.utc) + timedelta(hours=6)).timestamp())
    with patch.object(zca_auth_store.settings, "zca_auth_store_dir", str(tmp_path)):
        asyncio.run(
            save_zca_auth(
                "zl_health01",
                {
                    "cookies": [{"key": "zpw_sek", "value": "v", "expires": soon_ts}],
                    "imei": "imei-h1",
                    "userAgent": "Mozilla/5.0 Chrome/145.0.0.0",
                    "proxy_url": "http://u:pw@103.2.2.2:8080",
                },
            )
        )
        with patch(
            "app.modules.all_platform.zalo.api.routes.auth.get_listener_status",
            return_value={
                "user_id": "zl_health01",
                "running": False,
                "connected": False,
                "auth_expired": False,
                "conflict_type": "web_slot_conflict",
                "last_error": WEB_SLOT_CONFLICT_MESSAGE,
            },
        ):
            r_health = client.get(
                "/api/all-platform/zalo/auth/status",
                params={"account_id": "zl_health01"},
            )
            assert r_health.status_code == 200
            hb = r_health.json()
            assert hb["conflict_type"] == "web_slot_conflict"
            assert hb["cookie_expiring_soon"] is True
            assert hb["cookie_expires_at"] is not None
            assert hb["has_proxy"] is True
            assert hb["proxy_masked"] == "http://***@103.2.2.2:8080"
            assert hb["message"] == WEB_SLOT_CONFLICT_MESSAGE


def test_sse_auth_expired_never_deletes_persisted_zca_auth(tmp_path: Path):
    """Verify auth.py SSE auth_expired preserves zca-auth/{user_id}.json (imei + proxy_url)."""
    import ast

    auth_src = (
        REPO_BACKEND_ROOT / "app" / "modules" / "all_platform" / "zalo" / "api" / "routes" / "auth.py"
    ).read_text(encoding="utf-8")
    tree = ast.parse(auth_src)
    events_fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "auth_status_events"
    )
    called_names = {
        (call.func.id if isinstance(call.func, ast.Name) else call.func.attr)
        for call in ast.walk(events_fn)
        if isinstance(call, ast.Call) and isinstance(call.func, (ast.Name, ast.Attribute))
    }
    assert "delete_zca_auth" not in called_names

    # Runtime verification with real SSE stream
    async def _run():
        zca_auth_store._ZCA_AUTH_CACHE.clear()
        with patch.object(zca_auth_store.settings, "zca_auth_store_dir", str(tmp_path)):
            uid = "zl_sse_keep01"
            await save_zca_auth(
                uid,
                {
                    "cookies": [{"key": "zpw_sek", "value": "v", "expires": 1950000000}],
                    "imei": "imei-must-survive",
                    "userAgent": "Mozilla/5.0 Chrome/145.0.0.0",
                    "proxy_url": "http://u:pw@103.7.7.7:8080",
                },
            )
            await session_store.save_session(
                SessionData(
                    session_id=f"{uid}--sess1",
                    user_id=uid,
                    browser=None,
                    context=None,
                    page=None,
                    status="confirmed",
                    zca_auth={"imei": "imei-must-survive"},
                )
            )

            from app.modules.all_platform.zalo.api.routes.auth import auth_status_events

            class _FakeRequest:
                def __init__(self):
                    self._calls = 0

                async def is_disconnected(self):
                    self._calls += 1
                    return self._calls > 1

            await message_events.publish_auth_expired(uid, WEB_SLOT_CONFLICT_MESSAGE)
            with patch(
                "app.modules.all_platform.zalo.api.routes.auth.get_listener_status",
                return_value={"connected": False, "auth_expired": False, "conflict_type": "web_slot_conflict"},
            ):
                resp = await auth_status_events(_FakeRequest(), user_id=uid)
                chunks: List[str] = []
                async for chunk in resp.body_iterator:
                    chunks.append(chunk if isinstance(chunk, str) else chunk.decode("utf-8"))
                    if "auth-status" in chunks[-1]:
                        break

            # Auth file MUST STILL EXIST with intact imei + proxy_url!
            reloaded = await load_zca_auth(uid)
            assert reloaded is not None
            assert reloaded["imei"] == "imei-must-survive"
            assert reloaded["proxy_url"] == "http://u:pw@103.7.7.7:8080"

            sse_blob = "".join(chunks)
            assert "event: auth-status" in sse_blob
            assert "web_slot_conflict" in sse_blob
            assert "http://***@103.7.7.7:8080" in sse_blob
            assert "pw@" not in sse_blob

    asyncio.run(_run())


def test_qr_manager_handles_declined_and_expired_cleanly():
    async def _run():
        mgr = ZcaQrSessionManager()

        for terminal_event, expected_status in (("declined", "declined"), ("expired", "expired")):
            ndjson_events = [
                json.dumps({"event": "qr", "qr_data_url": "data:image/png;base64,QR", "attempt": 1, "max_attempts": 3, "expires_in_s": 100}),
                json.dumps({"event": terminal_event}),
            ]
            fake_proc = _make_fake_ndjson_proc(ndjson_events, delay_s=0.01)
            with (
                patch("app.modules.all_platform.zalo.services.win_subprocess.WindowsSubprocessWrapper", return_value=fake_proc),
                patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)),
            ):
                sess = await mgr.start_session(
                    owner_id="owner-test",
                    owner_email="owner@test.com",
                    initial_wait_s=2.0,
                )
                if sess.reader_task:
                    await asyncio.wait_for(sess.reader_task, timeout=5.0)
                st = sess.to_status_response()
                assert st["status"] == expected_status
                assert st["expires_in_s"] == 0
                assert st["error"]

    asyncio.run(_run())


def test_import_session_preserves_saved_proxy_url(tmp_path: Path):
    app = FastAPI()
    app.include_router(zalo_auth_router, prefix="/api/all-platform/zalo")
    client = TestClient(app)

    zca_auth_store._ZCA_AUTH_CACHE.clear()
    with patch.object(zca_auth_store.settings, "zca_auth_store_dir", str(tmp_path)):
        asyncio.run(
            save_zca_auth(
                "zl_imp01",
                {
                    "cookies": [{"key": "zpsid", "value": "old"}],
                    "imei": "stable-imei-imp01",
                    "userAgent": "Mozilla/5.0 Chrome/145.0.0.0",
                    "proxy_url": "http://vn:keepme@103.55.66.77:8080",
                },
            )
        )
        with (
            patch("app.modules.all_platform.zalo.api.routes.auth._remember_zalo_user", AsyncMock(return_value=None)),
            patch("app.modules.all_platform.zalo.api.routes.auth._start_listener_and_first_sync", AsyncMock(return_value=None)),
        ):
            resp = client.post(
                "/api/all-platform/zalo/auth/import-session",
                json={
                    "account_id": "zl_imp01",
                    "cookies": [{"key": "zpw_sek", "value": "newtok", "domain": ".zalo.me", "expires": 1950000000}],
                    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0.0.0",
                },
            )
        assert resp.status_code == 200
        reloaded = asyncio.run(load_zca_auth("zl_imp01"))
        assert reloaded is not None
        assert reloaded["imei"] == "stable-imei-imp01"
        assert reloaded["proxy_url"] == "http://vn:keepme@103.55.66.77:8080"

