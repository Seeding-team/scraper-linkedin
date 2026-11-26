"""Test cho Việc B (2026-11-26): feed mặc định (`sort="lead_score_high"`) KHÔNG được ẩn bài
`lead_score IS NULL` (chưa từng được AI chấm điểm — ví dụ lỗi tạm thời, hoặc 1 luồng cào nào
đó chưa gọi AI). Trước fix, `.gte("lead_score", 40)` đơn thuần loại bỏ cả NULL vì trong
Postgres `NULL >= 40` = NULL (falsy) — bài tồn tại thật trong DB, tính vào "Tổng bài", nhưng
biến mất khỏi feed mặc định vĩnh viễn. Chỉ bài có `lead_score` XÁC ĐỊNH và < 40 mới bị ẩn.

Test bằng cách bắt (spy) các lệnh gọi lên query builder giả — không cần mô phỏng toàn bộ
luồng _fetch_posts()/_fetch_threads_posts() (resolve taxonomy, member...), vì hàm trả về sớm
ngay sau execute() khi danh sách bài rỗng.
"""

from __future__ import annotations

from typing import Any

from app.modules.all_platform.services import unified_posts_service as svc


class _Result:
    def __init__(self, data=None, count=0):
        self.data = data or []
        self.count = count


class _RecordingQuery:
    """Trả về chính nó cho mọi method chain (.select/.eq/.gte/.or_/.order/.range/...),
    ghi lại (tên method, args, kwargs) vào danh sách dùng chung để assert sau."""

    def __init__(self, calls: list[tuple[str, tuple, dict]]):
        self._calls = calls

    def execute(self):
        self._calls.append(("execute", (), {}))
        return _Result([], 0)

    def __getattr__(self, name: str):
        def _method(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self
        return _method


class _RecordingSupabase:
    def __init__(self, calls: list[tuple[str, tuple, dict]]):
        self._calls = calls

    def table(self, _name: str):
        return _RecordingQuery(self._calls)


def _expected_or_clause() -> str:
    return f"lead_score.gte.{svc._DEFAULT_MIN_LEAD_SCORE},lead_score.is.null"


def _assert_no_hiding_null(calls: list[tuple[str, tuple, dict]]) -> None:
    # Khong con bat ky loi goi .gte("lead_score", ...) don thuan nao (cai tung an ca NULL).
    assert not any(
        name == "gte" and args and args[0] == "lead_score"
        for name, args, _kwargs in calls
    )
    # Phai co dung loi or_(...) ket hop NULL.
    assert any(
        name == "or_" and args and args[0] == _expected_or_clause()
        for name, args, _kwargs in calls
    )


def test_fetch_posts_facebook_lead_score_high_does_not_hide_null(monkeypatch):
    calls: list[tuple[str, tuple, dict]] = []
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _RecordingSupabase(calls))

    posts, total = svc._fetch_posts(
        table="facebook_posts",
        email="",
        sort="lead_score_high",
        page=1,
        page_size=20,
    )

    assert posts == []
    assert total == 0
    _assert_no_hiding_null(calls)


def test_fetch_posts_facebook_latest_sort_unaffected(monkeypatch):
    """Sort khác "lead_score_high" (vd "latest") không đụng tới lead_score — không có mặt
    cả gte lẫn or_ trên cột này (hành vi cũ giữ nguyên, không bị ảnh hưởng)."""
    calls: list[tuple[str, tuple, dict]] = []
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _RecordingSupabase(calls))

    svc._fetch_posts(table="facebook_posts", email="", sort="latest", page=1, page_size=20)

    assert not any(
        (name in ("gte", "or_")) and args and "lead_score" in str(args[0])
        for name, args, _kwargs in calls
    )


def test_fetch_keyword_posts_threads_lead_score_high_does_not_hide_null(monkeypatch):
    calls: list[tuple[str, tuple, dict]] = []
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _RecordingSupabase(calls))

    posts, total = svc._fetch_keyword_posts(
        table="threads_posts",
        email="",
        date_from=None,
        date_to=None,
        has_taxonomy_filter=False,
        id_member=None,
        search=None,
        sort="lead_score_high",
        page=1,
        page_size=20,
    )

    assert posts == []
    assert total == 0
    _assert_no_hiding_null(calls)
