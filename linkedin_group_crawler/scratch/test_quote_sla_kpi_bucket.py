"""Test THUAN (pure unit, khong DB) cho Section 7 - KPI SLA Quote Center.
_quote_sla_bucket() la ham thuan (chi nhan dict + datetime, khong goi
Supabase) - mirror dung nguong/dieu kien voi computeQuoteSla() o FE
(modules/crm/utils/quoteSla.ts), dung lam nguon dem KPI "quá hạn"/"sắp đến
hạn" TRUOC pagination trong list_quotes_by_phase()."""
import sys
sys.path.insert(0, '.')

from datetime import datetime, timedelta, timezone

from app.modules.all_platform.services.supabase_quote_service import _quote_sla_bucket

NOW = datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


CASES = [
    ({"sla_due_at": None}, "other", "Chua dat SLA"),
    ({"sla_due_at": iso(NOW - timedelta(hours=1))}, "overdue", "Da qua han, chua hoan thanh"),
    ({"sla_due_at": iso(NOW + timedelta(hours=2))}, "due_soon", "Con <=4h (dung nguong QUOTE_SLA_DUE_SOON_THRESHOLD)"),
    ({"sla_due_at": iso(NOW + timedelta(hours=4, seconds=1))}, "other", "Vua qua nguong 4h -> KHONG tinh la sap den han"),
    ({"sla_due_at": iso(NOW + timedelta(hours=10))}, "other", "Con nhieu hon 4h"),
    (
        {"sla_due_at": iso(NOW - timedelta(hours=5)), "completed_at": iso(NOW - timedelta(hours=6))},
        "other",
        "DA HOAN THANH (completed_at) - KHONG duoc tinh la qua han du sla_due_at da qua (dung yeu cau khong dem hoan thanh la qua han)",
    ),
    (
        {"sla_due_at": iso(NOW - timedelta(hours=5)), "sent_at": iso(NOW - timedelta(hours=6))},
        "other",
        "Da gui (sent_at, fallback hoan thanh cu) - KHONG tinh la qua han",
    ),
    ({"sla_due_at": "not-a-real-timestamp"}, "other", "sla_due_at hong dinh dang -> an toan tra 'other', khong crash"),
]

failures: list[str] = []
for row, expected, label in CASES:
    got = _quote_sla_bucket(row, NOW)
    ok = got == expected
    print(f"[{'PASS' if ok else 'FAIL'}] {label} -> got={got!r} expected={expected!r}")
    if not ok:
        failures.append(label)

print()
if failures:
    print(f"{len(failures)} CHECK FAILED:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
else:
    print("ALL CHECKS PASSED (pure unit, khong cham DB that).")
