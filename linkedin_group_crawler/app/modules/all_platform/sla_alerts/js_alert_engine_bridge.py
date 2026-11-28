"""Python Async Bridge for the Node.js Persistent SLA Alert Forward Engine.

Manages a single long-lived ``node scripts/sla_alert_forward_engine.js``
subprocess communicating via bidirectional JSON-Lines (NDJSON):
- Outgoing RPC requests on stdin (``ping``, ``stats``, ``enqueue-alert``,
  ``send-immediate``, ``flush-all``, ``shutdown``).
- Incoming RPC responses (matched by ``id``) + asynchronous
  ``{"type": "delivery_result", ...}`` events on stdout -> persisted to
  ``public.inbox_alert_forward_logs``.
- Cross-platform Windows/Linux support: uses ``asyncio.create_subprocess_exec``
  with ``CREATE_NO_WINDOW`` on Windows and transparently falls back to
  ``subprocess.Popen`` + ``asyncio.to_thread`` if a SelectorEventLoop is active.
- Automatic lazy startup, crash recovery, and Python fallback via
  ``send_zca_message`` if the Node engine fails.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from loguru import logger

VN_TZ = timezone(timedelta(hours=7))

_CHANNEL_LABELS: Dict[str, str] = {
    "zalo": "ZALO",
    "messenger": "MESSENGER",
    "telegram": "TELEGRAM",
    "whatsapp": "WHATSAPP",
    "email": "EMAIL",
}


def _backend_root() -> Path:
    # .../linkedin_group_crawler/app/modules/all_platform/sla_alerts/js_alert_engine_bridge.py
    # parents[0]=sla_alerts, [1]=all_platform, [2]=modules, [3]=app, [4]=linkedin_group_crawler
    return Path(__file__).resolve().parents[4]


def engine_script_path() -> Path:
    return _backend_root() / "scripts" / "sla_alert_forward_engine.js"


# ── Threaded Subprocess Facade (Windows SelectorEventLoop compatibility) ─────

class _ThreadedReader:
    def __init__(self, stream: Any) -> None:
        self._stream = stream

    async def readline(self) -> bytes:
        if not self._stream:
            return b""
        try:
            return await asyncio.to_thread(self._stream.readline)
        except Exception:
            return b""


class _ThreadedWriter:
    def __init__(self, stream: Any) -> None:
        self._stream = stream

    def write(self, data: bytes) -> None:
        if self._stream:
            self._stream.write(data)

    async def drain(self) -> None:
        if self._stream:
            await asyncio.to_thread(self._stream.flush)

    def close(self) -> None:
        if self._stream:
            try:
                self._stream.close()
            except Exception:
                pass


class _ThreadedSubprocess:
    """Async subprocess wrapper around ``subprocess.Popen`` when needed on Windows."""

    def __init__(self, cmd: List[str], *, cwd: str, env: Dict[str, str], creationflags: int = 0) -> None:
        kwargs: Dict[str, Any] = {
            "cwd": cwd,
            "env": env,
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        if sys.platform == "win32" and creationflags:
            kwargs["creationflags"] = creationflags
        self._proc = subprocess.Popen(cmd, **kwargs)
        self.stdin = _ThreadedWriter(self._proc.stdin)
        self.stdout = _ThreadedReader(self._proc.stdout)
        self.stderr = _ThreadedReader(self._proc.stderr)

    @property
    def pid(self) -> Optional[int]:
        return self._proc.pid

    @property
    def returncode(self) -> Optional[int]:
        self._proc.poll()
        return self._proc.returncode

    async def wait(self) -> int:
        return await asyncio.to_thread(self._proc.wait)

    def terminate(self) -> None:
        try:
            self._proc.terminate()
        except Exception:
            pass

    def kill(self) -> None:
        try:
            self._proc.kill()
        except Exception:
            pass


# ── Python Fallback Formatting & Delivery ────────────────────────────────────

def _format_time_vn(value: Any) -> str:
    dt: Optional[datetime] = None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    elif isinstance(value, str) and value.strip():
        try:
            raw = value.strip()
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            dt = None
    if dt is None:
        dt = datetime.now(timezone.utc)
    vn = dt.astimezone(VN_TZ)
    return vn.strftime("%H:%M %d/%m")


def _format_wait_text(seconds: Any) -> str:
    secs = max(0, int(seconds or 0))
    if secs < 60:
        return f"{secs} giây"
    mins, rem_s = divmod(secs, 60)
    if mins < 60:
        return f"{mins} phút {rem_s} giây" if rem_s else f"{mins} phút"
    hours, rem_m = divmod(mins, 60)
    return f"{hours} giờ {rem_m} phút" if rem_m else f"{hours} giờ"


def render_fallback_message(config: Dict[str, Any], event: Dict[str, Any]) -> tuple[str, List[Dict[str, Any]]]:
    alert_type = str(event.get("alert_type") or "new_message").strip().lower()
    channel = str(event.get("channel") or "zalo").strip().lower()
    channel_label = _CHANNEL_LABELS.get(channel, channel.upper())
    customer_name = str(event.get("customer_name") or "").strip() or "Khách hàng"
    customer_phone = str(event.get("customer_phone") or "").strip() or "Chưa rõ SĐT"
    account_name = str(event.get("account_name") or event.get("account_id") or "").strip() or "Tài khoản"
    content = str(event.get("content") or "").strip()[:600] or "(Không có nội dung văn bản)"
    time_vn = str(event.get("time_vn") or _format_time_vn(event.get("received_at")))
    sla_minutes = str(event.get("sla_minutes") or max(1, round(int(event.get("target_seconds") or 300) / 60)))
    deadline_vn = str(event.get("deadline_vn") or (_format_time_vn(event["deadline_at"]) if event.get("deadline_at") else "--:--"))
    wait_text = str(event.get("wait_text") or _format_wait_text(event.get("wait_business_seconds") or 0))
    staff_name = str(event.get("staff_name") or "").strip() or "Chưa phân công"
    open_url = str(event.get("open_url") or "").strip()

    if alert_type == "sla_breach":
        tpl = str(config.get("sla_breach_template") or "").strip() or (
            "🚨 [QUÁ HẠN SLA - {{channel}}]\n"
            "👤 Khách: {{customer_name}} ({{customer_phone}})\n"
            "📱 Tài khoản: {{account_name}}\n"
            "⏱️ Đã chờ quá hạn: {{wait_text}} (Mục tiêu: {{sla_minutes}} phút)\n"
            "💬 Tin cuối: {{content}}\n"
            "👤 Phụ trách: {{staff_name}}\n"
            "🔗 {{open_url}}"
        )
    elif alert_type == "sla_warning":
        tpl = (
            "⚠️ [SẮP QUÁ HẠN SLA - {{channel}}]\n"
            "👤 Khách: {{customer_name}} ({{customer_phone}})\n"
            "📱 Tài khoản: {{account_name}}\n"
            "⏱️ Đã chờ: {{wait_text}} / Mục tiêu {{sla_minutes}} phút\n"
            "💬 Tin cuối: {{content}}\n"
            "🔗 {{open_url}}"
        )
    elif alert_type == "test":
        tpl = (
            "✅ [TEST THÔNG BÁO SLA - {{channel}}]\n"
            "📱 Tài khoản gửi: {{account_name}}\n"
            "💬 Nội dung: {{content}}\n"
            "⏰ Lúc: {{time_vn}}\n"
            "🔗 {{open_url}}"
        )
    else:
        tpl = str(config.get("new_message_template") or "").strip() or (
            "📩 [TIN MỚI - {{channel}}]{{extra_count_text}}\n"
            "👤 Khách: {{customer_name}} ({{customer_phone}})\n"
            "📱 Tài khoản: {{account_name}}\n"
            "💬 Nội dung: {{content}}\n"
            "⏰ Lúc: {{time_vn}} | Hạn SLA ({{sla_minutes}}p): {{deadline_vn}}\n"
            "🔗 {{open_url}}"
        )

    replacements = {
        "channel": channel_label,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "account_name": account_name,
        "content": content,
        "extra_count_text": "",
        "time_vn": time_vn,
        "sla_minutes": sla_minutes,
        "deadline_vn": deadline_vn,
        "wait_text": wait_text,
        "staff_name": staff_name,
        "open_url": open_url,
    }
    rendered = tpl
    for key, val in replacements.items():
        rendered = rendered.replace("{{" + key + "}}", val)
    rendered = "\n".join(line for line in rendered.splitlines() if line.strip() != "🔗").strip()

    mentions: List[Dict[str, Any]] = []
    if alert_type == "sla_breach" and config.get("mention_all_on_breach"):
        if not rendered.startswith("@All"):
            rendered = f"@All {rendered}"
        mentions.append({"pos": 0, "uid": "-1", "len": 4})

    return rendered, mentions


async def _python_fallback_send(
    config: Dict[str, Any],
    event: Dict[str, Any],
    auth: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Fallback direct ZCA delivery when the Node.js alert engine is unavailable."""
    started = time.monotonic()
    rendered, mentions = render_fallback_message(config, event)
    target_group_id = str(config.get("target_zalo_group_id") or "").strip()

    if config.get("dry_run"):
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "sent": True,
            "dry_run": True,
            "status": "dry_run",
            "via": "python_fallback",
            "latency_ms": latency_ms,
            "rendered_text": rendered,
            "error": None,
        }

    if not target_group_id:
        return {
            "sent": False,
            "dry_run": False,
            "status": "failed",
            "via": "python_fallback",
            "latency_ms": int((time.monotonic() - started) * 1000),
            "rendered_text": rendered,
            "error": "Thiếu target_zalo_group_id",
        }
    if not auth:
        return {
            "sent": False,
            "dry_run": False,
            "status": "failed",
            "via": "python_fallback",
            "latency_ms": int((time.monotonic() - started) * 1000),
            "rendered_text": rendered,
            "error": "Không tìm thấy ZCA auth cho tài khoản Zalo gửi thông báo",
        }

    try:
        from app.modules.all_platform.zalo.services.zca_api_bridge import send_zca_message

        resp = await send_zca_message(
            auth,
            target_group_id,
            rendered,
            thread_type=1,
            mentions=mentions or None,
        )
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "sent": True,
            "dry_run": False,
            "status": "sent",
            "via": "python_fallback",
            "latency_ms": latency_ms,
            "rendered_text": rendered,
            "response": resp,
            "error": None,
        }
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "sent": False,
            "dry_run": False,
            "status": "failed",
            "via": "python_fallback",
            "latency_ms": latency_ms,
            "rendered_text": rendered,
            "error": str(exc)[:500],
        }


# ── Default Delivery Result DB Logger ────────────────────────────────────────

def _persist_delivery_result_sync(event: Dict[str, Any]) -> None:
    """Write a JS engine ``delivery_result`` event into ``inbox_alert_forward_logs``."""
    try:
        from app.core.supabase_client import get_supabase_client

        meta = event.get("meta") if isinstance(event.get("meta"), dict) else {}
        status = str(event.get("status") or ("sent" if event.get("ok") else "failed")).strip()
        if status not in ("sent", "dry_run", "failed", "skipped", "rate_limited"):
            status = "sent" if event.get("ok") else "failed"

        alert_type = str(meta.get("alert_type") or event.get("alert_type") or "new_message").strip()
        if alert_type not in ("new_message", "sla_warning", "sla_breach", "test"):
            alert_type = "new_message"

        row: Dict[str, Any] = {
            "config_id": meta.get("config_id") or None,
            "alert_type": alert_type,
            "channel": str(meta.get("channel") or "zalo").strip().lower(),
            "source_account_id": meta.get("source_account_id"),
            "source_conversation_id": meta.get("source_conversation_id"),
            "sla_turn_id": meta.get("sla_turn_id") or None,
            "target_zalo_group_id": meta.get("target_zalo_group_id"),
            "rendered_text": event.get("rendered_text"),
            "status": status,
            "via": str(event.get("via") or "js_engine"),
            "latency_ms": int(event["latency_ms"]) if event.get("latency_ms") is not None else None,
            "error": str(event["error"])[:1000] if event.get("error") else None,
        }
        sb = get_supabase_client()
        sb.table("inbox_alert_forward_logs").insert(row).execute()
    except Exception as exc:
        msg = str(exc).lower()
        if "42p01" in msg or "pgrst205" in msg or "does not exist" in msg:
            logger.debug(f"[sla-js-bridge] inbox_alert_forward_logs not migrated yet: {exc}")
        else:
            logger.warning(f"[sla-js-bridge] failed to log delivery_result: {exc}")


DeliveryHandler = Callable[[Dict[str, Any]], Any]


# ── Bridge Class ─────────────────────────────────────────────────────────────

class JsAlertEngineBridge:
    """Persistent manager for ``scripts/sla_alert_forward_engine.js``."""

    def __init__(self) -> None:
        self._proc: Optional[Any] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._lock: Optional[asyncio.Lock] = None
        self._write_lock: Optional[asyncio.Lock] = None
        self._ready = False
        self._stopping = False
        self._pending: Dict[str, asyncio.Future] = {}
        self._stdout_task: Optional[asyncio.Task] = None
        self._stderr_task: Optional[asyncio.Task] = None
        self._delivery_handler: Optional[DeliveryHandler] = None
        self._restarts = 0
        self._last_error: Optional[str] = None
        self._started_at_monotonic: Optional[float] = None
        self._last_start_fail_monotonic: float = 0.0

    def set_delivery_handler(self, handler: Optional[DeliveryHandler]) -> None:
        self._delivery_handler = handler

    def _ensure_loop_locks(self) -> tuple[asyncio.Lock, asyncio.Lock]:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            # Event loop changed (e.g. separate pytest asyncio.run calls) -> reset locks
            self._loop = loop
            self._lock = asyncio.Lock()
            self._write_lock = asyncio.Lock()
            if self._proc is not None and self._proc.returncode is None:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None
            self._ready = False
            self._pending.clear()
            self._stdout_task = None
            self._stderr_task = None
        assert self._lock is not None and self._write_lock is not None
        return self._lock, self._write_lock

    @property
    def alive(self) -> bool:
        return bool(
            self._proc is not None
            and self._proc.returncode is None
            and self._ready
            and not self._stopping
        )

    async def _spawn_process(self, script: Path) -> Any:
        cmd = ["node", str(script)]
        cwd = str(_backend_root())
        env = {**os.environ}
        creationflags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW

        try:
            kwargs: Dict[str, Any] = {
                "cwd": cwd,
                "env": env,
                "stdin": asyncio.subprocess.PIPE,
                "stdout": asyncio.subprocess.PIPE,
                "stderr": asyncio.subprocess.PIPE,
            }
            if sys.platform == "win32":
                kwargs["creationflags"] = creationflags
            return await asyncio.create_subprocess_exec(*cmd, **kwargs)
        except NotImplementedError:
            # Windows SelectorEventLoop does not support create_subprocess_exec
            logger.debug("[sla-js-bridge] falling back to _ThreadedSubprocess on Windows")
            return _ThreadedSubprocess(cmd, cwd=cwd, env=env, creationflags=creationflags)

    async def ensure_started(self) -> None:
        lock, _ = self._ensure_loop_locks()
        if self.alive:
            return
        async with lock:
            if self.alive:
                return
            self._stopping = False
            script = engine_script_path()
            if not script.exists():
                self._last_error = f"Engine script not found: {script}"
                raise RuntimeError(self._last_error)

            # Avoid tight crash-restart storm (wait 1.5s after a failed start)
            now = time.monotonic()
            if self._last_start_fail_monotonic and (now - self._last_start_fail_monotonic) < 1.5:
                await asyncio.sleep(0.5)

            # Cleanup stale process if any
            if self._proc is not None:
                try:
                    self._proc.kill()
                except Exception:
                    pass
                self._proc = None

            try:
                proc = await self._spawn_process(script)
                ready_line = await asyncio.wait_for(proc.stderr.readline(), timeout=10.0)
                if b"ready" not in (ready_line or b"").lower():
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    raise RuntimeError(f"SLA JS alert engine unexpected startup: {ready_line!r}")

                self._proc = proc
                self._ready = True
                self._last_error = None
                self._started_at_monotonic = time.monotonic()
                if self._restarts > 0 or self._stdout_task is not None:
                    self._restarts += 1
                self._stdout_task = asyncio.create_task(
                    self._read_stdout_loop(proc), name="sla-js-engine-stdout"
                )
                self._stderr_task = asyncio.create_task(
                    self._read_stderr_loop(proc), name="sla-js-engine-stderr"
                )
                logger.info(f"[sla-js-bridge] Node.js Alert Engine started pid={proc.pid}")
            except Exception as exc:
                self._last_start_fail_monotonic = time.monotonic()
                self._last_error = str(exc)[:300]
                self._ready = False
                raise

    async def _read_stderr_loop(self, proc: Any) -> None:
        try:
            while proc.stderr is not None:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    logger.warning(f"[sla-js-engine stderr] {text[:500]}")
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug(f"[sla-js-bridge] stderr reader stopped: {exc}")

    async def _handle_delivery_event(self, data: Dict[str, Any]) -> None:
        handler = self._delivery_handler
        try:
            if handler is not None:
                res = handler(data)
                if inspect.isawaitable(res):
                    await res
            else:
                await asyncio.to_thread(_persist_delivery_result_sync, data)
        except Exception as exc:
            logger.warning(f"[sla-js-bridge] delivery_result handler error: {exc}")

    async def _read_stdout_loop(self, proc: Any) -> None:
        try:
            while proc.stdout is not None:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                if not decoded:
                    continue
                try:
                    data = json.loads(decoded)
                except json.JSONDecodeError:
                    logger.warning(f"[sla-js-bridge] non-JSON stdout: {decoded[:200]}")
                    continue
                if not isinstance(data, dict):
                    continue

                if data.get("type") == "delivery_result":
                    asyncio.create_task(self._handle_delivery_event(data))
                    continue

                req_id = data.get("id")
                if req_id is not None:
                    fut = self._pending.pop(str(req_id), None)
                    if fut and not fut.done():
                        fut.set_result(data)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self._last_error = str(exc)[:300]
            logger.warning(f"[sla-js-bridge] stdout reader exited: {exc}")
        finally:
            if self._proc is proc:
                self._ready = False
                for fut in self._pending.values():
                    if not fut.done():
                        fut.set_exception(RuntimeError("SLA JS Alert Engine connection lost"))
                self._pending.clear()

    async def request(
        self,
        cmd: str,
        payload: Optional[Dict[str, Any]] = None,
        *,
        timeout: float = 20.0,
    ) -> Dict[str, Any]:
        await self.ensure_started()
        _, write_lock = self._ensure_loop_locks()
        proc = self._proc
        if not proc or not proc.stdin or proc.returncode is not None:
            raise RuntimeError("SLA JS Alert Engine process is not running")

        req_id = uuid.uuid4().hex[:12]
        msg: Dict[str, Any] = {"id": req_id, "cmd": cmd}
        if payload is not None:
            msg["payload"] = payload

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut

        try:
            raw = (json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8")
            async with write_lock:
                proc.stdin.write(raw)
                await proc.stdin.drain()
        except Exception as exc:
            self._pending.pop(req_id, None)
            self._ready = False
            self._last_error = str(exc)[:300]
            raise RuntimeError(f"Failed writing to SLA JS Alert Engine: {exc}") from exc

        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(req_id, None)
            raise RuntimeError(f"SLA JS Alert Engine timeout ({timeout}s) for cmd={cmd}") from exc

    async def enqueue_alert(
        self,
        config: Dict[str, Any],
        event: Dict[str, Any],
        auth: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Enqueue an alert to the Node.js engine; falls back to Python if Node fails."""
        try:
            resp = await self.request(
                "enqueue-alert",
                {"config": config, "event": event, "auth": auth},
                timeout=15.0,
            )
            if resp.get("ok"):
                return {
                    "ok": True,
                    "via": "js_engine",
                    **(resp.get("result") or {}),
                }
            raise RuntimeError(str(resp.get("error") or "JS engine rejected enqueue-alert"))
        except Exception as exc:
            self._last_error = str(exc)[:300]
            logger.warning(f"[sla-js-bridge] enqueue-alert failed ({exc}) -> Python fallback")
            fb = await _python_fallback_send(config, event, auth)
            await self._handle_delivery_event(
                {
                    "type": "delivery_result",
                    "ok": bool(fb.get("sent")),
                    "status": fb.get("status") or ("sent" if fb.get("sent") else "failed"),
                    "via": "python_fallback",
                    "latency_ms": fb.get("latency_ms"),
                    "rendered_text": fb.get("rendered_text"),
                    "error": fb.get("error"),
                    "meta": {
                        "config_id": config.get("id"),
                        "alert_type": event.get("alert_type") or "new_message",
                        "channel": event.get("channel") or "zalo",
                        "source_account_id": event.get("account_id"),
                        "source_conversation_id": event.get("conversation_id"),
                        "sla_turn_id": event.get("sla_turn_id"),
                        "target_zalo_group_id": config.get("target_zalo_group_id"),
                    },
                }
            )
            return fb

    async def send_immediate(
        self,
        config: Dict[str, Any],
        event: Dict[str, Any],
        auth: Optional[Dict[str, Any]] = None,
        *,
        timeout: float = 25.0,
    ) -> Dict[str, Any]:
        """Send an immediate alert (Test Ping) via JS engine with Python fallback."""
        try:
            resp = await self.request(
                "send-immediate",
                {"config": config, "event": event, "auth": auth},
                timeout=timeout,
            )
            res = resp.get("result") or {}
            if isinstance(res, dict) and ("sent" in res or "status" in res):
                return {
                    "sent": bool(res.get("sent")),
                    "dry_run": bool(res.get("dry_run", config.get("dry_run", False))),
                    "status": res.get("status") or ("sent" if res.get("sent") else "failed"),
                    "via": res.get("via") or "js_engine",
                    "latency_ms": res.get("latency_ms"),
                    "rendered_text": res.get("rendered_text"),
                    "error": res.get("error") or resp.get("error"),
                }
            raise RuntimeError(str(resp.get("error") or "Invalid send-immediate response"))
        except Exception as exc:
            self._last_error = str(exc)[:300]
            logger.warning(f"[sla-js-bridge] send-immediate failed ({exc}) -> Python fallback")
            return await _python_fallback_send(config, event, auth)

    async def get_status(self, *, auto_start: bool = True) -> Dict[str, Any]:
        """Return live engine telemetry (pid, uptime, stats) for the UI header badge."""
        if not self.alive and auto_start:
            try:
                await self.ensure_started()
            except Exception as exc:
                err_msg = str(exc)[:300]
                return {
                    "alive": False,
                    "pid": None,
                    "uptime_ms": 0,
                    "mode": "python_fallback",
                    "restarts": self._restarts,
                    "error": err_msg,
                    "last_error": err_msg,
                    "stats": {},
                }

        if not self.alive:
            return {
                "alive": False,
                "pid": None,
                "uptime_ms": 0,
                "mode": "offline",
                "restarts": self._restarts,
                "error": self._last_error,
                "last_error": self._last_error,
                "stats": {},
            }

        try:
            resp = await self.request("ping", timeout=3.0)
            info = resp.get("result") or {}
            return {
                "alive": True,
                "pid": info.get("pid") or (self._proc.pid if self._proc else None),
                "uptime_ms": int(info.get("uptime_ms") or 0),
                "mode": "js_engine",
                "restarts": self._restarts,
                "error": self._last_error,
                "last_error": self._last_error,
                "stats": info.get("stats") or {},
            }
        except Exception as exc:
            self._last_error = str(exc)[:300]
            return {
                "alive": False,
                "pid": self._proc.pid if self._proc else None,
                "uptime_ms": 0,
                "mode": "python_fallback",
                "restarts": self._restarts,
                "error": self._last_error,
                "last_error": self._last_error,
                "stats": {},
            }

    async def flush_all(self, *, timeout: float = 8.0) -> Dict[str, Any]:
        if not self.alive:
            return {"flushed_buffers": 0, "stats": {}}
        try:
            resp = await self.request("flush-all", timeout=timeout)
            return resp.get("result") or {}
        except Exception as exc:
            logger.warning(f"[sla-js-bridge] flush-all failed: {exc}")
            return {"flushed_buffers": 0, "error": str(exc)}

    async def shutdown(self) -> None:
        self._stopping = True
        proc = self._proc
        if proc is not None and proc.returncode is None:
            try:
                if self._ready and proc.stdin is not None:
                    proc.stdin.write(b'{"id":"shutdown","cmd":"shutdown"}\n')
                    await proc.stdin.drain()
                await asyncio.wait_for(proc.wait(), timeout=6.0)
            except Exception:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

        for task in (self._stdout_task, self._stderr_task):
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        self._stdout_task = None
        self._stderr_task = None
        self._proc = None
        self._ready = False
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError("SLA JS Alert Engine shut down"))
        self._pending.clear()
        logger.info("[sla-js-bridge] Node.js Alert Engine stopped")


_BRIDGE = JsAlertEngineBridge()


def get_js_alert_engine_bridge() -> JsAlertEngineBridge:
    return _BRIDGE


def set_delivery_result_handler(handler: Optional[DeliveryHandler]) -> None:
    _BRIDGE.set_delivery_handler(handler)


async def enqueue_alert(
    config: Dict[str, Any],
    event: Dict[str, Any],
    auth: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return await _BRIDGE.enqueue_alert(config, event, auth)


async def send_immediate(
    config: Dict[str, Any],
    event: Dict[str, Any],
    auth: Optional[Dict[str, Any]] = None,
    *,
    timeout: float = 25.0,
) -> Dict[str, Any]:
    return await _BRIDGE.send_immediate(config, event, auth, timeout=timeout)


async def get_engine_status(*, auto_start: bool = True) -> Dict[str, Any]:
    return await _BRIDGE.get_status(auto_start=auto_start)


async def flush_js_alert_engine(*, timeout: float = 8.0) -> Dict[str, Any]:
    return await _BRIDGE.flush_all(timeout=timeout)


async def shutdown_js_alert_engine() -> None:
    await _BRIDGE.shutdown()
