"""Dong bo thong tin xuyen chuoi Lead -> Khach hang / Lien he -> Co hoi -> Bao gia.

Nguyen tac:
- Chi lan XUONG (lead -> customer/contact/deal -> quote snapshot), moi buoc la best-effort: loi chi log,
  KHONG BAO GIO lam hong thao tac sua goc cua nguoi dung.
- Moi o ben duoi chi bi ghi de khi no van la BAN SAO cua gia tri cu o nguon (hoac dang rong). Gia tri da bi
  nguoi dung sua tay khac di (vd khach hang dung chung cho nhieu lead, "Kinh gui" go tay) duoc giu nguyen.
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


def _s(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _copy_updates(current_row: dict, mapping: dict[str, str], old_src: dict, new_src: dict) -> dict:
    """mapping: {cot dich: cot nguon}. Tra ve cac cot dich can doi: nguon doi sang gia tri moi khong rong
    va gia tri hien tai cua dich la ban sao cua gia tri nguon CU (hoac rong)."""
    updates: dict[str, Any] = {}
    for dest, src in mapping.items():
        new_val, old_val, cur = _s(new_src.get(src)), _s(old_src.get(src)), _s(current_row.get(dest))
        if new_val and new_val != old_val and (not cur or cur == old_val):
            updates[dest] = new_val
    return updates


def propagate_customer_change(customer_row: dict | None) -> None:
    """Khach hang doi -> cap nhat ban sao tren cac Co hoi cua khach do, roi toi snapshot cua Bao gia."""
    try:
        row = customer_row or {}
        cid = row.get("id")
        if not cid:
            return
        supabase = get_supabase_client()
        updates = {
            dest: _s(row.get(src))
            for dest, src in (("customer_name", "customer_name"), ("company_name", "company_name"),
                              ("address", "address"), ("tax_code", "tax_code"))
            if _s(row.get(src))
        }
        if updates:
            supabase.table("customer_leads").update(updates).eq("customer_id", cid).eq("instance", settings.crm_instance).execute()
        from app.modules.all_platform.services.supabase_quote_service import sync_customer_snapshot_to_quotes
        sync_customer_snapshot_to_quotes(customer_id=cid, customer_row=row)
    except Exception as exc:  # noqa: BLE001
        logger.warning("propagate_customer_change failed: %s", exc)


def propagate_lead_change(old_lead: dict | None, new_lead: dict | None) -> None:
    """Lead (da chuyen doi) doi -> Lien he / Khach hang / Co hoi sinh ra tu lead do doi theo (neu van la ban sao)."""
    try:
        old, new = old_lead or {}, new_lead or {}
        contact_id, customer_id, deal_id = (
            new.get("converted_contact_id"), new.get("converted_customer_id"), new.get("converted_deal_id"),
        )
        if not (contact_id or customer_id or deal_id):
            return
        supabase = get_supabase_client()
        inst = settings.crm_instance

        if contact_id:
            contact_rows = supabase.table("crm_contacts").select("*").eq("id", contact_id).eq("instance", inst).limit(1).execute().data or []
            if contact_rows:
                cur = contact_rows[0]
                upd = _copy_updates(cur, {"name": "lead_name", "phone": "phone", "email": "email", "position": "position"}, old, new)
                if upd:
                    from app.modules.all_platform.services.crm_customer_service import normalize_email, normalize_phone
                    if "phone" in upd:
                        upd["phone_normalized"] = normalize_phone(upd["phone"])
                    if "email" in upd:
                        upd["email_normalized"] = normalize_email(upd["email"])
                    res = supabase.table("crm_contacts").update(upd).eq("id", contact_id).execute()
                    if res.data:
                        from app.modules.all_platform.services.supabase_quote_service import sync_contact_snapshot_to_quotes
                        sync_contact_snapshot_to_quotes(res.data[0], old_row=cur)

        if customer_id:
            cust_rows = supabase.table("crm_customers").select("*").eq("id", customer_id).eq("instance", inst).limit(1).execute().data or []
            if cust_rows:
                cur = cust_rows[0]
                old_org = _s(old.get("company_name")) or _s(old.get("lead_name"))
                new_org = _s(new.get("company_name")) or _s(new.get("lead_name"))
                upd = _copy_updates(cur, {
                    "phone": "phone", "email": "email", "zalo": "zalo", "facebook": "facebook",
                    "telegram": "telegram", "website": "website", "company_name": "company_name",
                }, old, new)
                if new_org and new_org != old_org and _s(cur.get("customer_name")) in ("", old_org):
                    upd["customer_name"] = new_org
                # Doi Sale phu trach cua lead -> owner Khach hang theo Sale moi, CHI khi owner hien tai la owner do chinh lead nay sinh ra
                # (Sale cu / SDR cu / nguoi tao / nguoi chuyen doi); owner da chon tay khac duoc giu nguyen.
                new_ae, old_ae = _s(new.get("qualification_ae_id")), _s(old.get("qualification_ae_id"))
                if new_ae and new_ae != old_ae:
                    derived = {x for x in (old_ae, _s(old.get("sdr_id")), _s(new.get("created_by")), _s(new.get("converted_by"))) if x}
                    if _s(cur.get("owner_id")) in derived and _s(cur.get("owner_id")) != new_ae:
                        upd["owner_id"] = new_ae
                if upd:
                    from app.modules.all_platform.services.crm_customer_service import normalize_email, normalize_phone
                    if "phone" in upd:
                        upd["phone_normalized"] = normalize_phone(upd["phone"])
                    if "email" in upd:
                        upd["email_normalized"] = normalize_email(upd["email"])
                    res = supabase.table("crm_customers").update(upd).eq("id", customer_id).execute()
                    if res.data:
                        propagate_customer_change(res.data[0])

        if deal_id:
            deal_rows = supabase.table("customer_leads").select("*").eq("id", deal_id).eq("instance", inst).limit(1).execute().data or []
            if deal_rows:
                upd = _copy_updates(deal_rows[0], {"phone": "phone", "email": "email", "company_name": "company_name"}, old, new)
                if upd:
                    supabase.table("customer_leads").update(upd).eq("id", deal_id).execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("propagate_lead_change failed: %s", exc)
