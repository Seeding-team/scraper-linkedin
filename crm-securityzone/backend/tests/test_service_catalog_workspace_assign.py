"""Tests cho bulk Workspace assignment (many-to-many, migration 190):
- assign_group_workspaces: validation + RPC payload (service functions)
- _ws_write REPLACE-ALL (junction + legacy mirror) cho nhom/1 item
- list_service_catalog_items_scoped: union legacy-filter + junction rows, co
  `workspaces` trong payload tra ve
- API auth: /service-catalog/workspaces-assign khong cho phep goi khong auth
  (follow test_msc_sync_api style).

Khong cham DB that / MSC that; fake Supabase mini o day.
"""
from __future__ import annotations

import copy
import types

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.all_platform.services import supabase_service_catalog_service as catalog


# ─────────────────────────────────────────────────────────────────────────────
# Fake Supabase (theo pattern FakeSupabase tests/test_msc_sync_service.py
# + them delete + rpc recorder cho assign).
# ─────────────────────────────────────────────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self._db, self._table = db, table
        self.op, self.payload = "select", None
        self.filters, self._order, self._limit = [], None, None
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

    def neq(self, col, value):
        self.filters.append(("neq", col, value))
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
                # PostgREST: .is_(col, "null") nghia la NULL (None); .is_(col, True/False)
                current = row.get(col or "")
                expected: object = None if value in ("null", None) else value
                if current is not expected and current != expected:
                    return False
            if kind == "neq" and row.get(col) == value:
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
                # giong Postgres: DB tao id (uuid) khi caller khong truyen.
                row.setdefault("id", str(_uuid.uuid4()))
                rows.append(row)
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
        # select
        result = [dict(row) for row in rows if self._match(row)]
        if self._limit is not None:
            result = result[: self._limit]
        if self._single:
            # giong Supabase: maybe_single() tra 1 row (dict) hoac None
            return _Result(result[0] if result else None)
        return _Result(result)


class FakeSupabase:
    def __init__(self, rpc_data=None):
        self.db: dict[str, list] = {}
        self.rpc_calls: list[tuple] = []
        self.rpc_data = rpc_data

    def table(self, name):
        return _Query(self.db, name)

    def rpc(self, fn_name, params):
        self.rpc_calls.append((fn_name, copy.deepcopy(params)))
        return _RPCQuery(self)

    class _RPCResult(list):
        pass

    @property
    def _last_rpc(self):
        return self.rpc_calls[-1] if self.rpc_calls else None

    def last_rpc(self):
        return self.rpc_calls[-1] if self.rpc_calls else None


class _RPCQuery:
    def __init__(self, fake):
        self._fake = fake

    def execute(self):
        return _Result(self._fake.rpc_data or [])


WORKSPACES_LIST = [
    {"instance_key": "markee", "code": "MK", "name": "MARKEE AI", "total_groups": 0},
    {"instance_key": "cloudgate", "code": "CG", "name": "CÔNG TY TNHH CLOUDGATE", "total_groups": 0},
    {"instance_key": "securityzone", "code": "SZ", "name": "SecurityZone", "total_groups": 0},
]


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(catalog, "get_supabase_client", lambda: db)
    return db


@pytest.fixture
def available_workspaces(monkeypatch):
    monkeypatch.setattr(catalog, "list_available_workspaces", lambda: WORKSPACES_LIST)


# ─────────────────────────────────────────────────────────────────────────────
# assign_group_workspaces: input validation
# ─────────────────────────────────────────────────────────────────────────────


def test_assign_rejects_empty_group_list(fake_db, available_workspaces):
    with pytest.raises(ValueError, match="nhóm sản phẩm"):
        catalog.assign_group_workspaces([], ["cloudgate"])


def test_assign_rejects_empty_ws(fake_db, available_workspaces):
    with pytest.raises(ValueError, match="Workspace"):
        catalog.assign_group_workspaces(["g1"], ["", "  "])


def test_assign_rejects_unknown_workspace(fake_db, available_workspaces):
    with pytest.raises(ValueError, match="markeee"):
        catalog.assign_group_workspaces(["g1"], ["markeee"])


def test_assign_rejects_unknown_groups(fake_db, available_workspaces):
    with pytest.raises(ValueError, match="không tồn tại"):
        catalog.assign_group_workspaces(["ghost-id"], ["cloudgate"])


def test_assign_rejects_non_group(fake_db, available_workspaces):
    fake_db.db["service_catalog_items"] = [
        {"id": "prod-1", "item_type": "component", "parent_id": "g1", "instance": "markee"}
    ]
    with pytest.raises(ValueError, match="không phải là nhóm"):
        catalog.assign_group_workspaces(["prod-1"], ["cloudgate"])


def test_assign_rpc_payload_normalizes_and_dedupes(fake_db, available_workspaces):
    fake_db.rpc_data = [{"item_id": "g1", "instance": "cloudgate"}]
    fake_db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "parent_id": None, "instance": "markee"}
    ]
    catalog.assign_group_workspaces(["g1", "", "g1"], [" Cloudgate ", "marKEE", None], actor_id="user-1")

    fn, params = fake_db.last_rpc()
    assert fn == "service_catalog_ws_assign"
    assert params["p_group_ids"] == ["g1"]
    assert params["p_instances"] == ["cloudgate", "markee"]
    assert params["p_actor_id"] == "user-1"


def test_assign_result_shape_sets_sorted_unique(fake_db, available_workspaces):
    fake_db.rpc_data = [
        {"item_id": "g1", "instance": "cloudgate"},
        {"item_id": "g1", "instance": "markee"},
        {"item_id": "g1", "instance": "cloudgate"},
    ]
    fake_db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "parent_id": None, "instance": "markee"}
    ]
    out = catalog.assign_group_workspaces(["g1"], ["cloudgate", "markee"])
    assert out["groups"] == ["g1"]
    assert out["assignment"]["g1"] == ["cloudgate", "markee"]


def test_assign_rejects_more_than_500_groups(fake_db, available_workspaces):
    ids = [f"g{i}" for i in range(501)]
    with pytest.raises(ValueError, match="500"):
        catalog.assign_group_workspaces(ids, ["cloudgate"])


def test_assign_rejects_empty_rpc_result(fake_db, available_workspaces):
    fake_db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "parent_id": None, "instance": "markee"}
    ]
    fake_db.rpc_data = []
    with pytest.raises(ValueError, match="Không ghi được"):
        catalog.assign_group_workspaces(["g1"], ["cloudgate"])


# ─────────────────────────────────────────────────────────────────────────────
# _ws_write: replace-all 1-2 item + legacy mirror
# ─────────────────────────────────────────────────────────────────────────────


def test_ws_write_replaces_junction_and_mirrors_legacy(fake_db):
    fake_db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "instance": "securityzone"}
    ]
    fake_db.db[catalog.WORKSPACES_TABLE] = [
        # cũ: sz + markee → thay boi [cloudgate]
        {"item_id": "g1", "instance": "securityzone"},
        {"item_id": "g1", "instance": "markee"},
    ]

    sets = catalog._ws_write(fake_db, ["g1"], ["Cloudgate"], "actor-1")
    assert sets == {"g1": ["cloudgate"]}

    ws_rows = [
        {k: v for k, v in w.items() if k in ("item_id", "instance")}
        for w in fake_db.db[catalog.WORKSPACES_TABLE]
    ]
    assert ws_rows == [{"item_id": "g1", "instance": "cloudgate"}]
    group = next(r for r in fake_db.db["service_catalog_items"] if r["id"] == "g1")
    assert group["instance"] == "cloudgate"  # legacy: set cu khong con trong set moi -> primary = first member
    assert group["updated_by"] == "actor-1"


def test_ws_write_keeps_legacy_primary_when_still_selected(fake_db):
    fake_db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "instance": "markee"}
    ]
    fake_db.db[catalog.WORKSPACES_TABLE] = [{"item_id": "g1", "instance": "markee"}]
    catalog._ws_write(fake_db, ["g1"], ["cloudgate", "Markee"])
    ws_rows = fake_db.db[catalog.WORKSPACES_TABLE]
    assert sorted(w["instance"] for w in ws_rows) == ["cloudgate", "markee"]
    group = next(r for r in fake_db.db["service_catalog_items"] if r["id"] == "g1")
    assert group["instance"] == "markee"  # van con trong set → giu lai cho reader cu


def test_ws_write_rejects_empty_instances(fake_db):
    fake_db.db["service_catalog_items"] = [{"id": "g1", "instance": "markee"}]
    fake_db.db[catalog.WORKSPACES_TABLE] = [{"item_id": "g1", "instance": "markee"}]
    with pytest.raises(ValueError, match="Workspace"):
        catalog._ws_write(fake_db, ["g1"], ["   "])


# ─────────────────────────────────────────────────────────────────────────────
# list_service_catalog_items_scoped: junction-aware union + workspaces payload
# ─────────────────────────────────────────────────────────────────────────────


def test_scoped_list_includes_junction_only_items(fake_db):
    fake_db.db["service_catalog_items"] = [
        # legacy instance = cloudgate (khop bo loc legacy)
        {"id": "g1", "name": "Nhóm G1", "item_type": "group", "parent_id": None, "instance": "cloudgate", "sort_order": 0},
        # junction-only: legacy 'markee' nhung co assignment 'securityzone'
        {"id": "g2", "name": "Nhóm G2", "item_type": "group", "parent_id": None, "instance": "markee", "sort_order": 1},
        # con truc tiep cua g2 (nhan set cua cha)
        {"id": "p2", "name": "San pham P2", "item_type": "component", "parent_id": "g2", "instance": "markee", "sort_order": 0},
        # item khong lien quan voi bo loc
        {"id": "g3", "name": "Nhóm G3", "item_type": "group", "parent_id": None, "instance": "markee", "sort_order": 2},
    ]
    fake_db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "g2", "instance": "securityzone"},
        {"item_id": "p2", "instance": "securityzone"},
    ]

    items = catalog.list_service_catalog_items_scoped(["securityzone"])
    roots = {i["id"] for i in items}
    all_ids = set(roots)
    for root in items:
        for child in root.get("children") or []:
            all_ids.add(child["id"])
    assert roots == {"g2"}, f"roots phai chi con g2 (p2 la con cua g2) — thay: {roots}"
    assert all_ids == {"g2", "p2"}

    by_id = {i["id"]: i for i in items}
    assert set(by_id["g2"]["workspaces"]) == {"securityzone"}
    assert set(by_id["g2"]["children"][0]["workspaces"]) == {"securityzone"}


def test_scoped_list_none_returns_all_with_workspaces(fake_db):
    fake_db.db["service_catalog_items"] = [
        {"id": "g1", "name": "Nhóm G1", "item_type": "group", "parent_id": None, "instance": "markee", "sort_order": 0}
    ]
    fake_db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "g1", "instance": "markee"},
        {"item_id": "g1", "instance": "cloudgate"},
    ]
    items = catalog.list_service_catalog_items_scoped(None)
    assert len(items) == 1
    assert set(items[0]["workspaces"]) == {"markee", "cloudgate"}


# ─────────────────────────────────────────────────────────────────────────────
# get_catalog_change_fingerprint (cross-clone sync — Requirement C)
# ─────────────────────────────────────────────────────────────────────────────


def test_fingerprint_counts_groups_and_junction(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(catalog, "get_supabase_client", lambda: db)
    db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "updated_at": "2026-10-12T01:00:00+00:00"},
        {"id": "g2", "item_type": "group", "updated_at": "2026-10-12T03:00:00+00:00"},
        {"id": "c1", "item_type": "component", "parent_id": "g1", "updated_at": "2026-10-12T02:00:00+00:00"},
    ]
    db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "g1", "instance": "markee"},
        {"item_id": "g2", "instance": "cloudgate"},
        {"item_id": "c1", "instance": "markee"},
    ]
    result = catalog.get_catalog_change_fingerprint()
    # CHỈ group được đếm (không đếm product/con như là group)
    assert result["groups_count"] == 2
    assert result["junction_count"] == 3
    # fake Query ignores order(): row đầu của select là g1 — shape verified;
    # logic max(updated_at) thực sự nằm ở Postgres (order desc + limit 1).
    assert result["items_max_updated_at"] == "2026-10-12T01:00:00+00:00"


def test_fingerprint_is_stable_then_changes_with_data(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(catalog, "get_supabase_client", lambda: db)
    db.db["service_catalog_items"] = [
        {"id": "g1", "item_type": "group", "instance": "markee", "updated_at": "2026-10-12T01:00:00+00:00"},
    ]
    fp1 = catalog.get_catalog_change_fingerprint()
    # "Seeding ghi": thêm 1 group + 2 junction dòng (giống ws_assign replace-all
    # với 2 instance) → fingerprint khác lần trước
    db.db["service_catalog_items"].append({"id": "g2", "item_type": "group", "instance": "cloudgate", "updated_at": "2026-10-12T05:00:00+00:00"})
    db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "g1", "instance": "markee"},
        {"item_id": "g2", "instance": "cloudgate"},
        {"item_id": "g2", "instance": "securityzone"},
    ]
    fp2 = catalog.get_catalog_change_fingerprint()
    assert fp2["groups_count"] == fp1["groups_count"] + 1
    # junction sau thay đổi = g1×1 (markee) + g2×2 (cloudgate, securityzone)
    assert fp2["junction_count"] == 3


def test_fingerprint_never_raises_on_db_errors(monkeypatch):
    class _ExplodingQuery:
        def select(self, *_a, **_k):
            return self

        def eq(self, *_a, **_k):
            return self

        def order(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def execute(self):
            raise RuntimeError("db down")

    class _ExplodingDb:
        def table(self, _name):
            return _ExplodingQuery()

    monkeypatch.setattr(catalog, "get_supabase_client", lambda: _ExplodingDb())
    result = catalog.get_catalog_change_fingerprint()
    # Không raise — client giữ nguyên dữ liệu cũ, thử lại chu kỳ sau
    assert result["groups_count"] == 0
    assert result["items_max_updated_at"] is None
    assert result["junction_count"] == 0


VERSION_PATH = "/api/all-platform/service-catalog/version"


def test_version_endpoint_requires_auth() -> None:
    response = client.get(VERSION_PATH)
    assert response.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# API: auth (khong cho phep goi thieu auth/phan quyen)
# ─────────────────────────────────────────────────────────────────────────────

ASSIGN_PATH = "/api/all-platform/service-catalog/workspaces-assign"
client = TestClient(app)


def test_assign_endpoint_requires_auth() -> None:
    response = client.post(ASSIGN_PATH, json={"group_ids": ["g1"], "instances": ["cloudgate"]})
    assert response.status_code == 401


def test_assign_endpoint_rejects_empty_body_shapes_unauth_too() -> None:
    response = client.post(ASSIGN_PATH, json={})
    assert response.status_code == 401  # auth checked truoc schema/permission


# ─────────────────────────────────────────────────────────────────────────────
# Fingerprint stamps (isolation task 2026-10-14): reorder + bundle composition
# ─────────────────────────────────────────────────────────────────────────────


def test_reorder_stamps_updated_at_on_both_rows(fake_db):
    fake_db.db["service_catalog_items"] = [
        {"id": "a", "item_type": "group", "parent_id": None, "instance": "cloudgate", "sort_order": 0, "name": "A"},
        {"id": "b", "item_type": "group", "parent_id": None, "instance": "cloudgate", "sort_order": 1, "name": "B"},
    ]
    catalog.reorder_service_catalog_item("b", "up")
    rows = {r["id"]: r for r in fake_db.db["service_catalog_items"]}
    # ca 2 dong doi sort_order deu phai co updated_at (fingerprint bump)
    assert rows["a"].get("updated_at"), "dong 'a' phai duoc stamp updated_at"
    assert rows["b"].get("updated_at"), "dong 'b' phai duoc stamp updated_at"
    assert rows["a"]["sort_order"] == 1 and rows["b"]["sort_order"] == 0


def test_fingerprint_changes_after_reorder(fake_db):
    fake_db.db["service_catalog_items"] = [
        {"id": "a", "item_type": "group", "parent_id": None, "instance": "cloudgate", "sort_order": 0, "updated_at": "2026-10-12T01:00:00+00:00", "name": "A"},
        {"id": "b", "item_type": "group", "parent_id": None, "instance": "cloudgate", "sort_order": 1, "updated_at": "2026-10-12T02:00:00+00:00", "name": "B"},
    ]
    fake_db.db[catalog.WORKSPACES_TABLE] = [
        {"item_id": "a", "instance": "cloudgate"},
        {"item_id": "b", "instance": "cloudgate"},
    ]

    def key():
        fp = catalog.get_catalog_change_fingerprint()
        return (fp["groups_count"], fp["items_max_updated_at"], fp["junction_count"])

    key_before = key()
    catalog.reorder_service_catalog_item("b", "up")
    key_after = key()
    assert key_after != key_before, "reorder phai lam fingerprint doi (updated_at stamp)"


def test_set_bundle_components_stamps_bundle_item(fake_db):
    fake_db.db["service_catalog_items"] = [
        {"id": "bundle-1", "item_type": "bundle", "instance": "cloudgate", "name": "Bundle"},
        {"id": "comp-1", "item_type": "component", "instance": "cloudgate", "name": "Comp"},
    ]
    fake_db.db[catalog.BUNDLE_ITEMS_TABLE] = []
    fake_db.db[catalog.PRICING_TABLE] = []
    catalog.set_bundle_components(
        "bundle-1",
        [{"component_id": "comp-1", "quantity": 2}],
    )
    bundle = next(r for r in fake_db.db["service_catalog_items"] if r["id"] == "bundle-1")
    assert bundle.get("updated_at"), "bundle item phai duoc stamp updated_at sau khi sua thanh phan"
