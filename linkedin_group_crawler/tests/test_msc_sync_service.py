"""Test dong bo Hang hoa MSC → CRM (services/msc_sync_service).

Dung DB GIA trong bo nho (khong cham DB that, khong cham MSC that). MSC chi duoc
mo phong qua stub cho GET /api/v1/goods — bao dam nguyen tac "MSC READ-ONLY".
"""
from __future__ import annotations

import copy
import threading  # noqa: F401 — giu phong import goc de doc ro intent
import types

import pytest

from app.modules.all_platform.services import msc_sync_service
from app.modules.all_platform.services import supabase_service_catalog_service as catalog_service


# ─────────────────────────────────────────────────────────────────────────────
# Fake Supabase trong bo nho (pattern giong tests/test_crm_sync_propagation.py)
# ─────────────────────────────────────────────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op, self.payload = "select", None
        self.filters, self._order, self._limit = [], None, None

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        self.filters.append(("is", col, val))
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, list(vals)))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _match(self, row):
        for kind, col, val in self.filters:
            current = row.get(col)
            if kind == "eq" and str(current) != str(val):
                return False
            if kind == "is":
                is_null_query = str(val).lower() == "null"
                if is_null_query and current is not None:
                    return False
                if not is_null_query and current != val:
                    return False
            if kind == "in" and current not in val:
                return False
        return True

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "select":
            matched = [dict(r) for r in rows if self._match(r)]
            if self._order:
                col, desc = self._order
                matched.sort(key=lambda r: (r.get(col) or 0), reverse=desc)
            if self._limit is not None:
                matched = matched[: self._limit]
            return _Result(matched)
        if self.op == "insert":
            payload = self.payload if isinstance(self.payload, list) else [self.payload]
            inserted, seq = [], len(rows) + 1
            for item in payload:
                row = dict(item)
                row.setdefault("id", f"uuid-{seq}")
                seq += 1
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
        return _Result([])


class FakeSupabase:
    def __init__(self):
        self.db: dict[str, list[dict]] = {}

    def table(self, name):
        return _Query(self.db, name)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeSupabase()
    # Stub settings doc lap (test_crm_lead_import_service thay toan bo
    # app.core.config trong sys.modules bang namespace khac — xung dot bien
    # toan cuc; dung stub rieng cho ca 2 binding de bat tieu process nay)
    stub_settings = types.SimpleNamespace(
        msc_api_base_url="https://msc.example",
        msc_api_token="",
        msc_sync_hour=2,
        msc_sync_minute=30,
        msc_sync_dry_run=False,
        msc_sync_timeout_sec=60.0,
        crm_instance="markee",
    )
    monkeypatch.setattr(msc_sync_service, "settings", stub_settings)
    import app.core.config as config_module

    monkeypatch.setattr(config_module, "settings", stub_settings, raising=False)
    monkeypatch.setattr(msc_sync_service, "get_supabase_client", lambda: db)
    monkeypatch.setattr(catalog_service, "get_supabase_client", lambda: db)
    return db


def stub_snapshot(monkeypatch, payload):
    monkeypatch.setattr(msc_sync_service, "_fetch_msc_snapshot", lambda: (200, payload))


def base_snapshot():
    return {
        "success": True,
        "data": {
            "groups": [
                {"id": "g_1", "name": "Server", "createdAt": "2026-01-01T00:00:00Z"},
                {"id": "g_2", "name": "Laptop", "createdAt": "2026-01-01T00:00:00Z"},
            ],
            "brands": [{"id": "b_1", "name": "Dell"}],
            "items": [
                {
                    "id": "item_1",
                    "itemName": "PowerEdge R750",
                    "model": "R750",
                    "brand": "Dell",
                    "groupId": "g_1",
                    "createdAt": "2026-01-02T00:00:00Z",
                },
                {
                    "id": "item_2",
                    "itemName": "Chua phan loai hang",
                    "groupId": "Chưa phân loại",
                    "createdAt": "2026-01-02T00:00:00Z",
                },
                {
                    # groupId la TEN nhom (du lieu MSC thuc te co the nhu vay)
                    "id": "item_3",
                    "itemName": "Laptop Business",
                    "brand": "",
                    "brandId": "b_1",
                    "groupId": "Laptop",
                    "createdAt": "2026-01-02T00:00:00Z",
                },
            ],
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Mapping + lan dong bo dau tien
# ─────────────────────────────────────────────────────────────────────────────


def test_first_sync_maps_and_inserts(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    stats = msc_sync_service.run_sync(trigger="manual", user_id="user-1")

    assert stats["status"] == "success"
    assert stats["fetched_items"] == 3
    # 3 nhom: Server, Laptop + nhom mac dinh "Chưa phân loại"
    assert stats["groups_created"] == 3
    assert stats["inserted"] == 3
    assert stats["duplicates"] == 0
    assert stats["failed"] == 0

    rows = fake_db.db["service_catalog_items"]
    groups = {r["name"]: r for r in rows if r["item_type"] == "group"}
    comps = {r["name"]: r for r in rows if r["item_type"] == "component"}

    assert set(groups) == {"Server", "Laptop", "Hàng hóa MSC – Chưa phân loại"}
    for row in groups.values():
        assert row["external_source"] == "msc"
        assert row["external_id"]
    assert groups["Hàng hóa MSC – Chưa phân loại"]["external_id"] == "__msc_unclassified__"

    assert set(comps) == {"PowerEdge R750", "Chua phan loai hang", "Laptop Business"}
    st = comps["PowerEdge R750"]
    assert st["external_id"] == "item_1"
    assert st["external_source"] == "msc"
    assert st["part_number"] == "R750"
    assert st["brand"] == "Dell"
    assert st["parent_id"] == groups["Server"]["id"]
    # "Chưa phân loại" → nhom mac dinh
    assert comps["Chua phan loai hang"]["parent_id"] == groups["Hàng hóa MSC – Chưa phân loại"]["id"]
    # groupId la ten ("Laptop") → van map dung nhom; brand resolve tu brandId
    assert comps["Laptop Business"]["parent_id"] == groups["Laptop"]["id"]
    assert comps["Laptop Business"]["brand"] == "Dell"


def test_invalid_item_is_counted_failed_others_continue(fake_db, monkeypatch):
    snapshot = base_snapshot()
    snapshot["data"]["items"].append({"id": "item_bad"})  # khong ten, khong model
    stub_snapshot(monkeypatch, snapshot)
    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)

    assert stats["status"] == "partial"
    assert stats["failed"] == 1
    assert stats["inserted"] == 3
    assert any("item_bad" in msg for msg in stats["errors"])


def test_duplicate_msc_ids_wins_latest(fake_db, monkeypatch):
    snapshot = base_snapshot()
    snapshot["data"]["items"].append(
        {
            "id": "item_1",
            "itemName": "PowerEdge R750 XEON MỚI",
            "model": "R750-NEW",
            "brand": "Dell",
            "groupId": "g_1",
            "updatedAt": "2026-01-05T00:00:00Z",
        }
    )
    stub_snapshot(monkeypatch, snapshot)
    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)

    assert stats["duplicates"] == 1
    assert stats["inserted"] == 3
    rows = [r for r in fake_db.db["service_catalog_items"] if r.get("external_id") == "item_1"]
    assert len(rows) == 1
    assert rows[0]["part_number"] == "R750-NEW"
    assert rows[0]["name"] == "PowerEdge R750 XEON MỚI"


# ─────────────────────────────────────────────────────────────────────────────
# Idempotent: lan 2 giong lan 1 → SKIP; khong tao group trung
# ─────────────────────────────────────────────────────────────────────────────


def test_second_sync_is_idempotent_skip(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    first = msc_sync_service.run_sync(trigger="manual", user_id=None)
    second = msc_sync_service.run_sync(trigger="manual", user_id=None)

    assert first["inserted"] == 3
    assert second["inserted"] == 0
    assert second["updated"] == 0
    assert second["skipped"] == 3
    assert second["groups_created"] == 0
    assert len(fake_db.db["service_catalog_items"]) == 6  # 3 group + 3 item


def test_existing_group_same_name_is_adopted_not_duplicated(fake_db, monkeypatch):
    # Nhom "Server" da co tu truoc (tao thu cong, chua co external id)
    fake_db.db["service_catalog_items"] = [
        {
            "id": "crm-group-old",
            "item_type": "group",
            "name": "Server",
            "external_source": None,
            "external_id": None,
            "status": "active",
            "sort_order": 0,
        }
    ]
    stub_snapshot(monkeypatch, base_snapshot())
    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)

    assert stats["groups_created"] == 2  # Laptop + default group
    assert stats["groups_updated"] == 1
    servers = [r for r in fake_db.db["service_catalog_items"] if r["name"] == "Server"]
    assert len(servers) == 1
    assert servers[0]["id"] == "crm-group-old"
    assert servers[0]["external_source"] == "msc"
    assert servers[0]["external_id"] == "g_1"


# ─────────────────────────────────────────────────────────────────────────────
# Cap nhat / mat du lieu / khong dong vao field CRM tu quan ly
# ─────────────────────────────────────────────────────────────────────────────


def test_changed_model_updates_part_number_only(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    msc_sync_service.run_sync(trigger="manual", user_id=None)

    before = {r["name"]: dict(r) for r in fake_db.db["service_catalog_items"]}

    snapshot = base_snapshot()
    snapshot["data"]["items"][0]["model"] = "R750XS"
    stub_snapshot(monkeypatch, snapshot)
    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)

    assert stats["updated"] == 1
    assert stats["skipped"] == 2
    after = {r["name"]: r for r in fake_db.db["service_catalog_items"]}
    assert after["PowerEdge R750"]["part_number"] == "R750XS"
    # Cac field khac khong bi sua vo co
    assert after["PowerEdge R750"]["name"] == before["PowerEdge R750"]["name"]
    assert after["PowerEdge R750"]["brand"] == before["PowerEdge R750"]["brand"]


def test_sync_never_touches_user_managed_fields(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    msc_sync_service.run_sync(trigger="manual", user_id=None)
    row = next(r for r in fake_db.db["service_catalog_items"] if r.get("external_id") == "item_1")
    row["sku"] = "CRM-SKU-1"
    row["default_unit_price_vnd"] = 999
    row["status"] = "inactive"

    snapshot = base_snapshot()
    snapshot["data"]["items"][0]["model"] = "R750XS"
    stub_snapshot(monkeypatch, snapshot)
    msc_sync_service.run_sync(trigger="manual", user_id=None)

    rows = fake_db.db["service_catalog_items"]
    target = next(r for r in rows if r.get("external_id") == "item_1")
    assert target["sku"] == "CRM-SKU-1"
    assert target["default_unit_price_vnd"] == 999
    assert target["status"] == "inactive"
    assert target["part_number"] == "R750XS"


def test_item_disappeared_is_not_deleted(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    msc_sync_service.run_sync(trigger="manual", user_id=None)

    snapshot = base_snapshot()
    snapshot["data"]["items"] = [snapshot["data"]["items"][1]]  # item_1, item_3 bien mat
    stub_snapshot(monkeypatch, snapshot)
    msc_sync_service.run_sync(trigger="manual", user_id=None)

    remaining = [r for r in fake_db.db["service_catalog_items"] if r.get("external_id")]
    assert {r["external_id"] for r in remaining} >= {"item_1", "item_2", "item_3"}


# ─────────────────────────────────────────────────────────────────────────────
# Dry run: KHONG ghi bat ky du lieu nao
# ─────────────────────────────────────────────────────────────────────────────


def test_dry_run_zero_writes(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())

    stats = msc_sync_service.run_sync(trigger="manual", user_id="user-1", dry_run=True)

    assert stats["dry_run"] is True
    assert stats["status"] == "success"
    assert stats["error_message"] == "DRY RUN - khong ghi du lieu vao CRM"
    # Du kien insert duoc tinh, nhung KHONG ghi
    assert stats["inserted"] == 3
    assert stats["groups_created"] == 3
    # Du lieu san pham khong bi doi (rec trong db chi la key rong + audit)
    assert fake_db.db.get("service_catalog_items", []) == []
    assert [r for r in fake_db.db["msc_sync_runs"] if not r["dry_run"]] == []


# ─────────────────────────────────────────────────────────────────────────────
# Loi MSC → KHONG CRM write nao xay ra (read-before-write)
# ─────────────────────────────────────────────────────────────────────────────


def _stub_http(monkeypatch, status_code=200, json_data=None, json_error=None):
    class _Resp:
        def __init__(self):
            self.status_code = status_code

        def json(self):
            if json_error:
                raise json_error
            return json_data

    class _Client:
        def __init__(self, **_kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def get(self, *_a, **_k):
            return _Resp()

    monkeypatch.setattr(
        msc_sync_service,
        "httpx",
        types.SimpleNamespace(
            Timeout=lambda *_a, **_kw: object(),
            Client=_Client,
        ),
    )


@pytest.mark.parametrize(
    "status_code, json_data",
    [
        (500, None),  # HTTP 5xx
        (404, None),  # HTTP 4xx
        (200, {"success": False}),  # success=false
        (200, {"success": True, "data": {}}),  # thieu data.groups/data.items
    ],
)
def test_msc_failure_causes_no_crm_write(fake_db, monkeypatch, status_code, json_data):
    # Co du lieu CRM co san truoc
    fake_db.db["service_catalog_items"] = [
        {"id": "crm-1", "item_type": "group", "name": "Old", "status": "active"}
    ]
    _stub_http(monkeypatch, status_code=status_code, json_data=json_data)

    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)

    assert stats["status"] == "failed"
    assert stats["error_message"]
    # CRM giu nguyen nguyen trang
    assert [r["name"] for r in fake_db.db["service_catalog_items"]] == ["Old"]


def test_msc_invalid_json_causes_no_crm_write(fake_db, monkeypatch):
    fake_db.db["service_catalog_items"] = [
        {"id": "crm-1", "item_type": "group", "name": "Old", "status": "active"}
    ]
    _stub_http(monkeypatch, json_error=ValueError("bad json"))
    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)
    assert stats["status"] == "failed"
    assert [r["name"] for r in fake_db.db["service_catalog_items"]] == ["Old"]


def test_missing_base_url_fails_cleanly(fake_db, monkeypatch):
    fake_db.db["service_catalog_items"] = [
        {"id": "crm-1", "item_type": "group", "name": "Old", "status": "active"}
    ]
    monkeypatch.setattr(msc_sync_service.settings, "msc_api_base_url", "")
    stats = msc_sync_service.run_sync(trigger="manual", user_id=None)
    assert stats["status"] == "failed"
    assert "MSC_API_BASE_URL" in stats["error_message"]
    assert fake_db.db.get("service_catalog_items", []) == [
        {"id": "crm-1", "item_type": "group", "name": "Old", "status": "active"}
    ]


def test_failed_run_is_recorded_in_msc_sync_runs(fake_db, monkeypatch):
    _stub_http(monkeypatch, status_code=503)
    msc_sync_service.run_sync(trigger="scheduled", user_id=None)
    runs = fake_db.db["msc_sync_runs"]
    assert len(runs) == 1
    assert runs[0]["status"] == "failed"
    assert runs[0]["trigger_type"] == "scheduled"
    assert runs[0]["http_status"] == 503


# ─────────────────────────────────────────────────────────────────────────────
# Khoa tranh chay song song + thai ra khoa sau run
# ─────────────────────────────────────────────────────────────────────────────


def test_concurrent_run_is_rejected_and_lock_released(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    with msc_sync_service._sync_lock:
        stats = msc_sync_service.run_sync(trigger="manual", user_id=None)
        assert stats["status"] == "failed"
        assert "dang chay" in stats["error_message"]
        assert "msc_sync_runs" not in fake_db.db  # khong ghi audit khi bi tu choi

    # Khoa phai duoc thai ra sau moi run (co that bai hay khong)
    result = msc_sync_service._sync_lock.acquire(blocking=False)
    assert result is True
    msc_sync_service._sync_lock.release()

    stats2 = msc_sync_service.run_sync(trigger="manual", user_id=None)
    assert stats2["status"] == "success"


def test_status_lists_runs_from_audit_table(fake_db, monkeypatch):
    stub_snapshot(monkeypatch, base_snapshot())
    msc_sync_service.run_sync(trigger="manual", user_id=None)
    runs = msc_sync_service.list_sync_runs(limit=10)
    assert len(runs) == 1
    assert runs[0]["inserted"] == 3
    assert runs[0]["duration_ms"] is not None
