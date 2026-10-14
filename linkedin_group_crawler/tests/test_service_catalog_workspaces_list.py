"""Tests nguon du lieu CARD WORKSPACE tren trang Product & Services (Issue B
task 2026-10-15): `list_available_workspaces` — endpoint
`GET /api/all-platform/service-catalog/workspaces` — phai sinh duoc entry cho
MỌI workspace duoc dang ky qua 2 con duong hien co (issuer row active /phan
cong workspace trong catalog), KHONG co allowlist hard-code.

TimeTech (instance=timetech) duoc dung lam workspace thu 4 de chung minh renderer
du lieu da total dynamic: chi can DATA dang ky/so huu (ngoai pham vi task nay —
KHONG ghi DB that) la card tu xuat hien, theo DUNG contract
{instance_key, code, name, total_groups} ma `ServiceCatalogPage.tsx`
(workspaceCards.map → sc-ws-card) tien render.

Khong cham DB that — FakeSupabase mini (pattern tests/test_service_catalog_
workspace_assign.py).
"""
from __future__ import annotations

import copy

import pytest

from app.modules.all_platform.services import supabase_service_catalog_service as catalog


# ─────────────────────────────────────────────────────────────────────────────
# Fake Supabase mini (chi cac op mà list_available_workspaces dung)
# ─────────────────────────────────────────────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self._db, self._table = db, table
        self.filters = []

    def select(self, *_a, **_k):
        return self

    def eq(self, col, value):
        self.filters.append(("eq", col, value))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _match(self, row):
        for kind, col, value in self.filters:
            if kind == "eq" and row.get(col) != value:
                return False
        return True

    def execute(self):
        rows = self._db.setdefault(self._table, [])
        return _Result([dict(r) for r in rows if self._match(r)])


class FakeSupabase:
    def __init__(self):
        self.db: dict[str, list] = {}

    def table(self, name):
        return _Query(self.db, name)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures du lieu (gia lap — KHONG ghi DB that)
# ─────────────────────────────────────────────────────────────────────────────

# Hien trang prod-like: 3 issuer duoc seed tu migration 069, ca 3 deu bi
# backfill instance='markee' (default cua migration 001) — ban do
# code_to_instance (mk/cg/sz) la thu quy chuan hoa ve dung instance_key.
ISSUERS_3 = [
    {"id": "c1", "code": "SZ", "legal_name": "SecurityZone", "brand_name": None, "instance": "markee", "status": "active"},
    {"id": "c2", "code": "CG", "legal_name": "CÔNG TY TNHH CLOUDGATE", "brand_name": None, "instance": "markee", "status": "active"},
    {"id": "c3", "code": "MK", "legal_name": "MARKEE AI", "brand_name": None, "instance": "markee", "status": "active"},
]

ISSUER_TIMETECH = {
    "id": "c4",
    "code": "TT",
    "legal_name": "TimeTech JSC",
    "brand_name": "TimeTech",
    "instance": "timetech",  # DANG KY DUNG instance (khong rely vao backfill 'markee')
    "status": "active",
}


def _seed(db: FakeSupabase, issuers, groups, junction):
    db.db["quote_issuer_companies"] = copy.deepcopy(issuers)
    db.db[catalog.ITEMS_TABLE] = copy.deepcopy(groups)
    db.db[catalog.WORKSPACES_TABLE] = copy.deepcopy(junction)


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(catalog, "get_supabase_client", lambda: db)
    return db


def _keys(result):
    return {w["instance_key"] for w in result}


# ─────────────────────────────────────────────────────────────────────────────
# 1. Hien trang (khong co du lieu TimeTech) → dung 3 card, khong luu
#    (hanh vi nay la ly do card TimeTech chua xuat hien — thieu DATA, khong
#     phai thieu code; xem Reports/CRM_QUOTE_..._DEEP_INVESTIGATION §7-8)
# ─────────────────────────────────────────────────────────────────────────────


def test_current_state_three_cards_no_timetech(fake_db):
    _seed(
        fake_db,
        ISSUERS_3,
        [{"id": "g1", "instance": "markee", "item_type": "group"},
         {"id": "g2", "instance": "cloudgate", "item_type": "group"}],
        [{"item_id": "g1", "instance": "markee"}, {"item_id": "g2", "instance": "cloudgate"}],
    )
    result = catalog.list_available_workspaces()
    assert _keys(result) == {"markee", "cloudgate", "securityzone"}
    assert "timetech" not in _keys(result)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Con duong A — issuer row active voi instance='timetech' → card xuat hien
#    theo DUNG contract renderer dung
# ─────────────────────────────────────────────────────────────────────────────


def test_active_issuer_timetech_produces_card_entry(fake_db):
    _seed(fake_db, ISSUERS_3 + [ISSUER_TIMETECH], [], [])
    result = catalog.list_available_workspaces()
    tt = [w for w in result if w["instance_key"] == "timetech"]
    assert len(tt) == 1
    card = tt[0]
    # Renderer (ServiceCatalogPage workspaceCards.map) doc dung 4 field nay:
    assert set(card.keys()) == {"instance_key", "code", "name", "total_groups"}
    assert card["code"] == "TT"
    assert card["name"] == "TimeTech"          # brand_name → legal_name → code
    assert card["total_groups"] == 0           # issuer chua co group van co card
    # 3 card cu khong bi anh huong (regression):
    assert _keys(result) == {"markee", "cloudgate", "securityzone", "timetech"}


def test_inactive_issuer_timetech_is_excluded(fake_db):
    inactive = dict(ISSUER_TIMETECH, status="inactive")
    _seed(fake_db, ISSUERS_3 + [inactive], [], [])
    assert "timetech" not in _keys(catalog.list_available_workspaces())


# ─────────────────────────────────────────────────────────────────────────────
# 3. Con duong B — khong can issuer row: chi can catalog duoc gan workspace
#    (junction hoac legacy instance) → dynamic discovery bo sung card
# ─────────────────────────────────────────────────────────────────────────────


def test_junction_assignment_discovers_timetech_without_issuer(fake_db):
    _seed(
        fake_db,
        ISSUERS_3,
        [{"id": "g9", "instance": "markee", "item_type": "group"}],
        [{"item_id": "g9", "instance": "timetech"}],  # gan workspace qua junction (migration 190)
    )
    result = catalog.list_available_workspaces()
    tt = [w for w in result if w["instance_key"] == "timetech"]
    assert len(tt) == 1
    assert tt[0]["total_groups"] == 1
    assert set(tt[0].keys()) == {"instance_key", "code", "name", "total_groups"}
    # Group bi gan junction cho timetech KHONG con dem cho markee (junction wins):
    mk = [w for w in result if w["instance_key"] == "markee"]
    assert mk and mk[0]["total_groups"] == 0


def test_legacy_instance_column_discovers_timetech(fake_db):
    _seed(
        fake_db,
        ISSUERS_3,
        [{"id": "g9", "instance": "timetech", "item_type": "group"}],  # legacy column, khong junction
        [],
    )
    result = catalog.list_available_workspaces()
    tt = [w for w in result if w["instance_key"] == "timetech"]
    assert len(tt) == 1 and tt[0]["total_groups"] == 1


# ─────────────────────────────────────────────────────────────────────────────
# 4. Data trap da duoc audit canh bao: issuer row code='TT' nhung instance bi
#    backfill 'markee' (migration 001 default) + 'tt' KHONG co trong map
#    code_to_instance → issuer path ghep ve markee (merged); card TimeTech
#    chi bao chay khi hoac instance='timetech' duoc set dung, hoac co catalog
#    assignment (dynamic discovery o test 3 tu bo sung).
# ─────────────────────────────────────────────────────────────────────────────


def test_issuer_with_backfilled_markee_instance_needs_catalog_or_correct_instance(fake_db):
    trap = dict(ISSUER_TIMETECH, instance="markee")
    _seed(fake_db, ISSUERS_3 + [trap], [], [])
    result = catalog.list_available_workspaces()
    assert "timetech" not in _keys(result)  # merged ve markee — dung nhu thiet ke map
    # ...va ngay khi co 1 group gan junction timetech, card quay lai du/dung contract:
    _seed(
        fake_db,
        ISSUERS_3 + [trap],
        [{"id": "g9", "instance": "markee", "item_type": "group"}],
        [{"item_id": "g9", "instance": "timetech"}],
    )
    result2 = catalog.list_available_workspaces()
    tt = [w for w in result2 if w["instance_key"] == "timetech"]
    assert len(tt) == 1 and tt[0]["total_groups"] == 1
