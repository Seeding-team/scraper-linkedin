"""Pure unit test cho permission matrix moi (can_edit_technical_quote/
can_edit_quote_pricing/can_transition_quote_stage/can_approve_quote) - KHONG
ket noi DB, goi truc tiep ham Python that voi dict gia lap.
Chay: python scratch/test_quote_permission_matrix.py
"""
import sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.modules.all_platform.services.crm_permission_service import (
    can_approve_quote,
    can_edit_technical_quote,
    can_edit_quote_pricing,
    can_transition_quote_stage,
)

failed = 0
def check(label, actual, expected):
    global failed
    ok = actual == expected
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: {actual} (expected {expected})")
    if not ok:
        failed += 1

ADMIN = {"id": "u-admin", "role": "admin"}
LEADER_NO_FLAG = {"id": "u-leader", "role": "leader", "can_approve_quotes": False}
LEADER_WITH_FLAG = {"id": "u-leader2", "role": "leader", "can_approve_quotes": True}
MEMBER_NO_FLAG = {"id": "u-member", "role": "member", "can_approve_quotes": False}
MEMBER_WITH_FLAG = {"id": "u-member2", "role": "member", "can_approve_quotes": True}
TECH_OWNER = {"id": "u-tech", "role": "member", "can_approve_quotes": False}
PRICING_OWNER = {"id": "u-pricing", "role": "member", "can_approve_quotes": False}
STRANGER = {"id": "u-stranger", "role": "member", "can_approve_quotes": False}

QUOTE = {"technicalOwnerId": "u-tech", "quoteOwnerId": "u-pricing"}

print("=== 1) can_approve_quote (Section 4.C yeu cau) ===")
check("Admin -> duyet duoc", can_approve_quote(ADMIN), True)
check("User co can_approve_quotes -> duyet duoc", can_approve_quote(MEMBER_WITH_FLAG), True)
check("Leader KHONG co flag -> khong duyet duoc", can_approve_quote(LEADER_NO_FLAG), False)
check("Member KHONG co flag -> khong duyet duoc", can_approve_quote(MEMBER_NO_FLAG), False)
check("Anonymous (None) -> khong duyet duoc", can_approve_quote(None), False)

print()
print("=== 2) can_edit_technical_quote (chi technical_owner/full-CRM-access) ===")
check("Technical owner dung nguoi -> sua duoc", can_edit_technical_quote(TECH_OWNER, QUOTE), True)
check("Pricing owner (KHONG phai tech) -> khong sua duoc phan ky thuat", can_edit_technical_quote(PRICING_OWNER, QUOTE), False)
check("Nguoi la khac hoan toan -> khong sua duoc", can_edit_technical_quote(STRANGER, QUOTE), False)
check("Admin -> luon sua duoc (full CRM access)", can_edit_technical_quote(ADMIN, QUOTE), True)
check("Anonymous -> khong sua duoc", can_edit_technical_quote(None, QUOTE), False)

print()
print("=== 3) can_edit_quote_pricing (chi quote_owner/full-CRM-access) ===")
check("Pricing owner dung nguoi -> sua duoc", can_edit_quote_pricing(PRICING_OWNER, QUOTE), True)
check("Technical owner (KHONG phai pricing) -> khong sua duoc gia ban", can_edit_quote_pricing(TECH_OWNER, QUOTE), False)
check("Nguoi la khac hoan toan -> khong sua duoc", can_edit_quote_pricing(STRANGER, QUOTE), False)
check("Admin -> luon sua duoc", can_edit_quote_pricing(ADMIN, QUOTE), True)

print()
print("=== 4) can_transition_quote_stage (dung nguoi dung buoc) ===")
check("Technical owner chuyen sang 'technical' -> duoc", can_transition_quote_stage(TECH_OWNER, QUOTE, "technical"), True)
check("Technical owner chuyen sang 'pricing' (ban giao) -> duoc", can_transition_quote_stage(TECH_OWNER, QUOTE, "pricing"), True)
check("Technical owner chuyen sang 'review' -> KHONG duoc (phai la pricing owner)", can_transition_quote_stage(TECH_OWNER, QUOTE, "review"), False)
check("Pricing owner chuyen sang 'review' (hoan tat gia ban) -> duoc", can_transition_quote_stage(PRICING_OWNER, QUOTE, "review"), True)
check("Pricing owner chuyen sang 'pricing' -> KHONG duoc (phai la technical owner)", can_transition_quote_stage(PRICING_OWNER, QUOTE, "pricing"), False)
check("Nguoi la khac hoan toan -> khong chuyen duoc stage nao", can_transition_quote_stage(STRANGER, QUOTE, "technical"), False)
check("Admin -> chuyen duoc moi stage", can_transition_quote_stage(ADMIN, QUOTE, "review"), True)

print()
if failed:
    print(f"{failed} case FAILED")
    sys.exit(1)
print("Tat ca case pass.")
print()
print("LUU Y: day la unit test THUAN cho logic Python (permission functions).")
print("Logic validate du lieu trong SQL (quote_set_processing_stage RPC, migration 089)")
print("moi duoc REVIEW TINH (static review), CHUA duoc thuc thi tren DB that vi")
print("chua co TEST_SUPABASE_URL - se chay lai bang integration test khi co DB test.")
