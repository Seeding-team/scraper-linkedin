"""Hạ tầng giả lập dùng chung cho test Viber (KHÔNG phải file test — không có tiền tố
``test_`` nên pytest không thu thập). Thay ``viber_repo`` (DB Supabase) và ``viber_api``
(REST Viber) bằng bản in-memory để test không chạm mạng/DB thật."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import uuid
from typing import Any, Dict, List, Optional

from app.modules.all_platform.viber import config as viber_config
from app.modules.all_platform.viber.services import viber_api, viber_repo, viber_service

TOKEN = "4453b6ac12345678-e02c5f12174805f9-daec9cbb5448c51f"
ADMIN = {"id": "u-admin", "role": "admin", "full_name": "Admin"}
MEMBER = {"id": "u-member", "role": "member", "full_name": "Sale A"}
OTHER = {"id": "u-other", "role": "member", "full_name": "Sale B"}
VIBER_USER = "01234567890A/+b=="  # id Viber thật dạng base64, có '/', '+', '='

DEFAULT_INFO = {
    "status": 0, "id": "pa:123", "name": "Markee CSKH", "uri": "markeecskh",
    "icon": "https://x/icon.jpg", "subscribers_count": 5,
}


class FakeDB:
    def __init__(self):
        self.accounts: Dict[str, Dict[str, Any]] = {}
        self.dialogs: Dict[tuple, Dict[str, Any]] = {}
        self.messages: Dict[tuple, Dict[str, Any]] = {}
        self.uploads: Dict[str, bytes] = {}
        self.sent: List[Dict[str, Any]] = []
        self.webhooks: List[str] = []
        self.downloads: List[str] = []


def install(monkeypatch, *, account_info: Optional[Dict[str, Any]] = None, webhook_base="https://seeding.example.com/") -> FakeDB:
    fake = FakeDB()
    info = dict(account_info or DEFAULT_INFO)

    async def create_account(id_member, auth_token, label=None):
        row = {"id": str(uuid.uuid4()), "id_member": id_member, "auth_token": auth_token, "label": label, "status": "pending"}
        fake.accounts[row["id"]] = row
        return dict(row)

    async def update_account(account_id, **fields):
        fake.accounts[account_id].update(fields)
        return dict(fake.accounts[account_id])

    async def get_account(account_id):
        row = fake.accounts.get(account_id)
        return dict(row) if row else None

    async def find_account_by_bot(bot_id):
        return next((dict(a) for a in fake.accounts.values() if a.get("bot_id") == bot_id), None)

    async def delete_account(account_id):
        fake.accounts.pop(account_id, None)
        for key in [k for k in fake.dialogs if k[0] == account_id]:
            fake.dialogs.pop(key, None)
        for key in [k for k in fake.messages if k[0] == account_id]:
            fake.messages.pop(key, None)

    async def list_accounts(member_ids=None):
        return [dict(a) for a in fake.accounts.values() if member_ids is None or a["id_member"] in member_ids]

    async def touch_dialog(account_id, viber_user_id, *, increment_unread=False, **fields):
        key = (account_id, viber_user_id)
        row = fake.dialogs.setdefault(key, {"account_id": account_id, "viber_user_id": viber_user_id, "unread_count": 0, "is_subscribed": True})
        row.update({k: v for k, v in fields.items() if v is not None})
        if increment_unread:
            row["unread_count"] += 1

    async def get_dialog(account_id, viber_user_id):
        return fake.dialogs.get((account_id, viber_user_id))

    async def list_dialogs(account_id):
        return [d for (aid, _), d in fake.dialogs.items() if aid == account_id]

    async def clear_unread(account_id, viber_user_id):
        if (account_id, viber_user_id) in fake.dialogs:
            fake.dialogs[(account_id, viber_user_id)]["unread_count"] = 0

    async def upsert_message(row):
        fake.messages[(row["account_id"], row["message_token"])] = dict(row)
        return dict(row)

    async def message_exists(account_id, token):
        return (account_id, token) in fake.messages

    async def list_messages(account_id, viber_user_id, *, limit=50, before=None):
        rows = [m for m in fake.messages.values() if m["account_id"] == account_id and m["viber_user_id"] == viber_user_id]
        rows = sorted(rows, key=lambda m: m["sent_at"])
        if before:
            rows = [m for m in rows if m["sent_at"] < before]
        return rows[-limit:]

    async def update_message_status(account_id, token, status, error=None):
        lower = {"delivered": ["sent"], "seen": ["sent", "delivered"], "failed": ["sent", "delivered", "seen"]}
        row = fake.messages.get((account_id, token))
        if not row or status not in lower or row["status"] not in lower[status]:
            return None
        row["status"] = status
        if error:
            row["error"] = error
        return dict(row)

    async def upload_media(path, data, content_type):
        fake.uploads[path] = data
        return f"https://storage.example/viber-media/{path}"

    for name, fn in list(locals().items()):
        if asyncio.iscoroutinefunction(fn) and hasattr(viber_repo, name):
            monkeypatch.setattr(viber_repo, name, fn)

    async def fake_call(auth_token, method, payload):
        if auth_token != TOKEN:
            raise viber_api.ViberApiError(2, "invalidAuthToken")
        if method == "get_account_info":
            return info
        if method == "set_webhook":
            fake.webhooks.append(payload["url"])
            return {"status": 0}
        if method == "send_message":
            fake.sent.append(payload)
            return {"status": 0, "message_token": 5000000000000000000 + len(fake.sent)}
        raise AssertionError(method)

    async def fake_download(url):
        fake.downloads.append(url)
        return b"\x89PNG-bytes", "image/png"

    monkeypatch.setattr(viber_api, "_call", fake_call)
    monkeypatch.setattr(viber_api, "download", fake_download)
    monkeypatch.setattr(viber_config.settings, "viber_webhook_base_url", webhook_base)
    return fake


def sign(body: bytes) -> str:
    return hmac.new(TOKEN.encode(), body, hashlib.sha256).hexdigest()


async def deliver(account_id: str, event: Dict[str, Any]) -> None:
    raw = json.dumps(event).encode()
    await viber_service.handle_webhook(account_id, raw, sign(raw))
    if viber_service._background_tasks:
        await asyncio.gather(*list(viber_service._background_tasks))
