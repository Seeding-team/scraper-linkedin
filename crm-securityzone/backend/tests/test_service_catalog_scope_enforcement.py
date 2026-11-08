"""Tests Workspace isolation cho Service Catalog (isolation task 2026-10-14)
— ma tran R1–R15 trong Reports/CRM_SERVICE_CATALOG_FINAL_INVESTIGATION §10.

Khong cham DB that/cau hinh that: settings flag/instance monkeypatch,
Supabase fake (cung pattern FakeSupabase cua test_service_catalog_
workspace_assign), auth deps monkeypatch de di qua 401 (pattern auth test
hien co chi check 401; day them override user de biet 403/200 co dung
semantics khong).
"""
from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from app.core import config as app_config
from app.main import app
from app.modules.all_platform import auth_deps
from app.modules.all_platform.services import supabase_service_catalog_service as catalog

# Ten workspace Rieng CUA CLONE NAY (doi khi propagate sang clone khac).
OWN_INSTANCE = "securityzone"

BASE_PATH = "/api/all-platform/service-catalog"


# ─────────────────────────────────────────────────────────────────────────────
# Fakes (copy pattern tu test_service_catalog_workspace_assign.py)
# ─────────────────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self._db, self._table = db, table
        self.op, self.payload = "select", None
        self.filters, self._limit = [], None
        self._single = False

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op, self.payload = "delete", None
        return self

    def eq(self, col, value):
        self.filters.append(("eq", col, value))
        return self

    def in_(self, col, values):
        self.filters.append(("in", col, list(values)))
        return self

    def is_(self, col, value):
        self.filters.append(("is", col, value))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def maybe_single(self):
        self._single = True
        return self

    def _match(self, row):
        for kind, col, value in self.filters:
            if kind == "eq" and row.get(col) != value:
                return False
            if kind == "in" and row.get(col) not in value:
                return False
            if kind == "is":
                # PostgREST: .is_(col, "null") nghia la NULL (None)
                current = row.get(col or "")
                expected: object = None if value in ("null", None) else value
                if current is not expected and current != expected:
                    return False
        return True

    def execute(self):
        rows = self._db.setdefault(self._table, [])
        if self.op == "insert":
            payload = self.payload if isinstance(self.payload, list) else [self.payload]
            inserted = []
            import uuid as _uuid

            for item in payload:
                row = dict(copy.deepcopy(item))
                row.setdefault("id", str(_uuid.uuid4()))  # DB gen uuid
                self._db.setdefault(self._table, []).append(row)
                inserted.append(dict(row))
            return _Result(inserted)
        if self.op == "update":
            updated = []
            for row in rows:
                if self._match(row):
                    row.update(copy.deepcopy(self.payload))
                    updated.append(dict(row))
            return _Result(updated)
        if self.op == "delete":
            kept = [row for row in rows if not self._match(row)]
            self._db[self._table] = rows = kept
            return _Result([])
        result = [dict(row) for row in rows if self._match(row)]
        if self._limit is not None:
            result = result[: self._limit]
        if self._single:
            # giong Supabase: maybe_single() tra 1 row (dict) hoac None
            return _Result(result[0] if result else None)
        return _Result(result)


class FakeSupabase:
    def __init__(self):
        self.db: dict[str, list] = {}

    def table(self, name):
        return _Query(self.db, name)


def _seed_catalog_items(db: FakeSupabase) -> None:
    """4 item: own (junction cloudgate), foreign (markee), junction-wins
    (legacy cloudgate nhung junction markee → OUT), adopted (junction-only
    cloudgate → IN scope)."""
    db.db["service_catalog_items"] = [
        {"id": "own-1", "item_type": "group", "parent_id": None, "instance": "securityzone", "name": "Own", "sort_order": 0, "status": "active"},
        # foreign: legacy markee + junction markee (thuoc workspace khac)
        {"id": "foreign-1", "item_type": "group", "parent_id": None, "instance": "markee", "name": "Foreign", "sort_order": 1, "status": "active"},
        # junction-wins: legacy cloudgate NHUNG junction chi markee → OUT of scope
        {"id": "moved-1", "item_type": "group", "parent_id": None, "instance": "securityzone", "name": "Moved", "sort_order": 2, "status": "active"},
        # junction-only: legacy markee NHUNG junction cloudgate → IN scope
        {"id": "adopted-1", "item_type": "component", "parent_id": "own-1", "instance": "markee", "name": "Adopted", "sort_order": 0, "status": "active"},
    ]
    db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "own-1", "instance": "securityzone"},
        {"item_id": "foreign-1", "instance": "markee"},
        {"item_id": "moved-1", "instance": "markee"},
        {"item_id": "adopted-1", "instance": "securityzone"},
    ]


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(catalog, "get_supabase_client", lambda: db)
    return db


@pytest.fixture
def enforce_own(monkeypatch):
    """Flag ON + instance cua clone nay (plain-field clone: cloudgate/
    securityzone/timetech; crm-module property doc contextvar — o clone do
    fixture patch `default_crm_instance`)."""
    monkeypatch.setattr(app_config.settings, "catalog_scope_enforced", True)
    monkeypatch.setattr(app_config.settings, "crm_instance", OWN_INSTANCE)


@pytest.fixture
def enforcement_off(monkeypatch):
    monkeypatch.setattr(app_config.settings, "catalog_scope_enforced", False)


@pytest.fixture
def authorized_admin(monkeypatch):
    monkeypatch.setattr(auth_deps, "decode_token", lambda token: {"sub": "11111111-1111-1111-1111-111111111111"})
    monkeypatch.setattr(auth_deps, "get_user_by_id", lambda user_id: {"id": user_id, "role": "admin", "is_active": True})
    return {"id": "11111111-1111-1111-1111-111111111111", "role": "admin", "is_active": True}


AUTH_HEADERS = {"Authorization": "Bearer test-token"}
client = TestClient(app)


# ─────────────────────────────────────────────────────────────────────────────
# Scope helpers (service-level)
# ─────────────────────────────────────────────────────────────────────────────


def test_floor_none_when_flag_off(enforcement_off):
    assert catalog._catalog_scope_floor() is None
    assert catalog.enforce_catalog_scope_floor(["markee", "securityzone"]) == ["markee", "securityzone"]
    assert catalog.enforce_catalog_scope_floor(None) is None


def test_floor_raised_when_flag_on_but_instance_missing(monkeypatch):
    monkeypatch.setattr(app_config.settings, "catalog_scope_enforced", True)
    monkeypatch.setattr(app_config.settings, "crm_instance", "  ")
    with pytest.raises(RuntimeError, match="fail-closed"):
        catalog._catalog_scope_floor()


def test_floor_normalizes_case(enforce_own, monkeypatch):
    monkeypatch.setattr(app_config.settings, "crm_instance", " SECURITYZONE ")
    assert catalog._catalog_scope_floor() == ["securityzone"]


def test_enforce_floor_intersection_never_expands(enforce_own):
    assert catalog.enforce_catalog_scope_floor(None) == ["securityzone"]
    assert catalog.enforce_catalog_scope_floor([]) == ["securityzone"]
    # client hoi own + foreign → chi own (khong mo rong)
    assert catalog.enforce_catalog_scope_floor(["securityzone", "markee"]) == ["securityzone"]
    # client CHI hoi foreign → giao rong (router phai tra cay rong, 200)
    assert catalog.enforce_catalog_scope_floor(["markee"]) == []
    assert catalog.enforce_catalog_scope_floor(["markeee"]) == []


# ─────────────────────────────────────────────────────────────────────────────
# item_in_scope / ensure_catalog_items_in_scope: junction precedence + fallback
# ─────────────────────────────────────────────────────────────────────────────


def test_item_scope_junction_wins_over_legacy(fake_db, enforce_own):
    _seed_catalog_items(fake_db)
    rows = fake_db.db["service_catalog_items"]
    by_id = {r["id"]: r for r in rows}
    assert catalog.item_in_scope(fake_db, by_id["own-1"], ["securityzone"]) is True
    assert catalog.item_in_scope(fake_db, by_id["foreign-1"], ["securityzone"]) is False
    # legacy cloudgate nhung junction chi markee → JUNCTION thang, khong con
    # nam trong scope (khong fallback legacy khi co junction)
    assert catalog.item_in_scope(fake_db, by_id["moved-1"], ["securityzone"]) is False


def test_item_scope_legacy_fallback_only_without_junction(fake_db, enforce_own):
    db = fake_db
    # khong junction row nao: ownership = legacy instance
    db.db["service_catalog_items"] = [
        {"id": "legacy-own", "item_type": "group", "instance": "securityzone"},
        {"id": "legacy-foreign", "item_type": "group", "instance": "markee"},
    ]
    db.db[catalog.WORKSPACES_TABLE] = []
    by_id = {r["id"]: r for r in db.db["service_catalog_items"]}
    assert catalog.item_in_scope(db, by_id["legacy-own"], ["securityzone"]) is True
    assert catalog.item_in_scope(db, by_id["legacy-foreign"], ["securityzone"]) is False


def test_multi_workspace_group_in_scope_for_both(fake_db):
    """R8: nhom multi-workspace {securityzone, markee} hop le cho CA 2 clone
    (fail-closed floor nhan set hitting intersection, khong blocked)."""
    db = fake_db
    db.db["service_catalog_items"] = [
        {"id": "shared-1", "item_type": "group", "instance": "securityzone"}
    ]
    db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "shared-1", "instance": "securityzone"},
        {"item_id": "shared-1", "instance": "markee"},
    ]
    assert catalog.item_in_scope(db, db.db["service_catalog_items"][0], ["securityzone"]) is True
    assert catalog.item_in_scope(db, db.db["service_catalog_items"][0], ["markee"]) is True
    assert catalog.item_in_scope(db, db.db["service_catalog_items"][0], ["cloudgate"]) is False


def test_ensure_items_scope_raises_403_on_foreign(fake_db, enforce_own):
    _seed_catalog_items(fake_db)
    catalog.ensure_catalog_items_in_scope(["own-1"])  # ok
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        catalog.ensure_catalog_items_in_scope(["own-1", "foreign-1"])
    assert exc.value.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Review round 2: service-level fail-closed (MSC/vendor path bypass router)
# ─────────────────────────────────────────────────────────────────────────────


def test_create_service_item_rejects_foreign_parent_at_service_level(fake_db, enforce_own):
    """Vendor import approve tạo con vào nhóm markee (plain call, không qua
    router) phải bị chặn ở chính service layer."""
    _seed_catalog_items(fake_db)
    with pytest.raises(ValueError, match="Nhom cha thuoc workspace khac"):
        catalog.create_service_catalog_item(
            {"item_type": "component", "parent_id": "foreign-1", "name": "X"}, None
        )


def test_create_service_item_rejects_foreign_instance_request(fake_db, enforce_own):
    _seed_catalog_items(fake_db)
    with pytest.raises(ValueError, match="workspace khác"):
        catalog.create_service_catalog_item(
            {"item_type": "group", "name": "X", "instance": "markee"}, None
        )


def test_update_service_item_rejects_foreign_target_at_service_level(fake_db, enforce_own):
    _seed_catalog_items(fake_db)
    with pytest.raises(ValueError, match="workspace khac"):
        catalog.update_service_catalog_item("foreign-1", {"name": "Hack"}, None)


def test_update_shared_item_assignment_rejected_when_outside_floor(fake_db, enforce_own):
    """Item chia sẻ {cloudgate, markee}: clone cloudgate KHONG được gỡ
    assignment của markee (replace-all)."""
    db = fake_db
    db.db["service_catalog_items"] = [
        {"id": "shared-1", "item_type": "group", "instance": "securityzone", "name": "Shared"},
    ]
    db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "shared-1", "instance": "securityzone"},
        {"item_id": "shared-1", "instance": "markee"},
    ]
    with pytest.raises(ValueError, match="workspace khác"):
        catalog.update_service_catalog_item("shared-1", {"instance": "securityzone"}, None)


def test_update_nonshared_item_own_instance_ok(fake_db, enforce_own):
    """Item CHI thuoc floor (junction chỉ cloudgate) vẫn sửa instance bình thường."""
    _seed_catalog_items(fake_db)
    out = catalog.update_service_catalog_item("own-1", {"name": "Own Renamed", "instance": "securityzone"}, None)
    assert out["name"] == "Own Renamed"


def test_list_drops_floating_children_of_out_of_scope_parents(fake_db, enforce_own):
    """Con tự match floor nhưng nhóm cha bị loại → con phải bị drop, không
    trở thành floating root."""
    db = fake_db
    db.db["service_catalog_items"] = [
        {"id": "p-foreign-parent", "item_type": "group", "parent_id": None, "instance": "markee", "name": "ForeignParent", "sort_order": 0},
        # con 'legacy cloudgate' của nhóm cha markee (không junction riêng)
        {"id": "child-float", "item_type": "component", "parent_id": "p-foreign-parent", "instance": "securityzone", "name": "Float", "sort_order": 0},
    ]
    db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "p-foreign-parent", "instance": "markee"},
    ]
    roots = catalog.list_service_catalog_items_scoped(None)
    ids = {i["id"] for i in roots}
    assert ids == set(), "floating child phải bị drop (không thành root)"


def test_list_pricing_rows_foreign_issuer_hidden(fake_db, enforce_own):
    db = fake_db
    db.db["service_catalog_items"] = [
        {"id": "own-1", "item_type": "group", "instance": "securityzone", "name": "Own"},
    ]
    db.db["service_catalog_item_pricing"] = [
        {"id": "row-default", "service_catalog_item_id": "own-1", "issuer_company_id": None, "default_customer_price_vnd": 100},
        {"id": "row-own-issuer", "service_catalog_item_id": "own-1", "issuer_company_id": "issuer-own", "default_customer_price_vnd": 150},
        {"id": "row-foreign-issuer", "service_catalog_item_id": "own-1", "issuer_company_id": "issuer-foreign", "default_customer_price_vnd": 999},
    ]
    db.db["quote_issuer_companies"] = [
        {"id": "issuer-own", "instance": "securityzone"},
        {"id": "issuer-foreign", "instance": "markee"},
    ]
    rows = catalog.list_service_catalog_item_pricing("own-1")
    returned_ids = {r["id"] for r in rows}
    assert returned_ids == {"row-default", "row-own-issuer"}


# ─────────────────────────────────────────────────────────────────────────────
# API ma tran: list/lookup/pricing/update/delete/reorder/components/links/assign
# ─────────────────────────────────────────────────────────────────────────────


def test_api_list_scoped_own_without_instances(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.get(f"{BASE_PATH}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    ids = [item["id"] for item in body["data"]]
    assert ids == ["own-1"]  # khong co foreign/moved
    # con `adopted-1` (junction-only) van hien trong children cua own-1
    child_ids = [c["id"] for c in body["data"][0]["children"]]
    assert child_ids == ["adopted-1"]


def test_api_list_intersection_empty_returns_200_empty_tree(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.get(f"{BASE_PATH}?instances=markeee,markee", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"] == []


def test_api_list_intersection_prevents_widening(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.get(f"{BASE_PATH}?instances=securityzone,markee", headers=AUTH_HEADERS)
    body = response.json()
    ids = [item["id"] for item in body["data"]]
    # foreign-1 (markee) KHONG bao gio xuat hien
    assert "foreign-1" not in ids
    assert "moved-1" not in ids
    assert ids == ["own-1"]


def test_api_list_flag_off_passthrough_keeps_old_behavior(fake_db, enforcement_off, authorized_admin):
    _seed_catalog_items(fake_db)
    # None → khong filter (hanh vi cu): roots = own-1, foreign-1, moved-1
    response = client.get(f"{BASE_PATH}", headers=AUTH_HEADERS)
    roots = {item["id"] for item in response.json()["data"]}
    assert roots == {"own-1", "foreign-1", "moved-1"}  # adopted-1 la con cua own-1
    # client filter respected (hanh vi cu): instances=markee →
    # legacy match = foreign-1 + adopted-1; junction union them moved-1
    response = client.get(f"{BASE_PATH}?instances=markee", headers=AUTH_HEADERS)
    roots = {item["id"] for item in response.json()["data"]}
    assert roots == {"foreign-1", "moved-1", "adopted-1"}


def test_api_lookup_foreign_id_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.get(f"{BASE_PATH}/lookup?ids=foreign-1", headers=AUTH_HEADERS)
    assert response.status_code == 403


def test_api_lookup_own_and_mixed_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    ok = client.get(f"{BASE_PATH}/lookup?ids=own-1", headers=AUTH_HEADERS)
    assert ok.status_code == 200
    mixed = client.get(f"{BASE_PATH}/lookup?ids=own-1,foreign-1", headers=AUTH_HEADERS)
    assert mixed.status_code == 403


def test_api_pricing_get_foreign_item_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.get(f"{BASE_PATH}/foreign-1/pricing", headers=AUTH_HEADERS)
    assert response.status_code == 403


def test_api_pricing_get_own_item_allowed(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.get(f"{BASE_PATH}/own-1/pricing", headers=AUTH_HEADERS)
    assert response.status_code == 200


def test_api_pricing_put_foreign_issuer_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    fake_db.db["quote_issuer_companies"] = [
        {"id": "issuer-own", "instance": "securityzone"},
        {"id": "issuer-foreign", "instance": "markee"},
    ]
    ok = client.put(
        f"{BASE_PATH}/own-1/pricing",
        json={"issuer_company_id": "issuer-own", "default_customer_price_vnd": 100, "pricing_input_mode": "customer_price"},
        headers=AUTH_HEADERS,
    )
    assert ok.status_code == 200
    denied = client.put(
        f"{BASE_PATH}/own-1/pricing",
        json={"issuer_company_id": "issuer-foreign", "default_customer_price_vnd": 100, "pricing_input_mode": "customer_price"},
        headers=AUTH_HEADERS,
    )
    assert denied.status_code == 403


def test_api_pricing_put_foreign_item_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.put(
        f"{BASE_PATH}/foreign-1/pricing",
        json={"issuer_company_id": None, "default_customer_price_vnd": 100, "pricing_input_mode": "customer_price"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_update_foreign_item_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.put(
        f"{BASE_PATH}/update",
        json={"id": "foreign-1", "name": "Hack"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_update_move_to_foreign_instance_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.put(
        f"{BASE_PATH}/update",
        json={"id": "own-1", "instance": "markee", "name": "Own"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403
    own = client.put(
        f"{BASE_PATH}/update",
        json={"id": "own-1", "instance": "securityzone", "name": "Own"},
        headers=AUTH_HEADERS,
    )
    assert own.status_code == 200


def test_api_update_reparent_into_foreign_group_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.put(
        f"{BASE_PATH}/update",
        json={"id": "own-1", "parent_id": "foreign-1"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_delete_foreign_item_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.delete(f"{BASE_PATH}/delete?id=foreign-1", headers=AUTH_HEADERS)
    assert response.status_code == 403


def test_api_delete_own_item_allowed(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.delete(f"{BASE_PATH}/delete?id=adopted-1", headers=AUTH_HEADERS)
    assert response.status_code == 200


def test_api_reorder_foreign_item_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.put(
        f"{BASE_PATH}/reorder",
        json={"id": "foreign-1", "direction": "up"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_bundle_components_bundle_owned_components_may_cross(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    db = fake_db
    # bundle own-2 thuoc cloudgate; component foreign-1 thuoc markee → hop le
    db.db["service_catalog_items"].append(
        {"id": "bundle-own", "item_type": "bundle", "instance": "securityzone", "name": "Bundle", "sort_order": 3, "status": "active"}
    )
    db.db[catalog.WORKSPACES_TABLE].append({"item_id": "bundle-own", "instance": "securityzone"})
    response = client.put(
        f"{BASE_PATH}/bundle-own/components",
        json={"items": [{"component_id": "foreign-1", "quantity": 1}]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_api_bundle_components_foreign_bundle_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    db = fake_db
    db.db["service_catalog_items"].append(
        {"id": "bundle-foreign", "item_type": "bundle", "instance": "markee", "name": "Bundle F", "sort_order": 4, "status": "active"}
    )
    db.db[catalog.WORKSPACES_TABLE].append({"item_id": "bundle-foreign", "instance": "markee"})
    response = client.put(
        f"{BASE_PATH}/bundle-foreign/components",
        json={"items": [{"component_id": "own-1", "quantity": 1}]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# workspaces-assign DISABLED trong clone (approved) — 403 du (JWT + role dung)
# ─────────────────────────────────────────────────────────────────────────────


def test_api_workspaces_assign_disabled_even_for_authorized_admin(fake_db, enforce_own, authorized_admin):
    response = client.post(
        f"{BASE_PATH}/workspaces-assign",
        json={"group_ids": ["own-1"], "instances": [OWN_INSTANCE]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_workspaces_assign_disabled_when_flag_off_too(fake_db, enforcement_off, authorized_admin):
    """Endpoint TẮT CỨNG ở clone (không phụ thuộc flag enforcement)."""
    response = client.post(
        f"{BASE_PATH}/workspaces-assign",
        json={"group_ids": ["own-1"], "instances": [OWN_INSTANCE]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_workspaces_assign_requires_auth(fake_db):
    response = client.post(
        f"{BASE_PATH}/workspaces-assign",
        json={"group_ids": ["own-1"], "instances": [OWN_INSTANCE]},
    )
    assert response.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# Quote-form catalog-links: catalog_item_ids phai thuoc floor
# ─────────────────────────────────────────────────────────────────────────────


def test_api_quote_form_catalog_links_foreign_item_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    response = client.put(
        "/api/all-platform/quote-forms/form-1/catalog-links",
        json={"catalog_item_ids": ["foreign-1"]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_quote_form_catalog_links_own_ok(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    fake_db.db["quote_form_catalog_links"] = []
    response = client.put(
        "/api/all-platform/quote-forms/form-1/catalog-links",
        json={"catalog_item_ids": ["own-1"]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


# ─────────────────────────────────────────────────────────────────────────────
# Pricing: draft quote-picker issuer (client-supplied) phai thuoc floor
# ─────────────────────────────────────────────────────────────────────────────


def test_api_list_draft_picker_foreign_issuer_denied(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    fake_db.db["quote_issuer_companies"] = [
        {"id": "issuer-foreign", "instance": "markee", "status": "active"}
    ]
    response = client.get(
        f"{BASE_PATH}?context=quote_picker&issuer_company_id=issuer-foreign",
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_api_list_draft_picker_own_issuer_ok(fake_db, enforce_own, authorized_admin):
    _seed_catalog_items(fake_db)
    fake_db.db["quote_issuer_companies"] = [
        {"id": "issuer-own", "instance": "securityzone", "status": "active"}
    ]
    response = client.get(
        f"{BASE_PATH}?context=quote_picker&issuer_company_id=issuer-own",
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# Boot validation (fail-fast config)
# ─────────────────────────────────────────────────────────────────────────────


def test_boot_validation_fails_when_flag_on_without_instance(monkeypatch):
    monkeypatch.setenv("CRM_INSTANCE", "   ")
    monkeypatch.setattr(app_config.settings, "catalog_scope_enforced", True)
    with pytest.raises(RuntimeError, match="CRM_INSTANCE must be set"):
        app_config._validate_catalog_scope_enforcement(app_config.settings)


def test_boot_validation_fails_flag_off_without_instance(monkeypatch):
    """Flag OFF + không CRM_INSTANCE: khong fail (hanh vi cu, MAIN-compat)."""
    monkeypatch.setenv("CRM_INSTANCE", "")
    monkeypatch.setattr(app_config.settings, "catalog_scope_enforced", False)
    app_config._validate_catalog_scope_enforcement(app_config.settings)


def test_boot_validation_ok_when_flag_on_with_instance(monkeypatch, enforce_own):
    monkeypatch.setenv("CRM_INSTANCE", OWN_INSTANCE)
    app_config._validate_catalog_scope_enforcement(app_config.settings)
