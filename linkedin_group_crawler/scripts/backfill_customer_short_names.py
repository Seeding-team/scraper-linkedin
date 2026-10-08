"""Backfill ten viet tat cho khach hang DOANH NGHIEP cu (crm_customers.short_name) - chay tay, mac dinh DRY-RUN.

  python scripts/backfill_customer_short_names.py            # chi in du kien
  python scripts/backfill_customer_short_names.py --apply    # ghi vao DB

Quy tac (khong ghi de, khong ep khach ca nhan thanh cong ty):
  - Chi xet khach CHUA co short_name va la doanh nghiep (co company_name / MST / ten co tu khoa to chuc).
  - customer_name KHAC company_name va la ten thuong hieu cua cong ty (vd STARTECH, DENFOOD ~ DEN FOOD) -> short_name = customer_name, manual = true.
  - customer_name la ten nguoi lien he (khong lien quan ten cong ty) -> khong dung lam ten viet tat, de xuat tu ten cong ty (auto).
  - Con lai (ten day du / chi co 1 ten) -> short_name = de xuat theo quy tac (khong AI), manual = false.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.core.supabase_client import get_supabase_client  # noqa: E402
from app.modules.all_platform.services.crm_short_name_service import is_brand_of, looks_like_enterprise, suggest_short_name  # noqa: E402


def main(apply: bool) -> None:
    sb = get_supabase_client()
    rows = sb.table("crm_customers").select("id, customer_name, company_name, tax_code, short_name").eq("instance", settings.crm_instance).execute().data or []
    plan, skipped_personal, already = [], 0, 0
    for r in rows:
        if (r.get("short_name") or "").strip():
            already += 1
            continue
        if not looks_like_enterprise(r.get("customer_name"), r.get("company_name"), r.get("tax_code")):
            skipped_personal += 1
            continue
        name, company = (r.get("customer_name") or "").strip(), (r.get("company_name") or "").strip()
        if company and name and name != company and is_brand_of(name, company):
            plan.append((r["id"], name, True, name, company))
        else:
            out = suggest_short_name(company or name, customer_id=r["id"], use_ai=False)["suggestion"]
            if out:
                plan.append((r["id"], out, False, name, company))
    print(f"{len(rows)} khach | da co ten viet tat: {already} | ca nhan bo qua: {skipped_personal} | se dien: {len(plan)} | apply={apply}")
    for cid, short, manual, name, company in plan:
        print(f"  {'[tay]' if manual else '[auto]'} {short!r:42} <- {(company or name)[:60]}")
        if apply:
            sb.table("crm_customers").update({"short_name": short, "short_name_manual": manual}).eq("id", cid).is_("short_name", "null").execute()


if __name__ == "__main__":
    main("--apply" in sys.argv)
