"""Build public proxy URLs from env (home / office / VPS)."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote


def _env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _socks_url(host: str, port: str, user: str | None, password: str | None) -> str:
    auth = ""
    if user:
        u = quote(user, safe="")
        p = quote(password or "", safe="")
        auth = f"{u}:{p}@"
    return f"socks5://{auth}{host}:{port}"


def build_node_config() -> dict[str, Any]:
    label = _env("MOBILE_PROXY_LABEL") or "SIM-01"
    port = _env("MOBILE_PROXY_SOCKS_PORT") or "1081"
    user = _env("MOBILE_PROXY_SOCKS_USER")
    password = _env("MOBILE_PROXY_SOCKS_PASS")

    office_url = _env("MOBILE_PROXY_SOCKS_URL_OFFICE")
    vps_url = _env("MOBILE_PROXY_SOCKS_URL_VPS")
    local_pc_url = _env("MOBILE_PROXY_SOCKS_URL_LOCAL_PC")

    lan_host = _env("MOBILE_PROXY_SOCKS_HOST")
    if not office_url and lan_host:
        office_url = _socks_url(lan_host, port, user, password)
    if not local_pc_url:
        local_pc_url = _socks_url("127.0.0.1", port, user, password)

    console_url = _env("MOBILE_PROXY_CONSOLE_URL")
    console_on = bool(console_url)

    return {
        "enabled": bool(office_url or vps_url or local_pc_url or console_on),
        "consoleConfigured": console_on,
        "nodes": [
            {
                "id": label.lower().replace(" ", "-"),
                "label": label,
                "socksUrlOffice": office_url,
                "socksUrlVps": vps_url,
                "socksUrlLocalPc": local_pc_url,
                "consoleUrl": console_url,
                "port": int(port) if port.isdigit() else port,
            }
        ],
    }
