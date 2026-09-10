"""Supabase client singleton for the all-platform module."""

from __future__ import annotations

import os
import re
import socket
import threading
import time
from typing import TYPE_CHECKING, Callable, TypeVar

from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

if TYPE_CHECKING:
    pass

T = TypeVar("T")
_supabase_client: Client | None = None
# BUG THAT DA GAP ("Cannot send a request, as the client has been closed"):
# FastAPI chay cac sync route handler tren mot threadpool, nen nhieu request
# CO THE dong thoi doc/ghi bien global `_supabase_client` nay - truoc day
# khong co lock nao ca. 1 thread gap loi transient goi reset_supabase_client()
# CUNG LUC 1 thread khac dang goi get_supabase_client() co the doc duoc client
# nam giua chung 2 thao tac (vua bi set None vua chua kip tao lai), hoac te
# hon: dong session cua client MA THREAD KIA DANG DUNG DO. Lock nay chi bao ve
# thao tac DOC/GHI bien global cho atomic (khong con race lam rong/tao trung
# client) - no KHONG the bao ve 1 thread da lay san tham chieu client TRUOC do
# roi dang ban I/O luc bi reset (xem them ly do bo han .close() ben duoi).
_client_lock = threading.Lock()

# Transient network markers (substring match on f"{type(exc).__name__}: {exc}")
_TRANSIENT_ERROR_MARKERS = (
    "Server disconnected",
    "ConnectionTerminated",
    "RemoteProtocolError",
    "PROTOCOL_ERROR",
    "COMPRESSION_ERROR",
    "ReadTimeout",
    "ConnectTimeout",
    "PoolTimeout",
    "timed out",
    "timeout",
    "502 Bad Gateway",
    "503 Service Unavailable",
    "504 Gateway",
    "cloudflare",
)

# Win32 socket error codes that mean "try again later" (transient)
# See: https://learn.microsoft.com/en-us/windows/win32/winsock/windows-sockets-error-codes-2
_TRANSIENT_WSA_CODES = frozenset({
    10035,  # WSAEWOULDBLOCK — non-blocking socket op could not complete immediately
    10036,  # WSAEINPROGRESS — a blocking Windows Sockets 1.1 call is in progress
    10038,  # WSAENOTSOCK — op attempted on a fd that is no longer a valid socket
            # (httpx pool handed out a connection whose underlying OS handle was
            # already closed/reused elsewhere in the process — same failure
            # family as 10054/10053, just a different Winsock code depending on
            # exactly which syscall hits the stale fd first). BUG THAT DA GAP:
            # code nay TUNG THIEU trong danh sach, nen loi nay bi coi la KHONG
            # transient -> khong reset client/retry, loi that thoat ra ngay lan
            # dau (QA thuc te: "Error getting customer leads/SDRs" roi request
            # sau do lai 200 OK binh thuong, dung dau hieu 1 loi tam thoi bi xu
            # ly sai thanh vinh vien).
    10053,  # WSAECONNABORTED — software caused connection abort
    10054,  # WSAECONNRESET — existing connection forcibly closed by remote host
    10060,  # WSAETIMEDOUT — connection timed out
    10061,  # WSAECONNREFUSED — connection refused (server not listening)
    10065,  # WSAENETUNREACH — network is unreachable
})

# POSIX errno codes equivalent to the Win32 transient set (Linux/VM Linux)
_TRANSIENT_POSIX_CODES = frozenset({
    11,     # EAGAIN
    35,     # EDEADLK (or EWOULDBLOCK on some)
    104,    # ECONNRESET
    110,    # ETIMEDOUT
    111,    # ECONNREFUSED
    113,    # ENETUNREACH
})

_TRANSIENT_OS_EXC_CLASSES = (
    socket.gaierror,
    socket.timeout,
    ConnectionResetError,
    TimeoutError,
    BlockingIOError,    # raised when a non-blocking socket would block
    ConnectionAbortedError,
)


def reset_supabase_client() -> None:
    """Drop the cached Supabase client after a broken HTTP connection.

    BUG THAT DA GAP ("Cannot send a request, as the client has been closed"):
    ban truoc goi ``session.close()`` NGAY LAP TUC tren client dang bi thay
    the - nhung client CU do co the dang duoc 1 REQUEST/THREAD KHAC su dung
    dong thoi (FastAPI chay sync handler tren threadpool, nhieu request chia
    chung 1 singleton). Dong session cua no giua chung khien request kia nhan
    ngay loi "client has been closed" du ban than request kia khong gap loi
    transient gi ca (QA thuc te xac nhan: 1 request "customer-leads" loi
    transient, request "sdrs" chay gan cung luc tren thread khac bi vo dung
    session vua bi dong nay). Chi DROP tham chieu global (duoi lock, atomic
    voi get_supabase_client()) - KHONG con chu dong dong session nua. Client
    cu tro thanh "mo coi", cac request dang giu tham chieu rieng van dung
    duoc binh thuong cho toi khi xong; httpx.Client tu dong giai phong ket
    noi khi bi garbage-collect (doi lay 1 it leak-cho-toi-GC ngan de doi lay
    KHONG con loi "closed" gia gay boi chinh co che reset nay).
    """
    global _supabase_client
    with _client_lock:
        _supabase_client = None


def is_transient_supabase_error(exc: BaseException) -> bool:
    """Return True for upstream/network failures safe to retry.

    Detects:
    - All known transient markers by substring (WinError NNNN, Server
      disconnected, Cloudflare 5xx, timeouts, etc.).
    - Any ``OSError``/``socket.*`` whose errno is in the transient set
      (Win32 WSA codes + POSIX equivalents).
    - Specific exception classes commonly raised by socket / httpx.
    """
    # 1. By exception class
    if isinstance(exc, _TRANSIENT_OS_EXC_CLASSES):
        return True

    # 2. By errno (OSError stores errno on .errno / args[0])
    code = getattr(exc, "errno", None)
    if code is None:
        try:
            code = exc.args[0]
        except (IndexError, TypeError):
            code = None
    if isinstance(code, int):
        if code in _TRANSIENT_WSA_CODES or code in _TRANSIENT_POSIX_CODES:
            return True

    # 3. By message substring (catches httpx/httpcore/anyio/socket msg strings)
    msg = f"{type(exc).__name__}: {exc}"
    if any(marker in msg for marker in _TRANSIENT_ERROR_MARKERS):
        return True

    # 4. "[Errno NNNN]" / "WinError NNNN" / "WSAE..." markers in message
    if re.search(r"\[Errno (?:10035|10038|10053|10054|10060|10061|10065)\]", msg):
        return True
    if re.search(r"WinError (?:10035|10038|10053|10054|10060|10061|10065)", msg):
        return True
    if re.search(r"WSA(EWOULDBLOCK|ENOTSOCK|ECONNABORTED|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENETUNREACH)", msg):
        return True

    return False


def friendly_supabase_error_message(exc: BaseException) -> str:
    """User-facing message for a Supabase/network failure — NEVER the raw
    exception text (yeu cau ro rang "không render raw WinError ra giao
    diện"). Loi transient (socket Windows, timeout, 502/503...) da qua het
    so lan retry cua execute_supabase_query() van co the roi toi day - tra
    ve 1 cau chung chung, khong lo chi tiet ky thuat noi bo cho FE/nguoi
    dung cuoi. Loi KHONG transient (schema/permission/logic that) van giu
    nguyen str(exc) - do la loi nghiep vu that can thay de debug/xu ly.
    """
    if is_transient_supabase_error(exc):
        return "Không tải được dữ liệu do lỗi kết nối tạm thời. Vui lòng thử lại sau ít phút."
    return str(exc)


def execute_supabase_query(
    operation: Callable[[], T],
    *,
    attempts: int = 4,
    base_delay: float = 0.25,
    max_delay: float = 3.0,
) -> T:
    """Execute a Supabase query with retry/reset for flaky HTTP connections.

    Strategy:
    - Up to ``attempts`` attempts (default 4).
    - Exponential backoff with jitter, capped at ``max_delay``.
    - On transient error: drop the singleton client so the next attempt
      creates a fresh connection (fixes stale-connection bugs after
      ``WinError 10054`` / WSAECONNRESET).
    - Non-transient errors (schema errors, auth failures, 4xx) re-raised
      immediately — no point retrying those.
    """
    import random

    last_exc: Exception | None = None
    delays: list[float] = []
    n = max(1, attempts)
    for attempt in range(n):
        try:
            return operation()
        except Exception as exc:
            last_exc = exc
            transient = is_transient_supabase_error(exc)
            if not transient or attempt >= n - 1:
                raise
            # Drop cached client on transient socket errors so the retry
            # creates a fresh connection (don't reuse a half-dead socket).
            reset_supabase_client()
            # Exponential backoff with jitter
            sleep_s = base_delay * (2 ** attempt)
            sleep_s = min(sleep_s, max_delay)
            sleep_s = sleep_s * (0.75 + random.random() * 0.5)  # ±25% jitter
            delays.append(round(sleep_s, 3))
            time.sleep(sleep_s)

    if last_exc:
        raise last_exc
    raise RuntimeError("Supabase operation failed without an exception")


def get_supabase_client() -> Client:
    """Return a singleton Supabase client.

    Reads ``SUPABASE_URL`` and ``SUPABASE_SERVICE_ROLE_KEY`` from environment.
    Raises ``RuntimeError`` if either is missing.

    Note:
    - ``postgrest_client_timeout`` is bumped to 30s — default 120s but
      reading from `.env.example` callers often override via httpx pool.
    - ``Connection: keep-alive`` header helps on Windows VM where frequent
      reconnects trigger ``WinError 10035``.
    - Pass an explicit ``httpx.Client`` with retry transport so transient
      socket resets are auto-retried at the HTTP layer (in addition to the
      ``execute_supabase_query`` retry on top of that).
    """
    global _supabase_client
    # Doc nhanh KHONG lock truoc (fast path - da co client thi tra ve ngay,
    # khong tranh chap voi thread khac). Chi vao lock khi THAT SU can tao moi
    # - double-checked locking: kiem tra lai 1 lan nua SAU khi vao lock, vi 1
    # thread khac co the da tao xong trong luc thread nay cho lay lock.
    if _supabase_client is not None:
        return _supabase_client

    with _client_lock:
        if _supabase_client is not None:
            return _supabase_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
            )

        # Dedicated httpx client with HTTP-level retry + sensible timeouts.
        # On Windows VM / Supabase cross-region requests, transient socket
        # errors (WinError 10035/10053/10054/10060) are common and need
        # retries. We let httpx handle them so the call site stays clean.
        try:
            import httpx
            _http_client = httpx.Client(
                timeout=httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0),
                headers={"Connection": "keep-alive"},
                # `retries` only covers connect failures, never a RemoteProtocolError
                # on a pooled socket the upstream closed. execute_supabase_query()
                # is what actually recovers from that.
                transport=httpx.HTTPTransport(retries=3),
                # Expire idle sockets well before Kong/nginx (keepalive_timeout 60s)
                # reaps them, so we rarely hand out an already-closed connection.
                limits=httpx.Limits(
                    max_keepalive_connections=20,
                    max_connections=100,
                    keepalive_expiry=15.0,
                ),
            )
        except Exception:
            _http_client = None

        _supabase_client = create_client(
            url,
            key,
            options=SyncClientOptions(
                # Allow long-running Postgres RPC / REST calls
                postgrest_client_timeout=30,
                storage_client_timeout=30,
                function_client_timeout=30,
                # Extra headers sent on every request (helps debug + keep-alive)
                headers={"x-client-info": "linkedin-group-crawler/1.0"},
                httpx_client=_http_client,
            ),
        )
        return _supabase_client
