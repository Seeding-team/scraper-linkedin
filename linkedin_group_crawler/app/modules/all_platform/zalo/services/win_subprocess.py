"""Windows subprocess wrapper dùng chung cho các service cần đọc stdout/stderr
Node.js bất đồng bộ trên Windows (asyncio.create_subprocess_exec không ổn định
trên Windows với 1 số phiên bản Python/loop policy — dùng `subprocess.Popen` +
`asyncio.to_thread` thay thế).

Tách ra từ `zca_qr_bridge.py` cũ (chỉ phục vụ QR login, đã xoá khi bỏ luồng
QR/Playwright) vì `zca_persistent_listener.py` (listener realtime, vẫn đang
dùng) cũng cần class này.
"""

from typing import Any, Dict, List, Optional
import asyncio
import subprocess


class _AsyncReaderWrapper:
    def __init__(self, stream):
        self._stream = stream

    async def readline(self) -> bytes:
        if not self._stream:
            return b""
        try:
            return await asyncio.to_thread(self._stream.readline)
        except Exception:
            return b""


class WindowsSubprocessWrapper:
    def __init__(
        self,
        cmd: List[str],
        cwd: str,
        env: Dict[str, str],
        stdin_input: Optional[bytes] = None,
    ):
        self._proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdin=subprocess.PIPE if stdin_input is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        self._stdout_override = self
        self._stderr_override = _AsyncReaderWrapper(self._proc.stderr)

        if stdin_input is not None and self._proc.stdin is not None:
            try:
                self._proc.stdin.write(stdin_input)
                self._proc.stdin.flush()
            except Exception:
                pass
            finally:
                try:
                    self._proc.stdin.close()
                except Exception:
                    pass

    @property
    def returncode(self) -> Optional[int]:
        self._proc.poll()
        return self._proc.returncode

    @property
    def stderr(self) -> Any:
        return self._stderr_override

    @stderr.setter
    def stderr(self, value: Any) -> None:
        self._stderr_override = value

    @property
    def stdout(self) -> Any:
        return self._stdout_override

    @stdout.setter
    def stdout(self, value: Any) -> None:
        self._stdout_override = value

    async def readline(self) -> bytes:
        return await asyncio.to_thread(self._proc.stdout.readline)

    async def wait(self) -> int:
        return await asyncio.to_thread(self._proc.wait)

    def terminate(self):
        try:
            self._proc.terminate()
        except Exception:
            pass

    def kill(self):
        try:
            self._proc.kill()
        except Exception:
            pass
