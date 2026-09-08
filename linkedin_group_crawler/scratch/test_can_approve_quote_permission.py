"""Pure unit test cho can_approve_quote() - KHONG ket noi DB, KHONG mutation,
chi goi truc tiep ham Python voi dict gia lap. Chay: python scratch/test_can_approve_quote_permission.py
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.modules.all_platform.services.crm_permission_service import can_approve_quote

cases = [
    (None, False, "user None -> khong duyet duoc"),
    ({"role": "admin"}, True, "role=admin -> luon duyet duoc du khong co cờ can_approve_quotes"),
    ({"role": "Admin"}, True, "role khong phan biet hoa/thuong"),
    ({"role": "leader", "can_approve_quotes": False}, False, "leader KHONG co co -> khong duyet duoc (thay doi hanh vi that so voi truoc)"),
    ({"role": "leader", "can_approve_quotes": True}, True, "leader co co that -> duyet duoc"),
    ({"role": "member", "can_approve_quotes": True}, True, "member co co that -> duyet duoc"),
    ({"role": "member", "can_approve_quotes": False}, False, "member khong co co -> khong duyet duoc"),
    ({"role": "member"}, False, "member thieu han field can_approve_quotes (None) -> khong duyet duoc"),
]

failed = 0
for user, expected, desc in cases:
    actual = can_approve_quote(user)
    status = "PASS" if actual == expected else "FAIL"
    if actual != expected:
        failed += 1
    print(f"[{status}] {desc}: can_approve_quote({user!r}) = {actual} (expected {expected})")

print()
if failed:
    print(f"{failed}/{len(cases)} FAILED")
    sys.exit(1)
print(f"All {len(cases)} cases passed.")
