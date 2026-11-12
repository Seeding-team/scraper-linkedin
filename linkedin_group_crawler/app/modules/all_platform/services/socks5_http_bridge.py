"""In-process pure-Python HTTP/CONNECT -> SOCKS5 (with RFC 1929 auth) proxy bridge.

Chromium and Playwright cannot pass username/password credentials on `socks5://`
proxies natively (`ERR_NO_SUPPORTED_PROXIES` / failed auth). This lightweight
asyncio relay exposes an unauthenticated local HTTP proxy (`http://127.0.0.1:PORT`)
for Chromium and tunnels each TCP stream through an upstream SOCKS5 proxy using
remote DNS resolution (`ATYP = 0x03`).
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import struct
import time
from typing import Any
from urllib.parse import unquote, urlparse, urlunparse

logger = logging.getLogger(__name__)


def _is_running_in_docker() -> bool:
    if os.path.exists("/.dockerenv"):
        return True
    return os.getenv("DOCKER_CONTAINER", "").strip().lower() in {"1", "true", "yes"}


def rewrite_proxy_url_for_runtime(raw_url: str | None) -> str | None:
    """Adjust `127.0.0.1` / `localhost` -> `host.docker.internal` inside Docker."""
    if not raw_url or not raw_url.strip():
        return None
    url = raw_url.strip()
    if os.getenv("PUBLIC_CRAWL_KEEP_LOCALHOST_PROXY", "").strip().lower() in {"1", "true", "yes"}:
        return url
    if not _is_running_in_docker():
        return url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in {"127.0.0.1", "localhost"}:
        return url
    target_host = os.getenv("PUBLIC_CRAWL_DOCKER_HOST", "host.docker.internal").strip() or "host.docker.internal"
    auth = ""
    if parsed.username is not None:
        auth = parsed.username
        if parsed.password is not None:
            auth = f"{auth}:{parsed.password}"
        auth = f"{auth}@"
    port_part = f":{parsed.port}" if parsed.port else ""
    new_netloc = f"{auth}{target_host}{port_part}"
    return urlunparse((parsed.scheme, new_netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def resolve_socks_url_for_node(node: dict[str, Any]) -> str | None:
    """Pick the best proxy URL from a mobile_proxy node dict for the current runtime."""
    if not isinstance(node, dict):
        return None
    candidates: list[str | None]
    if _is_running_in_docker() or os.name != "nt":
        candidates = [
            node.get("socksUrlVps"),
            node.get("socksUrlOffice"),
            node.get("socksUrlLocalPc"),
        ]
    else:
        candidates = [
            node.get("socksUrlLocalPc"),
            node.get("socksUrlOffice"),
            node.get("socksUrlVps"),
        ]
    for cand in candidates:
        resolved = rewrite_proxy_url_for_runtime(cand)
        if resolved:
            return resolved
    return None


def parse_proxy_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url.strip())
    scheme = (parsed.scheme or "socks5").lower()
    if scheme not in {"socks5", "socks5h", "http", "https"}:
        raise ValueError(f"Unsupported proxy scheme: {scheme}")
    host = parsed.hostname
    port = parsed.port
    if not host or not port:
        raise ValueError(f"Invalid proxy URL (missing host or port): {url}")
    return {
        "scheme": scheme,
        "host": host,
        "port": int(port),
        "username": unquote(parsed.username) if parsed.username is not None else None,
        "password": unquote(parsed.password) if parsed.password is not None else None,
    }


async def _read_exact(reader: asyncio.StreamReader, n: int) -> bytes:
    data = await reader.readexactly(n)
    return data


async def open_socks5_tunnel(
    upstream_host: str,
    upstream_port: int,
    target_host: str,
    target_port: int,
    username: str | None = None,
    password: str | None = None,
    connect_timeout: float = 12.0,
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Connect to target `(target_host, target_port)` through a SOCKS5 upstream proxy."""
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(upstream_host, upstream_port),
        timeout=connect_timeout,
    )
    try:
        has_auth = username is not None and username != ""
        methods = b"\x00\x02" if has_auth else b"\x00"
        writer.write(struct.pack("!BB", 5, len(methods)) + methods)
        await writer.drain()

        ver, chosen = struct.unpack("!BB", await asyncio.wait_for(_read_exact(reader, 2), timeout=connect_timeout))
        if ver != 5 or chosen == 0xFF:
            raise ConnectionError("SOCKS5 handshake rejected (no acceptable auth method)")

        if chosen == 0x02:
            if not has_auth:
                raise ConnectionError("SOCKS5 proxy requires username/password authentication")
            u_bytes = (username or "").encode("utf-8")[:255]
            p_bytes = (password or "").encode("utf-8")[:255]
            auth_pkt = struct.pack("!BB", 1, len(u_bytes)) + u_bytes + struct.pack("!B", len(p_bytes)) + p_bytes
            writer.write(auth_pkt)
            await writer.drain()
            auth_ver, auth_status = struct.unpack(
                "!BB", await asyncio.wait_for(_read_exact(reader, 2), timeout=connect_timeout)
            )
            if auth_ver != 1 or auth_status != 0:
                raise PermissionError(f"SOCKS5 username/password authentication failed (status={auth_status})")

        # Send CONNECT request using ATYP = 0x03 (domain) or 0x01/0x04 (IP)
        try:
            ip_bytes = socket.inet_pton(socket.AF_INET, target_host)
            addr_part = b"\x01" + ip_bytes
        except OSError:
            try:
                ip6_bytes = socket.inet_pton(socket.AF_INET6, target_host)
                addr_part = b"\x04" + ip6_bytes
            except OSError:
                host_bytes = target_host.encode("idna")[:255]
                addr_part = struct.pack("!B", 3) + struct.pack("!B", len(host_bytes)) + host_bytes

        req = b"\x05\x01\x00" + addr_part + struct.pack("!H", int(target_port))
        writer.write(req)
        await writer.drain()

        resp_head = await asyncio.wait_for(_read_exact(reader, 4), timeout=connect_timeout)
        r_ver, rep, _rsv, atyp = struct.unpack("!BBBB", resp_head)
        if r_ver != 5 or rep != 0:
            raise ConnectionError(f"SOCKS5 CONNECT failed to {target_host}:{target_port} (rep={rep})")

        # Consume BND.ADDR + BND.PORT
        if atyp == 1:
            await asyncio.wait_for(_read_exact(reader, 4 + 2), timeout=connect_timeout)
        elif atyp == 3:
            domain_len = (await asyncio.wait_for(_read_exact(reader, 1), timeout=connect_timeout))[0]
            await asyncio.wait_for(_read_exact(reader, domain_len + 2), timeout=connect_timeout)
        elif atyp == 4:
            await asyncio.wait_for(_read_exact(reader, 16 + 2), timeout=connect_timeout)
        else:
            raise ConnectionError(f"SOCKS5 unexpected ATYP={atyp}")

        return reader, writer
    except Exception:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        raise


async def _pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter, idle_timeout: float = 120.0) -> None:
    try:
        while True:
            chunk = await asyncio.wait_for(src.read(65536), timeout=idle_timeout)
            if not chunk:
                break
            dst.write(chunk)
            await dst.drain()
    except Exception:
        pass
    finally:
        try:
            if not dst.is_closing() and dst.can_write_eof():
                dst.write_eof()
        except Exception:
            pass


class Socks5HttpBridge:
    """Local HTTP/CONNECT proxy server tunneling to an upstream SOCKS5 proxy."""

    def __init__(self, upstream_url: str, connect_timeout: float = 15.0) -> None:
        self.upstream_url = upstream_url
        self.upstream = parse_proxy_url(upstream_url)
        self.connect_timeout = connect_timeout
        self._server: asyncio.AbstractServer | None = None
        self._port: int | None = None
        self._active_tasks: set[asyncio.Task[Any]] = set()

    @property
    def local_http_url(self) -> str:
        if not self._port:
            raise RuntimeError("Socks5HttpBridge has not been started yet")
        return f"http://127.0.0.1:{self._port}"

    async def start(self) -> str:
        if self._server is not None and self._port is not None:
            return self.local_http_url
        self._server = await asyncio.start_server(self._handle_client, "127.0.0.1", 0)
        sock = self._server.sockets[0]
        self._port = int(sock.getsockname()[1])
        logger.debug("[PROXY-BRIDGE] Started local relay http://127.0.0.1:%s -> %s:%s", self._port, self.upstream["host"], self.upstream["port"])
        return self.local_http_url

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            try:
                await asyncio.wait_for(self._server.wait_closed(), timeout=3.0)
            except Exception:
                pass
            self._server = None
        for t in list(self._active_tasks):
            t.cancel()
        self._active_tasks.clear()
        self._port = None

    async def __aenter__(self) -> str:
        return await self.start()

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.stop()

    async def _handle_client(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._active_tasks.add(task)
        remote_writer: asyncio.StreamWriter | None = None
        try:
            raw_head = await asyncio.wait_for(client_reader.readuntil(b"\r\n\r\n"), timeout=15.0)
            lines = raw_head.decode("latin-1").split("\r\n")
            if not lines or " " not in lines[0]:
                return
            method, target, proto = lines[0].split(" ", 2)
            method_upper = method.upper()

            if method_upper == "CONNECT":
                if ":" in target:
                    t_host, t_port_s = target.rsplit(":", 1)
                    t_port = int(t_port_s)
                else:
                    t_host, t_port = target, 443
                remote_reader, remote_writer = await self._open_upstream(t_host.strip("[]"), t_port)
                client_writer.write(f"{proto} 200 Connection Established\r\n\r\n".encode("latin-1"))
                await client_writer.drain()
            else:
                parsed = urlparse(target)
                t_host = parsed.hostname
                t_port = parsed.port or (443 if parsed.scheme == "https" else 80)
                if not t_host:
                    # Fallback to Host header
                    for h_line in lines[1:]:
                        if h_line.lower().startswith("host:"):
                            host_val = h_line.split(":", 1)[1].strip()
                            if ":" in host_val:
                                t_host, t_port_s = host_val.rsplit(":", 1)
                                t_port = int(t_port_s)
                            else:
                                t_host = host_val
                            break
                if not t_host:
                    client_writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
                    await client_writer.drain()
                    return

                remote_reader, remote_writer = await self._open_upstream(t_host, t_port)
                rel_path = parsed.path or "/"
                if parsed.query:
                    rel_path = f"{rel_path}?{parsed.query}"
                rebuilt_headers = [f"{method_upper} {rel_path} {proto}"]
                for h_line in lines[1:]:
                    if not h_line:
                        continue
                    if h_line.lower().startswith("proxy-connection:"):
                        continue
                    rebuilt_headers.append(h_line)
                remote_writer.write(("\r\n".join(rebuilt_headers) + "\r\n\r\n").encode("latin-1"))
                await remote_writer.drain()

            await asyncio.gather(
                _pipe(client_reader, remote_writer),
                _pipe(remote_reader, client_writer),
                return_exceptions=True,
            )
        except Exception:
            try:
                client_writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                await client_writer.drain()
            except Exception:
                pass
        finally:
            try:
                client_writer.close()
            except Exception:
                pass
            if remote_writer is not None:
                try:
                    remote_writer.close()
                except Exception:
                    pass
            if task is not None:
                self._active_tasks.discard(task)

    async def _open_upstream(self, target_host: str, target_port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        if self.upstream["scheme"] in {"http", "https"}:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.upstream["host"], self.upstream["port"]),
                timeout=self.connect_timeout,
            )
            connect_req = f"CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n\r\n"
            writer.write(connect_req.encode("latin-1"))
            await writer.drain()
            resp = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=self.connect_timeout)
            if b" 200 " not in resp.split(b"\r\n", 1)[0]:
                writer.close()
                raise ConnectionError(f"Upstream HTTP CONNECT failed: {resp!r}")
            return reader, writer

        return await open_socks5_tunnel(
            upstream_host=self.upstream["host"],
            upstream_port=self.upstream["port"],
            target_host=target_host,
            target_port=target_port,
            username=self.upstream["username"],
            password=self.upstream["password"],
            connect_timeout=self.connect_timeout,
        )


async def probe_proxy_egress(proxy_url: str, timeout: float = 8.0) -> dict[str, Any]:
    """Quickly verify TCP + SOCKS5 auth + outbound IP reachability via api.ipify.org."""
    t0 = time.perf_counter()
    try:
        info = parse_proxy_url(proxy_url)
        if info["scheme"] in {"http", "https"}:
            return {
                "ok": True,
                "proxyUrl": proxy_url,
                "latencyMs": int((time.perf_counter() - t0) * 1000),
                "egressIp": None,
            }
        reader, writer = await open_socks5_tunnel(
            upstream_host=info["host"],
            upstream_port=info["port"],
            target_host="api.ipify.org",
            target_port=80,
            username=info["username"],
            password=info["password"],
            connect_timeout=timeout,
        )
        try:
            writer.write(b"GET /?format=text HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n")
            await writer.drain()
            chunks: list[bytes] = []
            total = 0
            while total < 4096:
                chunk = await asyncio.wait_for(reader.read(2048), timeout=timeout)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
            raw = b"".join(chunks)
            text = raw.decode("utf-8", errors="ignore")
            body = text.split("\r\n\r\n", 1)[1].strip() if "\r\n\r\n" in text else ""
            egress_ip = body.splitlines()[0].strip() if body else None
        finally:
            writer.close()
        return {
            "ok": bool(egress_ip),
            "proxyUrl": proxy_url,
            "egressIp": egress_ip,
            "latencyMs": int((time.perf_counter() - t0) * 1000),
            "error": None if egress_ip else "Empty ipify response",
        }
    except Exception as exc:
        return {
            "ok": False,
            "proxyUrl": proxy_url,
            "egressIp": None,
            "latencyMs": int((time.perf_counter() - t0) * 1000),
            "error": str(exc),
        }
