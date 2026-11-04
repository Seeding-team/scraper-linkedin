"""ZCA Worker Pool — Persistent Node.js Server per Zalo user.

Thay cho mô hình spawn-per-call (mỗi lệnh ZCA spawn 1 tiến trình Node.js mới),
module này duy trì 1 tiến trình Node.js persistent per user, giao tiếp qua
JSON-Lines qua stdin/stdout.

Lợi ích:
    * Loại bỏ ~300-500ms overhead khởi động Node.js + ZCA login mỗi lần gọi.
    * Giữ Zalo session sống trong tiến trình → không phải login lại giữa các lệnh.
    * Tự fallback về spawn-per-call (zca_api_bridge.py cũ) nếu server gặp lỗi.

Protocol:
    stdin  → {"id":"req-1","command":"list-groups","args":{},"auth":{...}}\n
    stdout ← {"id":"req-1","ok":true,"groups":[...]}\n

Timeout / cleanup:
    * Server tự thoát sau ZCA_SERVER_IDLE_MS ms không có request (default 10 phút).
    * Pool tự cleanup worker sau idle quá WORKER_IDLE_SECS giây.
    * Worker bị replace khi crash hoặc process chết.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from loguru import logger

# Các lệnh nặng/phức tạp cần listener — vẫn fallback về spawn-per-call
_SPAWN_ONLY_COMMANDS = {"sync-old-messages", "first-time-sync"}

# Idle timeout cho worker (phải <= MAX_IDLE_MS trong zca_api_server.js)
WORKER_IDLE_SECS = 540  # 9 phút

_server_script: Optional[Path] = None


def _get_server_script() -> Path:
    global _server_script
    if _server_script is None:
        _server_script = Path(__file__).resolve().parents[5] / "scripts" / "zca_api_server.js"
    return _server_script


# ── Worker ────────────────────────────────────────────────────────────────────

class _ZcaWorker:
    """Một persistent Node.js server instance cho 1 user."""

    def __init__(self, user_key: str) -> None:
        self.user_key = user_key
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self._ready = False
        self._last_used: float = 0.0
        self._pending: Dict[str, asyncio.Future] = {}
        self._read_task: Optional[asyncio.Task] = None

    @property
    def alive(self) -> bool:
        return (
            self._proc is not None
            and self._proc.returncode is None
            and self._ready
        )

    async def start(self) -> None:
        """Spawn tiến trình Node.js server, chờ báo "ready" trên stderr."""
        script = _get_server_script()
        if not script.exists():
            raise RuntimeError(f"ZCA API server script not found: {script}")

        env = {**os.environ, "ZCA_SERVER_IDLE_MS": str(int(WORKER_IDLE_SECS * 1000))}
        cwd = str(script.parent.parent)  # linkedin_group_crawler/

        if sys.platform == "win32":
            self._proc = await asyncio.create_subprocess_exec(
                "node", str(script),
                cwd=cwd, env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
        else:
            self._proc = await asyncio.create_subprocess_exec(
                "node", str(script),
                cwd=cwd, env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        # Chờ "[zca-server] ready" từ stderr (timeout 15s)
        assert self._proc.stderr is not None
        try:
            ready_line = await asyncio.wait_for(
                self._proc.stderr.readline(), timeout=15.0
            )
            if b"ready" not in ready_line.lower():
                raise RuntimeError(f"ZCA server startup unexpected: {ready_line!r}")
        except asyncio.TimeoutError:
            self._proc.kill()
            raise RuntimeError("ZCA persistent server did not become ready in 15s")

        self._ready = True
        self._last_used = asyncio.get_event_loop().time()
        self._read_task = asyncio.create_task(self._read_stdout_loop(), name=f"zca-server-{self.user_key}")
        logger.info(f"ZCA persistent server started pid={self._proc.pid} key={self.user_key}")

    async def _read_stdout_loop(self) -> None:
        """Đọc từng dòng stdout, resolve futures đang chờ."""
        assert self._proc and self._proc.stdout
        try:
            while True:
                line = await self._proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                if not decoded:
                    continue
                try:
                    data = json.loads(decoded)
                except json.JSONDecodeError:
                    logger.warning(f"ZCA server non-JSON stdout: {decoded[:200]}")
                    continue
                req_id = data.get("id")
                fut = self._pending.pop(req_id, None)
                if fut and not fut.done():
                    fut.set_result(data)
        except Exception as exc:
            logger.warning(f"ZCA server stdout reader exited: {exc}")
        finally:
            self._ready = False
            # Fail mọi pending future
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("ZCA server connection lost"))
            self._pending.clear()

    async def send(
        self,
        command: str,
        auth: Dict[str, Any],
        args: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
        timeout: float = 120.0,
    ) -> Dict[str, Any]:
        """Gửi lệnh tới server, chờ kết quả. Thread-safe qua _lock."""
        if not self.alive:
            raise RuntimeError("ZCA worker not alive")

        req_id = str(uuid.uuid4())[:12]
        request = {"id": req_id, "command": command, "args": args or {}, "auth": auth}
        if payload:
            request["payload"] = payload

        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut

        try:
            line = (json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8")
            assert self._proc and self._proc.stdin
            self._proc.stdin.write(line)
            await self._proc.stdin.drain()
            self._last_used = loop.time()
        except Exception as exc:
            self._pending.pop(req_id, None)
            raise RuntimeError(f"Failed to write to ZCA server: {exc}") from exc

        try:
            result = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise RuntimeError(f"ZCA server timeout ({timeout}s) for command={command}")

        return result

    async def stop(self) -> None:
        """Dừng worker gracefully."""
        self._ready = False
        if self._read_task and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
        proc = self._proc
        if proc and proc.returncode is None:
            try:
                if proc.stdin:
                    proc.stdin.write(b'{"id":"shutdown","command":"shutdown"}\n')
                    await proc.stdin.drain()
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        self._proc = None


# ── Pool ─────────────────────────────────────────────────────────────────────

class ZcaWorkerPool:
    """Pool quản lý 1 persistent worker per user key.

    worker key = hash(imei + userAgent prefix + first cookie value prefix)
    để phân biệt các phiên đăng nhập khác nhau của cùng 1 user.
    """

    def __init__(self) -> None:
        self._workers: Dict[str, _ZcaWorker] = {}
        self._lock = asyncio.Lock()

    def _auth_key(self, auth: Dict[str, Any]) -> str:
        cookies = auth.get("cookies") or []
        first_val = cookies[0].get("value", "") if cookies else ""
        return f"{(auth.get('imei') or '')[:20]}|{(auth.get('userAgent') or '')[:30]}|{first_val[:16]}"

    async def _get_or_create(self, auth: Dict[str, Any]) -> _ZcaWorker:
        key = self._auth_key(auth)
        async with self._lock:
            worker = self._workers.get(key)
            if worker and worker.alive:
                return worker
            # Worker chết hoặc chưa có — tạo mới
            if worker:
                try:
                    await worker.stop()
                except Exception:
                    pass
            worker = _ZcaWorker(key)
            await worker.start()
            self._workers[key] = worker
            return worker

    async def run_command(
        self,
        command: str,
        auth: Dict[str, Any],
        *,
        args: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
        timeout: float = 120.0,
    ) -> Dict[str, Any]:
        """Chạy command qua persistent worker. Raise RuntimeError nếu thất bại."""
        worker = await self._get_or_create(auth)
        try:
            result = await worker.send(command, auth, args=args, payload=payload, timeout=timeout)
        except Exception as exc:
            # Worker có thể chết giữa chừng — cleanup và raise để caller fallback
            key = self._auth_key(auth)
            async with self._lock:
                dead = self._workers.get(key)
                if dead is worker:
                    self._workers.pop(key, None)
            raise RuntimeError(f"ZCA worker error: {exc}") from exc

        if not result.get("ok"):
            detail = result.get("error_detail") or result.get("error") or "unknown"
            raise RuntimeError(json.dumps(detail) if isinstance(detail, dict) else str(detail))

        return result

    async def cleanup_idle(self) -> None:
        """Dừng workers đã idle quá lâu. Gọi từ background task định kỳ."""
        now = asyncio.get_event_loop().time()
        to_remove = []
        async with self._lock:
            for key, worker in list(self._workers.items()):
                if not worker.alive or now - worker._last_used > WORKER_IDLE_SECS:
                    to_remove.append((key, worker))
        for key, worker in to_remove:
            try:
                await worker.stop()
            except Exception:
                pass
            async with self._lock:
                if self._workers.get(key) is worker:
                    self._workers.pop(key, None)
            logger.info(f"ZCA worker pool: removed idle worker key={key}")

    async def shutdown_all(self) -> None:
        """Dừng toàn bộ workers."""
        async with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for worker in workers:
            try:
                await worker.stop()
            except Exception:
                pass


# Singleton pool instance — dùng chung trong toàn app
_pool: Optional[ZcaWorkerPool] = None


def get_pool() -> ZcaWorkerPool:
    global _pool
    if _pool is None:
        _pool = ZcaWorkerPool()
    return _pool
