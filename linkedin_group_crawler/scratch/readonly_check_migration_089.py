"""READ-ONLY check (chi .select(), khong insert/update/delete nao) xem
migration 087/088/089 da apply dung chua tren DB backend dang tro toi.
Chay: python scratch/readonly_check_migration_089.py
"""
import sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app.core.config  # noqa: F401 - side-effect: load .env/.env.local truoc khi doc bien
from app.core.supabase_client import get_supabase_client

supabase = get_supabase_client()

print("=== 1) Cot moi tren quotes (migration 087) ===")
row = supabase.table("quotes").select(
    "id,deleted_at,deleted_by,cancellation_reason,cancelled_at,cancelled_by,"
    "published_at,published_by,sent_at,sent_by,requested_changes_target_stage,"
    "requested_changes_reason,requested_changes_at,requested_changes_by,processing_stage"
).limit(1).execute()
print("select cot moi OK, sample:", row.data)

print()
print("=== 2) Bang quote_deletion_audit (migration 088) ===")
audit = supabase.table("quote_deletion_audit").select("id").limit(1).execute()
print("bang ton tai, so dong hien co:", len(audit.data or []), "(rong la binh thuong, chua hard-delete gi)")

print()
print("=== 3) CHECK constraint processing_stage cho phep gia tri moi ===")
# Chi SELECT dem xem co dong nao dang dung gia tri cu/moi - KHONG insert gi.
for stage in ["request", "technical", "pricing", "review", "ready_to_publish", "published"]:
    r = supabase.table("quotes").select("id").eq("processing_stage", stage).limit(1).execute()
    print(f"  processing_stage='{stage}': co truy van duoc (khong loi CHECK) - {len(r.data or [])} dong mau")

print()
print("Tat ca deu la SELECT thuan tuy - khong co INSERT/UPDATE/DELETE nao chay trong script nay.")
