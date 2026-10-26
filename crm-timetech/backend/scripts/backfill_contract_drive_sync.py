"""(A5) Backfill dong bo Drive cho hop dong CU (da co file_url/version DOCX nhung chua co row nao
trong contract_drive_files). Chay THU CONG, 1 lan, THEO TUNG WORKSPACE (khong chay song song 4
workspace cung luc - theo dung yeu cau trong plan, de theo doi loi tung cai).

Cach chay (trong container backend cua DUNG workspace muon backfill, vi settings.crm_instance la
bien moi trucong theo tung container):
    docker compose exec backend python3 scripts/backfill_contract_drive_sync.py [--dry-run]

--dry-run: chi liet ke hop dong se duoc xu ly, KHONG insert job nao (xem truoc an toan).
"""
from __future__ import annotations

import os
import sys

# Cho phep chay script nay bang `python3 scripts/backfill_contract_drive_sync.py` TU BAT KY cwd
# nao trong container (kha nang cao se bi goi qua `docker compose exec` voi path tuong doi) - "app"
# package can nam trong sys.path, khong tu dong co neu khong chay tu dung /app.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    from app.core.config import settings
    from app.core.supabase_client import get_supabase_client

    sb = get_supabase_client()
    instance = settings.crm_instance

    all_contracts = (
        sb.table("contracts").select("id, contract_number, file_url, title")
        .eq("instance", instance).execute().data or []
    )
    existing_file_ids = {
        row["contract_id"]
        for row in sb.table("contract_drive_files").select("contract_id").execute().data or []
    }

    candidates = []
    for c in all_contracts:
        if c["id"] in existing_file_ids:
            continue
        has_file_url = bool((c.get("file_url") or "").strip())
        versions = sb.table("contract_drive_sync_jobs").select("id").eq("contract_id", c["id"]).execute().data
        if has_file_url or not versions:
            # co file_url HOAC chua tung co job nao (co the la hop dong Copilot co version DOCX,
            # sync_contract_file() tu kiem tra lai) - dua vao danh sach ung vien, de sync_contract_file
            # tu quyet dinh "skipped" neu thuc su khong co gi de dong bo.
            candidates.append(c)

    print(f"[{instance}] Tong hop dong: {len(all_contracts)} | Da co Drive file: {len(existing_file_ids)} | Ung vien backfill: {len(candidates)}")
    for c in candidates:
        print(f"  - {c.get('contract_number') or c['id']}: {c.get('title')}")

    if dry_run:
        print("(--dry-run) KHONG insert job nao. Chay lai KHONG co --dry-run de thuc su xep lich.")
        return

    for c in candidates:
        sb.table("contract_drive_sync_jobs").insert({"contract_id": c["id"], "status": "queued"}).execute()
    print(f"Da xep lich dong bo cho {len(candidates)} hop dong - worker se tu xu ly trong vai phut toi (poll moi 10s).")


if __name__ == "__main__":
    main()
