"""Tests cho 3 cơ chế mới trong supabase_groups_service.py (2026-11-22):
- Việc 1: group_intents (nhiều lĩnh vực/group) qua _sync_group_intents + _attach_group_extras
- Việc 2: group_pricing_tiers qua _sync_group_pricing_tiers
- Việc 3: group_comment_templates/group_post_templates qua _sync_group_templates

Dùng fake Supabase client tối giản (chỉ đủ chain .select/.eq/.in_/.insert/.delete/.execute
mà các hàm này gọi tới), không cần DB thật.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.modules.all_platform.services import supabase_groups_service as svc


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any]] = []
        self.op: tuple[str, Any] | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def update(self, data):
        self.op = ("update", data)
        return self

    def delete(self):
        self.op = ("delete", None)
        return self

    def _matches(self, row: dict) -> bool:
        for key, value in self.filters:
            if isinstance(value, set):
                if row.get(key) not in value:
                    return False
            elif row.get(key) != value:
                return False
        return True

    def execute(self):
        if self.op:
            kind, payload = self.op
            if kind == "insert":
                items = payload if isinstance(payload, list) else [payload]
                saved = []
                for item in items:
                    row = dict(item)
                    row.setdefault("id", str(uuid.uuid4()))
                    self.rows.append(row)
                    saved.append(dict(row))
                return _Result(saved)
            if kind == "delete":
                remaining = [r for r in self.rows if not self._matches(r)]
                removed = [r for r in self.rows if self._matches(r)]
                self.rows[:] = remaining
                return _Result(removed)
            if kind == "update":
                updated = []
                for r in self.rows:
                    if self._matches(r):
                        r.update(payload)
                        updated.append(dict(r))
                return _Result(updated)

        matched = [dict(r) for r in self.rows if self._matches(r)]
        return _Result(matched)


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


@pytest.fixture
def fake_db():
    return _FakeSupabase()


# ---------------------------------------------------------------------------
# Việc 1 — group_intents: replace-all semantics + gắn vào rows qua _attach_group_extras
# ---------------------------------------------------------------------------
def test_sync_group_intents_replaces_all_rows_for_group_platform(fake_db):
    gid = "g1"
    svc._sync_group_intents(fake_db, gid, "facebook", ["cat-a", "cat-b"])
    rows = fake_db.store["group_intents"]
    assert {r["id_intent"] for r in rows} == {"cat-a", "cat-b"}
    assert all(r["platform"] == "facebook" for r in rows)

    # Lưu lại với danh sách mới -> xoá sạch danh sách cũ, không cộng dồn.
    svc._sync_group_intents(fake_db, gid, "facebook", ["cat-c"])
    rows = fake_db.store["group_intents"]
    assert [r["id_intent"] for r in rows] == ["cat-c"]


def test_sync_group_intents_dedupes_and_ignores_empty(fake_db):
    svc._sync_group_intents(fake_db, "g1", "facebook", ["cat-a", "cat-a", "", None, "cat-b"])
    rows = fake_db.store["group_intents"]
    assert sorted(r["id_intent"] for r in rows) == ["cat-a", "cat-b"]


def test_sync_group_intents_scoped_by_platform_does_not_touch_other_platform(fake_db):
    svc._sync_group_intents(fake_db, "g-shared-id", "facebook", ["cat-a"])
    svc._sync_group_intents(fake_db, "g-shared-id", "linkedin", ["cat-b"])
    rows = fake_db.store["group_intents"]
    assert len(rows) == 2
    fb_rows = [r for r in rows if r["platform"] == "facebook"]
    li_rows = [r for r in rows if r["platform"] == "linkedin"]
    assert fb_rows[0]["id_intent"] == "cat-a"
    assert li_rows[0]["id_intent"] == "cat-b"

    # Sửa lại nhóm facebook không được đụng tới dòng linkedin cùng group_id.
    svc._sync_group_intents(fake_db, "g-shared-id", "facebook", ["cat-z"])
    rows = fake_db.store["group_intents"]
    assert len(rows) == 2
    li_rows = [r for r in rows if r["platform"] == "linkedin"]
    assert li_rows[0]["id_intent"] == "cat-b"


def test_attach_group_extras_fills_intent_ids_and_names(fake_db):
    fake_db.store["group_intents"] = [
        {"group_id": "g1", "platform": "facebook", "id_intent": "cat-a"},
        {"group_id": "g1", "platform": "facebook", "id_intent": "cat-b"},
    ]
    rows = [{"id": "g1"}]
    cat_map = {"cat-a": {"name": "Giáo dục"}}  # cat-b cố ý thiếu trong cat_map ban đầu
    fake_db.store["categories"] = [{"id": "cat-b", "name": "Bán lẻ"}]

    svc._attach_group_extras(fake_db, rows, "facebook", cat_map)

    assert rows[0]["intent_ids"] == ["cat-a", "cat-b"]
    assert rows[0]["intent_names"] == ["Giáo dục", "Bán lẻ"]
    assert rows[0]["pricing_tiers"] == []
    assert rows[0]["comment_templates"] == []
    assert rows[0]["post_templates"] == []


# ---------------------------------------------------------------------------
# Việc 2 — group_pricing_tiers: replace-all, bỏ dòng dữ liệu không hợp lệ, "Miễn phí" -> rỗng
# ---------------------------------------------------------------------------
def test_sync_group_pricing_tiers_replaces_and_validates(fake_db):
    svc._sync_group_pricing_tiers(
        fake_db,
        "g1",
        "facebook",
        [
            {"posts_count": 4, "period": "week", "unit_price": 100000},
            {"posts_count": 0, "period": "week", "unit_price": 100000},  # posts_count<=0 -> bỏ
            {"posts_count": 2, "period": "year", "unit_price": 100000},  # period sai -> bỏ
            {"posts_count": "8", "period": "month", "unit_price": "250000"},  # string numeric vẫn nhận
        ],
    )
    rows = fake_db.store["group_pricing_tiers"]
    assert len(rows) == 2
    assert {r["posts_count"] for r in rows} == {4, 8}

    # Chuyển "Miễn phí" -> gửi mảng rỗng -> xoá sạch.
    svc._sync_group_pricing_tiers(fake_db, "g1", "facebook", [])
    assert fake_db.store["group_pricing_tiers"] == []


# ---------------------------------------------------------------------------
# Việc 3 — group_comment_templates / group_post_templates: replace-all, bỏ chuỗi rỗng
# ---------------------------------------------------------------------------
def test_sync_group_templates_replaces_and_skips_blank(fake_db):
    svc._sync_group_templates(
        fake_db, "group_comment_templates", "g1", "facebook",
        ["Chào bạn!", "   ", {"content": "Inbox mình tư vấn nhé"}], created_by="user-1",
    )
    rows = fake_db.store["group_comment_templates"]
    assert [r["content"] for r in rows] == ["Chào bạn!", "Inbox mình tư vấn nhé"]
    assert all(r["created_by"] == "user-1" for r in rows)

    svc._sync_group_templates(fake_db, "group_comment_templates", "g1", "facebook", [], created_by="user-1")
    assert fake_db.store["group_comment_templates"] == []


def test_sync_group_templates_independent_tables(fake_db):
    svc._sync_group_templates(fake_db, "group_comment_templates", "g1", "facebook", ["mẫu bình luận"], created_by=None)
    svc._sync_group_templates(fake_db, "group_post_templates", "g1", "facebook", ["mẫu bài đăng"], created_by=None)
    assert [r["content"] for r in fake_db.store["group_comment_templates"]] == ["mẫu bình luận"]
    assert [r["content"] for r in fake_db.store["group_post_templates"]] == ["mẫu bài đăng"]


# ---------------------------------------------------------------------------
# Regression (2026-11-23): 1 bảng vệ tinh lỗi/chưa tồn tại (vd migration 236/237/238
# chưa áp dụng ở DB đích) KHÔNG được làm thất bại cả add/update_facebook_group — các
# trường chính (tên, URL, lịch cào 24h...) phải vẫn lưu được. Trước đây các lời gọi
# _sync_group_intents/_sync_group_pricing_tiers/_sync_group_templates không được bọc
# try/except nên 1 exception ở đó (vd "relation group_intents does not exist") làm cả
# request trả success=False dù dòng chính đã UPDATE/INSERT xong.
# ---------------------------------------------------------------------------
class _RaisingQuery(_FakeQuery):
    def execute(self):
        raise RuntimeError('relation "group_intents" does not exist')


class _FakeSupabaseWithFailingTable(_FakeSupabase):
    def __init__(self, failing_tables: set[str]):
        super().__init__()
        self.failing_tables = failing_tables

    def table(self, name: str):
        if name in self.failing_tables:
            return _RaisingQuery(self.store.setdefault(name, []), name)
        return super().table(name)


def test_update_facebook_group_still_saves_main_fields_when_group_intents_table_missing(monkeypatch):
    db = _FakeSupabaseWithFailingTable({"group_intents"})
    db.store["facebook_groups"] = [{"id": "g1", "group_name": "Ten cu"}]
    monkeypatch.setattr(svc, "get_supabase_client", lambda: db)

    result = svc.update_facebook_group("g1", {"id": "g1", "group_name": "Ten moi", "intent_ids": ["cat-a"]})

    assert result["group_name"] == "Ten moi"
    assert db.store["group_intents"] == []  # khong co dong nao duoc ghi (bang loi), nhung khong van den dong chinh


def test_add_facebook_group_still_creates_group_when_group_intents_table_missing(monkeypatch):
    db = _FakeSupabaseWithFailingTable({"group_intents"})
    monkeypatch.setattr(svc, "get_supabase_client", lambda: db)

    result = svc.add_facebook_group(
        {"group_name": "Nhom moi", "group_url": "https://facebook.com/groups/abc", "intent_ids": ["cat-a"]}
    )

    assert result["group_name"] == "Nhom moi"
    assert db.store["facebook_groups"][0]["group_name"] == "Nhom moi"
