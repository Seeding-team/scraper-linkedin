"""Test cho Việc 2 (2026-11-26): save_facebook_crawl_to_supabase (luồng cào 24h tự động,
supabase_facebook_crawl_service.py) đổi từ "SELECT existing_urls -> lọc Python -> insert
thường" (check-then-insert, có race condition thật — xem báo cáo điều tra trước) sang
.upsert(on_conflict="post_url", ignore_duplicates=True) (atomic, giống post_ingest_service.py).

Điều kiện bắt buộc: bài ĐÃ CÓ SẴN phải giữ nguyên 100% (đặc biệt crawl_date KHÔNG bị ghi đè
thành hôm nay) — nếu lỡ dùng upsert kiểu DO UPDATE thay vì DO NOTHING, job 24h quét lại bài cũ
mỗi ngày sẽ liên tục đẩy crawl_date lên "hôm nay", gây đúng lỗi "Tổng bài tăng ảo" ở card thống
kê (post_call_result_service.py::_count_crawled_posts đếm theo crawl_date) — nghiêm trọng hơn
lỗi mất bài mà Việc 2 đang sửa.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import supabase_facebook_crawl_service as fb_crawl_service
from app.modules.facebook.src.modules.crawl_fb.models.GroupSummary import GroupSummary
from app.modules.facebook.src.modules.crawl_fb.models.post import Post


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Query builder tối giản — mô phỏng đúng ON CONFLICT ... DO NOTHING của Postgres/PostgREST
    khi `ignore_duplicates=True`: row đã tồn tại giữ nguyên 100% (không update cột nào) và
    KHÔNG xuất hiện trong RETURNING (res.data) — khác hẳn upsert "DO UPDATE" (merge) thông
    thường."""

    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any]] = []
        self.op: tuple[str, Any] | None = None
        self.on_conflict: str | None = None
        self.ignore_duplicates: bool = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def upsert(self, data, on_conflict: str | None = None, ignore_duplicates: bool = False):
        self.op = ("upsert", data)
        self.on_conflict = on_conflict
        self.ignore_duplicates = ignore_duplicates
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
            items = payload if isinstance(payload, list) else [payload]

            if kind == "insert":
                saved = []
                for item in items:
                    row = dict(item)
                    row.setdefault("id", str(uuid.uuid4()))
                    self.rows.append(row)
                    saved.append(dict(row))
                return _Result(saved)

            if kind == "upsert":
                conflict_keys = self.on_conflict.split(",") if self.on_conflict else []
                saved = []
                for item in items:
                    existing = None
                    if conflict_keys:
                        for row in self.rows:
                            if all(row.get(k) == item.get(k) for k in conflict_keys):
                                existing = row
                                break
                    if existing is not None:
                        if self.ignore_duplicates:
                            continue  # DO NOTHING: khong doi gi, khong co trong RETURNING
                        existing.update(item)
                        saved.append(dict(existing))
                    else:
                        row = dict(item)
                        row.setdefault("id", str(uuid.uuid4()))
                        self.rows.append(row)
                        saved.append(dict(row))
                return _Result(saved)

        matched = [r for r in self.rows if self._matches(r)]
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched_clients(fake_db):
    with mock.patch.object(fb_crawl_service, "get_supabase_client", return_value=fake_db):
        yield fake_db


def _make_summary(post_url: str, group_url: str = "https://facebook.com/groups/abc") -> GroupSummary:
    post = Post(
        url=post_url,
        date="",
        reactions=1,
        comments=0,
        shares=0,
        score=1,
        content="Noi dung bai test",
    )
    return GroupSummary(
        group_name="Test Group",
        link_group=group_url,
        total_posts_24h=1,
        Intent="sales",
        id_member="member-1",
        hot_post=post,
        selected_posts=[post],
    )


# ---------------------------------------------------------------------------
# BẮT BUỘC PASS (yêu cầu tường minh của Việc 2): job 24h quét lại trúng đúng 1 bài đã tồn tại
# từ 7 ngày trước -> crawl_date của bài đó phải GIỮ NGUYÊN, không bị ghi đè thành hôm nay.
# ---------------------------------------------------------------------------
def test_rescanning_existing_post_does_not_overwrite_crawl_date(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("facebook_groups", []).append(
        {"id": "group-1", "group_url": "https://facebook.com/groups/abc"}
    )

    old_crawl_date = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    existing_post_url = "https://facebook.com/posts/old-1"
    fake_db.store.setdefault("facebook_posts", []).append(
        {
            "id": "post-old-1",
            "post_url": existing_post_url,
            "crawl_date": old_crawl_date,
            "content": "Bai cu da cao tu 7 ngay truoc",
            "group_id": "group-1",
        }
    )

    summary = _make_summary(existing_post_url)
    result = fb_crawl_service.save_facebook_crawl_to_supabase("cronjob", [summary])

    row = next(r for r in fake_db.store["facebook_posts"] if r["post_url"] == existing_post_url)
    assert row["crawl_date"] == old_crawl_date, (
        "crawl_date cua bai da ton tai bi ghi de -> se gay 'Tong bai tang ao' moi lan job 24h "
        "quet lai trung bai cu (dung ON CONFLICT DO UPDATE thay vi DO NOTHING)"
    )
    assert len(fake_db.store["facebook_posts"]) == 1  # khong tao them dong moi nao
    assert result["total_posts"] == 0  # khong co bai nao THAT SU moi duoc insert
    assert result["duplicates"] == 1
    assert result["inserted_posts"] == []  # bai trung bi loai khoi danh sach xu ly AI tiep theo


# ---------------------------------------------------------------------------
# 1 bai moi that su + 1 bai trung trong CUNG 1 batch -> total_posts/duplicates/inserted_posts
# phai phan anh dung ket qua THAT SU cua upsert (khong doan qua pre-check nhu code cu).
# ---------------------------------------------------------------------------
def test_mixed_batch_counts_new_and_duplicate_correctly(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("facebook_groups", []).append(
        {"id": "group-1", "group_url": "https://facebook.com/groups/abc"}
    )
    old_crawl_date = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    existing_post_url = "https://facebook.com/posts/old-2"
    fake_db.store.setdefault("facebook_posts", []).append(
        {
            "id": "post-old-2",
            "post_url": existing_post_url,
            "crawl_date": old_crawl_date,
            "content": "Bai cu",
            "group_id": "group-1",
        }
    )

    new_post_url = "https://facebook.com/posts/new-1"
    post_dup = Post(url=existing_post_url, date="", reactions=0, comments=0, shares=0, score=1, content="Bai cu")
    post_new = Post(url=new_post_url, date="", reactions=0, comments=0, shares=0, score=1, content="Bai moi")
    summary = GroupSummary(
        group_name="Test Group",
        link_group="https://facebook.com/groups/abc",
        total_posts_24h=2,
        Intent="sales",
        id_member="member-1",
        selected_posts=[post_dup, post_new],
    )

    result = fb_crawl_service.save_facebook_crawl_to_supabase("cronjob", [summary])

    assert result["total_posts"] == 1  # chi post_new la THAT SU moi
    assert result["duplicates"] == 1
    assert [p["post_url"] for p in result["inserted_posts"]] == [new_post_url]

    old_row = next(r for r in fake_db.store["facebook_posts"] if r["post_url"] == existing_post_url)
    assert old_row["crawl_date"] == old_crawl_date  # van giu nguyen, khong bi doi


# ---------------------------------------------------------------------------
# Khong co bai nao trung -> hanh vi nhu insert binh thuong (regression check voi test legacy
# da co o test_crawl_exclude_auto_reject.py, chi lap lai ngan gon o day cho ro muc dich).
# ---------------------------------------------------------------------------
def test_brand_new_post_is_inserted_normally(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("facebook_groups", []).append(
        {"id": "group-1", "group_url": "https://facebook.com/groups/abc"}
    )

    summary = _make_summary("https://facebook.com/posts/brand-new-1")
    result = fb_crawl_service.save_facebook_crawl_to_supabase("cronjob", [summary])

    assert result["total_posts"] == 1
    assert result["duplicates"] == 0
    assert len(result["inserted_posts"]) == 1
