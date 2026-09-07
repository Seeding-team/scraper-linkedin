"""Unit test THUAN (khong DB that) cho bug THAT da phat hien qua live
read-only audit: 4 quote 'Admin review' that su co status='approved'
nhung processing_stage con ket dinh 'review' (RPC quote_approve() cac ban
TRUOC migration 089 khong dong bo 2 cot cung luc). approve_quote() (Python)
gio phai TU EP processing_stage='ready_to_publish' SAU RPC neu quote da
approved nhung stage chua toi ready_to_publish/published - bao ve ca truong
hop DB dang chay RPC cu HOAC RPC dung nhung loi khac.
Chay: python scratch/test_approve_quote_stage_sync.py
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

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def is_(self, *_a, **_k):
        return self

    def single(self):
        return self

    def order(self, *_a, **_k):
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def execute(self):
        if self._update_payload is not None:
            self.store.setdefault(f"{self.name}__updates", []).append(dict(self._update_payload))
            row = self.store["quotes"][self._filters.get("id")]
            row.update(self._update_payload)
            return FakeQueryResult(data=[row])
        row = self.store["quotes"].get(self._filters.get("id"))
        return FakeQueryResult(data=row)


class FakeRpc:
    def __init__(self, store, result_status, result_stage):
        self.store = store
        self.result_status = result_status
        self.result_stage = result_stage

    def execute(self):
        # Mo phong DUNG hanh vi RPC that (co the la ban CU khong dong bo
        # stage, hoac ban MOI dong bo dung) - test tu cau hinh ket qua RPC
        # tra ve de kiem tra Python co TU SUA hay khong.
        row = self.store["quotes"]["q1"]
        row["status"] = self.result_status
        row["processing_stage"] = self.result_stage
        return MagicMock(data=row)


class FakeSupabase:
    def __init__(self, initial_row, rpc_result_status, rpc_result_stage):
        self.store = {"quotes": {"q1": dict(initial_row)}}
        self.rpc_result_status = rpc_result_status
        self.rpc_result_stage = rpc_result_stage

    def table(self, name):
        return FakeTable(self.store, name)

    def rpc(self, _name, _params):
        return FakeRpc(self.store, self.rpc_result_status, self.rpc_result_stage)


def run():
    from app.modules.all_platform.services import supabase_quote_service as svc

    # ── 1) RPC (ban CU, bug that) tra ve approved nhung stage van 'review' ──
    fake_old_rpc = FakeSupabase(
        {"id": "q1", "status": "draft", "processing_stage": "review", "quote_form_id": "f1", "quote_number": "BG-1", "form_schema_version": 1},
        rpc_result_status="approved", rpc_result_stage="review",
    )
    with patch.object(svc, "get_supabase_client", return_value=fake_old_rpc), patch.object(svc, "_quote_items", return_value=[]):
        result = svc.approve_quote("q1", "u-admin")
        record(
            "RPC cu (bug) tra ve stage='review' nhung status='approved' -> Python TU SUA thanh 'ready_to_publish'",
            result["processingStage"] == "ready_to_publish",
        )
        updates = fake_old_rpc.store.get("quotes__updates", [])
        record("Co 1 update rieng tu Python de sua processing_stage", len(updates) == 1 and updates[0].get("processing_stage") == "ready_to_publish")

    # ── 2) RPC (ban MOI, dung) da tu dong bo dung -> Python KHONG can update them ──
    fake_new_rpc = FakeSupabase(
        {"id": "q1", "status": "draft", "processing_stage": "review", "quote_form_id": "f1", "quote_number": "BG-1", "form_schema_version": 1},
        rpc_result_status="approved", rpc_result_stage="ready_to_publish",
    )
    with patch.object(svc, "get_supabase_client", return_value=fake_new_rpc), patch.object(svc, "_quote_items", return_value=[]):
        result = svc.approve_quote("q1", "u-admin")
        record("RPC moi (dung) tra ve dung 'ready_to_publish' -> van dung", result["processingStage"] == "ready_to_publish")
        updates = fake_new_rpc.store.get("quotes__updates", [])
        record("RPC da dung roi -> Python KHONG can goi update() them (tranh ghi du khong can thiet)", len(updates) == 0)

    # ── 3) Quote da o 'published' (approved tu truoc, da phat hanh) -> KHONG
    # DUOC LUI ve 'ready_to_publish' ────────────────────────────────────────
    fake_published = FakeSupabase(
        {"id": "q1", "status": "draft", "processing_stage": "published", "quote_form_id": "f1", "quote_number": "BG-1", "form_schema_version": 1},
        rpc_result_status="approved", rpc_result_stage="published",
    )
    with patch.object(svc, "get_supabase_client", return_value=fake_published), patch.object(svc, "_quote_items", return_value=[]):
        result = svc.approve_quote("q1", "u-admin")
        record("Quote da 'published' -> processing_stage GIU NGUYEN 'published' (khong lui lai)", result["processingStage"] == "published")
        updates = fake_published.store.get("quotes__updates", [])
        record("Khong co update thua nao khi da o 'published'", len(updates) == 0)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
