"""Unit test THUAN (khong DB that) cho validate_project_belongs_to_customer()
va viec no duoc goi dung trong create_customer_lead()/update_customer_lead()
(customer_lead_service.py) - Block 1: "Cross-customer Project bi chan" +
"explicit project_id=null bo gan that".

Chay: python scratch/test_deal_project_cross_customer.py
"""
import io
import os
import sys
from unittest.mock import patch

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


class FakeQueryResult:
    def __init__(self, data=None):
        self.data = data


class FakeTable:
    def __init__(self, store, name):
        self.store = store
        self.name = name
        self._filters = {}
        self._maybe_single = False
        self._update_payload = None
        self._insert_payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def order(self, *_a, **_k):
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def _matching_rows(self):
        rows = list(self.store.get(self.name, []))
        for field, value in self._filters.items():
            rows = [r for r in rows if r.get(field) == value]
        return rows

    def execute(self):
        if self._insert_payload is not None:
            new_row = dict(self._insert_payload)
            new_row.setdefault("id", f"new-{len(self.store.setdefault(self.name, []))}")
            self.store.setdefault(self.name, []).append(new_row)
            return FakeQueryResult(data=[new_row])
        if self._update_payload is not None:
            rows = self._matching_rows()
            for r in rows:
                r.update(self._update_payload)
            return FakeQueryResult(data=rows)
        rows = self._matching_rows()
        if self._maybe_single:
            return FakeQueryResult(data=(rows[0] if rows else None))
        return FakeQueryResult(data=rows)


class FakeSupabase:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return FakeTable(self.store, name)


PROJECTS = [
    {"id": "proj-A", "project_code": "DA-A", "name": "Du an A", "customer_id": "cust-1", "description": None, "status": "active", "manager_id": None, "team_id": None, "created_by": None, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
    {"id": "proj-B", "project_code": "DA-B", "name": "Du an B", "customer_id": "cust-2", "description": None, "status": "active", "manager_id": None, "team_id": None, "created_by": None, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
]

LEADS = [
    {"id": "lead-1", "customer_id": "cust-1", "project_id": None, "customer_name": "KH 1"},
]


def run():
    from app.modules.all_platform.services import customer_lead_service as csvc
    from app.modules.all_platform.services import supabase_project_service as psvc

    store_projects = {"projects": list(PROJECTS)}
    fake_projects = FakeSupabase(store_projects)

    with patch.object(psvc, "get_supabase_client", return_value=fake_projects):
        # ── validate_project_belongs_to_customer() truc tiep ───────────────
        try:
            csvc.validate_project_belongs_to_customer("proj-A", "cust-1")
            record("validate: Project THUOC DUNG Customer - chap nhan", True)
        except ValueError as e:
            record("validate: Project THUOC DUNG Customer - chap nhan", False, str(e))

        try:
            csvc.validate_project_belongs_to_customer("proj-B", "cust-1")
            record("validate: Project THUOC Customer KHAC - TU CHOI", False)
        except ValueError as e:
            record("validate: Project THUOC Customer KHAC - TU CHOI", "không thuộc" in str(e), str(e))

        try:
            csvc.validate_project_belongs_to_customer(None, "cust-1")
            record("validate: project_id=None (chua gan) - chap nhan, khong goi DB", True)
        except ValueError:
            record("validate: project_id=None (chua gan) - chap nhan, khong goi DB", False)

        try:
            csvc.validate_project_belongs_to_customer("proj-khong-ton-tai", "cust-1")
            record("validate: project_id khong ton tai - TU CHOI", False)
        except ValueError as e:
            record("validate: project_id khong ton tai - TU CHOI", "không tồn tại" in str(e), str(e))

    # ── create_customer_lead(): tich hop that qua ham thuc te ──────────────
    store_leads = {"customer_leads": [], "customer_lead_activity_log": []}
    fake_leads = FakeSupabase(store_leads)
    with patch.object(csvc, "get_supabase_client", return_value=fake_leads), \
         patch.object(psvc, "get_supabase_client", return_value=fake_projects), \
         patch.object(csvc, "_write_activity_log", lambda **kw: None):
        try:
            csvc.create_customer_lead({"customer_name": "Test", "customer_id": "cust-1", "project_id": "proj-B"})
            record("create_customer_lead: TU CHOI project_id khac Customer", False)
        except ValueError as e:
            record("create_customer_lead: TU CHOI project_id khac Customer", "không thuộc" in str(e), str(e))

        created = csvc.create_customer_lead({"customer_name": "Test", "customer_id": "cust-1", "project_id": "proj-A"})
        record("create_customer_lead: chap nhan project_id CUNG Customer", created is not None and created.get("project_id") == "proj-A")

    # ── update_customer_lead(): explicit null bo gan THAT SU persist ───────
    store_leads2 = {"customer_leads": [dict(LEADS[0], project_id="proj-A")]}
    fake_leads2 = FakeSupabase(store_leads2)
    with patch.object(csvc, "get_supabase_client", return_value=fake_leads2), \
         patch.object(psvc, "get_supabase_client", return_value=fake_projects):
        try:
            csvc.update_customer_lead("lead-1", {"project_id": "proj-B"})
            record("update_customer_lead: TU CHOI doi sang project_id khac Customer", False)
        except ValueError as e:
            record("update_customer_lead: TU CHOI doi sang project_id khac Customer", "không thuộc" in str(e), str(e))

        unassigned = csvc.update_customer_lead("lead-1", {"project_id": None})
        record("update_customer_lead: project_id=null RO RANG -> bo gan THAT SU (khong bi bo qua)",
               unassigned is not None and unassigned.get("project_id") is None)

        reassigned = csvc.update_customer_lead("lead-1", {"project_id": "proj-A"})
        record("update_customer_lead: gan lai DUNG Project cua Customer - chap nhan", reassigned.get("project_id") == "proj-A")


if __name__ == "__main__":
    run()
    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)
