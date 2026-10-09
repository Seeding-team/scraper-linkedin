"""Chức vụ (position) cho "Người liên hệ" của Đơn vị phát hành (quote_issuer_companies) — migration 187.

Tái sử dụng dropdown Chức vụ đã có cho CRM contact (PositionSelect/crm_position_service.resolve_position_category),
không viết lại logic validate category riêng cho issuer company."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from app.modules.all_platform.services import crm_position_service as pos
from app.modules.all_platform.services import supabase_quote_service as svc


class _FakeTable:
    def __init__(self, store):
        self._store = store
        self._op = None
        self._payload = None
        self._filter_id = None

    def select(self, *_a, **_kw):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, _col, value):
        self._filter_id = value
        return self

    def order(self, *_a, **_kw):
        return self

    def execute(self):
        if self._op == "insert":
            row = {"id": "new-id", "code": "X", "legal_name": "X", **self._payload}
            self._store["last_insert"] = self._payload
            return type("R", (), {"data": [row]})()
        if self._op == "update":
            self._store["last_update"] = self._payload
            row = {"id": self._filter_id, "code": "X", "legal_name": "X", **self._payload}
            return type("R", (), {"data": [row]})()
        if self._op == "select":
            return type("R", (), {"data": [self._store.get("current_row", {})]})()
        return type("R", (), {"data": []})()


class _FakeClient:
    def __init__(self, store):
        self._store = store

    def table(self, _name):
        return _FakeTable(self._store)


def _fake_category(category_id, *, is_active=True, name="Giám đốc"):
    def _fetch(cid):
        if cid != category_id:
            return None
        return {"id": category_id, "category_type": "crm_position", "name": name, "is_active": is_active}
    return _fetch


def test_create_issuer_company_resolves_position_category(monkeypatch):
    store = {}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    monkeypatch.setattr(pos, "_fetch_category", _fake_category("cat-1"))
    svc.create_issuer_company({"code": "MK", "legal_name": "Markee", "position_category_id": "cat-1"})
    assert store["last_insert"]["position_category_id"] == "cat-1"
    assert store["last_insert"]["position_label_snapshot"] == "Giám đốc"


def test_create_issuer_company_without_position_stays_null(monkeypatch):
    store = {}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    svc.create_issuer_company({"code": "MK", "legal_name": "Markee"})
    assert store["last_insert"]["position_category_id"] is None
    assert store["last_insert"]["position_label_snapshot"] is None


def test_create_issuer_company_rejects_deactivated_category(monkeypatch):
    store = {}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    monkeypatch.setattr(pos, "_fetch_category", _fake_category("cat-1", is_active=False))
    with pytest.raises(pos.InvalidPositionCategoryError):
        svc.create_issuer_company({"code": "MK", "legal_name": "Markee", "position_category_id": "cat-1"})


def test_update_issuer_company_sets_position_category(monkeypatch):
    store = {"current_row": {"position_category_id": None}}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    monkeypatch.setattr(pos, "_fetch_category", _fake_category("cat-1"))
    svc.update_issuer_company("issuer-1", {"position_category_id": "cat-1"})
    assert store["last_update"]["position_category_id"] == "cat-1"
    assert store["last_update"]["position_label_snapshot"] == "Giám đốc"


def test_update_issuer_company_can_clear_position_category(monkeypatch):
    store = {"current_row": {"position_category_id": "cat-1"}}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    svc.update_issuer_company("issuer-1", {"position_category_id": None})
    assert store["last_update"]["position_category_id"] is None
    assert store["last_update"]["position_label_snapshot"] is None


def test_update_issuer_company_keeping_already_deactivated_position_does_not_raise(monkeypatch):
    # Sua truong KHAC (vd phone) cua 1 ban ghi dang gan Chuc vu da bi ngung dung - khong duoc bao loi vo ly vi gia
    # tri khong doi (require_active chi bat khi THAY DOI), dung tinh than da ap dung cho CRM contact.
    store = {"current_row": {"position_category_id": "cat-1"}}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    monkeypatch.setattr(pos, "_fetch_category", _fake_category("cat-1", is_active=False))
    svc.update_issuer_company("issuer-1", {"position_category_id": "cat-1", "phone": "0909"})
    assert store["last_update"]["position_category_id"] == "cat-1"
    assert store["last_update"]["phone"] == "0909"


def test_update_issuer_company_rejects_newly_picking_deactivated_position(monkeypatch):
    store = {"current_row": {"position_category_id": None}}
    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeClient(store))
    monkeypatch.setattr(pos, "_fetch_category", _fake_category("cat-1", is_active=False))
    with pytest.raises(pos.InvalidPositionCategoryError):
        svc.update_issuer_company("issuer-1", {"position_category_id": "cat-1"})


def test_row_to_issuer_company_exposes_position_fields():
    row = {"id": "i1", "code": "MK", "legal_name": "Markee", "position_category_id": "cat-1", "position_label_snapshot": "Giám đốc"}
    out = svc._row_to_issuer_company(row)
    assert out["positionCategoryId"] == "cat-1" and out["positionLabel"] == "Giám đốc"
