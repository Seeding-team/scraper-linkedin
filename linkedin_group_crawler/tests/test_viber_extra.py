"""Edge case bổ sung cho module Viber (dùng chung hạ tầng giả ở ``_viber_fakes``)."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.modules.all_platform.viber.services import viber_api, viber_service
from _viber_fakes import ADMIN, MEMBER, OTHER, TOKEN, VIBER_USER, deliver, install, sign


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def db(monkeypatch):
    fake = install(monkeypatch)

    async def no_scope(user):
        return None if user["role"] == "admin" else [user["id"]]

    monkeypatch.setattr(viber_service, "_resolve_member_scope", no_scope)
    return fake


async def _connect(user=MEMBER):
    return await viber_service.connect_bot(user, TOKEN, "CSKH")


# ── Luồng webhook: các loại sự kiện ───────────────────────────────────────────

def test_webhook_verification_callback_is_noop(db):
    acc = run(_connect())
    run(deliver(acc["id"], {"event": "webhook", "timestamp": 1, "message_token": 1}))
    assert not db.messages and not db.dialogs


def test_webhook_unknown_account_404(db):
    import json

    body = json.dumps({"event": "message", "message_token": 1, "sender": {"id": VIBER_USER}, "message": {"type": "text", "text": "x"}}).encode()
    with pytest.raises(HTTPException) as e:
        run(viber_service.handle_webhook("00000000-0000-0000-0000-000000000000", body, sign(body)))
    assert e.value.status_code == 404


def test_conversation_started_creates_dialog_without_message(db):
    acc = run(_connect())
    run(deliver(acc["id"], {
        "event": "conversation_started", "timestamp": 1, "message_token": 1,
        "user": {"id": VIBER_USER, "name": "Khách mới", "country": "VN"}, "subscribed": False,
    }))
    d = db.dialogs[(acc["id"], VIBER_USER)]
    assert d["name"] == "Khách mới" and d["is_subscribed"] is False and d["unread_count"] == 0
    assert not db.messages  # mở hội thoại chưa nhắn gì -> chưa có tin


def test_incoming_media_types(db):
    acc = run(_connect())

    async def scenario():
        await deliver(acc["id"], {
            "event": "message", "timestamp": 1, "message_token": 10,
            "sender": {"id": VIBER_USER, "name": "K"},
            "message": {"type": "video", "media": "https://dl.viber/v.mp4", "size": 123},
        })
        await deliver(acc["id"], {
            "event": "message", "timestamp": 2, "message_token": 11,
            "sender": {"id": VIBER_USER, "name": "K"},
            "message": {"type": "location", "location": {"lat": 10.77, "lon": 106.69}},
        })
        await deliver(acc["id"], {
            "event": "message", "timestamp": 3, "message_token": 12,
            "sender": {"id": VIBER_USER, "name": "K"},
            "message": {"type": "contact", "contact": {"name": "Anh B", "phone_number": "+84900000000"}},
        })
        await deliver(acc["id"], {
            "event": "message", "timestamp": 4, "message_token": 13,
            "sender": {"id": VIBER_USER, "name": "K"},
            "message": {"type": "url", "media": "https://markee.vn/sp", "text": None},
        })

    run(scenario())
    assert db.messages[(acc["id"], "10")]["media_type"] == "video"
    loc = db.messages[(acc["id"], "11")]
    assert loc["media_type"] == "location" and "10.77,106.69" in loc["media_url"]
    con = db.messages[(acc["id"], "12")]
    assert con["media_type"] == "contact" and "Anh B" in con["text"] and "+84900000000" in con["text"]
    assert db.messages[(acc["id"], "13")]["text"] == "https://markee.vn/sp"


def test_failed_status_sets_error(db):
    acc = run(_connect())
    run(deliver(acc["id"], {"event": "message", "timestamp": 1, "message_token": 1, "sender": {"id": VIBER_USER, "name": "K"}, "message": {"type": "text", "text": "hi"}}))
    sent = run(viber_service.send_text(MEMBER, acc["id"], VIBER_USER, "trả lời"))
    token = sent[0]["message_token"]
    run(deliver(acc["id"], {"event": "failed", "timestamp": 2, "message_token": int(token), "user_id": VIBER_USER, "desc": "Not a Viber user"}))
    row = db.messages[(acc["id"], token)]
    assert row["status"] == "failed" and row["error"] == "Not a Viber user"


# ── Gửi tin: biên và lỗi từ Viber ─────────────────────────────────────────────

def test_text_chunk_boundaries(db):
    acc = run(_connect())
    run(deliver(acc["id"], {"event": "message", "timestamp": 1, "message_token": 1, "sender": {"id": VIBER_USER, "name": "K"}, "message": {"type": "text", "text": "hi"}}))
    assert len(run(viber_service.send_text(MEMBER, acc["id"], VIBER_USER, "a" * 7000))) == 1
    db.sent.clear()
    out = run(viber_service.send_text(MEMBER, acc["id"], VIBER_USER, "b" * 7001))
    assert len(out) == 2 and [len(p["text"]) for p in db.sent] == [7000, 1]


def test_empty_text_rejected(db):
    acc = run(_connect())
    run(deliver(acc["id"], {"event": "message", "timestamp": 1, "message_token": 1, "sender": {"id": VIBER_USER, "name": "K"}, "message": {"type": "text", "text": "hi"}}))
    with pytest.raises(HTTPException) as e:
        run(viber_service.send_text(MEMBER, acc["id"], VIBER_USER, "   "))
    assert e.value.status_code == 400


def test_video_within_limit_sent_as_video(db):
    acc = run(_connect())
    run(deliver(acc["id"], {"event": "message", "timestamp": 1, "message_token": 1, "sender": {"id": VIBER_USER, "name": "K"}, "message": {"type": "text", "text": "hi"}}))
    run(viber_service.send_media(MEMBER, acc["id"], VIBER_USER, "clip.mp4", b"x" * 1000, "video/mp4"))
    assert db.sent[0]["type"] == "video" and db.sent[0]["size"] == 1000


def test_viber_rejects_send_maps_to_vietnamese(db, monkeypatch):
    acc = run(_connect())
    run(deliver(acc["id"], {"event": "message", "timestamp": 1, "message_token": 1, "sender": {"id": VIBER_USER, "name": "K"}, "message": {"type": "text", "text": "hi"}}))

    async def reject(auth_token, method, payload):
        if method == "send_message":
            raise viber_api.ViberApiError(6, "notSubscribed")
        return {"status": 0}

    monkeypatch.setattr(viber_api, "_call", reject)
    with pytest.raises(HTTPException) as e:
        run(viber_service.send_text(MEMBER, acc["id"], VIBER_USER, "hi"))
    assert e.value.status_code == 400 and "đăng ký" in e.value.detail


def test_send_to_unknown_dialog_404(db):
    acc = run(_connect())
    with pytest.raises(HTTPException) as e:
        run(viber_service.send_media(MEMBER, acc["id"], "khong-ton-tai", "a.png", b"x", "image/png"))
    assert e.value.status_code == 404


# ── Kết nối lại & RBAC ────────────────────────────────────────────────────────

def test_reconnect_reregisters_webhook(db):
    acc = run(_connect())
    db.webhooks.clear()
    out = run(viber_service.reconnect(MEMBER, acc["id"]))
    assert out["status"] == "connected" and len(db.webhooks) == 1


def test_other_member_cannot_reconnect_or_delete(db):
    acc = run(_connect())
    for call in (viber_service.reconnect(OTHER, acc["id"]), viber_service.disconnect_account(OTHER, acc["id"])):
        with pytest.raises(HTTPException) as e:
            run(call)
        assert e.value.status_code == 403


def test_leader_scope_resolution(monkeypatch):
    """_resolve_member_scope thật (không monkeypatch) cho leader: gộp chính mình + member
    của các team mình làm leader."""
    install(monkeypatch)

    class FakeSB:
        def table(self, name):
            self._t = name
            return self

        def select(self, *a):
            return self

        def eq(self, *a):
            return self

        def in_(self, *a):
            return self

        def execute(self):
            if self._t == "teams":
                return type("R", (), {"data": [{"id": "team-1"}]})()
            return type("R", (), {"data": [{"id_member": "m1"}, {"id_member": "m2"}]})()

    monkeypatch.setattr(viber_service, "get_supabase_client", lambda: FakeSB())
    scope = run(viber_service._resolve_member_scope({"id": "leader-1", "role": "leader"}))
    assert set(scope) == {"leader-1", "m1", "m2"}
    assert run(viber_service._resolve_member_scope({"id": "a", "role": "admin"})) is None
    assert run(viber_service._resolve_member_scope({"id": "m", "role": "member"})) == ["m"]


def test_pagination_before(db):
    acc = run(_connect())

    async def scenario():
        for i in range(5):
            await deliver(acc["id"], {
                "event": "message", "timestamp": 1700000000000 + i * 1000, "message_token": 100 + i,
                "sender": {"id": VIBER_USER, "name": "K"}, "message": {"type": "text", "text": f"m{i}"},
            })

    run(scenario())
    page1 = run(viber_service.get_messages(MEMBER, acc["id"], VIBER_USER, limit=2))
    assert [m["text"] for m in page1] == ["m3", "m4"]
    older = run(viber_service.get_messages(MEMBER, acc["id"], VIBER_USER, limit=2, before=page1[0]["sent_at"]))
    assert [m["text"] for m in older] == ["m1", "m2"]
