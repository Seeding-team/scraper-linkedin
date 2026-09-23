"""Tiny JSON-file store for admin-editable SIM phone number labels.

Env vars (MOBILE_PROXY_<ID>_LABEL) still work as the initial/default label,
but admins can rename a node's phone number straight from the UI without
touching .env or redeploying — this store just overrides the env default.
Persisted under storage/ (mounted as a Docker volume) so it survives
container recreation/redeploys.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.core.config import BASE_DIR

_PATH = BASE_DIR / "storage" / "mobile_proxy_labels.json"
_lock = threading.Lock()


def _read() -> dict[str, str]:
    try:
        raw = _PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except OSError:
        return {}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}


def get_label(node_id: str) -> str | None:
    value = _read().get(node_id)
    value = (value or "").strip()
    return value or None


def get_all_labels() -> dict[str, str]:
    return _read()


def set_label(node_id: str, label: str) -> None:
    label = (label or "").strip()
    with _lock:
        data = _read()
        if label:
            data[node_id] = label
        else:
            data.pop(node_id, None)
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


__all__: list[str] = ["get_label", "get_all_labels", "set_label"]
