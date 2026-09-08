"""Unit test THUAN (khong DB that) cho _derive_quote_phase() va
list_quotes_by_phase() - dung DUNG yeu cau nghiep vu: phase suy tu
processing_stage/status/sent_at THAT, gom theo version_chain_id (1 dong =
1 Quote Case), dem/loc/phan trang o backend.
Chay: python scratch/test_quote_phase_mapping.py
"""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


def run():
    from app.modules.all_platform.services import supabase_quote_service as svc

    # ── 1) _derive_quote_phase() - mapping thuan ────────────────────────────
    record("request -> presale", svc._derive_quote_phase({"processing_stage": "request", "status": "draft"}) == "presale")
    record("technical -> presale", svc._derive_quote_phase({"processing_stage": "technical", "status": "draft"}) == "presale")
    record("pricing -> sale_markup", svc._derive_quote_phase({"processing_stage": "pricing", "status": "draft"}) == "sale_markup")
    record("review -> admin_review", svc._derive_quote_phase({"processing_stage": "review", "status": "draft"}) == "admin_review")
    record("ready_to_publish -> ready_to_send (cho phat hanh)", svc._derive_quote_phase({"processing_stage": "ready_to_publish", "status": "approved"}) == "ready_to_send")
    record("published + sent_at=None -> ready_to_send (cho gui)", svc._derive_quote_phase({"processing_stage": "published", "status": "approved", "sent_at": None}) == "ready_to_send")
    record("published + co sent_at -> sent", svc._derive_quote_phase({"processing_stage": "published", "status": "approved", "sent_at": "2026-09-01T00:00:00Z"}) == "sent")
    record("status='cancelled' bat ky stage nao -> None (loai khoi moi dem)", svc._derive_quote_phase({"processing_stage": "pricing", "status": "cancelled"}) is None)
    record("processing_stage=None (quote cu) -> mac dinh 'request' -> presale", svc._derive_quote_phase({"processing_stage": None, "status": "draft"}) == "presale")

    # ── 1b) BUG THAT DA PHAT HIEN (live, read-only, 4 quote that): status=
    # 'approved' nhung processing_stage con ket dinh 'review' (RPC quote_
    # approve() TRUOC migration 089 khong dong bo 2 cot nay) - PHAI uu tien
    # status THAT, khong con hien nham "Cho Admin duyet" cho quote DA duyet ──
    record(
        "status='approved' + stage con ket dinh 'review' (du lieu cu) -> PHAI la ready_to_send, KHONG con la admin_review",
        svc._derive_quote_phase({"processing_stage": "review", "status": "approved"}) == "ready_to_send",
    )
    record(
        "status='approved' + stage con ket dinh 'pricing' (du lieu cu hon nua) -> van la ready_to_send",
        svc._derive_quote_phase({"processing_stage": "pricing", "status": "approved"}) == "ready_to_send",
    )
    record(
        "status='approved' + stage DUNG 'ready_to_publish' -> van la ready_to_send (khong doi hanh vi dung)",
        svc._derive_quote_phase({"processing_stage": "ready_to_publish", "status": "approved"}) == "ready_to_send",
    )
    record(
        "status='approved' + stage='published' + sent_at co -> van uu tien nhanh 'sent' (khong bi status='approved' che mat)",
        svc._derive_quote_phase({"processing_stage": "published", "status": "approved", "sent_at": "2026-09-01T00:00:00Z"}) == "sent",
    )

    # ── 1c) THU TU UU TIEN DAY DU (chot lai theo yeu cau) - 6 state mau
    # thuan bat buoc phai test rieng, KHONG duoc de status='approved' ghi de
    # sent/published (day la dieu nguoc lai voi bug da fix o 1b - phai chac
    # chan KHONG fix qua tay theo huong khac) ──────────────────────────────
    record(
        "approved + processing_stage='review' (khong sent/published) -> ready_to_send (dung nhu 1b)",
        svc._derive_quote_phase({"status": "approved", "processing_stage": "review"}) == "ready_to_send",
    )
    record(
        "approved + published_at co gia tri (bat ke processing_stage con la gi) -> ready_to_send, KHONG bi status che mat huong SAI",
        svc._derive_quote_phase({"status": "approved", "processing_stage": "review", "published_at": "2026-09-02T00:00:00Z"}) == "ready_to_send",
    )
    record(
        "approved + sent_at co gia tri -> PHAI la 'sent' (tin hieu manh nhat, status khong duoc ghi de xuong ready_to_send)",
        svc._derive_quote_phase({"status": "approved", "processing_stage": "review", "sent_at": "2026-09-03T00:00:00Z"}) == "sent",
    )
    record(
        "draft + processing_stage='published' (chua tung approve, du lieu la thuong) -> van la ready_to_send (processing_stage that duoc tin)",
        svc._derive_quote_phase({"status": "draft", "processing_stage": "published"}) == "ready_to_send",
    )
    record(
        "cancelled + sent_at co gia tri -> VAN la None (huy la tin hieu manh nhat, dung ca khi da tung gui)",
        svc._derive_quote_phase({"status": "cancelled", "processing_stage": "published", "sent_at": "2026-09-01T00:00:00Z"}) is None,
    )
    record(
        "soft-deleted (deleted_at co gia tri) + approved -> None (xoa mem loai khoi moi dem, bat ke status)",
        svc._derive_quote_phase({"status": "approved", "processing_stage": "ready_to_publish", "deleted_at": "2026-09-01T00:00:00Z"}) is None,
    )

    # ── 2) list_quotes_by_phase() - gom chuoi + dem + loc + phan trang ──────
    now_base = "2026-09-01T00:00:00Z"

    def make_row(id_, chain, version, stage, status="draft", sent_at=None, updated_at=now_base):
        return {
            "id": id_, "deal_id": None, "quote_number": f"BG-{id_}",
            "quote_form_id": "form-1", "form_schema_version": 1,
            "version_chain_id": chain, "version_number": version,
            "processing_stage": stage, "status": status, "sent_at": sent_at,
            "created_at": updated_at, "updated_at": updated_at,
        }

    slim_rows = [
        # Chuoi A: V1 (pricing) + V2 (review, MOI HON) -> chi tinh V2 = admin_review
        make_row("a1", "chain-A", 1, "pricing"),
        make_row("a2", "chain-A", 2, "review"),
        # Chuoi B: 1 quote don, request -> presale
        make_row("b1", "chain-B", 1, "request"),
        # Chuoi C: da huy -> loai hoan toan
        make_row("c1", "chain-C", 1, "pricing", status="cancelled"),
        # Chuoi D, E, F: sale_markup them cho du phan trang
        make_row("d1", "chain-D", 1, "pricing"),
        make_row("e1", "chain-E", 1, "pricing"),
        make_row("f1", "chain-F", 1, "pricing"),
    ]

    full_rows_by_id = {r["id"]: {**r, "items": []} for r in slim_rows}

    class FakeTable:
        def __init__(self, mode):
            self.mode = mode  # 'slim' hoac 'full'
            self._ids = None

        def select(self, *_a, **_k):
            return self

        def is_(self, *_a, **_k):
            return self

        def in_(self, field, ids):
            self._ids = ids
            return self

        def execute(self):
            if self.mode == "slim":
                return MagicMock(data=slim_rows)
            return MagicMock(data=[full_rows_by_id[i] for i in (self._ids or []) if i in full_rows_by_id])

    class FakeSupabase:
        def table(self, name):
            return FakeTable("slim")

    # _quote_items goi truy van rieng - mock luon de tra ve [] (khong quan
    # trong noi dung item trong test nay).
    with patch.object(svc, "get_supabase_client", return_value=FakeSupabase()), \
         patch.object(svc, "_quote_items", return_value=[]):
        result_all = svc.list_quotes_by_phase(phase=None, page=1, page_size=10)
        record("Counts: presale=1 (chuoi B - chuoi A da chuyen sang review, KHONG dem V1 cu)", result_all["counts"]["presale"] == 1)
        record("Counts: admin_review=1 (chuoi A, dung dem CURRENT=V2, khong dem ca 2 version)", result_all["counts"]["admin_review"] == 1)
        record("Counts: sale_markup=3 (chuoi D/E/F)", result_all["counts"]["sale_markup"] == 3)
        record("Counts: 'all' = tong 5 bucket (khong tinh chuoi C da huy)", result_all["counts"]["all"] == 5)
        record("Chuoi C (cancelled) KHONG xuat hien trong items", all(item["id"] != "c1" for item in result_all["items"]))

        result_presale = svc.list_quotes_by_phase(phase="presale", page=1, page_size=10)
        record("Loc phase='presale': chi tra ve chuoi B (1 dong)", len(result_presale["items"]) == 1 and result_presale["items"][0]["id"] == "b1")
        record("Item tra ve co dung field 'phase'='presale'", result_presale["items"][0]["phase"] == "presale")
        record("Chuoi B (1 version) -> versionCount=1", result_presale["items"][0]["versionCount"] == 1)

        result_admin_review = svc.list_quotes_by_phase(phase="admin_review", page=1, page_size=10)
        record("Chuoi A (V1+V2) -> versionCount=2 (dem CA chuoi, khong phai 1)", result_admin_review["items"][0]["id"] == "a2" and result_admin_review["items"][0]["versionCount"] == 2)

        result_page1 = svc.list_quotes_by_phase(phase="sale_markup", page=1, page_size=2)
        record("Phan trang: page_size=2 -> chi tra ve 2/3 item", len(result_page1["items"]) == 2)
        record("Phan trang: total=3 (dung tong so, khong phai so tren trang)", result_page1["total"] == 3)
        result_page2 = svc.list_quotes_by_phase(phase="sale_markup", page=2, page_size=2)
        record("Phan trang: trang 2 con 1 item con lai", len(result_page2["items"]) == 1)

        try:
            svc.list_quotes_by_phase(phase="invalid_phase")
            record("phase khong hop le -> phai raise ValueError", False)
        except ValueError:
            record("phase khong hop le -> raise ValueError dung", True)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
