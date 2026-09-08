"""READ-ONLY check (chi .select(), KHONG insert/update/delete) xem trang
thai THAT cua quote_approval_rule_sets/quote_approval_rules sau khi nguoi
dung bam "Luu quy tac" va gap loi 'NoneType' object has no attribute 'data'.
Chay: python scratch/readonly_check_rule_sets_state.py
"""
import sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app.core.config  # noqa: F401
from app.core.supabase_client import get_supabase_client

supabase = get_supabase_client()

print("=== 1) TOAN BO quote_approval_rule_sets hien co ===")
rule_sets = supabase.table("quote_approval_rule_sets").select("*").order("created_at").execute().data or []
print(f"Tong so rule_sets: {len(rule_sets)}")
for rs in rule_sets:
    print(f"  id={rs['id']} name={rs.get('name')!r} version={rs.get('version')} is_active={rs.get('is_active')} "
          f"auto_approve_enabled={rs.get('auto_approve_enabled')} created_at={rs.get('created_at')} created_by={rs.get('created_by')} "
          f"updated_at={rs.get('updated_at')} updated_by={rs.get('updated_by')}")

print()
print("=== 2) So rule con cua TUNG rule_set ===")
for rs in rule_sets:
    rules = supabase.table("quote_approval_rules").select("*").eq("rule_set_id", rs["id"]).order("display_order").execute().data or []
    rule_types = [r.get("rule_type") for r in rules]
    print(f"  rule_set_id={rs['id']} (version={rs.get('version')}, is_active={rs.get('is_active')}): {len(rules)} rule -> {rule_types}")
    if len(rules) not in (0, 4):
        print(f"    !!! DO DANG - khong phai 0 hoac 4 rule !!!")

print()
print("=== 3) Co bao nhieu rule_set dang is_active=True? ===")
active_sets = [rs for rs in rule_sets if rs.get("is_active")]
print(f"So luong active: {len(active_sets)}")
for rs in active_sets:
    print(f"  ACTIVE: id={rs['id']} version={rs.get('version')}")
if len(active_sets) > 1:
    print("  !!! CANH BAO: NHIEU HON 1 rule_set active cung luc !!!")

print()
print("=== 4) GET active hien tra ve bo nao (dung logic that cua get_active_rule_set) ===")
try:
    active_result = supabase.table("quote_approval_rule_sets").select("*").eq("is_active", True).maybe_single().execute()
    active_row = active_result.data if active_result else None
    if active_row is None:
        print("  get_active_rule_set() se tra ve None (KHONG co active, hoac .maybe_single() tra ve None object)")
    else:
        print(f"  active_row: id={active_row['id']} version={active_row.get('version')}")
except Exception as exc:
    print(f"  LOI khi truy van active: {exc}")

print()
print("Tat ca deu la SELECT thuan tuy - khong co INSERT/UPDATE/DELETE nao chay trong script nay.")
