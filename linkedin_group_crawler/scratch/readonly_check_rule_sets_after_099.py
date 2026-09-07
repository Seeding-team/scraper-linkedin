"""READ-ONLY check (chi .select(), KHONG insert/update/delete) tren bang
quote_approval_rule_sets/quote_approval_rules. Dung de xac nhan sau khi user
tu bam "Luu quy tac" that: version tang dung 1, cu inactive, moi active, du
4 rule, khong co duplicate active/orphan.
Chay: python scratch/readonly_check_rule_sets_after_099.py
"""
import sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app.core.config  # noqa: F401
from app.core.supabase_client import get_supabase_client

supabase = get_supabase_client()

sets = supabase.table("quote_approval_rule_sets").select("id,name,version,is_active,auto_approve_enabled,idempotency_key,created_at,updated_at").order("version").execute().data or []
print(f"Tong so rule_sets: {len(sets)}")
active = [s for s in sets if s.get("is_active")]
print(f"So dong is_active=true: {len(active)} (ky vong: dung 1)")
for s in sets:
    rules = supabase.table("quote_approval_rules").select("id,rule_type").eq("rule_set_id", s["id"]).execute().data or []
    print(f"  - id={s['id']} version={s['version']} is_active={s['is_active']} so_rule={len(rules)} idempotency_key={s.get('idempotency_key')!r} updated_at={s.get('updated_at')}")
