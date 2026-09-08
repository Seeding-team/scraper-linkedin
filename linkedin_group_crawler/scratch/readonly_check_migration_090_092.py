"""READ-ONLY check (chi .select(), KHONG insert/update/delete nao) xem
migration 090/091/092 da apply dung nhung gi tren DB that dang tro toi -
dung TRUOC KHI viet migration 093 (khong duoc gia dinh schema, phai doc that).
Chay: python scratch/readonly_check_migration_090_092.py
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


print("=== 1) quote_items.cost_not_applicable (migration 090) ===")
try_select("cost_not_applicable", "quote_items", "id,cost_price,markup_percent,cost_not_applicable")

print("=== 2) quote_approval_rule_sets / rules / evaluations (migration 091) ===")
try_select("quote_approval_rule_sets", "quote_approval_rule_sets", "id,name,version,is_active,auto_approve_enabled")
try_select("quote_approval_rules", "quote_approval_rules", "id,rule_set_id,rule_type,operator,threshold_value,unit,is_required,display_order,is_active")
try_select("quote_rule_evaluations", "quote_rule_evaluations", "id,quote_id,rule_set_id,rule_set_version,result,evaluated_at")

print("=== 3) quote_delivery_channels (migration 092) - CHECK CO cot connection_status hay khong ===")
try_select("quote_delivery_channels (core fields)", "quote_delivery_channels", "id,channel_type,display_name,is_enabled,sender_name,sender_address,imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,encrypted_app_password,credential_updated_at,credential_updated_by")
try_select("quote_delivery_channels (connection_status fields - co the CHUA co)", "quote_delivery_channels", "id,imap_connection_status,imap_last_tested_at,smtp_connection_status,smtp_last_tested_at")

print("=== 4) quote_delivery_channel_audit_log (chi co neu da apply ban 092 co audit table) ===")
try_select("quote_delivery_channel_audit_log", "quote_delivery_channel_audit_log", "id,channel_type,actor_id,actor_name,actor_role,action,created_at")

print("Tat ca deu la SELECT thuan tuy - khong co INSERT/UPDATE/DELETE nao chay trong script nay.")
