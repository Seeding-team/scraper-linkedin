"""Test cho Việc C (2026-11-26): `auto_reject_legacy_low_lead_score_posts()` chỉ quét và tự
gắn 'Không phù hợp' cho bài CŨ đã có sẵn `lead_score` XÁC ĐỊNH trong khoảng 1-39 (phạm vi nhỏ,
bị bỏ sót từ cửa sổ lịch sử 2026-10-02 -> 2026-11-04). KHÔNG được đụng tới bài `lead_score IS
NULL` (chưa từng được AI chấm điểm — khác bản chất, xem Việc B) và KHÔNG ghi đè đánh giá thủ
công đã có sẵn (tái dùng đúng guard của `auto_reject_if_excluded`)."""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.all_platform.services import crawl_exclude_service as exc_svc
from app.modules.all_platform.services import post_evaluation_service as review_svc


class _Result:
    def __init__(self, data=None):
        self.data = data or []


class _FakeQuery:
    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any, str]] = []
        self.op: tuple[str, Any] | None = None
        self.single = False

    def select(self, *_a, **_kw):
        return self

    def eq(self, key, value):
        self.filters.append((key, value, "eq"))
        return self

    def gte(self, key, value):
        self.filters.append((key, value, "gte"))
        return self

    def lte(self, key, value):
        self.filters.append((key, value, "lte"))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def upsert(self, data, on_conflict=None):
        self.op = ("upsert", data, on_conflict)
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def _matches(self, row: dict) -> bool:
        for key, value, kind in self.filters:
            cur = row.get(key)
            if kind == "eq" and cur != value:
                return False
            if kind == "gte" and (cur is None or cur < value):
                return False
            if kind == "lte" and (cur is None or cur > value):
                return False
        return True

    def execute(self):
        if self.op:
            kind, payload = self.op[0], self.op[1]
            if kind == "upsert":
                on_conflict = self.op[2]
                conflict_keys = on_conflict.split(",") if on_conflict else []
                existing = None
                if conflict_keys:
                    for row in self.rows:
                        if all(row.get(k) == payload.get(k) for k in conflict_keys):
                            existing = row
                            break
                if existing is not None:
                    existing.update(payload)
                    return _Result([dict(existing)])
                self.rows.append(dict(payload))
                return _Result([dict(payload)])
            if kind == "insert":
                self.rows.append(dict(payload))
                return _Result([dict(payload)])

        matched = [r for r in self.rows if self._matches(r)]
        if self.single:
            return _Result(dict(matched[0])) if matched else _Result(None)
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


@pytest.fixture
def fake_db(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(exc_svc, "get_supabase_client", lambda: db)
    monkeypatch.setattr(review_svc, "get_supabase_client", lambda: db)
    return db


def test_marks_only_posts_with_determined_low_score_1_to_39(fake_db):
    fake_db.store.setdefault("facebook_posts", []).extend(
        [
            {"id": "fb-low-1", "lead_score": 25},       # phai bi gan "khong-phu-hop"
            {"id": "fb-high-1", "lead_score": 85},      # KHONG dung toi (diem cao)
            {"id": "fb-null-1", "lead_score": None},    # KHONG dung toi (chua cham diem)
        ]
    )
    fake_db.store.setdefault("threads_posts", []).append(
        {"id": "th-low-1", "lead_score": 39}            # bien tren, van phai bi gan
    )
    fake_db.store.setdefault("linkedin_posts", []).append(
        {"id": "li-reviewed-1", "lead_score": 10}
    )
    # Bai linkedin da duoc 1 Admin danh gia thu cong truoc do (khac 'chua-danh-gia') ->
    # KHONG duoc ghi de.
    fake_db.store.setdefault("post_quick_review", []).append(
        {
            "post_id": "li-reviewed-1",
            "platform": "linkedin",
            "evaluation_code": "da-lien-he",
            "exclude_keyword_exempt": False,
        }
    )

    summary = exc_svc.auto_reject_legacy_low_lead_score_posts()

    review_by_id = {
        r["post_id"]: r for r in fake_db.store.get("post_quick_review", [])
    }

    assert review_by_id["fb-low-1"]["evaluation_code"] == "khong-phu-hop"
    assert review_by_id["th-low-1"]["evaluation_code"] == "khong-phu-hop"

    # Bai diem cao va bai NULL KHONG duoc tao review moi nao.
    assert "fb-high-1" not in review_by_id
    assert "fb-null-1" not in review_by_id

    # Bai da duoc danh gia thu cong truoc do giu nguyen, khong bi ghi de.
    assert review_by_id["li-reviewed-1"]["evaluation_code"] == "da-lien-he"

    assert summary["marked"] == 2  # fb-low-1 + th-low-1
    assert summary["skipped_already_reviewed"] == 1  # li-reviewed-1

    history_action_types = {h["action_type"] for h in fake_db.store.get("post_evaluation_history", [])}
    assert history_action_types == {"auto_exclude_low_score"}


def test_idempotent_second_run_does_not_duplicate_history(fake_db):
    fake_db.store.setdefault("facebook_posts", []).append({"id": "fb-low-2", "lead_score": 15})

    exc_svc.auto_reject_legacy_low_lead_score_posts()
    first_history_len = len(fake_db.store.get("post_evaluation_history", []))

    second_summary = exc_svc.auto_reject_legacy_low_lead_score_posts()

    assert len(fake_db.store.get("post_evaluation_history", [])) == first_history_len
    assert second_summary["marked"] == 0
    assert second_summary["skipped_already_reviewed"] == 1
