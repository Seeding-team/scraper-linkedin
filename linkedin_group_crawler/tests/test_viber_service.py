"""Test module Viber Chat: webhook (chữ ký, lưu tin đến, chống trùng khi Viber retry,
trạng thái đã nhận/đã xem), gửi text/ảnh/tệp, kết nối bot, RBAC. DB (viber_repo) và Viber
API được thay bằng bản giả trong bộ nhớ — không gọi mạng/Supabase thật."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
import uuid
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.modules.all_platform.viber import config as viber_config
from app.modules.all_platform.viber.services import viber_api, viber_repo, viber_service

TOKEN = "4453b6ac12345678-e02c5f12174805f9-daec9cbb5448c51f"
ADMIN = {"id": "u-admin", "role": "admin", "full_name": "Admin"}
MEMBER = {"id": "u-member", "role": "member", "full_name": "Sale A"}
OTHER = {"id": "u-other", "role": "member", "full_name": "Sale B"}
VIBER_USER = "01234567890A/+b=="  # có '/', '+', '=' như id thật của Viber


class FakeDB:
    def __init__(self):
        self.accounts: Dict[str, Dict[str, Any]] = {}
        self.dialogs: Dict[tuple, Dict[str, Any]] = {}
        self.messages: Dict[tuple, Dict[str, Any]] = {}
        self.uploads: Dict[str, bytes] = {}
        self.sent: List[Dict[str, Any]] = []
        self.webhooks: List[str] = []


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()

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
        return sorted(rows, key=lambda m: m["sent_at"])[-limit:]

    async def upload_media(path, data, content_type):
        fake.uploads[path] = data
        return f"https://storage.example/viber-media/{path}"

    async def update_message_status(account_id, token, status, error=None):
        rank = {"sent": 0, "delivered": 1, "seen": 2, "failed": 3}
        row = fake.messages.get((account_id, token))
        if not row or rank.get(row["status"], 0) >= rank.get(status, 0):
            return None
        row["status"] = status
        return dict(row)

    for name, fn in list(locals().items()):
        if callable(fn) and hasattr(viber_repo, name):
            monkeypatch.setattr(viber_repo, name, fn)

    async def fake_call(auth_token, method, payload):
        if auth_token != TOKEN:
            raise viber_api.ViberApiError(2, "invalidAuthToken")
        if method == "get_account_info":
            return {"status": 0, "id": "pa:123", "name": "Markee CSKH", "uri": "markeecskh", "icon": "https://x/icon.jpg", "subscribers_count": 5}
        if method == "set_webhook":
            fake.webhooks.append(payload["url"])
            return {"status": 0}
        if method == "send_message":
            fake.sent.append(payload)
            return {"status": 0, "message_token": 5000000000000000000 + len(fake.sent)}
        raise AssertionError(method)

    async def fake_download(url):
        return b"\x89PNG-bytes", "image/png"

    monkeypatch.setattr(viber_api, "_call", fake_call)
    monkeypatch.setattr(viber_api, "download", fake_download)
    monkeypatch.setattr(viber_config.settings, "viber_webhook_base_url", "https://seeding.example.com/")

    async def no_scope(user):
        return None if user["role"] == "admin" else [user["id"]]

    monkeypatch.setattr(viber_service, "_resolve_member_scope", no_scope)
    return fake


def run(coro):
    return asyncio.run(coro)


async def _connect(user=MEMBER):
    return await viber_service.connect_bot(user, TOKEN, "CSKH")


def _sign(body: bytes) -> str:
    return hmac.new(TOKEN.encode(), body, hashlib.sha256).hexdigest()


async def _deliver(account_id: str, event: Dict[str, Any]) -> None:
    raw = json.dumps(event).encode()
    await viber_service.handle_webhook(account_id, raw, _sign(raw))
    await asyncio.gather(*list(viber_service._background_tasks))


def test_connect_registers_webhook_and_hides_token(db):
    acc = run(_connect())
    assert acc["status"] == "connected"
    assert "auth_token" not in acc
    assert acc["display_name"] == "Markee CSKH" and acc["bot_id"] == "pa:123"
    assert db.webhooks == [f"https://seeding.example.com/api/all-platform/viber/webhook/{acc['id']}"]
    # Kết nối lại cùng bot -> không tạo bản ghi trùng
    again = run(_connect())
    assert again["id"] == acc["id"] and len(db.accounts) == 1


def test_connect_rejects_bad_token_and_missing_https(db, monkeypatch):
    with pytest.raises(HTTPException) as e:
        run(viber_service.connect_bot(MEMBER, "bad", None))
    assert e.value.status_code == 400 and not db.accounts

    monkeypatch.setattr(viber_config.settings, "viber_webhook_base_url", "http://localhost:8000")
    with pytest.raises(HTTPException) as e:
        run(_connect())
    assert "VIBER_WEBHOOK_BASE_URL" in e.value.detail
    assert next(iter(db.accounts.values()))["status"] == "error"


def test_webhook_signature_and_incoming_messages(db):
    acc = run(_connect())
    raw = json.dumps({"event": "message"}).encode()
    with pytest.raises(HTTPException) as e:
        run(viber_service.handle_webhook(acc["id"], raw, "deadbeef"))
    assert e.value.status_code == 401

    async def scenario():
        text_event = {
            "event": "message", "timestamp": 1760000000000, "message_token": 4912661846655238145,
            "sender": {"id": VIBER_USER, "name": "Khách A", "avatar": "https://a/av.jpg", "country": "VN"},
            "message": {"type": "text", "text": "Xin chào, xem https://markee.vn giúp"},
        }
        await _deliver(acc["id"], text_event)
        await _deliver(acc["id"], text_event)  # Viber retry -> không nhân đôi
        await _deliver(acc["id"], {
            "event": "message", "timestamp": 1760000001000, "message_token": 4912661846655238146,
            "sender": {"id": VIBER_USER, "name": "Khách A"},
            "message": {"type": "picture", "media": "https://dl-media.viber.com/x.jpg", "text": ""},
        })
        await _deliver(acc["id"], {"event": "unsubscribed", "timestamp": 1, "user_id": VIBER_USER, "message_token": 1})

    run(scenario())
    msgs = [m for m in db.messages.values()]
    assert len(msgs) == 2
    text_msg = db.messages[(acc["id"], "4912661846655238145")]
    assert text_msg["is_outgoing"] is False and text_msg["status"] == "received" and "markee.vn" in text_msg["text"]
    pic = db.messages[(acc["id"], "4912661846655238146")]
    assert pic["media_type"] == "picture" and pic["media_url"].startswith("https://storage.example/")
    assert "/" not in pic["media_url"].split("/viber-media/")[1].split("/")[1]  # thư mục user đã băm
    dialog = db.dialogs[(acc["id"], VIBER_USER)]
    assert dialog["unread_count"] == 2 and dialog["name"] == "Khách A" and dialog["is_subscribed"] is False
    assert dialog["last_message_preview"] == "[Hình ảnh]"

    rows = run(viber_service.get_messages(MEMBER, acc["id"], VIBER_USER))
    assert len(rows) == 2 and db.dialogs[(acc["id"], VIBER_USER)]["unread_count"] == 0


def test_send_text_media_and_status(db):
    acc = run(_connect())
    run(_deliver(acc["id"], {
        "event": "message", "timestamp": 1760000000000, "message_token": 1,
        "sender": {"id": VIBER_USER, "name": "Khách A"}, "message": {"type": "text", "text": "hi"},
    }))

    sent = run(viber_service.send_text(MEMBER, acc["id"], VIBER_USER, "x" * 7005))
    assert len(sent) == 2 and [len(p["text"]) for p in db.sent] == [7000, 5]
    assert db.sent[0]["receiver"] == VIBER_USER and db.sent[0]["sender"]["name"] == "Markee CSKH"
    assert sent[0]["is_outgoing"] and sent[0]["sender_name"] == "Sale A" and sent[0]["status"] == "sent"

    db.sent.clear()
    small = run(viber_service.send_media(MEMBER, acc["id"], VIBER_USER, "a.png", b"x" * 100, "image/png", caption="Bảng giá"))
    assert db.sent[0]["type"] == "picture" and db.sent[0]["text"] == "Bảng giá" and db.sent[0]["media"].endswith(".png")
    assert len(small) == 1 and small[0]["text"] == "Bảng giá"

    db.sent.clear()
    big = run(viber_service.send_media(MEMBER, acc["id"], VIBER_USER, "big.jpg", b"x" * (2 * 1024 * 1024), "image/jpeg", caption="c" * 200))
    assert db.sent[0]["type"] == "file" and db.sent[0]["file_name"] == "big.jpg" and db.sent[0]["size"] == 2 * 1024 * 1024
    assert db.sent[1]["type"] == "text" and len(big) == 2

    with pytest.raises(HTTPException):
        run(viber_service.send_media(MEMBER, acc["id"], VIBER_USER, "huge.zip", b"x" * (50 * 1024 * 1024 + 1), "application/zip"))

    token = sent[0]["message_token"]

    async def statuses():
        await _deliver(acc["id"], {"event": "seen", "timestamp": 1, "message_token": int(token), "user_id": VIBER_USER})
        await _deliver(acc["id"], {"event": "delivered", "timestamp": 1, "message_token": int(token), "user_id": VIBER_USER})

    run(statuses())
    assert db.messages[(acc["id"], token)]["status"] == "seen"  # delivered tới trễ không hạ cấp


def test_rbac_and_unknown_dialog(db):
    acc = run(_connect())
    with pytest.raises(HTTPException) as e:
        run(viber_service.list_dialogs(OTHER, acc["id"]))
    assert e.value.status_code == 403
    assert run(viber_service.list_dialogs(ADMIN, acc["id"])) == []
    assert [a["id"] for a in run(viber_service.list_accounts_for_caller(OTHER))] == []
    with pytest.raises(HTTPException) as e:
        run(viber_service.send_text(MEMBER, acc["id"], "nobody", "hi"))
    assert e.value.status_code == 404


def test_http_routes(db):
    from app.modules.all_platform.auth_deps import get_current_user
    from app.modules.all_platform.viber.api.routes.viber import router

    app = FastAPI()
    app.include_router(router, prefix="/api/all-platform/viber")
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    client = TestClient(app)

    r = client.post("/api/all-platform/viber/accounts/connect", json={"auth_token": TOKEN})
    assert r.status_code == 200 and r.json()["data"]["status"] == "connected"
    account_id = r.json()["data"]["id"]

    body = json.dumps({
        "event": "message", "timestamp": 1760000000000, "message_token": 77,
        "sender": {"id": VIBER_USER, "name": "Khách A"}, "message": {"type": "text", "text": "hello"},
    }).encode()
    bad = client.post(f"/api/all-platform/viber/webhook/{account_id}", content=body, headers={"X-Viber-Content-Signature": "x"})
    assert bad.status_code == 401
    ok = client.post(f"/api/all-platform/viber/webhook/{account_id}", content=body, headers={"X-Viber-Content-Signature": _sign(body)})
    assert ok.status_code == 200
    for _ in range(100):  # webhook xử lý nền -> chờ tin được ghi
        if (account_id, "77") in db.messages:
            break
        time.sleep(0.02)

    r = client.get(f"/api/all-platform/viber/accounts/{account_id}/messages", params={"viber_user_id": VIBER_USER})
    assert r.status_code == 200 and [m["text"] for m in r.json()["data"]] == ["hello"]

    r = client.post("/api/all-platform/viber/messages/send", json={"account_id": account_id, "viber_user_id": VIBER_USER, "text": "chào bạn"})
    assert r.status_code == 200 and r.json()["data"][0]["text"] == "chào bạn"

    r = client.post(
        "/api/all-platform/viber/messages/send-media",
        data={"account_id": account_id, "viber_user_id": VIBER_USER},
        files={"file": ("bao-gia.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert r.status_code == 200 and r.json()["data"][0]["media_type"] == "file"

    assert client.get("/api/all-platform/viber/accounts").json()["data"][0]["id"] == account_id
    assert client.delete(f"/api/all-platform/viber/accounts/{account_id}").status_code == 200
    assert not db.accounts
