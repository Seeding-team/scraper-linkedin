"""Request/response schemas cho dong bo Hang hoa MSC → CRM (msc-sync)."""

from __future__ import annotations

from pydantic import BaseModel


class MscSyncRunRequest(BaseModel):
    """Body cua POST /msc-sync/run. dry_run=true → chi tinh toan, khong ghi CRM."""

    dry_run: bool = False
