"""API quản trị Bot Zalo ở tầng HTTP: phân quyền, mã lỗi, hình dạng JSON (khớp hợp đồng giao diện)."""
from unittest import mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.routes import zalo_bot_admin as admin
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.services import zalo_bot_service as svc

from test_zalo_bot_service import FakeDB  # DB giả dùng chung (pytest đặt thư mục tests vào sys.path)


@pytest.fixture()
def env():
    db = FakeDB()
    db.tables["zalo_groups"] += [
        {"user_id": "acc1", "group_id": "u100", "group_name": "Khách A", "thread_type": "user", "is_friend": False},
        {"user_id": "acc1", "group_id": "g200", "group_name": "Nhóm B", "thread_type": "group", "is_friend": False},
    ]
    state = {"email": "nv@x.com", "manage_ok": True, "allowed": None}

    async def account(_id):
        return {"account_id": _id, "id_member": "m1", "owner_id": "o1"} if _id == "acc1" else None

    async def require_admin(caller_email, target):
        if not caller_email:
            raise HTTPException(status_code=401, detail="Cần đăng nhập")
        if not state["manage_ok"]:
            raise HTTPException(status_code=403, detail="Bạn không có quyền thao tác trên tài khoản Zalo này")

    async def conv_access(account_id, caller_email):
        return state["allowed"]

    app = FastAPI()
    app.include_router(admin.router, prefix="/api/all-platform/zalo")
    app.dependency_overrides[verify_zalo_api_key] = lambda: None
    app.dependency_overrides[get_authenticated_caller_email] = lambda: state["email"]

    with mock.patch.object(svc, "_rest", db.rest), \
         mock.patch.object(admin, "get_zalo_account_by_id", account), \
         mock.patch.object(admin, "_require_admin_leader_or_self", require_admin), \
         mock.patch.object(admin, "check_caller_conversation_access", conv_access), \
         mock.patch.object(svc, "load_zca_auth", mock.AsyncMock(return_value={"k": 1})), \
         mock.patch.object(svc, "chatwoot_ready", return_value=False):
        yield TestClient(app), db, state


P = "/api/all-platform/zalo/zalo-bot"


def test_config_defaults_then_save_and_readiness_shape(env):
    client, db, _ = env
    r = client.get(f"{P}/config/acc1")
    assert r.status_code == 200
    body = r.json()
    assert body["exists"] is False and body["is_enabled"] is False and body["dry_run"] is True
    assert set(body["readiness"]) == {
        "zca_logged_in", "n8n_incoming_configured", "shared_secret_configured",
        "chatwoot_sync_configured", "bridge_enabled", "config_complete",
    }
    assert body["readiness"]["zca_logged_in"] is True and body["readiness"]["config_complete"] is False

    # bật thiếu Chatwoot ID -> 400 kèm detail tiếng Việt
    bad = client.put(f"{P}/config/acc1", json={"is_enabled": True})
    assert bad.status_code == 400 and "Chatwoot" in bad.json()["detail"]
    # ID sai kiểu -> 422 (validate của pydantic)
    assert client.put(f"{P}/config/acc1", json={"chatwoot_inbox_id": 0}).status_code == 422
    assert client.put(f"{P}/config/acc1", json={"pause_minutes": 5000}).status_code == 422

    ok = client.put(f"{P}/config/acc1", json={"chatwoot_account_id": 3, "chatwoot_inbox_id": 162, "is_enabled": True})
    assert ok.status_code == 200
    saved = ok.json()
    assert saved["exists"] and saved["is_enabled"] and saved["dry_run"] is True
    assert saved["chatwoot_account_id"] == 3 and saved["chatwoot_inbox_id"] == 162
    assert saved["readiness"]["config_complete"] is True
    assert db.tables["zalo_bot_configs"][0]["updated_by"] == "nv@x.com"


def test_config_permissions_and_unknown_account(env):
    client, _, state = env
    assert client.get(f"{P}/config/khong_ton_tai").status_code == 404
    state["manage_ok"] = False
    r = client.put(f"{P}/config/acc1", json={"dry_run": False})
    assert r.status_code == 403 and "admin, leader hoặc chủ tài khoản" in r.json()["detail"]
    # các thao tác quản lý cả tài khoản: chỉ admin/leader/chủ tài khoản
    assert client.get(f"{P}/stats", params={"account_id": "acc1"}).status_code == 403
    assert client.get(f"{P}/scope/acc1").status_code == 403
    assert client.get(f"{P}/scope/acc1/candidates").status_code == 403
    assert client.post(f"{P}/scope/acc1/rules", json={"thread_ids": ["u100"], "bot_on": True}).status_code == 403
    assert client.post(f"{P}/scope/acc1/clear").status_code == 403
    # theo hội thoại: người được xem hội thoại thì xem cấu hình + nhật ký được
    assert client.get(f"{P}/logs", params={"account_id": "acc1"}).status_code == 200
    cfg = client.get(f"{P}/config/acc1")
    assert cfg.status_code == 200 and cfg.json()["can_manage"] is False
    state["manage_ok"] = True
    assert client.get(f"{P}/config/acc1").json()["can_manage"] is True
    state["email"] = None
    assert client.get(f"{P}/config/acc1").status_code == 401
    assert client.get(f"{P}/logs", params={"account_id": "acc1"}).status_code == 401


def test_logs_follow_conversation_access_not_manage_role(env):
    client, db, state = env
    for i, thread in enumerate(["u100", "u999", "u100", "u777"], start=1):
        db.tables["zalo_bot_logs"].append({
            "id": i, "account_id": "acc1", "thread_id": thread, "direction": "in", "source_msg_id": None,
            "content": f"tin {i}", "status": "forwarded", "error": None, "sent_by": None,
            "created_at": f"2026-11-04T03:0{i}:00Z",
        })
    orig = db.rest

    async def ordered(method, path, *, params=None, json=None, prefer=None):
        no_limit = {k: v for k, v in (params or {}).items() if k != "limit"} if method == "GET" else params
        rows = await orig(method, path, params=no_limit, json=json, prefer=prefer)
        if method == "GET" and path == "zalo_bot_logs" and rows:
            rows = sorted(rows, key=lambda r: -r["id"])
            if params and params.get("id", "").startswith("lt."):
                rows = [r for r in rows if r["id"] < int(params["id"][3:])]
            rows = rows[: int((params or {}).get("limit", 1000))]
        return rows

    state["manage_ok"] = False  # member thường
    with mock.patch.object(svc, "_rest", ordered):
        # được xem toàn bộ hội thoại (vd. tài khoản dùng chung) -> thấy hết nhật ký
        state["allowed"] = None
        all_ids = [i["id"] for i in client.get(f"{P}/logs", params={"account_id": "acc1"}).json()["items"]]
        assert all_ids == [4, 3, 2, 1]
        # chỉ được chia sẻ u100 -> chỉ thấy dòng của u100, không lộ hội thoại riêng tư khác
        state["allowed"] = {"u100"}
        page = client.get(f"{P}/logs", params={"account_id": "acc1"}).json()
        assert [i["id"] for i in page["items"]] == [3, 1] and page["has_more"] is False
        # phân trang vẫn đúng khi bị lọc
        p1 = client.get(f"{P}/logs", params={"account_id": "acc1", "limit": 1}).json()
        assert [i["id"] for i in p1["items"]] == [3] and p1["has_more"] is True and p1["next_before_id"] == 3
        p2 = client.get(f"{P}/logs", params={"account_id": "acc1", "limit": 1, "before_id": 3}).json()
        assert [i["id"] for i in p2["items"]] == [1] and p2["has_more"] is False
        # chỉ định thẳng hội thoại riêng tư chưa được chia sẻ -> 403
        assert client.get(f"{P}/logs", params={"account_id": "acc1", "thread_id": "u999"}).status_code == 403
        # không được chia sẻ hội thoại nào -> rỗng
        state["allowed"] = set()
        assert client.get(f"{P}/logs", params={"account_id": "acc1"}).json()["items"] == []


def test_configs_brief_for_account_tree(env):
    client, db, _ = env
    db.tables["zalo_bot_configs"] += [
        {"account_id": "acc1", "is_enabled": True, "dry_run": False},
        {"account_id": "acc2", "is_enabled": False, "dry_run": True},
    ]
    r = client.get(f"{P}/configs", params={"account_ids": "acc1, acc2 ,acc3"})
    assert r.status_code == 200
    assert r.json() == {"configs": {"acc1": {"is_enabled": True, "dry_run": False},
                                    "acc2": {"is_enabled": False, "dry_run": True}}}


def _enable(db):
    db.tables["zalo_bot_configs"].append({
        "account_id": "acc1", "is_enabled": True, "dry_run": False, "chatwoot_account_id": 3, "chatwoot_inbox_id": 162,
        "auto_pause_on_staff_reply": True, "pause_minutes": 60, "chatwoot_sync": True,
    })


def test_takeover_resume_flow_and_status_shape(env):
    client, db, _ = env
    url = f"{P}/threads/acc1/u100"
    # bot chưa bật -> trạng thái off, tiếp quản bị 409
    assert client.get(f"{url}/status").json()["state"] == "off"
    assert client.post(f"{url}/takeover", json={}).status_code == 409
    _enable(db)
    st = client.get(f"{url}/status").json()
    assert st["state"] == "active" and st["bot_applicable"] and st["paused"] is False
    assert set(st) >= {"account_id", "thread_id", "bot_applicable", "bot_enabled", "dry_run", "state", "paused",
                       "paused_until", "reason", "paused_by", "chatwoot_handed_off"}

    t = client.post(f"{url}/takeover", json={})
    assert t.status_code == 200
    body = t.json()
    assert body["state"] == "paused" and body["reason"] == "manual" and body["paused_by"] == "nv@x.com"
    assert body["paused_until"] is None
    assert client.get(f"{P}/threads/acc1/paused").json() == {"paused_thread_ids": ["u100"]}

    r = client.post(f"{url}/resume")
    assert r.status_code == 200 and r.json()["state"] == "active"
    assert client.get(f"{P}/threads/acc1/paused").json() == {"paused_thread_ids": []}

    # tiếp quản có thời hạn
    t2 = client.post(f"{url}/takeover", json={"minutes": 30}).json()
    assert t2["state"] == "paused" and t2["paused_until"]
    # chat nhóm: bot không áp dụng -> 409
    assert client.post(f"{P}/threads/acc1/g200/takeover", json={}).status_code == 409
    assert client.get(f"{P}/threads/acc1/g200/status").json()["state"] == "off"


def test_thread_access_respects_private_conversations(env):
    client, db, state = env
    _enable(db)
    state["allowed"] = {"u999"}   # người dùng chỉ được xem hội thoại u999
    r = client.get(f"{P}/threads/acc1/u100/status")
    assert r.status_code == 403
    assert client.post(f"{P}/threads/acc1/u100/takeover", json={}).status_code == 403
    state["allowed"] = {"u100"}
    assert client.get(f"{P}/threads/acc1/u100/status").status_code == 200


def test_logs_filters_pagination_and_thread_names(env):
    client, db, _ = env
    for i in range(1, 6):
        db.tables["zalo_bot_logs"].append({
            "id": i, "account_id": "acc1", "thread_id": "u100", "direction": "in" if i % 2 else "out",
            "source_msg_id": None, "content": f"tin {i}", "status": "forwarded" if i % 2 else "sent",
            "error": None, "sent_by": "bot", "created_at": f"2026-11-04T03:0{i}:00Z",
        })
    # FakeDB không sắp xếp/giới hạn id -> sắp xếp giảm dần bằng tay cho khớp thứ tự PostgREST
    orig = db.rest

    async def ordered(method, path, *, params=None, json=None, prefer=None):
        # FakeDB cắt limit theo thứ tự chèn: bỏ limit khi gọi, tự sắp xếp/lọc/cắt bên dưới cho giống PostgREST
        no_limit = {k: v for k, v in (params or {}).items() if k != "limit"} if method == "GET" else params
        rows = await orig(method, path, params=no_limit, json=json, prefer=prefer)
        if method == "GET" and path == "zalo_bot_logs" and rows:
            rows = sorted(rows, key=lambda r: -r["id"])
            if params and params.get("id", "").startswith("lt."):
                rows = [r for r in rows if r["id"] < int(params["id"][3:])]
            rows = rows[: int((params or {}).get("limit", 1000))]
        return rows

    with mock.patch.object(svc, "_rest", ordered):
        page1 = client.get(f"{P}/logs", params={"account_id": "acc1", "limit": 2}).json()
        assert [i["id"] for i in page1["items"]] == [5, 4] and page1["has_more"] is True and page1["next_before_id"] == 4
        assert page1["items"][0]["thread_name"] == "Khách A" and page1["items"][0]["content"] == "tin 5"
        page2 = client.get(f"{P}/logs", params={"account_id": "acc1", "limit": 2, "before_id": 4}).json()
        assert [i["id"] for i in page2["items"]] == [3, 2]
        last = client.get(f"{P}/logs", params={"account_id": "acc1", "limit": 2, "before_id": 2}).json()
        assert [i["id"] for i in last["items"]] == [1] and last["has_more"] is False and last["next_before_id"] is None
        assert client.get(f"{P}/logs", params={"account_id": "acc1", "direction": "sai"}).status_code == 422

        stats = client.get(f"{P}/stats", params={"account_id": "acc1", "days": 3}).json()
    assert stats["days"] == 3 and set(stats["totals"]) == {"forwarded", "sent", "dry_run", "skipped", "paused", "error"}
    assert len(stats["by_day"]) == 3 and set(stats["by_day"][0]) == {"date", "in", "out", "error"}


def test_runtime_flags_do_not_leak_secrets(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("ZALO_BOT_N8N_INCOMING_URL", "http://n8n/hook")
    monkeypatch.setenv("ZALO_BOT_SHARED_SECRET", "sieu-bi-mat")
    monkeypatch.setenv("ZALO_BOT_CHATWOOT_TOKEN", "tok")
    monkeypatch.setenv("ZALO_BOT_CHATWOOT_URL", "https://cw")
    body = client.get(f"{P}/runtime").json()
    assert body == {"n8n_incoming_configured": True, "shared_secret_configured": True,
                    "chatwoot_sync_configured": True, "bridge_enabled": True}
    assert "sieu-bi-mat" not in client.get(f"{P}/runtime").text


# ── Phạm vi bật bot theo người ────────────────────────────────────────────

def test_scope_mode_saved_and_validated_by_api(env):
    client, db, _ = env
    assert client.get(f"{P}/config/acc1").json()["scope_mode"] == "all"
    assert client.put(f"{P}/config/acc1", json={"scope_mode": "everyone"}).status_code == 422
    ok = client.put(f"{P}/config/acc1", json={"scope_mode": "selected"})
    assert ok.status_code == 200 and ok.json()["scope_mode"] == "selected"
    assert ok.json()["scope"] == {"scope_mode": "selected", "on_count": 0, "off_count": 0}


def test_scope_rules_bulk_apply_list_and_clear(env):
    client, db, state = env
    # chỉ hội thoại 1-1 được nhận; nhóm (g200) và ID lạ bị bỏ qua, không ghi rule rác
    r = client.post(f"{P}/scope/acc1/rules", json={"thread_ids": ["u100", "g200", "khong-co"], "bot_on": True})
    assert r.status_code == 200 and r.json() == {"changed": 1, "skipped_not_direct": 2}
    s = client.get(f"{P}/scope/acc1").json()
    assert s["on_count"] == 1 and s["off_count"] == 0
    assert s["rules"] == [{"thread_id": "u100", "name": "Khách A", "bot_on": True}]

    client.post(f"{P}/scope/acc1/rules", json={"thread_ids": ["u100"], "bot_on": False})
    assert client.get(f"{P}/scope/acc1").json()["off_count"] == 1
    client.post(f"{P}/scope/acc1/rules", json={"thread_ids": ["u100"], "bot_on": None})   # bỏ rule
    assert client.get(f"{P}/scope/acc1").json()["rules"] == []

    # validate hình dạng + quyền
    assert client.post(f"{P}/scope/acc1/rules", json={"thread_ids": [], "bot_on": True}).status_code == 422
    state["manage_ok"] = False
    assert client.post(f"{P}/scope/acc1/rules", json={"thread_ids": ["u100"], "bot_on": True}).status_code == 403
    assert client.get(f"{P}/scope/acc1").status_code == 403
    assert client.post(f"{P}/scope/acc1/clear").status_code == 403
    state["manage_ok"] = True
    client.post(f"{P}/scope/acc1/rules", json={"thread_ids": ["u100"], "bot_on": True})
    assert client.post(f"{P}/scope/acc1/clear").json() == {"ok": True}
    assert db.tables["zalo_bot_thread_rules"] == []


def test_thread_rule_toggle_by_staff_with_access_and_status_shape(env):
    client, db, state = env
    client.put(f"{P}/config/acc1", json={"chatwoot_account_id": 3, "chatwoot_inbox_id": 162, "is_enabled": True, "scope_mode": "selected"})
    st = client.get(f"{P}/threads/acc1/u100/status").json()
    assert st["state"] == "out_of_scope" and st["in_scope"] is False and st["rule"] is None

    on = client.post(f"{P}/threads/acc1/u100/rule", json={"bot_on": True})
    assert on.status_code == 200 and on.json()["state"] == "active" and on.json()["rule"] is True
    off = client.post(f"{P}/threads/acc1/u100/rule", json={"bot_on": False})
    assert off.json()["state"] == "out_of_scope" and off.json()["rule"] is False
    reset = client.post(f"{P}/threads/acc1/u100/rule", json={"bot_on": None})
    assert reset.json()["rule"] is None

    assert client.post(f"{P}/threads/acc1/g200/rule", json={"bot_on": True}).status_code == 409   # nhóm: không áp dụng
    state["allowed"] = {"khac"}                                                                    # hội thoại riêng tư chưa chia sẻ
    assert client.post(f"{P}/threads/acc1/u100/rule", json={"bot_on": True}).status_code == 403


def test_scope_candidates_search(env):
    client, db, _ = env
    r = client.get(f"{P}/scope/acc1/candidates", params={"q": "Khách"})
    assert r.status_code == 200
    ids = [i["thread_id"] for i in r.json()["items"]]
    assert "u100" in ids


def test_batch_wait_seconds_saved_and_validated_by_api(env):
    client, db, _ = env
    assert client.get(f"{P}/config/acc1").json()["batch_wait_seconds"] == 10
    assert client.put(f"{P}/config/acc1", json={"batch_wait_seconds": 121}).status_code == 422
    assert client.put(f"{P}/config/acc1", json={"batch_wait_seconds": -1}).status_code == 422
    ok = client.put(f"{P}/config/acc1", json={"batch_wait_seconds": 0})
    assert ok.status_code == 200 and ok.json()["batch_wait_seconds"] == 0
    assert client.put(f"{P}/config/acc1", json={"batch_wait_seconds": 25}).json()["batch_wait_seconds"] == 25
