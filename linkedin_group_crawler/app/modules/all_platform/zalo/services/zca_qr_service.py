"""Server-side Zalo QR Login session manager (subprocess supervisor for scripts/zca_qr_login.js).

Manages short-lived Node.js QR login sessions without modifying ``node_modules/zca-js``:
- Reuses persisted ``imei`` & ``proxy_url`` from ``zca-auth/{account_id}.json`` when re-linking.
- Passes ``proxy_url`` strictly via subprocess ``ZALO_PROXY_URL`` environment variable (never CLI argv).
- Parses pure NDJSON events (``qr``, ``scanned``, ``confirmed``, ``expired``, ``declined``, ``error``).
- Guarantees zero zombie processes via explicit cancellation, hard timeout, and TTL cleanup.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import secrets
import sys
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional
import uuid

from loguru import logger

from app.modules.all_platform.zalo.services.zca_auth_store import (
    get_effective_proxy_url,
    load_zca_auth,
    mask_proxy_url,
    validate_proxy_url,
)

DEFAULT_QR_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_QR_TTL_SECONDS = 100
_FINISHED_SESSION_TTL_S = 15 * 60
_MAX_CONCURRENT_QR_SESSIONS = 10
_TERMINAL_STATUSES = frozenset({"confirmed", "expired", "declined", "cancelled", "error"})


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[5]


def qr_login_script_path() -> Path:
    return _backend_root() / "scripts" / "zca_qr_login.js"


def _normalize_cookies_list(raw_cookies: Any) -> List[Dict[str, Any]]:
    if isinstance(raw_cookies, str):
        stripped = raw_cookies.strip()
        if stripped.startswith(("[", "{")):
            try:
                raw_cookies = json.loads(stripped)
            except Exception:
                return []
        else:
            return []
    if isinstance(raw_cookies, dict) and isinstance(raw_cookies.get("cookies"), list):
        raw_cookies = raw_cookies["cookies"]
    if not isinstance(raw_cookies, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_cookies:
        if not isinstance(item, dict):
            continue
        key = item.get("key") or item.get("name")
        if key and item.get("value") is not None:
            normalized = dict(item)
            normalized["key"] = str(key)
            out.append(normalized)
    return out


ConfirmCallback = Callable[["ZaloQrSession", Dict[str, Any]], Awaitable[str]]


@dataclass
class ZaloQrSession:
    qr_session_id: str
    account_id: Optional[str] = None
    label: Optional[str] = None
    owner_id: str = "default"
    owner_email: Optional[str] = None
    id_member: Optional[str] = None
    status: str = "starting"
    qr_data_url: Optional[str] = None
    scanned_user: Optional[Dict[str, Optional[str]]] = None
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    uid: Optional[str] = None
    attempt: int = 0
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    expires_in_s: int = DEFAULT_QR_TTL_SECONDS
    qr_generated_at: Optional[float] = None
    proxy_url: Optional[str] = None
    imei_hint: Optional[str] = None
    error: Optional[str] = None
    proc: Any = None
    reader_task: Optional[asyncio.Task] = None
    qr_ready_event: asyncio.Event = field(default_factory=asyncio.Event)
    created_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    finished_at: Optional[float] = None

    def remaining_expires_in_s(self) -> int:
        if self.status in _TERMINAL_STATUSES:
            return 0
        if self.qr_generated_at is None:
            return self.expires_in_s
        elapsed = time.monotonic() - self.qr_generated_at
        return max(0, int(round(self.expires_in_s - elapsed)))

    def to_start_response(self) -> Dict[str, Any]:
        start_status = self.status if self.status in {"starting", "qr_ready", "error"} else "starting"
        if self.status in {"scanned", "confirmed"}:
            start_status = "qr_ready"
        return {
            "qr_session_id": self.qr_session_id,
            "status": start_status,
            "qr_data_url": self.qr_data_url,
            "account_id": self.account_id,
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            "expires_in_s": self.remaining_expires_in_s(),
            "has_proxy": bool(self.proxy_url),
            "proxy_masked": mask_proxy_url(self.proxy_url),
            "error": self.error,
        }

    def to_status_response(self) -> Dict[str, Any]:
        return {
            "qr_session_id": self.qr_session_id,
            "status": self.status,
            "qr_data_url": self.qr_data_url,
            "scanned_user": self.scanned_user,
            "account_id": self.account_id,
            "display_name": self.display_name,
            "avatar": self.avatar,
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            "expires_in_s": self.remaining_expires_in_s(),
            "has_proxy": bool(self.proxy_url),
            "proxy_masked": mask_proxy_url(self.proxy_url),
            "error": self.error,
        }


class ZcaQrSessionManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, ZaloQrSession] = {}
        self._lock = asyncio.Lock()

    def _prune_locked(self) -> None:
        now = time.monotonic()
        stale_ids = [
            sid
            for sid, sess in self._sessions.items()
            if sess.finished_at is not None and (now - sess.finished_at) > _FINISHED_SESSION_TTL_S
        ]
        for sid in stale_ids:
            self._sessions.pop(sid, None)

    def get_session(self, qr_session_id: str) -> Optional[ZaloQrSession]:
        return self._sessions.get(qr_session_id)

    async def start_session(
        self,
        *,
        account_id: Optional[str] = None,
        label: Optional[str] = None,
        proxy_url: Optional[str] = None,
        proxy_explicitly_cleared: bool = False,
        owner_id: str = "default",
        owner_email: Optional[str] = None,
        id_member: Optional[str] = None,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        initial_wait_s: float = 8.0,
        on_confirmed: Optional[ConfirmCallback] = None,
    ) -> ZaloQrSession:
        validated_proxy: Optional[str] = None
        if not proxy_explicitly_cleared and proxy_url is not None:
            validated_proxy = validate_proxy_url(proxy_url)

        existing_auth: Optional[Dict[str, Any]] = None
        if account_id:
            existing_auth = await load_zca_auth(account_id)

        imei_hint = str((existing_auth or {}).get("imei") or "").strip() or None

        if proxy_explicitly_cleared:
            resolved_proxy = None
        elif validated_proxy is not None:
            resolved_proxy = validated_proxy
        else:
            saved_proxy = str((existing_auth or {}).get("proxy_url") or "").strip() or None
            resolved_proxy = saved_proxy or get_effective_proxy_url(None)

        script = qr_login_script_path()
        if not script.exists():
            raise RuntimeError(f"ZCA QR login script not found: {script}")

        safe_max_attempts = max(1, min(5, int(max_attempts or DEFAULT_MAX_ATTEMPTS)))

        async with self._lock:
            self._prune_locked()
            # Cancel any previous in-flight QR session targeting the same account_id
            if account_id:
                for prev in list(self._sessions.values()):
                    if (
                        prev.account_id == account_id
                        and prev.status not in _TERMINAL_STATUSES
                    ):
                        await self._cancel_session_locked(prev)

            active_count = sum(
                1 for s in self._sessions.values() if s.status not in _TERMINAL_STATUSES
            )
            if active_count >= _MAX_CONCURRENT_QR_SESSIONS:
                raise RuntimeError(
                    "Đang có quá nhiều phiên tạo mã QR đồng thời. Vui lòng thử lại sau ít phút."
                )

            qr_session_id = f"zqr_{secrets.token_hex(8)}"
            session = ZaloQrSession(
                qr_session_id=qr_session_id,
                account_id=account_id,
                label=(label or "").strip() or None,
                owner_id=owner_id,
                owner_email=(owner_email or "").strip().lower() or None,
                id_member=id_member,
                max_attempts=safe_max_attempts,
                proxy_url=resolved_proxy,
                imei_hint=imei_hint,
            )
            self._sessions[qr_session_id] = session

        await self._spawn_qr_process(session, on_confirmed=on_confirmed)

        if initial_wait_s > 0:
            try:
                await asyncio.wait_for(session.qr_ready_event.wait(), timeout=initial_wait_s)
            except asyncio.TimeoutError:
                pass

        return session

    async def _spawn_qr_process(
        self,
        session: ZaloQrSession,
        *,
        on_confirmed: Optional[ConfirmCallback] = None,
    ) -> None:
        script = qr_login_script_path()
        cmd = [
            "node",
            str(script),
            "--session-id",
            session.qr_session_id,
            "--max-attempts",
            str(session.max_attempts),
        ]
        if session.imei_hint:
            cmd.extend(["--imei", session.imei_hint])

        proc_env = {**os.environ}
        if session.proxy_url:
            proc_env["ZALO_PROXY_URL"] = session.proxy_url
        else:
            proc_env.pop("ZALO_PROXY_URL", None)

        try:
            if sys.platform == "win32":
                from app.modules.all_platform.zalo.services.win_subprocess import (
                    WindowsSubprocessWrapper,
                )

                proc = WindowsSubprocessWrapper(
                    cmd,
                    cwd=str(_backend_root()),
                    env=proc_env,
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=str(_backend_root()),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=proc_env,
                )
        except Exception as exc:
            session.status = "error"
            session.error = f"Không thể khởi chạy tiến trình tạo mã QR: {exc}"
            session.finished_at = time.monotonic()
            session.qr_ready_event.set()
            return

        session.proc = proc
        logger.info(
            f"Started ZCA QR login process qr_session={session.qr_session_id} "
            f"account={session.account_id} has_proxy={bool(session.proxy_url)} "
            f"reused_imei={bool(session.imei_hint)}"
        )
        session.reader_task = asyncio.create_task(
            self._read_loop(session, proc, on_confirmed=on_confirmed)
        )

    async def _terminate_proc(self, proc: Any) -> None:
        if not proc:
            return
        try:
            if proc.returncode is None:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    proc.kill()
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=2.0)
                    except Exception:
                        pass
        except ProcessLookupError:
            pass
        except Exception as exc:
            logger.debug(f"Could not terminate QR process cleanly: {exc}")

    async def _read_loop(
        self,
        session: ZaloQrSession,
        proc: Any,
        *,
        on_confirmed: Optional[ConfirmCallback] = None,
    ) -> None:
        stderr_lines: List[str] = []

        async def _drain_stderr() -> None:
            if not proc.stderr:
                return
            while True:
                line = await proc.stderr.readline()
                if not line:
                    return
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    stderr_lines.append(text[:500])
                    if len(stderr_lines) > 10:
                        stderr_lines.pop(0)
                    logger.debug(f"ZCA QR stderr [{session.qr_session_id}]: {text[:500]}")

        stderr_task = asyncio.create_task(_drain_stderr())
        hard_timeout_s = max(120, session.max_attempts * 115)
        deadline = time.monotonic() + hard_timeout_s

        try:
            while session.status not in _TERMINAL_STATUSES:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    session.status = "expired"
                    session.expires_in_s = 0
                    session.error = "Hết thời gian chờ quét mã QR. Vui lòng tạo mã mới."
                    session.qr_ready_event.set()
                    await self._terminate_proc(proc)
                    break

                if not proc.stdout:
                    break
                try:
                    raw = await asyncio.wait_for(proc.stdout.readline(), timeout=min(remaining, 30.0))
                except asyncio.TimeoutError:
                    continue

                if not raw:
                    break
                decoded = raw.decode("utf-8", errors="replace").strip()
                if not decoded:
                    continue
                await self._handle_ndjson_line(session, decoded, on_confirmed=on_confirmed)

            rc = await proc.wait()
            if session.status not in _TERMINAL_STATUSES:
                stderr_hint = " | ".join(stderr_lines[-3:]) if stderr_lines else ""
                session.status = "error"
                session.error = (
                    session.error
                    or stderr_hint
                    or f"Tiến trình tạo mã QR kết thúc bất ngờ (code={rc})."
                )
                session.qr_ready_event.set()
        except asyncio.CancelledError:
            await self._terminate_proc(proc)
            raise
        except Exception as exc:
            if session.status not in _TERMINAL_STATUSES:
                session.status = "error"
                session.error = f"Lỗi đọc luồng mã QR: {exc}"
                session.qr_ready_event.set()
            await self._terminate_proc(proc)
        finally:
            stderr_task.cancel()
            try:
                await stderr_task
            except (asyncio.CancelledError, Exception):
                pass
            if session.finished_at is None:
                session.finished_at = time.monotonic()
            session.updated_at = time.monotonic()
            session.proc = None
            session.qr_ready_event.set()

    async def _handle_ndjson_line(
        self,
        session: ZaloQrSession,
        raw_line: str,
        *,
        on_confirmed: Optional[ConfirmCallback] = None,
    ) -> None:
        try:
            ev = json.loads(raw_line)
        except json.JSONDecodeError:
            logger.debug(f"Ignoring non-JSON QR stdout [{session.qr_session_id}]: {raw_line[:200]}")
            return
        if not isinstance(ev, dict):
            return

        event_name = str(ev.get("event") or ev.get("type") or "").strip().lower()
        session.updated_at = time.monotonic()

        if event_name == "qr":
            qr_data_url = ev.get("qr_data_url") or ev.get("qr_base64") or ""
            session.qr_data_url = str(qr_data_url) if qr_data_url else None
            session.attempt = int(ev.get("attempt") or (session.attempt + 1))
            if ev.get("max_attempts"):
                session.max_attempts = int(ev["max_attempts"])
            session.expires_in_s = int(ev.get("expires_in_s") or DEFAULT_QR_TTL_SECONDS)
            session.qr_generated_at = time.monotonic()
            session.status = "qr_ready"
            session.error = None
            session.qr_ready_event.set()
            return

        if event_name == "scanned":
            display_name = ev.get("display_name") or None
            avatar = ev.get("avatar") or None
            session.scanned_user = {"display_name": display_name, "avatar": avatar}
            if display_name:
                session.display_name = str(display_name)
            if avatar:
                session.avatar = str(avatar)
            session.status = "scanned"
            return

        if event_name == "confirmed":
            cookies = _normalize_cookies_list(ev.get("cookies"))
            imei = str(ev.get("imei") or session.imei_hint or uuid.uuid4()).strip()
            user_agent = str(ev.get("userAgent") or ev.get("user_agent") or DEFAULT_QR_USER_AGENT).strip()
            uid = str(ev.get("uid") or ev.get("zaloId") or "").strip()
            display_name = (
                ev.get("display_name")
                or (session.scanned_user or {}).get("display_name")
                or session.label
                or None
            )
            avatar = ev.get("avatar") or (session.scanned_user or {}).get("avatar") or None

            session.uid = uid or None
            session.display_name = str(display_name) if display_name else session.display_name
            session.avatar = str(avatar) if avatar else session.avatar

            auth_dict: Dict[str, Any] = {
                "cookies": cookies,
                "imei": imei,
                "userAgent": user_agent,
                "zaloId": uid or (session.account_id or ""),
                "ownerId": session.owner_id,
                "idMember": session.id_member or session.owner_id,
                "source": "server_qr",
            }
            if session.proxy_url:
                auth_dict["proxy_url"] = session.proxy_url

            try:
                if on_confirmed is not None:
                    resolved_account_id = await on_confirmed(session, auth_dict)
                    if resolved_account_id:
                        session.account_id = resolved_account_id
                elif not session.account_id:
                    session.account_id = f"zl_{secrets.token_hex(4)}"
                session.status = "confirmed"
                session.error = None
            except Exception as exc:
                logger.warning(f"Failed to persist confirmed QR session {session.qr_session_id}: {exc}")
                session.status = "error"
                session.error = f"Đăng nhập QR thành công nhưng lỗi lưu phiên: {exc}"
            finally:
                session.finished_at = time.monotonic()
                session.qr_ready_event.set()
            return

        if event_name == "expired":
            session.status = "expired"
            session.expires_in_s = 0
            session.error = str(ev.get("error") or "Mã QR đã hết hạn sau 3 lần làm mới. Vui lòng tạo mã mới.")
            session.finished_at = time.monotonic()
            session.qr_ready_event.set()
            return

        if event_name == "declined":
            session.status = "declined"
            session.expires_in_s = 0
            session.error = str(ev.get("error") or "Bạn đã từ chối đăng nhập trên điện thoại Zalo.")
            session.finished_at = time.monotonic()
            session.qr_ready_event.set()
            return

        if event_name == "error":
            session.status = "error"
            session.error = str(ev.get("error") or ev.get("message") or "Không thể hoàn tất đăng nhập QR Zalo.")
            session.finished_at = time.monotonic()
            session.qr_ready_event.set()
            return

    async def _cancel_session_locked(self, session: ZaloQrSession) -> None:
        if session.status not in _TERMINAL_STATUSES:
            session.status = "cancelled"
        session.expires_in_s = 0
        session.finished_at = time.monotonic()
        session.updated_at = time.monotonic()
        session.qr_ready_event.set()
        proc = session.proc
        task = session.reader_task
        session.proc = None
        await self._terminate_proc(proc)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def cancel_session(self, qr_session_id: str) -> Dict[str, Any]:
        async with self._lock:
            session = self._sessions.get(qr_session_id)
            if session is not None:
                await self._cancel_session_locked(session)
        return {
            "ok": True,
            "qr_session_id": qr_session_id,
            "status": "cancelled",
        }

    async def shutdown(self) -> None:
        async with self._lock:
            for session in list(self._sessions.values()):
                if session.status not in _TERMINAL_STATUSES:
                    await self._cancel_session_locked(session)


_QR_MANAGER = ZcaQrSessionManager()


def get_qr_manager() -> ZcaQrSessionManager:
    return _QR_MANAGER
