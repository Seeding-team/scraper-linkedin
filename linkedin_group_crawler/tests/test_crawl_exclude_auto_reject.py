"""Tests cho auto_reject_if_excluded (tự động gắn 'khong-phu-hop' cho bài MỚI cào khớp
từ khóa loại trừ, hook ở tầng ingest — post_ingest_service.py,
supabase_linkedin_extension_crawl_service.py, supabase_threads_extension_crawl_service.py)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import crawl_exclude_service
from app.modules.all_platform.services import post_evaluation_service


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Query builder tối giản, đủ cho .select/.eq/.or_/.maybe_single/.insert/.upsert/.order."""

    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any]] = []
        self.single = False
        self.op: tuple[str, Any] | None = None
        self.on_conflict: str | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def or_(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def ilike(self, key, pattern):
        # Tối giản: chỉ dùng để test fallback path (không khớp gì) - không cần match thật.
        self.filters.append((key, "__never_matches__"))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def upsert(self, data, on_conflict: str | None = None):
        self.op = ("upsert", data)
        self.on_conflict = on_conflict
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

            if kind == "upsert":
                items = payload if isinstance(payload, list) else [payload]
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
                        existing.update(item)
                        saved.append(dict(existing))
                    else:
                        row = dict(item)
                        row.setdefault("id", str(uuid.uuid4()))
                        self.rows.append(row)
                        saved.append(dict(row))
                return _Result(saved)

        matched = [r for r in self.rows if self._matches(r)]
        if self.single:
            return _Result(dict(matched[0]) if matched else None)
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture(autouse=True)
def _clear_keyword_cache():
    crawl_exclude_service.clear_exclude_keywords_cache()
    yield
    crawl_exclude_service.clear_exclude_keywords_cache()


@pytest.fixture
def patched_clients(fake_db):
    with mock.patch.object(crawl_exclude_service, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(post_evaluation_service, "get_supabase_client", return_value=fake_db):
        yield fake_db


def _seed_keyword(fake_db, keyword: str, platform: str | None = None):
    fake_db.store.setdefault("crawl_exclude_keywords", []).append(
        {"id": f"kw-{keyword}", "keyword": keyword, "platform": platform, "status": "active"}
    )


def _review_row(fake_db, post_id, platform="facebook"):
    rows = fake_db.store.get("post_quick_review", [])
    return next((r for r in rows if r.get("post_id") == post_id and r.get("platform") == platform), None)


def _history_rows(fake_db, post_id, platform="facebook"):
    rows = fake_db.store.get("post_evaluation_history", [])
    return [r for r in rows if r.get("post_id") == post_id and r.get("platform") == platform]


# ---------------------------------------------------------------------------
# (a) Bài mới khớp từ khóa active -> evaluation_code tự thành khong-phu-hop,
#     có history action_type='auto_exclude_keyword'.
# ---------------------------------------------------------------------------
def test_a_new_post_matching_keyword_is_auto_rejected(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")

    result = crawl_exclude_service.auto_reject_if_excluded(
        "post-a", "facebook", "Mời anh chị tham khảo gói vay vốn ngân hàng ưu đãi"
    )

    assert result is not None
    review = _review_row(fake_db, "post-a")
    assert review is not None
    assert review["evaluation_code"] == "khong-phu-hop"

    history = _history_rows(fake_db, "post-a")
    assert len(history) == 1
    assert history[0]["action_type"] == "auto_exclude_keyword"
    assert history[0]["evaluated_by"] is None
    assert history[0]["previous_evaluation_code"] is None


# ---------------------------------------------------------------------------
# (b) Bài mới không khớp -> không bị đụng (không tạo review/history nào).
# ---------------------------------------------------------------------------
def test_b_new_post_not_matching_keyword_is_untouched(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")

    result = crawl_exclude_service.auto_reject_if_excluded(
        "post-b", "facebook", "Hôm nay trời đẹp, mời mọi người cà phê cuối tuần"
    )

    assert result is None
    assert _review_row(fake_db, "post-b") is None
    assert _history_rows(fake_db, "post-b") == []


# ---------------------------------------------------------------------------
# (c) exclude_keyword_exempt=true + khớp -> KHÔNG đổi.
# ---------------------------------------------------------------------------
def test_c_exempt_post_is_not_overridden_even_if_matching(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")
    fake_db.store.setdefault("post_quick_review", []).append(
        {
            "post_id": "post-c",
            "platform": "facebook",
            "evaluation_code": "chua-danh-gia",
            "exclude_keyword_exempt": True,
        }
    )

    result = crawl_exclude_service.auto_reject_if_excluded(
        "post-c", "facebook", "Gói vay vốn ngân hàng siêu ưu đãi"
    )

    assert result is None
    review = _review_row(fake_db, "post-c")
    assert review["evaluation_code"] == "chua-danh-gia"
    assert _history_rows(fake_db, "post-c") == []


# ---------------------------------------------------------------------------
# (d) Đã đánh giá thủ công (vd can-lien-he) + khớp từ khóa -> giữ nguyên, không ghi đè.
# ---------------------------------------------------------------------------
def test_d_manually_evaluated_post_is_not_overridden(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")
    fake_db.store.setdefault("post_quick_review", []).append(
        {
            "post_id": "post-d",
            "platform": "facebook",
            "evaluation_code": "can-lien-he",
            "exclude_keyword_exempt": False,
        }
    )

    result = crawl_exclude_service.auto_reject_if_excluded(
        "post-d", "facebook", "Gói vay vốn ngân hàng siêu ưu đãi"
    )

    review = _review_row(fake_db, "post-d")
    assert review["evaluation_code"] == "can-lien-he"
    assert result == review
    assert _history_rows(fake_db, "post-d") == []


# ---------------------------------------------------------------------------
# (e) Gọi 2 lần liên tiếp cho cùng 1 post đã khong-phu-hop -> không tạo history thừa.
# ---------------------------------------------------------------------------
def test_e_calling_twice_is_idempotent(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")

    crawl_exclude_service.auto_reject_if_excluded(
        "post-e", "facebook", "Gói vay vốn ngân hàng siêu ưu đãi"
    )
    crawl_exclude_service.auto_reject_if_excluded(
        "post-e", "facebook", "Gói vay vốn ngân hàng siêu ưu đãi"
    )

    review = _review_row(fake_db, "post-e")
    assert review["evaluation_code"] == "khong-phu-hop"
    assert len(_history_rows(fake_db, "post-e")) == 1


# ---------------------------------------------------------------------------
# Bonus: match không phân biệt hoa/thường và strip dấu (tái dùng keyword_match.py),
# và search_keyword (vd từ khóa tìm Threads) cũng được quét.
# ---------------------------------------------------------------------------
def test_matches_accent_insensitive_and_search_keyword(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay von")

    result = crawl_exclude_service.auto_reject_if_excluded(
        "post-f", "threads", "Nội dung bình thường", search_keyword="VAY VỐN ngân hàng"
    )

    assert result is not None
    assert _review_row(fake_db, "post-f", "threads")["evaluation_code"] == "khong-phu-hop"


# ---------------------------------------------------------------------------
# 3 điểm insert LEGACY (không qua extension/save-posts) bị bỏ sót ở lượt hook trước:
# supabase_facebook_crawl_service.save_facebook_crawl_to_supabase(),
# supabase_linkedin_crawl_service.save_crawl_batch_to_supabase(), và insert inline
# ở app/modules/linkedin/router.py::crawl_linkedin_group (JWT Bearer/Playwright).
# ---------------------------------------------------------------------------
def test_facebook_legacy_crawl_auto_rejects_matching_post(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")
    fake_db.store.setdefault("facebook_groups", []).append(
        {"id": "group-1", "group_url": "https://facebook.com/groups/abc"}
    )

    from app.modules.all_platform.services import supabase_facebook_crawl_service as fb_crawl_service
    from app.modules.facebook.src.modules.crawl_fb.models.GroupSummary import GroupSummary
    from app.modules.facebook.src.modules.crawl_fb.models.post import Post

    post = Post(
        url="https://facebook.com/posts/1",
        date="",
        reactions=1,
        comments=0,
        shares=0,
        score=1,
        content="Gói vay vốn ngân hàng siêu ưu đãi",
    )
    summary = GroupSummary(
        group_name="Test Group",
        link_group="https://facebook.com/groups/abc",
        total_posts_24h=1,
        Intent="sales",
        id_member="member-1",
        hot_post=post,
        selected_posts=[post],
    )

    with mock.patch.object(fb_crawl_service, "get_supabase_client", return_value=fake_db):
        result = fb_crawl_service.save_facebook_crawl_to_supabase("cronjob", [summary])

    assert result["total_posts"] == 1
    saved_row = next(r for r in fake_db.store["facebook_posts"] if r["post_url"] == post.url)
    review = _review_row(fake_db, saved_row["id"], "facebook")
    assert review is not None
    assert review["evaluation_code"] == "khong-phu-hop"
    history = _history_rows(fake_db, saved_row["id"], "facebook")
    assert len(history) == 1
    assert history[0]["action_type"] == "auto_exclude_keyword"


def test_linkedin_legacy_save_crawl_batch_auto_rejects_matching_post(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")

    from app.modules.all_platform.services import supabase_linkedin_crawl_service as li_crawl_service

    post_url = "https://www.linkedin.com/posts/legacy-batch-1"
    groups_results = [
        {
            "session_id": "sess-1",
            "group_name": "Nhom test",
            # Không có "/groups/<so>" để tránh nhánh .ilike() trong _get_group_taxonomy.
            "group_url": "https://www.linkedin.com/groups/test-group-xyz",
            "posts": [
                {
                    "post_url": post_url,
                    "author": "Nguyen Van A",
                    "content": "Gói vay vốn ngân hàng siêu ưu đãi",
                    "likes": 5,
                    "comments": 1,
                    "reposts": 0,
                    "posted_at": "2026-11-15T10:00:00+00:00",
                }
            ],
            "total_posts_scraped": 1,
            "success": True,
            "error": None,
        }
    ]

    with mock.patch.object(li_crawl_service, "get_supabase_client", return_value=fake_db):
        result = li_crawl_service.save_crawl_batch_to_supabase(
            email_crawl="crawler@example.com",
            target_date="2026-11-15",
            groups_results=groups_results,
        )

    assert result["total_posts"] == 1
    saved_row = next(r for r in fake_db.store["linkedin_posts"] if r["post_url"] == post_url)
    review = _review_row(fake_db, saved_row["id"], "linkedin")
    assert review is not None
    assert review["evaluation_code"] == "khong-phu-hop"
    history = _history_rows(fake_db, saved_row["id"], "linkedin")
    assert len(history) == 1
    assert history[0]["action_type"] == "auto_exclude_keyword"


def test_router_linkedin_crawl_endpoint_auto_rejects_matching_post(patched_clients):
    fake_db = patched_clients
    _seed_keyword(fake_db, "vay vốn ngân hàng")

    from app.modules.linkedin import router as li_router
    from app.modules.linkedin.schemas.request_models import CrawlGroupRequest

    crawl_time = datetime(2026, 11, 15, 10, 0, 0, tzinfo=timezone.utc)
    post_url = "https://www.linkedin.com/posts/router-legacy-1"
    fake_crawl_result = {
        "session_id": "sess-router-1",
        "group_name": "Nhom test router",
        "total_posts_scraped": 1,
        "crawl_time": crawl_time,
        "posts": [
            {
                "post_url": post_url,
                "author": "Nguyen Van B",
                "content": "Gói vay vốn ngân hàng siêu ưu đãi",
                "posted_at_raw": "5m",
                "likes": 2,
                "comments": 0,
                "reposts": 0,
            }
        ],
    }

    payload = CrawlGroupRequest(
        group_url="https://www.linkedin.com/groups/test-router-group",
        email="crawler@example.com",
    )

    with mock.patch.object(li_router, "open_group_and_collect_posts", return_value=fake_crawl_result), \
            mock.patch("app.core.supabase_client.get_supabase_client", return_value=fake_db):
        result = li_router.crawl_linkedin_group(payload)

    assert result.success is True
    saved_row = next(r for r in fake_db.store["linkedin_posts"] if r["post_url"] == post_url)
    review = _review_row(fake_db, saved_row["id"], "linkedin")
    assert review is not None
    assert review["evaluation_code"] == "khong-phu-hop"
    history = _history_rows(fake_db, saved_row["id"], "linkedin")
    assert len(history) == 1
    assert history[0]["action_type"] == "auto_exclude_keyword"
