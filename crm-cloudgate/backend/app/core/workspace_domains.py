"""Domain CRM chinh thuc theo workspace (instance) - NGUON DUY NHAT cho link trong email (ban giao, re-assign, xac minh, gui lai).

Thu tu uu tien (cao -> thap):
  1) env EMAIL_LINK_WORKSPACE_DOMAINS  (JSON {"markee": "https://...", ...}) - de DEV/UAT/clone rieng ghi de ma khong sua code
  2) env WORKSPACE_DOMAINS             (cung dinh dang clone da dung cho switcher workspace)
  3) OFFICIAL_WORKSPACE_DOMAINS ben duoi
Khong co instance trong ca 3 nguon -> khong tu doan domain khac (nguoi goi tu bao loi cau hinh).
"""
from __future__ import annotations

import json
import os

OFFICIAL_WORKSPACE_DOMAINS: dict[str, str] = {
    "markee": "https://crm.markee.vn",
    "cloudgate": "https://crm.getcloudgate.com",
    "securityzone": "https://crm.securityzone.vn",
    "timetech": "https://crm.timetech.vn",
}


def _parse(value: str | None) -> dict[str, str]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k).strip().lower(): str(v).strip().rstrip("/") for k, v in data.items() if str(k).strip() and str(v).strip()}


def workspace_domain(instance: str | None) -> str | None:
    key = (instance or "").strip().lower()
    if not key:
        return None
    for source in (_parse(os.environ.get("EMAIL_LINK_WORKSPACE_DOMAINS")), _parse(os.environ.get("WORKSPACE_DOMAINS")), OFFICIAL_WORKSPACE_DOMAINS):
        if key in source:
            return source[key]
    return None


def all_workspace_domains() -> dict[str, str]:
    """Toan bo map instance->domain, dung cho switcher workspace (GET /auth/workspaces).
    Merge CA 3 nguon (khong chi lay nguon dau tien khong rong) - nguon uu tien cao hon
    chi GHI DE tung key, khong lam mat cac workspace chi co o nguon uu tien thap hon.
    (2026-10-30, bug that da gap: `settings.workspace_domains` duoc auth.py dung nhung
    chua bao gio duoc dinh nghia trong config.py -> AttributeError -> switcher luon bi an.)
    """
    merged: dict[str, str] = dict(OFFICIAL_WORKSPACE_DOMAINS)
    merged.update(_parse(os.environ.get("WORKSPACE_DOMAINS")))
    merged.update(_parse(os.environ.get("EMAIL_LINK_WORKSPACE_DOMAINS")))
    return merged
