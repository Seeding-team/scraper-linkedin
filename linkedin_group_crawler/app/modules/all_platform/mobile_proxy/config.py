"""Build public proxy URLs from env — one or many SIM/phone nodes.

Single phone (today): plain MOBILE_PROXY_* vars, id defaults to "sim-01".
Multiple phones (later): set MOBILE_PROXY_NODES="sim-01,sim-02" and use
per-node vars MOBILE_PROXY_<ID>_* (id upper-cased, "-" -> "_"), e.g.
MOBILE_PROXY_SIM_02_CONSOLE_URL, MOBILE_PROXY_SIM_02_SOCKS_URL_VPS, ...
Any per-node var that is unset falls back to the plain (unprefixed) var,
so shared settings (port, user/pass) don't need to be repeated per node.
"""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote


def _env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _node_ids() -> list[str]:
    raw = _env("MOBILE_PROXY_NODES")
    if not raw:
        return ["sim-01"]
    ids = [part.strip() for part in raw.split(",") if part.strip()]
    return ids or ["sim-01"]


def _prefix_for(node_id: str) -> str:
    return "MOBILE_PROXY_" + node_id.upper().replace("-", "_") + "_"


def _node_env(node_id: str, suffix: str, single_node: bool) -> str | None:
    """Per-node var if set, else the plain shared var (single-node friendly)."""
    if not single_node:
        scoped = _env(_prefix_for(node_id) + suffix)
        if scoped:
            return scoped
    return _env("MOBILE_PROXY_" + suffix)


def _socks_url(host: str, port: str, user: str | None, password: str | None) -> str:
    auth = ""
    if user:
        u = quote(user, safe="")
        p = quote(password or "", safe="")
        auth = f"{u}:{p}@"
    return f"socks5://{auth}{host}:{port}"


def _build_one_node(node_id: str, single_node: bool) -> dict[str, Any]:
    label = _node_env(node_id, "LABEL", single_node) or node_id.upper()
    port = _node_env(node_id, "SOCKS_PORT", single_node) or "1081"
    user = _node_env(node_id, "SOCKS_USER", single_node)
    password = _node_env(node_id, "SOCKS_PASS", single_node)

    office_url = _node_env(node_id, "SOCKS_URL_OFFICE", single_node)
    vps_url = _node_env(node_id, "SOCKS_URL_VPS", single_node)
    local_pc_url = _node_env(node_id, "SOCKS_URL_LOCAL_PC", single_node)
    console_url = _node_env(node_id, "CONSOLE_URL", single_node)
    console_api_key = _node_env(node_id, "CONSOLE_API_KEY", single_node)

    lan_host = _node_env(node_id, "SOCKS_HOST", single_node)
    if not office_url and lan_host:
        office_url = _socks_url(lan_host, port, user, password)
    if not local_pc_url:
        local_pc_url = _socks_url("127.0.0.1", port, user, password)

    return {
        "id": node_id,
        "label": label,
        "socksUrlOffice": office_url,
        "socksUrlVps": vps_url,
        "socksUrlLocalPc": local_pc_url,
        "consoleUrl": console_url,
        "_consoleApiKey": console_api_key,  # stripped before returning to client
        "port": int(port) if port.isdigit() else port,
    }


def build_node_config() -> dict[str, Any]:
    ids = _node_ids()
    single_node = len(ids) == 1
    nodes = [_build_one_node(node_id, single_node) for node_id in ids]
    console_on = any(bool(n["consoleUrl"]) for n in nodes)
    public_nodes = [{k: v for k, v in n.items() if not k.startswith("_")} for n in nodes]
    return {
        "enabled": any(
            bool(n["socksUrlOffice"] or n["socksUrlVps"] or n["socksUrlLocalPc"] or n["consoleUrl"])
            for n in nodes
        ),
        "consoleConfigured": console_on,
        "nodes": public_nodes,
    }


def node_console_targets() -> list[dict[str, Any]]:
    """Internal helper for the router: (id, label, consoleUrl, apiKey) per node with a console configured."""
    ids = _node_ids()
    single_node = len(ids) == 1
    out = []
    for node_id in ids:
        node = _build_one_node(node_id, single_node)
        if node["consoleUrl"]:
            out.append(
                {
                    "id": node["id"],
                    "label": node["label"],
                    "consoleUrl": node["consoleUrl"],
                    "apiKey": node["_consoleApiKey"],
                }
            )
    return out
