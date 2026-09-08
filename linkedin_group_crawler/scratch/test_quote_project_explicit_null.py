"""Unit test THUAN (khong DB that) cho bug "bo chon Project khong luu duoc"
- exclude_none=True xoa mat y nghia "gui null CO Y" (bo gan) khoi "khong gui
gi ca" (giu nguyen). Test o 2 tang:
  1) quotes_update() router - dung model_fields_set dung cach phan biet.
  2) update_quote() service - validate Project phai DUNG khach hang voi
     bao gia (khong cho gan cheo khach hang), va _validate_project_matches_
     quote_customer() chiu duoc .maybe_single() tra ve None (bai hoc cu).
Chay: python scratch/test_quote_project_explicit_null.py
"""
import os
import sys
from unittest.mock import MagicMock, patch

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
        self._update_payload = None
        self._maybe_single = False

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def execute(self):
        if self._update_payload is not None:
            self.store.setdefault(f"{self.name}__updates", []).append(dict(self._update_payload))
            return FakeQueryResult(data=[dict(self._update_payload)])
        rows = self.store.get(self.name, {})
        row = rows.get(self._filters.get("id"))
        if self._maybe_single:
            return FakeQueryResult(data=row) if row else None
        return FakeQueryResult(data=[row] if row else [])


class FakeRpcCall:
    def execute(self):
        return MagicMock(data=None)


class FakeSupabase:
    def __init__(self, quotes=None, customer_leads=None, projects=None):
        self.store = {
            "quotes": quotes or {},
            "customer_leads": customer_leads or {},
            "projects": projects or {},
        }

    def table(self, name):
        return FakeTable(self.store, name)

    def rpc(self, _name, _params):
        return FakeRpcCall()


def run():
    from app.modules.all_platform.schemas.quote import QuoteUpdateRequest
    from app.modules.all_platform.services import supabase_quote_service as svc

    # ── 1) Pydantic model_fields_set - phan biet dung "khong gui" vs "gui null" ──
    not_sent = QuoteUpdateRequest(data={"a": 1})
    record("Khong gui project_id -> KHONG co trong model_fields_set", "project_id" not in not_sent.model_fields_set)

    sent_null = QuoteUpdateRequest(project_id=None)
    record("Gui project_id=null RO RANG -> CO trong model_fields_set", "project_id" in sent_null.model_fields_set)

    sent_value = QuoteUpdateRequest(project_id="project-1")
    record("Gui project_id='project-1' -> CO trong model_fields_set, dung gia tri", "project_id" in sent_value.model_fields_set and sent_value.project_id == "project-1")

    # ── 2) _validate_project_matches_quote_customer() - dung khach hang -> OK ──
    fake_ok = FakeSupabase(
        quotes={"q1": {"deal_id": "deal-1"}},
        customer_leads={"deal-1": {"customer_id": "cust-A"}},
        projects={"project-1": {"customer_id": "cust-A"}},
    )
    with patch.object(svc, "get_supabase_client", return_value=fake_ok):
        try:
            svc._validate_project_matches_quote_customer("q1", "project-1")
            record("Project DUNG khach hang cua bao gia -> khong raise", True)
        except ValueError as e:
            record("Project DUNG khach hang cua bao gia -> khong raise", False, str(e))

    # ── 3) Project SAI khach hang -> raise ValueError ro rang ──────────────
    fake_wrong = FakeSupabase(
        quotes={"q1": {"deal_id": "deal-1"}},
        customer_leads={"deal-1": {"customer_id": "cust-A"}},
        projects={"project-2": {"customer_id": "cust-B"}},
    )
    with patch.object(svc, "get_supabase_client", return_value=fake_wrong):
        try:
            svc._validate_project_matches_quote_customer("q1", "project-2")
            record("Project SAI khach hang -> phai raise ValueError", False)
        except ValueError as e:
            record("Project SAI khach hang -> raise ValueError dung", "khách hàng" in str(e))

    # ── 4) Bao gia CHUA gan Co hoi (deal_id=None) -> bo qua validate (khong doan) ──
    fake_no_deal = FakeSupabase(quotes={"q2": {"deal_id": None}})
    with patch.object(svc, "get_supabase_client", return_value=fake_no_deal):
        try:
            svc._validate_project_matches_quote_customer("q2", "project-x")
            record("Bao gia chua gan Co hoi -> bo qua validate, khong raise", True)
        except ValueError as e:
            record("Bao gia chua gan Co hoi -> bo qua validate, khong raise", False, str(e))

    # ── 5) Project khong ton tai -> raise ValueError ro rang (khong crash .data) ──
    fake_missing_project = FakeSupabase(
        quotes={"q1": {"deal_id": "deal-1"}},
        customer_leads={"deal-1": {"customer_id": "cust-A"}},
        projects={},
    )
    with patch.object(svc, "get_supabase_client", return_value=fake_missing_project):
        try:
            svc._validate_project_matches_quote_customer("q1", "project-khong-ton-tai")
            record("Project khong ton tai -> phai raise ValueError", False)
        except ValueError as e:
            record("Project khong ton tai -> raise ValueError dung (khong crash)", "dự án" in str(e).lower())

    # ── 6) update_quote(): gui project_id=None (bo gan) -> update DUNG 1 lan voi None ──
    fake_clear = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake_clear), \
         patch.object(svc, "get_quote", return_value={"id": "q1"}):
        svc.update_quote("q1", {"project_id": None}, "u-admin")
        updates = fake_clear.store.get("quotes__updates", [])
        record("update_quote({'project_id': None}): co update, project_id=None (clear that su)", len(updates) == 1 and updates[0].get("project_id") is None and "project_id" in updates[0])

    # ── 7) update_quote(): KHONG gui project_id gi ca -> KHONG dong toi cot nay ──
    fake_untouched = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake_untouched), \
         patch.object(svc, "get_quote", return_value={"id": "q1"}):
        svc.update_quote("q1", {"data": {"a": 1}}, "u-admin")
        updates = fake_untouched.store.get("quotes__updates", [])
        record("update_quote({'data': ...}) khong dong toi project_id: KHONG co update project_id nao", len(updates) == 0)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
