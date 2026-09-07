"""Unit test THUAN (khong DB that) cho get_customer_projects_summary() -
Customer Profile -> tab "Dự án". Kiem tra: khong N+1 (dung so query cu the),
gom Quote Case theo version_chain_id (CHI current), dem dung processing/sent/
opportunity theo TUNG Project, khong cong version cu vao currentQuoteValue.
Chay: python scratch/test_customer_projects_summary.py
"""
import os
import sys
from unittest.mock import patch

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
        self._in_field = None
        self._in_values = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def in_(self, field, values):
        self._in_field = field
        self._in_values = set(values)
        return self

    def is_(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def execute(self):
        query_calls.append(self.name)
        rows = list(self.store.get(self.name, []))
        for field, value in self._filters.items():
            rows = [r for r in rows if r.get(field) == value]
        if self._in_field is not None:
            rows = [r for r in rows if r.get(self._in_field) in self._in_values]
        return FakeQueryResult(data=rows)


class FakeSupabase:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return FakeTable(self.store, name)


query_calls: list[str] = []


def run():
    global query_calls
    from app.modules.all_platform.services import supabase_project_service as svc

    projects = [
        {"id": "proj-1", "project_code": "DA-001", "name": "Website A", "customer_id": "cust-1", "status": "active", "created_at": "2026-01-01"},
        {"id": "proj-2", "project_code": "DA-002", "name": "App B", "customer_id": "cust-1", "status": "planning", "created_at": "2026-01-02"},
    ]
    deals = [
        {"id": "deal-1", "customer_id": "cust-1", "project_id": "proj-1", "deal_stage": "negotiation"},
        {"id": "deal-2", "customer_id": "cust-1", "project_id": "proj-1", "deal_stage": "won"},
        {"id": "deal-3", "customer_id": "cust-1", "project_id": None, "deal_stage": "new_lead"},  # deal chua gan project nao
        {"id": "deal-4", "customer_id": "cust-1", "project_id": "proj-2", "deal_stage": "new_lead"},
    ]
    quotes = [
        # proj-1: chuoi X co V1 (pricing) + V2 (review, MOI HON) - CHI dem V2
        {"id": "qx1", "project_id": "proj-1", "version_chain_id": "chain-X", "version_number": 1, "processing_stage": "pricing", "status": "draft", "sent_at": None, "total_amount": 1000000},
        {"id": "qx2", "project_id": "proj-1", "version_chain_id": "chain-X", "version_number": 2, "processing_stage": "review", "status": "draft", "sent_at": None, "total_amount": 2000000},
        # proj-1: chuoi Y da gui (sent)
        {"id": "qy1", "project_id": "proj-1", "version_chain_id": "chain-Y", "version_number": 1, "processing_stage": "published", "status": "approved", "sent_at": "2026-09-01T00:00:00Z", "total_amount": 5000000},
        # proj-2: chuoi Z dang presale
        {"id": "qz1", "project_id": "proj-2", "version_chain_id": "chain-Z", "version_number": 1, "processing_stage": "request", "status": "draft", "sent_at": None, "total_amount": 3000000},
    ]
    store = {"projects": projects, "customer_leads": deals, "quotes": quotes}
    fake = FakeSupabase(store)
    query_calls = []

    with patch.object(svc, "get_supabase_client", return_value=fake):
        result = svc.get_customer_projects_summary("cust-1")

        record("Khong N+1: dung 3 truy van (projects, customer_leads, quotes) - khong phai 1 truy van rieng cho MOI project", len(query_calls) == 3, query_calls)

        record("Tong so du an = 2", result["projectCount"] == 2)
        record("Du an active = 1 (proj-1)", result["activeProjectCount"] == 1)
        record("Tong Co hoi CRM = 4 (ca deal chua gan project)", result["opportunityCount"] == 4)

        proj1 = next(p for p in result["projects"] if p["id"] == "proj-1")
        proj2 = next(p for p in result["projects"] if p["id"] == "proj-2")

        record("Proj-1: opportunityCount = 2 (deal-1, deal-2)", proj1["opportunityCount"] == 2)
        record("Proj-1: quoteCaseCount = 2 (chuoi X + chuoi Y, KHONG dem V1 rieng)", proj1["quoteCaseCount"] == 2)
        record("Proj-1: versionCount = 3 (V1+V2 cua X, V1 cua Y)", proj1["versionCount"] == 3)
        record("Proj-1: processingCount = 1 (chuoi X dang o 'review' = admin_review)", proj1["processingCount"] == 1)
        record("Proj-1: sentCount = 1 (chuoi Y da gui)", proj1["sentCount"] == 1)
        record("Proj-1: currentQuoteValue = 2.000.000 (V2 cua X) + 5.000.000 (Y) = 7.000.000, KHONG cong V1 cu (1tr)", proj1["currentQuoteValue"] == 7000000)

        record("Proj-2: opportunityCount = 1 (deal-4)", proj2["opportunityCount"] == 1)
        record("Proj-2: quoteCaseCount = 1", proj2["quoteCaseCount"] == 1)
        record("Proj-2: processingCount = 1 (dang 'request' = presale)", proj2["processingCount"] == 1)
        record("Proj-2: currentQuoteValue = 3.000.000", proj2["currentQuoteValue"] == 3000000)

        record("Tong quoteCaseCount toan bo = 3 (2 o proj-1 + 1 o proj-2)", result["quoteCaseCount"] == 3)
        record("Tong currentQuoteValue = 10.000.000 (7tr + 3tr)", result["currentQuoteValue"] == 10000000)

    # ── Khach hang chua co Project nao - tra ve rong, KHONG loi ─────────────
    empty_store = {"projects": [], "customer_leads": [], "quotes": []}
    fake_empty = FakeSupabase(empty_store)
    with patch.object(svc, "get_supabase_client", return_value=fake_empty):
        result_empty = svc.get_customer_projects_summary("cust-2")
        record("Khach hang chua co Project: projectCount=0, projects=[] (khong loi)", result_empty["projectCount"] == 0 and result_empty["projects"] == [])

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
