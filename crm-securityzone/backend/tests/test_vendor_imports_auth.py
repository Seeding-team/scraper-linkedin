"""Tests AUTH cho vendor-imports router (isolation task 2026-10-14).

Policy confirm boi user/Ops ngay 2026-10-14 (thay audit G3/Q6 — truoc day
toan bo router KHONG co auth gi ca trong ca 4 clone + MAIN):
- 7 endpoint deu bat buoc JWT (401 khi khong co/khong dung).
- Duong GHI (POST /batches, PATCH item, POST retry, POST approve) can
  master-data manager role (admin/leader hoac quote_business_role
  sale/presale) — 403 khi khong du role.
- Duong DOC (GET batches/detail/items) JWT-only.
- `_resolve_vendor_import_group_id` tao nhom fallback qua
  `create_service_catalog_item` (ownership-aware) → có junction +
  legacy instance = workspace cua deploy (KHONG con raw-insert 'markee'
  khong junction).

Khong cham DB that: FakeSupabase pattern, service fake cho deps.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.all_platform import auth_deps
from app.modules.all_platform.routers import vendor_imports as vi
from app.modules.all_platform.services import supabase_service_catalog_service as catalog_svc

CLONE_INSTANCE = "securityzone"

# Router mount prefix: app/modules/all_platform/router.py
# (`include_router(vendor_imports_router, prefix="/crm/vendor-imports")` +
# app/main.py: `/api/all-platform`).
VENDOR_PATH = "/api/all-platform/crm/vendor-imports/batches"


class _Result:
    def __init__(self, data):
        self.data = data


class _Rec:
    """Fake SupabaseVendorImportsService du form (async)."""

    def __init__(self, payload: dict | None = None):
        self.payload = payload or {}

    async def create_batch(self, **kwargs):
        return {"id": kwargs.get("id", "batch-1"), **self.payload}

    async def update_batch_status(self, *a, **k):
        return True

    async def list_batches(self, *a, **k):
        return []

    async def get_batch(self, *a, **k):
        return {
            "id": "batch-1",
            "status": "review",
            "target_scope": "project_only",
            "source_file_path": "",
        "source_file_type": "",
        }

    async def get_batch_items(self, *a, **k):
        return []

    async def update_item(self, *a, **k):
        return {}

    async def reset_items_for_retry(self, *a, **k):
        return True


@pytest.fixture
def fake_imports_service(monkeypatch):
    # Depends(get_imports_service)/Depends(get_instance) gan function object
    # TAI import time — patch thuoc tinh module khong doi duoc dependency;
    # dung dependency_overrides cua FastAPI (restore trong finally).
    app.dependency_overrides[vi.get_imports_service] = lambda: _Rec()
    app.dependency_overrides[vi.get_instance] = lambda: CLONE_INSTANCE
    # Retry schedule background OCR — patch no-op de TestClient khong chay
    # background task that su (dong bo voi ky luat "no lifespan/no DB that").
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(vi, "process_ocr_extraction", _noop)
    try:
        yield
    finally:
        app.dependency_overrides.pop(vi.get_imports_service, None)
        app.dependency_overrides.pop(vi.get_instance, None)


@pytest.fixture
def fake_supabase(monkeypatch):
    from app.core import supabase_client as sc

    class _Q:
        def __init__(self, db, table):
            self._db, self._table = db, table
            self.filters = []
            self._single = False
            self.op = "select"
            self._last_insert: list = []

        def select(self, *_a, **_k):
            return self

        def insert(self, payload):
            payload = payload if isinstance(payload, list) else [payload]
            rows = []
            for item in payload:
                row = dict(item)
                row.setdefault("id", str(__import__("uuid").uuid4()))
                self._db.setdefault(self._table, []).append(row)
                rows.append(dict(row))
            self._last_insert = rows
            self.op = "insert"
            return self

        def update(self, payload):
            self.op = "update"
            self._payload = payload
            return self

        def delete(self):
            self.op = "delete"
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

        def order(self, *_a, **_k):
            return self

        def limit(self, _n):
            return self

        def maybe_single(self):
            self._single = True
            return self

        def execute(self):
            rows = self._db.get(self._table, [])
            if self.op == "insert":
                result = list(self._last_insert)
            elif self.op == "update":
                result = []
                for row in rows:
                    if self._match(row):
                        row.update(dict(self._payload))
                        result.append(dict(row))
            elif self.op == "delete":
                kept = [row for row in rows if not self._match(row)]
                self._db[self._table] = kept
                result = []
            else:
                result = [dict(r) for r in rows if self._match(r)]
            if self._single:
                return _Result(result[0] if result else None)
            return _Result(result)

    class _DB:
        def __init__(self):
            self.db: dict[str, list] = {}

        def table(self, name):
            return _Q(self.db, name)

    db = _DB()
    monkeypatch.setattr(sc, "get_supabase_client", lambda: db)
    monkeypatch.setattr(vi, "get_supabase_client", lambda: db)
    # create_service_catalog_item su dung binding rieng trong module service.
    monkeypatch.setattr(catalog_svc, "get_supabase_client", lambda: db)
    return db


def _auth(monkeypatch, role: str | None):
    if role is None:
        return
    monkeypatch.setattr(auth_deps, "decode_token", lambda token: {"sub": "22222222-2222-2222-2222-222222222222"})
    monkeypatch.setattr(
        auth_deps,
        "get_user_by_id",
        lambda user_id: {"id": user_id, "role": role, "is_active": True},
    )


AUTH_HEADERS = {"Authorization": "Bearer test-token"}

client = TestClient(app)


# ─────────────────────────────────────────────────────────────────────────────
# 401: khong JWT
# ─────────────────────────────────────────────────────────────────────────────


def test_unauth_upload_denied():
    response = client.post(
        VENDOR_PATH,
        data={"vendor_id": "v1", "target_scope": "project_only"},
        files={"file": ("a.csv", b"x,y\n", "text/csv")},
    )
    assert response.status_code == 401


def test_unauth_list_denied():
    assert client.get(VENDOR_PATH).status_code == 401


def test_unauth_get_batch_denied():
    assert client.get(f"{VENDOR_PATH}/batch-1").status_code == 401


def test_unauth_get_items_denied():
    assert client.get(f"{VENDOR_PATH}/batch-1/items").status_code == 401


def test_unauth_patch_item_denied():
    assert client.patch(
        f"{VENDOR_PATH}/batch-1/items/it-1", json={"name": "n"}
    ).status_code == 401


def test_unauth_retry_denied():
    assert client.post(f"{VENDOR_PATH}/batch-1/retry").status_code == 401


def test_unauth_approve_denied():
    assert client.post(f"{VENDOR_PATH}/batch-1/approve").status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# 403: JWT nhung thieu role (duong GHI)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["member", "viewer"])
def test_lowrole_upload_denied(fake_imports_service, monkeypatch, role):
    _auth(monkeypatch, role)
    response = client.post(
        VENDOR_PATH,
        data={"vendor_id": "v1", "target_scope": "project_only"},
        files={"file": ("a.csv", b"x,y\n", "text/csv")},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 403


def test_lowrole_patch_item_denied(fake_imports_service, monkeypatch):
    _auth(monkeypatch, "member")
    response = client.patch(
        f"{VENDOR_PATH}/batch-1/items/it-1", json={"name": "n"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 403


def test_lowrole_retry_denied(fake_imports_service, fake_supabase, monkeypatch):
    _auth(monkeypatch, "member")
    response = client.post(f"{VENDOR_PATH}/batch-1/retry", headers=AUTH_HEADERS)
    assert response.status_code == 403


def test_lowrole_approve_denied(fake_imports_service, fake_supabase, monkeypatch):
    _auth(monkeypatch, "member")
    response = client.post(f"{VENDOR_PATH}/batch-1/approve", headers=AUTH_HEADERS)
    assert response.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# 200: JWT + role dung (admin) — duong ghi qua duoc deps; doc JWT-only
# ─────────────────────────────────────────────────────────────────────────────


def test_admin_list_ok(fake_imports_service, monkeypatch):
    _auth(monkeypatch, "admin")
    response = client.get(VENDOR_PATH, headers=AUTH_HEADERS)
    assert response.status_code == 200


def test_member_list_ok_jwt_only(fake_imports_service, monkeypatch):
    _auth(monkeypatch, "member")
    response = client.get(VENDOR_PATH, headers=AUTH_HEADERS)
    assert response.status_code == 200


def test_admin_retry_project_only_ok(fake_imports_service, fake_supabase, monkeypatch):
    _auth(monkeypatch, "admin")
    response = client.post(f"{VENDOR_PATH}/batch-1/retry", headers=AUTH_HEADERS)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "retrying"}


def test_admin_approve_project_only_ok(fake_imports_service, fake_supabase, monkeypatch):
    _auth(monkeypatch, "admin")
    response = client.post(f"{VENDOR_PATH}/batch-1/approve", headers=AUTH_HEADERS)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "approved", "processed": 0}


# ─────────────────────────────────────────────────────────────────────────────
# Group fallback creation: ownership-aware (junction + instance = deploy)
# ─────────────────────────────────────────────────────────────────────────────


def test_resolve_group_creates_via_ownership_helper_when_empty(fake_supabase):
    db = fake_supabase.db
    db["service_catalog_items"] = []  # khong con nhom nao
    group_id = vi._resolve_vendor_import_group_id(fake_supabase, CLONE_INSTANCE)
    rows = db["service_catalog_items"]
    created = [r for r in rows if r.get("id") == group_id]
    assert created, "phai tao nhom moi qua create_service_catalog_item"
    group = created[0]
    assert group["item_type"] == "group"
    assert group["name"] == "Vendor Import"
    assert group["instance"] == CLONE_INSTANCE
    # junction duoc ghi (ownership metadata) qua _ws_write
    junctions = [
        {k: v for k, v in j.items() if k in ("item_id", "instance")}
        for j in db.get("service_catalog_item_workspaces", [])
        if j.get("item_id") == group_id
    ]
    assert junctions == [{"item_id": group_id, "instance": CLONE_INSTANCE}]


def test_resolve_group_reuses_existing_group(fake_supabase):
    db = fake_supabase.db
    db["service_catalog_items"] = [
        {"id": "existing-group", "item_type": "group", "status": "active", "sort_order": 0}
    ]
    group_id = vi._resolve_vendor_import_group_id(fake_supabase, CLONE_INSTANCE)
    assert group_id == "existing-group"
