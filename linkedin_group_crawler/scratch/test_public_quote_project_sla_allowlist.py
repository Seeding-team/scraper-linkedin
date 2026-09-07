"""Unit test THUAN (khong DB) xac nhan _row_to_public_quote() KHONG BAO GIO
lo cac field noi bo MOI them (migration 097: project manager/team, SLA that)
- allowlist tuong minh, khong ke thua tu _row_to_quote(). Bo sung cho
scratch/test_public_quote_security.py (dang fail vi ly do khac, khong lien
quan - test nay CHI kiem tra allowlist, khong dung DB that).
Chay: python scratch/test_public_quote_project_sla_allowlist.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


def run():
    from app.modules.all_platform.services.supabase_quote_service import _row_to_public_quote

    fake_row = {
        "id": "q1", "deal_id": "d1", "quote_form_id": "f1", "quote_number": "BG-001",
        "status": "approved", "form_schema_version": 1, "form_snapshot": {"sections": []},
        "data": {}, "subtotal_amount": 100, "vat_amount": 10, "total_amount": 110,
        "currency": "VND", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
        "version_chain_id": "chain-1", "version_number": 1,
        # Field NOI BO moi (migration 097) - PHAI KHONG xuat hien trong output public.
        "project_id": "project-1",
        "sla_started_at": "2026-01-01T00:00:00Z",
        "sla_due_at": "2026-01-05T00:00:00Z",
        "completed_at": "2026-01-04T00:00:00Z",
        "technical_owner_id": "u-presale",
        "quote_owner_id": "u-sale",
    }

    public = _row_to_public_quote(fake_row, [])

    for forbidden_key in ["projectId", "slaStartedAt", "slaDueAt", "completedAt", "technicalOwnerId", "quoteOwnerId", "project_id", "sla_started_at", "sla_due_at", "completed_at"]:
        record(f"Public quote KHONG chua field noi bo '{forbidden_key}'", forbidden_key not in public)

    record("Public quote VAN co du field khach hang can (quoteNumber)", public.get("quoteNumber") == "BG-001")

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
