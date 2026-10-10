"""Sao chep Khach hang (crm_customers) sang workspace khac - dung tinh than copy_lead_to_instance()."""
from unittest import mock

import pytest

from app.modules.all_platform.services import crm_customer_service as svc


class _Q:
    def __init__(self, sb, name):
        self.sb, self.name, self.op, self.payload = sb, name, "select", None

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        if self.op == "insert":
            self.sb.inserted.append(dict(self.payload))
            row = {**self.payload, "id": "new-id"}
            return mock.Mock(data=[row])
        rows = self.sb.tables.get(self.name) or []
        return mock.Mock(data=rows[0] if rows else None)


class _FakeSB:
    def __init__(self, customer):
        self.tables = {"crm_customers": [customer]}
        self.inserted: list[dict] = []

    def table(self, name):
        return _Q(self, name)


def _customer(**kw):
    return {
        "id": "C1",
        "customer_name": "Nguyen Van A",
        "company_name": "Cong ty A",
        "instance": "markee",
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
        "customer_code": "KH0001",
        **kw,
    }


def test_copy_customer_rejects_invalid_target():
    sb = _FakeSB(_customer())
    with mock.patch.object(svc, "get_supabase_client", return_value=sb), \
            mock.patch("app.core.config.settings.crm_instance", "markee"):
        with pytest.raises(ValueError, match="khong hop le"):
            svc.copy_customer_to_instance("C1", "not-a-real-workspace", {"id": "u1"})


def test_copy_customer_rejects_copy_to_same_instance():
    sb = _FakeSB(_customer(instance="cloudgate"))
    with mock.patch.object(svc, "get_supabase_client", return_value=sb), \
            mock.patch("app.core.config.settings.crm_instance", "cloudgate"):
        with pytest.raises(ValueError, match="workspace hiện tại"):
            svc.copy_customer_to_instance("C1", "cloudgate", {"id": "u1"})


def test_copy_customer_strips_id_and_sets_target_instance():
    sb = _FakeSB(_customer())
    with mock.patch.object(svc, "get_supabase_client", return_value=sb), \
            mock.patch("app.core.config.settings.crm_instance", "markee"), \
            mock.patch("app.modules.all_platform.services.supabase_project_service._resolve_customer_code", return_value="KH9999"):
        result = svc.copy_customer_to_instance("C1", "cloudgate", {"id": "u1"})
    assert result["id"] == "new-id"
    inserted = sb.inserted[0]
    assert inserted["instance"] == "cloudgate"
    assert "id" not in inserted and "created_at" not in inserted and "updated_at" not in inserted
    assert inserted["customer_name"] == "Nguyen Van A"


def test_copy_customers_bulk_isolates_failures():
    sb = _FakeSB(_customer())
    with mock.patch.object(svc, "get_supabase_client", return_value=sb), \
            mock.patch("app.core.config.settings.crm_instance", "markee"), \
            mock.patch("app.modules.all_platform.services.supabase_project_service._resolve_customer_code", return_value="KH9999"):
        result = svc.copy_customers_to_instance(
            [
                {"customer_id": "C1", "target_instance": "cloudgate"},
                {"customer_id": "C1", "target_instance": ""},
            ],
            {"id": "u1"},
        )
    assert len(result["copied"]) == 1
    assert len(result["failed"]) == 1
