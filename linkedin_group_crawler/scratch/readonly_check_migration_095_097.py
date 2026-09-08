"""READ-ONLY check (chi .select(), KHONG insert/update/delete) xem migration
095/096/097 da apply dung chua tren DB that dang tro toi.
Chay: python scratch/readonly_check_migration_095_097.py
"""
import sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app.core.config  # noqa: F401
from app.core.supabase_client import get_supabase_client

supabase = get_supabase_client()


def try_select(label, table, columns):
    print(f"--- {label} ---")
    try:
        r = supabase.table(table).select(columns).limit(1).execute()
        print(f"  OK - table='{table}' cot='{columns}' truy van duoc, sample rows: {len(r.data or [])}")
        if r.data:
            print(f"  keys thuc te tren row mau: {sorted(r.data[0].keys())}")
    except Exception as exc:
        print(f"  LOI: {exc}")
    print()


print("=== 1) app_users.quote_business_role (migration 095) ===")
try_select("quote_business_role", "app_users", "id,role,quote_business_role")

print("=== 2) quote_delivery_channels.encrypted_app_password la TEXT (migration 096) ===")
try:
    r = supabase.table("quote_delivery_channels").select("id,encrypted_app_password,credential_updated_at").limit(1).execute()
    row = (r.data or [None])[0]
    if row:
        val = row.get("encrypted_app_password")
        print(f"  encrypted_app_password hien tai: {val!r} (type={type(val).__name__})")
        if val is not None and isinstance(val, str) and val.startswith("\\x"):
            print("  !!! CANH BAO: gia tri bat dau bang '\\x' - VAN la hex bytea output, chua thanh TEXT that !!!")
        elif val is None:
            print("  OK - dang NULL (dung ky vong sau migration 096 - can nhap lai App Password 1 lan)")
        else:
            print("  OK - gia tri la text thuong (khong phai hex bytea)")
    else:
        print("  Chua co dong nao trong quote_delivery_channels")
except Exception as exc:
    print(f"  LOI: {exc}")
print()

print("=== 3) projects (migration 097) ===")
try_select("projects", "projects", "id,project_code,name,customer_id,status,manager_id,team_id,created_by,created_at,updated_at")

print("=== 4) customer_leads.project_id (migration 097) ===")
try_select("customer_leads.project_id", "customer_leads", "id,project_id")

print("=== 5) quotes.project_id / sla_started_at / sla_due_at / completed_at (migration 097) ===")
try_select("quotes SLA+project fields", "quotes", "id,project_id,sla_started_at,sla_due_at,completed_at")

print("Tat ca deu la SELECT thuan tuy - khong co INSERT/UPDATE/DELETE nao chay trong script nay.")
