"""Unit tests cho tích hợp Go messenger-bridge (Facebook Messenger cá nhân 24/7)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterator, List, Optional

import pytest
from fastapi.testclient import TestClient

from app.core import supabase_client as sb_client_mod
from app.core.config import settings
from app.main import app
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.facebook.src.modules.messenger.router import index as messenger_router_mod
from app.modules.facebook.src.modules.messenger.services import (
    bridge_client,
    fb_messenger_service as fb_service_mod,
    fb_realtime_listener as fb_listener_mod,
)


class _FakeExecuteResult:
    def __init__(self, data: List[Dict[str, Any]]) -> None:
        self.data = data


class _FakeTableQuery:
    def __init__(self, table_name: str, db: "_FakeSupabase") -> None:
        self._table_name = table_name
        self._db = db
        self._op = "select"
        self._payload: Any = None
        self._on_conflict: Optional[str] = None
        self._filters: List[tuple[str, Any]] = []
        self._order_col: Optional[str] = None
        self._order_desc: bool = False
        self._limit_val: Optional[int] = None

    def select(self, *_cols: str) -> "_FakeTableQuery":
        self._op = "select"
        return self

    def insert(self, payload: Dict[str, Any]) -> "_FakeTableQuery":
        self._op = "insert"
        self._payload = dict(payload)
        return self

    def update(self, payload: Dict[str, Any]) -> "_FakeTableQuery":
        self._op = "update"
        self._payload = dict(payload)
        return self

    def upsert(
        self, payload: Dict[str, Any], on_conflict: Optional[str] = None
    ) -> "_FakeTableQuery":
        self._op = "upsert"
        self._payload = dict(payload)
        self._on_conflict = on_conflict
        return self

    def eq(self, col: str, val: Any) -> "_FakeTableQuery":
        self._filters.append((col, val))
        return self

    def order(self, col: str, desc: bool = False) -> "_FakeTableQuery":
        self._order_col = col
        self._order_desc = desc
        return self

    def limit(self, n: int) -> "_FakeTableQuery":
        self._limit_val = n
        return self

    def _matches(self, row: Dict[str, Any]) -> bool:
        return all(row.get(k) == v for k, v in self._filters)

    def execute(self) -> _FakeExecuteResult:
        rows = self._db.tables.setdefault(self._table_name, [])

        if self._op == "select":
            matched = [dict(r) for r in rows if self._matches(r)]
            if self._order_col:
                matched.sort(
                    key=lambda r: str(r.get(self._order_col) or ""),
                    reverse=self._order_desc,
                )
            if self._limit_val is not None:
                matched = matched[: self._limit_val]
            return _FakeExecuteResult(matched)

        if self._op == "insert":
            row = dict(self._payload)
            if (
                self._table_name == "fb_messenger_messages"
                and row.get("fb_message_id") is not None
            ):
                for existing in rows:
                    if (
                        existing.get("account_id") == row.get("account_id")
                        and existing.get("fb_message_id") == row.get("fb_message_id")
                    ):
                        raise RuntimeError(
                            "duplicate key value violates unique constraint uq_fb_msg_messages_fb_message_id"
                        )
            row.setdefault("id", f"{self._table_name}-{len(rows) + 1}")
            rows.append(row)
            return _FakeExecuteResult([dict(row)])

        if self._op == "update":
            updated: List[Dict[str, Any]] = []
            for r in rows:
                if self._matches(r):
                    r.update(self._payload)
                    updated.append(dict(r))
            return _FakeExecuteResult(updated)

        if self._op == "upsert":
            row = dict(self._payload)
            conflict_cols = [
                c.strip()
                for c in (self._on_conflict or "id").split(",")
                if c.strip()
            ]
            for existing in rows:
                if conflict_cols and all(
                    existing.get(c) == row.get(c) for c in conflict_cols
                ):
                    existing.update(row)
                    return _FakeExecuteResult([dict(existing)])
            row.setdefault("id", f"{self._table_name}-{len(rows) + 1}")
            rows.append(row)
            return _FakeExecuteResult([dict(row)])

        return _FakeExecuteResult([])


class _FakeRpcCall:
    def __init__(self, db: "_FakeSupabase", fn_name: str, params: Dict[str, Any]) -> None:
        self._db = db
        self._fn_name = fn_name
        self._params = params

    def execute(self) -> _FakeExecuteResult:
        if self._fn_name == "increment_fb_messenger_sent_count":
            acc_id = self._params.get("p_account_id")
            for r in self._db.tables.get("fb_messenger_accounts", []):
                if r.get("id") == acc_id:
                    r["daily_sent_count"] = (r.get("daily_sent_count") or 0) + 1
        return _FakeExecuteResult([])


class _FakeSupabase:
    def __init__(self) -> None:
        self.tables: Dict[str, List[Dict[str, Any]]] = {
            "fb_messenger_accounts": [],
            "fb_messenger_threads": [],
            "fb_messenger_messages": [],
        }

    def table(self, name: str) -> _FakeTableQuery:
        return _FakeTableQuery(name, self)

    def rpc(self, fn_name: str, params: Dict[str, Any]) -> _FakeRpcCall:
        return _FakeRpcCall(self, fn_name, params)


@pytest.fixture()
def fake_sb(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    sb = _FakeSupabase()
    monkeypatch.setattr(sb_client_mod, "get_supabase_client", lambda: sb)
    monkeypatch.setattr(messenger_router_mod, "get_supabase_client", lambda: sb)
    monkeypatch.setattr(fb_service_mod, "get_supabase_client", lambda: sb)
    monkeypatch.setattr(fb_listener_mod, "get_supabase_client", lambda: sb)
    return sb


@pytest.fixture()
def client(fake_sb: _FakeSupabase) -> Iterator[TestClient]:
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "user-1",
        "email": "tester@markee.vn",
        "role": "admin",
    }
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_connect_account_calls_bridge_when_enabled(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "bridge-secret-123")

    connect_calls: List[Dict[str, Any]] = []

    def _fake_connect(
        account_id: str,
        fb_user_id: str,
        cookie: str,
        user_agent: Optional[str] = None,
        proxy_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        connect_calls.append(
            {
                "account_id": account_id,
                "fb_user_id": fb_user_id,
                "cookie": cookie,
                "user_agent": user_agent,
                "proxy_url": proxy_url,
            }
        )
        return {"ok": True, "status": "connected"}

    monkeypatch.setattr(bridge_client, "connect", _fake_connect)

    resp = client.post(
        "/api/all-platform/messenger/accounts",
        json={
            "cookie": "c_user=1000555666; xs=secret_xs",
            "name": "Nick Cá Nhân 1",
            "proxy_url": "http://1.2.3.4:8080",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert len(connect_calls) == 1
    assert connect_calls[0]["fb_user_id"] == "1000555666"
    assert connect_calls[0]["cookie"] == "c_user=1000555666; xs=secret_xs"
    assert connect_calls[0]["proxy_url"] == "http://1.2.3.4:8080"
    assert fake_sb.tables["fb_messenger_accounts"][0]["status"] == "connected"


def test_connect_account_does_not_call_bridge_when_disabled(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "")
    monkeypatch.setattr(settings, "messenger_bridge_key", "")

    monkeypatch.setattr(
        fb_service_mod.FbMessengerService,
        "extract_dtsg_tokens",
        classmethod(lambda cls, cookies, ua, proxy_url=None: ("dtsg_token", "2511")),
    )

    called = False

    def _unexpected_connect(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
        nonlocal called
        called = True
        return {"ok": True}

    monkeypatch.setattr(bridge_client, "connect", _unexpected_connect)

    resp = client.post(
        "/api/all-platform/messenger/accounts",
        json={"cookie": "c_user=1000777888; xs=legacy_xs", "name": "Nick Legacy"},
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert called is False
    assert len(fake_sb.tables["fb_messenger_accounts"]) == 1


def test_delete_account_calls_bridge_disconnect(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "bridge-secret-123")

    fake_sb.tables["fb_messenger_accounts"].append(
        {"id": "acc-del-1", "fb_user_id": "10001", "is_active": True}
    )
    disconnected: List[str] = []
    monkeypatch.setattr(
        bridge_client,
        "disconnect",
        lambda account_id: disconnected.append(account_id) or {"ok": True},
    )

    resp = client.delete("/api/all-platform/messenger/accounts/acc-del-1")
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert disconnected == ["acc-del-1"]
    assert fake_sb.tables["fb_messenger_accounts"][0]["is_active"] is False


def test_send_goes_through_bridge_and_stores_fb_message_id(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "bridge-secret-123")

    fake_sb.tables["fb_messenger_accounts"].append(
        {
            "id": "acc-send-1",
            "fb_user_id": "1000111",
            "name": "Sender Nick",
            "status": "connected",
            "is_active": True,
            "warm_up_tier": 1,
            "daily_sent_count": 0,
            "daily_sent_limit": 50,
        }
    )

    send_calls: List[Dict[str, Any]] = []

    def _fake_send(
        account_id: str, recipient_id: str, text: str, client_msg_id: str
    ) -> Dict[str, Any]:
        send_calls.append(
            {
                "account_id": account_id,
                "recipient_id": recipient_id,
                "text": text,
                "client_msg_id": client_msg_id,
            }
        )
        return {"ok": True, "message_id": "mid.$e2ee_998877", "e2ee": True}

    monkeypatch.setattr(bridge_client, "send", _fake_send)

    resp = client.post(
        "/api/all-platform/messenger/send",
        json={
            "account_id": "acc-send-1",
            "recipient_id": "1000222",
            "recipient_name": "Khách Hàng A",
            "content": "Chào bạn, tin nhắn E2EE",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert len(send_calls) == 1
    assert send_calls[0]["account_id"] == "acc-send-1"
    assert send_calls[0]["recipient_id"] == "1000222"
    assert send_calls[0]["text"] == "Chào bạn, tin nhắn E2EE"
    assert len(send_calls[0]["client_msg_id"]) == 19

    msgs = fake_sb.tables["fb_messenger_messages"]
    assert len(msgs) == 1
    assert msgs[0]["fb_message_id"] == "mid.$e2ee_998877"
    assert msgs[0]["offline_threading_id"] == send_calls[0]["client_msg_id"]
    assert msgs[0]["content"] == "Chào bạn, tin nhắn E2EE"
    assert msgs[0]["is_self"] is True


def test_webhook_bridge_auth_rejects_wrong_or_missing_key(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "correct-bridge-key")

    payload = {"type": "status", "account_id": "acc-1", "status": "connected"}

    # Missing X-Bridge-Key header
    resp_missing = client.post(
        "/api/all-platform/messenger/webhook/bridge", json=payload
    )
    assert resp_missing.status_code == 401

    # Wrong X-Bridge-Key header
    resp_wrong = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json=payload,
        headers={"X-Bridge-Key": "wrong-key"},
    )
    assert resp_wrong.status_code == 401

    # Bridge disabled -> 401 even if header matches old value
    monkeypatch.setattr(settings, "messenger_bridge_url", "")
    resp_disabled = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json=payload,
        headers={"X-Bridge-Key": "correct-bridge-key"},
    )
    assert resp_disabled.status_code == 401


def test_webhook_bridge_dedupes_message_id_and_updates_self_echo(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "secret-key")

    fake_sb.tables["fb_messenger_accounts"].append(
        {"id": "acc-1", "fb_user_id": "1000111", "name": "Nick Chính"}
    )

    incoming_payload = {
        "type": "message",
        "account_id": "acc-1",
        "peer_id": "1000222",
        "peer_name": "Khách B",
        "message_id": "mid.$incoming_001",
        "text": "Alo shop ơi",
        "is_self": False,
        "e2ee": True,
        "timestamp_ms": 1794000000000,
        "attachments": [],
    }

    r1 = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json=incoming_payload,
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r1.status_code == 200
    assert r1.json()["success"] is True
    assert len(fake_sb.tables["fb_messenger_messages"]) == 1
    assert fake_sb.tables["fb_messenger_messages"][0]["fb_message_id"] == "mid.$incoming_001"
    assert fake_sb.tables["fb_messenger_messages"][0]["sender_id"] == "1000222"
    assert fake_sb.tables["fb_messenger_messages"][0]["recipient_id"] == "1000111"

    # Duplicate message_id -> no second insert
    r2 = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json=incoming_payload,
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r2.status_code == 200
    assert r2.json()["success"] is True
    assert len(fake_sb.tables["fb_messenger_messages"]) == 1

    # Self echo of a just-sent message with fb_message_id=None -> updates existing row instead of inserting
    fake_sb.tables["fb_messenger_messages"].append(
        {
            "id": "msg-just-sent",
            "account_id": "acc-1",
            "thread_id": "1000222",
            "sender_id": "1000111",
            "recipient_id": "1000222",
            "content": "Tin vừa gửi từ web",
            "is_self": True,
            "fb_message_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    echo_payload = {
        "type": "message",
        "account_id": "acc-1",
        "peer_id": "1000222",
        "peer_name": "Khách B",
        "message_id": "mid.$echo_002",
        "text": "Tin vừa gửi từ web",
        "is_self": True,
        "e2ee": True,
        "timestamp_ms": int(datetime.now(timezone.utc).timestamp() * 1000),
        "attachments": [],
    }
    r3 = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json=echo_payload,
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r3.status_code == 200
    assert r3.json()["success"] is True
    assert len(fake_sb.tables["fb_messenger_messages"]) == 2
    assert fake_sb.tables["fb_messenger_messages"][1]["fb_message_id"] == "mid.$echo_002"


def test_webhook_bridge_status_event_updates_account(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "secret-key")

    fake_sb.tables["fb_messenger_accounts"].append(
        {
            "id": "acc-status-1",
            "fb_user_id": "1000333",
            "status": "connected",
            "checkpoint_reason": None,
        }
    )

    resp = client.post(
        "/facebook/api/v1/messenger/webhook/bridge",
        json={
            "type": "status",
            "account_id": "acc-status-1",
            "status": "checkpoint",
            "error": "Account hit Facebook checkpoint",
        },
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "message": "", "data": None}
    acc = fake_sb.tables["fb_messenger_accounts"][0]
    assert acc["status"] == "checkpoint"
    assert acc["checkpoint_reason"] == "Account hit Facebook checkpoint"


def test_send_race_with_preinserted_echo_row(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "bridge-secret-123")

    fake_sb.tables["fb_messenger_accounts"].append(
        {
            "id": "acc-race-1",
            "fb_user_id": "1000111",
            "name": "Sender Nick",
            "status": "connected",
            "is_active": True,
            "warm_up_tier": 1,
            "daily_sent_count": 0,
            "daily_sent_limit": 50,
        }
    )
    fake_sb.tables["fb_messenger_messages"].append(
        {
            "id": "msg-echo-1",
            "account_id": "acc-race-1",
            "thread_id": "1000222",
            "sender_id": "1000111",
            "recipient_id": "1000222",
            "content": "Tin bị race echo",
            "is_self": True,
            "is_echo": True,
            "status": "sent",
            "offline_threading_id": None,
            "fb_message_id": "mid.X",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    monkeypatch.setattr(
        bridge_client,
        "send",
        lambda **_kwargs: {"ok": True, "message_id": "mid.X", "e2ee": True},
    )

    resp = client.post(
        "/api/all-platform/messenger/send",
        json={
            "account_id": "acc-race-1",
            "recipient_id": "1000222",
            "content": "Tin bị race echo",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    msgs = fake_sb.tables["fb_messenger_messages"]
    assert len(msgs) == 1
    assert msgs[0]["fb_message_id"] == "mid.X"
    assert msgs[0]["is_echo"] is False
    assert msgs[0]["status"] == "sent"
    assert msgs[0]["offline_threading_id"] is not None
    assert fake_sb.tables["fb_messenger_accounts"][0]["daily_sent_count"] == 1


def test_send_race_insert_conflict_fallback(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "bridge-secret-123")

    fake_sb.tables["fb_messenger_accounts"].append(
        {
            "id": "acc-race-fallback-1",
            "fb_user_id": "1000111",
            "name": "Sender Nick",
            "status": "connected",
            "is_active": True,
            "warm_up_tier": 1,
            "daily_sent_count": 0,
            "daily_sent_limit": 50,
        }
    )

    monkeypatch.setattr(
        bridge_client,
        "send",
        lambda **_kwargs: {"ok": True, "message_id": "mid.X", "e2ee": True},
    )

    echo_row = {
        "id": "msg-echo-race",
        "account_id": "acc-race-fallback-1",
        "thread_id": "1000222",
        "sender_id": "1000111",
        "recipient_id": "1000222",
        "content": "Tin bị race echo fallback",
        "is_self": True,
        "is_echo": True,
        "status": "sent",
        "offline_threading_id": None,
        "fb_message_id": "mid.X",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    first_select_seen = False
    orig_execute = _FakeTableQuery.execute

    def _patched_execute(self_query: _FakeTableQuery) -> _FakeExecuteResult:
        nonlocal first_select_seen
        # First select by fb_message_id returns empty
        if (
            self_query._table_name == "fb_messenger_messages"
            and self_query._op == "select"
            and any(k == "fb_message_id" and v == "mid.X" for k, v in self_query._filters)
            and not first_select_seen
        ):
            first_select_seen = True
            return _FakeExecuteResult([])

        # A row with fb_message_id "mid.X" is inserted just before the /send insert
        if (
            self_query._table_name == "fb_messenger_messages"
            and self_query._op == "insert"
            and self_query._payload.get("fb_message_id") == "mid.X"
        ):
            if not any(
                r.get("fb_message_id") == "mid.X"
                for r in fake_sb.tables["fb_messenger_messages"]
            ):
                fake_sb.tables["fb_messenger_messages"].append(dict(echo_row))

        return orig_execute(self_query)

    monkeypatch.setattr(_FakeTableQuery, "execute", _patched_execute)

    resp = client.post(
        "/api/all-platform/messenger/send",
        json={
            "account_id": "acc-race-fallback-1",
            "recipient_id": "1000222",
            "content": "Tin bị race echo fallback",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert first_select_seen is True

    msgs = fake_sb.tables["fb_messenger_messages"]
    assert len(msgs) == 1
    assert msgs[0]["fb_message_id"] == "mid.X"
    assert msgs[0]["is_echo"] is False
    assert msgs[0]["status"] == "sent"
    assert msgs[0]["offline_threading_id"] is not None
    assert fake_sb.tables["fb_messenger_accounts"][0]["daily_sent_count"] == 1


def test_send_bridge_error_returns_false_and_keeps_messages_empty(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "bridge-secret-123")

    fake_sb.tables["fb_messenger_accounts"].append(
        {
            "id": "acc-err-1",
            "fb_user_id": "1000111",
            "name": "Sender Nick",
            "status": "connected",
            "is_active": True,
            "warm_up_tier": 1,
            "daily_sent_count": 0,
            "daily_sent_limit": 50,
        }
    )

    monkeypatch.setattr(
        bridge_client,
        "send",
        lambda **_kwargs: {"ok": False, "error": "x"},
    )

    resp = client.post(
        "/api/all-platform/messenger/send",
        json={
            "account_id": "acc-err-1",
            "recipient_id": "1000222",
            "content": "Tin lỗi",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert fake_sb.tables["fb_messenger_messages"] == []
    assert fake_sb.tables["fb_messenger_accounts"][0]["daily_sent_count"] == 0


def test_webhook_bridge_status_respects_frozen_account_and_filters_invalid(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "secret-key")

    future_iso = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    fake_sb.tables["fb_messenger_accounts"].append(
        {
            "id": "acc-frozen-1",
            "fb_user_id": "1000444",
            "status": "frozen",
            "frozen_until": future_iso,
            "checkpoint_reason": "Rate limit freeze",
        }
    )

    # connected / disconnected must NOT overwrite active frozen status
    for ignored_status in ("connected", "disconnected", "bogus_status"):
        r = client.post(
            "/api/all-platform/messenger/webhook/bridge",
            json={
                "type": "status",
                "account_id": "acc-frozen-1",
                "status": ignored_status,
            },
            headers={"X-Bridge-Key": "secret-key"},
        )
        assert r.status_code == 200
        assert r.json()["success"] is True
        assert fake_sb.tables["fb_messenger_accounts"][0]["status"] == "frozen"

    # checkpoint / expired DO overwrite frozen
    r_cp = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json={
            "type": "status",
            "account_id": "acc-frozen-1",
            "status": "checkpoint",
            "error": "Checkpoint required",
        },
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r_cp.status_code == 200
    assert fake_sb.tables["fb_messenger_accounts"][0]["status"] == "checkpoint"


def test_webhook_bridge_message_validation_and_unknown_account(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "secret-key")

    # Missing peer_id -> 400
    r_no_peer = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json={"type": "message", "account_id": "acc-1", "peer_id": ""},
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r_no_peer.status_code == 400

    # Missing account_id -> 400
    r_no_acc = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json={"type": "message", "account_id": "", "peer_id": "1000222"},
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r_no_acc.status_code == 400

    # Unknown account -> 200 with message="unknown account", no row saved, no SSE published
    published: List[Dict[str, Any]] = []

    async def _spy_publish(ev: Dict[str, Any]) -> None:
        published.append(ev)

    monkeypatch.setattr(fb_listener_mod.messenger_event_bus, "publish", _spy_publish)

    r_unknown = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json={
            "type": "message",
            "account_id": "non-existent-acc",
            "peer_id": "1000222",
            "message_id": "mid.$unknown_1",
            "text": "Hello",
            "is_self": False,
        },
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert r_unknown.status_code == 200
    assert r_unknown.json() == {
        "success": True,
        "message": "unknown account",
        "data": None,
    }
    assert fake_sb.tables["fb_messenger_messages"] == []
    assert published == []


def test_webhook_bridge_message_race_insert_returns_duplicate_fallback(
    client: TestClient,
    fake_sb: _FakeSupabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "messenger_bridge_url", "http://messenger-bridge:8090")
    monkeypatch.setattr(settings, "messenger_bridge_key", "secret-key")

    fake_sb.tables["fb_messenger_accounts"].append(
        {"id": "acc-1", "fb_user_id": "1000111", "name": "Nick Chính"}
    )

    incoming_payload = {
        "type": "message",
        "account_id": "acc-1",
        "peer_id": "1000222",
        "peer_name": "Khách B",
        "message_id": "mid.$race_dup_001",
        "text": "Alo",
        "is_self": False,
        "e2ee": True,
        "timestamp_ms": 1794000000000,
        "attachments": [],
    }

    async def _mock_process_incoming_payload(**kwargs: Any) -> Dict[str, Any]:
        fake_sb.tables["fb_messenger_messages"].append(
            {
                "id": "msg-race-dup",
                "account_id": kwargs["account_id"],
                "thread_id": "1000222",
                "sender_id": kwargs["sender_id"],
                "recipient_id": kwargs["recipient_id"],
                "content": kwargs["content"],
                "is_self": kwargs["is_self"],
                "fb_message_id": kwargs.get("fb_message_id"),
            }
        )
        raise RuntimeError("duplicate key error")

    monkeypatch.setattr(
        fb_listener_mod.FbRealtimeListener,
        "process_incoming_payload",
        _mock_process_incoming_payload,
    )

    resp = client.post(
        "/api/all-platform/messenger/webhook/bridge",
        json=incoming_payload,
        headers={"X-Bridge-Key": "secret-key"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "message": "duplicate", "data": None}

