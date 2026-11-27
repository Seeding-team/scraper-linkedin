"""Test cho server-side filter theo evaluation_code/service_area (2026-11-27) — thay thế
cách phân trang CLIENT-SIDE cũ của trang Post Feed (dropdown "Trạng thái liên hệ" +
"Khu vực"): trước đây khi lọc, FE tự lọc tay trên ĐÚNG 1 batch 50 bài đã tải (page_size=50
cố định, không cộng dồn), nên danh sách hiển thị không bao giờ vượt quá 50 dù tổng số bài
khớp bộ lọc lớn hơn nhiều. Giờ lọc + phân trang 50 bài/trang hoàn toàn ở backend.

3 nhóm test:
- Unit test cho 2 hàm resolver mới (`_resolve_post_ids_by_evaluation_status`,
  `_resolve_post_ids_by_service_area`) với fake DB có dữ liệu thật.
- Unit test `_execute_with_id_predicates` (hotfix 414 lần 2, 2026-11-27): id resolve được ở
  Python (có thể lớn tuỳ dữ liệu thực tế, CẢ 2 CHIỀU — tập "chưa đánh giá" lẫn tập "đã đánh
  giá" sau các đợt backfill hàng loạt) không còn được nhồi vào `.in_()`/`.not_.in_()` của
  query PostgREST nữa (gây 414 Request-URI Too Large thật trên production) — thay vào đó
  fetch hết rồi lọc/đếm/phân trang bằng Python.
- Wiring test xác nhận `_fetch_posts()`/`_fetch_keyword_posts()` KHÔNG BAO GIỜ gọi
  `.in_("id", ...)`/`.not_.in_("id", ...)` khi truyền `evaluation_code`/`service_area`, và vẫn
  trả đúng danh sách bài + tổng số đã lọc.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.all_platform.services import unified_posts_service as svc


class _Result:
    def __init__(self, data=None, count=0):
        self.data = data or []
        self.count = count


# ── Fake DB co du lieu that, dung cho test resolver truc tiep ───────────────────────────


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple[str, Any, str]] = []

    def select(self, *_a, **_kw):
        return self

    def eq(self, key, value):
        self.filters.append((key, value, "eq"))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values), "in_"))
        return self

    def _matches(self, row: dict) -> bool:
        for key, value, kind in self.filters:
            cur = row.get(key)
            if kind == "eq" and cur != value:
                return False
            if kind == "in_" and cur not in value:
                return False
        return True

    def execute(self):
        matched = [r for r in self.rows if self._matches(r)]
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []))


@pytest.fixture
def fake_db():
    return _FakeSupabase()


def test_resolve_by_evaluation_status_pending_returns_not_in_small_reviewed_set(fake_db):
    """2026-11-27 hotfix: 'chua-danh-gia' la bucket MAC DINH (da gay 414 Request-URI Too
    Large tren production khi tra ve ~700 id de nhoi vao `.in_("id", ...)`), nen gio tra ve
    mode "not_in" tren tap NHO "da danh gia" (bo het full-table-scan `all_ids` cu)."""
    fake_db.store["post_quick_review"] = [
        {"post_id": "fb-1", "platform": "facebook", "evaluation_code": "can-lien-he"},
        # fb-2: khong co dong nao -> mac dinh chua-danh-gia
        {"post_id": "fb-3", "platform": "facebook", "evaluation_code": "chua-danh-gia"},
    ]

    mode, ids = svc._resolve_post_ids_by_evaluation_status(fake_db, "facebook_posts", "chua-danh-gia")

    assert mode == "not_in"
    assert sorted(ids) == ["fb-1"]
    assert "facebook_posts" not in fake_db.store  # khong con full-table-scan


def test_resolve_by_evaluation_status_explicit_codes(fake_db):
    fake_db.store["post_quick_review"] = [
        {"post_id": "fb-1", "platform": "facebook", "evaluation_code": "can-lien-he"},
        {"post_id": "fb-2", "platform": "facebook", "evaluation_code": "khong-phu-hop"},
        {"post_id": "li-1", "platform": "linkedin", "evaluation_code": "can-lien-he"},  # khac platform
    ]

    assert svc._resolve_post_ids_by_evaluation_status(fake_db, "facebook_posts", "can-lien-he") == ("in", ["fb-1"])
    assert svc._resolve_post_ids_by_evaluation_status(fake_db, "facebook_posts", "khong-phu-hop") == ("in", ["fb-2"])


def test_resolve_by_service_area_facebook_via_group_id_team(fake_db):
    fake_db.store["teams"] = [
        {"id": "team-a", "name_team": "Team Dev"},
        {"id": "team-b", "name_team": "Team Sale"},
    ]
    fake_db.store["facebook_groups"] = [
        {"id": "grp-dev", "id_team": "team-a"},
        {"id": "grp-sale", "id_team": "team-b"},
    ]
    fake_db.store["facebook_posts"] = [
        {"id": "fb-dev-1", "group_id": "grp-dev"},
        {"id": "fb-sale-1", "group_id": "grp-sale"},
    ]

    ids = svc._resolve_post_ids_by_service_area(fake_db, "facebook_posts", "Team Dev")

    assert ids == ["fb-dev-1"]


def test_resolve_by_service_area_threads_via_member_of_teams(fake_db):
    fake_db.store["teams"] = [{"id": "team-a", "name_team": "Team Dev"}]
    fake_db.store["member_of_teams"] = [
        {"id_member": "mem-1", "id_teams": "team-a"},
        {"id_member": "mem-2", "id_teams": "team-b"},
    ]
    fake_db.store["threads_posts"] = [
        {"id": "th-1", "id_member": "mem-1"},
        {"id": "th-2", "id_member": "mem-2"},
    ]

    ids = svc._resolve_post_ids_by_service_area(fake_db, "threads_posts", "Team Dev")

    assert ids == ["th-1"]


def test_resolve_by_service_area_unknown_team_returns_empty(fake_db):
    fake_db.store["teams"] = [{"id": "team-a", "name_team": "Team Dev"}]

    assert svc._resolve_post_ids_by_service_area(fake_db, "facebook_posts", "Khong Ton Tai") == []


# ── Unit test _execute_with_id_predicates (hotfix 414 lan 2) ────────────────────────────


class _StubQuery:
    """Khong con filter id gi ca - chi tra ve `rows` co san o .execute(), ghi lai moi call de
    kiem tra KHONG BAO GIO co .in_("id", ...)/.not_.in_("id", ...)."""

    def __init__(self, rows: list[dict], calls: list[tuple[str, tuple, dict]]):
        self._rows = rows
        self._calls = calls

    def execute(self):
        self._calls.append(("execute", (), {}))
        return _Result([dict(r) for r in self._rows], len(self._rows))

    def __getattr__(self, name: str):
        if name == "not_":
            self._calls.append(("not_", (), {}))
            return self

        def _method(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self
        return _method


def test_execute_with_id_predicates_no_predicate_uses_db_range_pagination():
    calls: list[tuple[str, tuple, dict]] = []
    rows = [{"id": "p1"}, {"id": "p2"}]
    query = _StubQuery(rows, calls)

    posts, total = svc._execute_with_id_predicates(query, [], page=1, page_size=50)

    assert posts == rows
    assert total == 2
    assert any(name == "range" for name, _a, _kw in calls)


def test_execute_with_id_predicates_in_mode_filters_and_paginates_in_python():
    calls: list[tuple[str, tuple, dict]] = []
    rows = [{"id": f"p{i}"} for i in range(1, 6)]  # p1..p5
    query = _StubQuery(rows, calls)

    posts, total = svc._execute_with_id_predicates(
        query, [("in", {"p2", "p4"})], page=1, page_size=1
    )

    assert total == 2  # chi p2, p4 khop
    assert posts == [{"id": "p2"}]  # trang 1, page_size=1 -> phan tu dau trong tap da loc
    # KHONG duoc co .range() (khong phan trang o DB nua) va KHONG duoc nhoi id vao .in_()/.not_.in_()
    assert not any(name == "range" for name, _a, _kw in calls)
    assert not any(
        name in ("in_", "not_in_") and args and args[0] == "id" for name, args, _kw in calls
    )


def test_execute_with_id_predicates_not_in_mode_excludes_matching_ids():
    calls: list[tuple[str, tuple, dict]] = []
    rows = [{"id": f"p{i}"} for i in range(1, 4)]  # p1, p2, p3
    query = _StubQuery(rows, calls)

    posts, total = svc._execute_with_id_predicates(
        query, [("not_in", {"p2"})], page=1, page_size=50
    )

    assert total == 2
    assert [p["id"] for p in posts] == ["p1", "p3"]


def test_execute_with_id_predicates_combines_multiple_predicates_with_and():
    rows = [{"id": f"p{i}"} for i in range(1, 6)]
    query = _StubQuery(rows, [])

    # p2..p4 thuoc "in" (vd service_area), nhung p3 bi loai boi "not_in" (vd evaluation_code)
    posts, total = svc._execute_with_id_predicates(
        query,
        [("in", {"p2", "p3", "p4"}), ("not_in", {"p3"})],
        page=1,
        page_size=50,
    )

    assert [p["id"] for p in posts] == ["p2", "p4"]
    assert total == 2


# ── Wiring test: _fetch_posts()/_fetch_keyword_posts() KHONG duoc nhoi id vao query ─────


class _RecordingQuery:
    """Tra ve chinh no cho moi method chain, ghi lai (ten method, args, kwargs); .execute()
    tra ve `rows` co san (gia lap ket qua DB da ap moi filter KHONG phai id)."""

    def __init__(self, calls: list[tuple[str, tuple, dict]], rows: list[dict]):
        self._calls = calls
        self._rows = rows

    def execute(self):
        self._calls.append(("execute", (), {}))
        return _Result([dict(r) for r in self._rows], len(self._rows))

    def __getattr__(self, name: str):
        if name == "not_":
            # supabase-py: `.not_` la PROPERTY (khong goi ()), tra ve chinh builder de
            # method filter KE TIEP (vd `.in_(...)`) bi phu dinh - khac moi method khac
            # o day deu la function call ghi lai args.
            self._calls.append(("not_", (), {}))
            return self

        def _method(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self
        return _method


class _RecordingSupabase:
    def __init__(self, calls: list[tuple[str, tuple, dict]], rows: list[dict]):
        self._calls = calls
        self._rows = rows

    def table(self, _name: str):
        return _RecordingQuery(self._calls, self._rows)


def _assert_no_id_list_filter(calls: list[tuple[str, tuple, dict]]) -> None:
    assert not any(
        name in ("in_", "not_in_") and args and args[0] == "id" for name, args, _kw in calls
    ), "Khong duoc nhoi id list vao .in_()/.not_.in_() cua query PostgREST (gay 414)"


def test_fetch_posts_facebook_applies_evaluation_code_and_service_area_filters(monkeypatch):
    rows = [{"id": "fb-1"}, {"id": "fb-2"}, {"id": "fb-3"}]
    calls: list[tuple[str, tuple, dict]] = []
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _RecordingSupabase(calls, rows))
    monkeypatch.setattr(svc, "_resolve_post_ids_by_evaluation_status", lambda sb, t, code: ("in", ["fb-1", "fb-2"]))
    monkeypatch.setattr(svc, "_resolve_post_ids_by_service_area", lambda sb, t, area: ["fb-1"])

    posts, total = svc._fetch_posts(
        table="facebook_posts",
        email="",
        sort="latest",
        page=1,
        page_size=50,
        evaluation_code="chua-danh-gia",
        service_area="Team Dev",
    )

    # evaluation_code khop fb-1/fb-2, service_area khop fb-1 -> giao nhau chi con fb-1
    assert [p["id"] for p in posts] == ["fb-1"]
    assert total == 1
    _assert_no_id_list_filter(calls)


def test_fetch_posts_facebook_not_in_mode_excludes_reviewed_posts_without_in_filter(monkeypatch):
    """Hotfix 2026-11-27 (lan 2): bucket 'chua-danh-gia' mac dinh - CA mode not_in (tap da
    danh gia) co the lon tuy du lieu thuc te (vd sau dot backfill auto-reject hang loat) nen
    tuyet doi KHONG duoc dua vao .in_()/.not_.in_() nua, chi loc bang Python sau fetch."""
    rows = [{"id": "fb-1"}, {"id": "fb-9"}]
    calls: list[tuple[str, tuple, dict]] = []
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _RecordingSupabase(calls, rows))
    monkeypatch.setattr(svc, "_resolve_post_ids_by_evaluation_status", lambda sb, t, code: ("not_in", ["fb-1"]))

    posts, total = svc._fetch_posts(
        table="facebook_posts",
        email="",
        sort="latest",
        page=1,
        page_size=50,
        evaluation_code="chua-danh-gia",
    )

    assert [p["id"] for p in posts] == ["fb-9"]
    assert total == 1
    _assert_no_id_list_filter(calls)


def test_fetch_keyword_posts_threads_applies_evaluation_code_and_service_area_filters(monkeypatch):
    rows = [{"id": "th-1"}, {"id": "th-2"}]
    calls: list[tuple[str, tuple, dict]] = []
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _RecordingSupabase(calls, rows))
    monkeypatch.setattr(svc, "_resolve_post_ids_by_evaluation_status", lambda sb, t, code: ("in", ["th-1"]))
    monkeypatch.setattr(svc, "_resolve_post_ids_by_service_area", lambda sb, t, area: ["th-1"])

    posts, total = svc._fetch_keyword_posts(
        table="threads_posts",
        email="",
        date_from=None,
        date_to=None,
        has_taxonomy_filter=False,
        id_member=None,
        search=None,
        sort="latest",
        page=1,
        page_size=50,
        evaluation_code="can-lien-he",
        service_area="Team Dev",
    )

    assert [p["id"] for p in posts] == ["th-1"]
    assert total == 1
    _assert_no_id_list_filter(calls)
