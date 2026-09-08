"""Unit test THUAN (khong DB that) cho phan SLA trong
set_quote_processing_stage() (supabase_quote_service.py) - validate
sla_due_at bat buoc + tuong lai khi Sale "Gui yeu cau xu ly" (request->
technical) LAN DAU, va set sla_started_at=now() dung 1 lan (khong ghi de
neu da co).
Chay: python scratch/test_quote_sla_transition.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


class FakeTable:
    def __init__(self, store, name):
        self.store = store
        self.name = name
        self._update_payload = None
        self._filters = {}

    def update(self, payload):
        self._update_payload = payload
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def is_(self, field, _value):
        self._filters[f"{field}__is_null"] = True
        return self

    def execute(self):
        if self._update_payload is not None:
            self.store.setdefault(f"{self.name}__updates", []).append({**self._update_payload, "_filters": dict(self._filters)})
        return MagicMock(data=[])


class FakeSupabase:
    def __init__(self):
        self.store = {}
        self.rpc_calls = []

    def table(self, name):
        return FakeTable(self.store, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        call = self

        class _Call:
            def execute(_self):
                return MagicMock(data=None)
        return _Call()


def run():
    from app.modules.all_platform.services import supabase_quote_service as svc

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    # ── 1) Thieu sla_due_at -> tu choi, KHONG goi RPC ───────────────────────
    fake1 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake1), \
         patch.object(svc, "get_quote", return_value={"processingStage": "request", "slaDueAt": None, "slaStartedAt": None}):
        try:
            svc.set_quote_processing_stage("q1", "u-sale", "technical")
            record("Thieu sla_due_at -> phai raise ValueError", False)
        except ValueError as e:
            record("Thieu sla_due_at -> raise ValueError dung", "SLA" in str(e))
        record("Thieu sla_due_at -> KHONG goi RPC (chan truoc khi goi)", len(fake1.rpc_calls) == 0)

    # ── 2) sla_due_at trong QUA KHU -> tu choi ──────────────────────────────
    fake2 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake2), \
         patch.object(svc, "get_quote", return_value={"processingStage": "request", "slaDueAt": past, "slaStartedAt": None}):
        try:
            svc.set_quote_processing_stage("q2", "u-sale", "technical")
            record("sla_due_at qua khu -> phai raise ValueError", False)
        except ValueError as e:
            record("sla_due_at qua khu -> raise ValueError dung", "tương lai" in str(e))

    # ── 3) sla_due_at hop le, sla_started_at CHUA co -> RPC thanh cong + set sla_started_at 1 LAN ──
    fake3 = FakeSupabase()
    call_count = {"n": 0}

    def fake_get_quote(quote_id):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"processingStage": "request", "slaDueAt": future, "slaStartedAt": None}
        return {"processingStage": "technical", "slaDueAt": future, "slaStartedAt": "2026-01-01T00:00:00Z"}

    with patch.object(svc, "get_supabase_client", return_value=fake3), \
         patch.object(svc, "get_quote", side_effect=fake_get_quote):
        result = svc.set_quote_processing_stage("q3", "u-sale", "technical")
        record("sla_due_at hop le -> RPC duoc goi dung 1 lan", len(fake3.rpc_calls) == 1)
        sla_updates = fake3.store.get("quotes__updates", [])
        record("sla_started_at duoc set dung 1 lan (1 update call)", len(sla_updates) == 1)
        if sla_updates:
            record("Update chi target dong dang sla_started_at=NULL (is_ filter)", sla_updates[0]["_filters"].get("sla_started_at__is_null") is True)

    # ── 4) sla_started_at DA CO tu truoc -> KHONG ghi de (khong update lai) ──
    fake4 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake4), \
         patch.object(svc, "get_quote", return_value={"processingStage": "request", "slaDueAt": future, "slaStartedAt": "2026-01-01T00:00:00Z"}):
        svc.set_quote_processing_stage("q4", "u-sale", "technical")
        record("sla_started_at DA CO tu truoc -> KHONG goi update lai (tranh ghi de)", "quotes__updates" not in fake4.store)

    # ── 5) Chuyen stage KHAC (vd pricing->review) -> KHONG dong toi SLA gi ca ──
    fake5 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake5), \
         patch.object(svc, "get_quote", return_value={"processingStage": "pricing", "slaDueAt": None, "slaStartedAt": None}):
        svc.set_quote_processing_stage("q5", "u-sale", "review")
        record("Chuyen pricing->review (khong phai request->technical) -> khong validate SLA gi ca", "quotes__updates" not in fake5.store)
        record("Chuyen pricing->review -> RPC van duoc goi binh thuong", len(fake5.rpc_calls) == 1)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
