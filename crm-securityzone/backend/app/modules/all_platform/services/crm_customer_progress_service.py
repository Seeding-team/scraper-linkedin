"""Tu dong tinh "Viec tiep theo" + nang nhom trang thai Khach hang (new_lead -> following ->
current_customer) theo hoat dong THAT cua Deal/Bao gia/Hop dong - KHONG hardcode co dinh chi 3 loai
viec tiep theo, suy ra tu trang thai that (status/processing_stage cua quotes, status cua contracts)
giong tinh than deal_stage_sync_service.py (nguon su that tuong tu, o cap Deal thay vi Customer).

Quy tac (theo yeu cau mentor 2026-10-10):
  - Co bao gia con hieu luc (chua huy/xoa) -> "Theo dõi báo giá"
  - Bao gia da duyet (approved/confirmed) -> "Gửi/chốt báo giá"
  - Co hop dong (da luu, chua terminated/expired) -> "Theo dõi hợp đồng"
  - Hop dong cho ky (pending_signature) -> "Theo dõi ký kết"
  - Hop dong da ky/dang hieu luc/da hoan tat (signed/active/completed) -> "Triển khai/chăm sóc"
  - Khong co du lieu gi -> nhan mac dinh theo `status` hien tai (fallback - giu dung hanh vi cu).
  - `not_fit` (thu cong, ngung theo doi) KHONG bao gio bi tinh lai - giu nguyen nhan rieng.
  - Nhieu Deal/Bao gia/Hop dong: chon DUNG 1 Deal "dang hoat dong" (khong o stage dong bang
    on_hold/lost, uu tien tin hieu cao nhat roi moi toi updated_at moi nhat) de tinh - tranh Deal cu
    de lau ghi de Deal moi dang chay ("không lấy trạng thái cũ ghi đè trạng thái mới").
  - Nhom khach hang (status) CHI duoc tu dong NANG LEN (new_lead -> following -> current_customer),
    khong bao gio tu ha xuong va khong bao gio dong vao/ra khoi not_fit - dung quy tac
    deal_stage_sync_service.AUTO_STAGE_ORDER ("chi tien len, khong bao gio keo lui"), va KHONG dung
    de ghi de task thu cong cua Sale (customer_leads.next_step van la truong rieng, khong dung toi).
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

TERMINAL_DEAL_STAGES = {"on_hold", "lost"}
APPROVED_QUOTE_STATUSES = {"approved", "confirmed"}
SIGNED_CONTRACT_STATUSES = {"signed", "active", "completed"}
INVALID_CONTRACT_STATUSES = {"terminated", "expired"}

STATUS_ORDER = {"new_lead": 0, "following": 1, "current_customer": 2}

FALLBACK_NEXT_ACTION_BY_STATUS = {
    "new_lead": "Xác minh nhu cầu",
    "following": "Theo dõi cơ hội",
    "current_customer": "Chăm sóc / upsell",
    "not_fit": "Không còn theo dõi",
}


def _valid_quotes(quotes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [q for q in quotes if q.get("status") != "cancelled" and not q.get("deleted_at")]


def _valid_contracts(contracts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [c for c in contracts if c.get("status") not in INVALID_CONTRACT_STATUSES]


def _deal_signal(quotes: list[dict[str, Any]], contracts: list[dict[str, Any]]) -> tuple[int, str, str | None] | None:
    """-> (do_uu_tien, nhan_viec_tiep_theo, nhom_de_xuat) cao nhat cho 1 Deal; None neu Deal chua co
    bao gia/hop dong hieu luc nao."""
    live_quotes = _valid_quotes(quotes)
    live_contracts = _valid_contracts(contracts)
    if any(c.get("status") in SIGNED_CONTRACT_STATUSES for c in live_contracts):
        return 5, "Triển khai/chăm sóc", "current_customer"
    if any(c.get("status") == "pending_signature" for c in live_contracts):
        return 4, "Theo dõi ký kết", "following"
    if live_contracts:
        return 3, "Theo dõi hợp đồng", "following"
    if any(q.get("status") in APPROVED_QUOTE_STATUSES for q in live_quotes):
        return 2, "Gửi/chốt báo giá", "following"
    if live_quotes:
        return 1, "Theo dõi báo giá", "following"
    return None


def _pick_active_deal(
    deals: list[dict[str, Any]],
    quotes_by_deal: dict[str, list[dict[str, Any]]],
    contracts_by_deal: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    candidates = [d for d in deals if str(d.get("deal_stage") or "") not in TERMINAL_DEAL_STAGES] or list(deals)
    if not candidates:
        return None

    def sort_key(deal: dict[str, Any]) -> tuple[int, str]:
        signal = _deal_signal(quotes_by_deal.get(deal["id"], []), contracts_by_deal.get(deal["id"], []))
        priority = signal[0] if signal else -1
        return (priority, str(deal.get("updated_at") or deal.get("created_at") or ""))

    return max(candidates, key=sort_key)


def compute_customer_progress(
    current_status: str | None,
    deals: list[dict[str, Any]],
    quotes: list[dict[str, Any]],
    contracts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Thuan ham (khong doc/ghi DB) - tinh "Viec tiep theo" + nhom de xuat cho 1 Khach hang tu du lieu
    Deal/Bao gia/Hop dong da tai san. Dung chung cho ca luong hien thi (GET) lan luong tu dong cap
    nhat (recompute_customer_progress)."""
    if current_status == "not_fit":
        return {"nextAction": FALLBACK_NEXT_ACTION_BY_STATUS["not_fit"], "autoStatus": None, "activeDealId": None}

    quotes_by_deal: dict[str, list[dict[str, Any]]] = {}
    for q in quotes:
        if q.get("deal_id"):
            quotes_by_deal.setdefault(q["deal_id"], []).append(q)
    contracts_by_deal: dict[str, list[dict[str, Any]]] = {}
    for c in contracts:
        if c.get("deal_id"):
            contracts_by_deal.setdefault(c["deal_id"], []).append(c)

    active_deal = _pick_active_deal(deals, quotes_by_deal, contracts_by_deal) if deals else None
    signal = (
        _deal_signal(quotes_by_deal.get(active_deal["id"], []), contracts_by_deal.get(active_deal["id"], []))
        if active_deal
        else None
    )
    if signal is None:
        return {
            "nextAction": FALLBACK_NEXT_ACTION_BY_STATUS.get(current_status or "new_lead", "Cập nhật hồ sơ"),
            "autoStatus": None,
            "activeDealId": active_deal.get("id") if active_deal else None,
        }
    _priority, next_action, proposed_status = signal
    auto_status = None
    if proposed_status and STATUS_ORDER.get(proposed_status, -1) > STATUS_ORDER.get(current_status or "new_lead", 0):
        auto_status = proposed_status
    return {"nextAction": next_action, "autoStatus": auto_status, "activeDealId": active_deal["id"]}


def attach_next_action(
    customers: list[dict[str, Any]],
    deals_by_customer: dict[str, list[dict[str, Any]]],
    quotes_by_customer: dict[str, list[dict[str, Any]]],
    contracts_by_customer: dict[str, list[dict[str, Any]]],
) -> None:
    """Gan truong `next_action` (doc-only, tinh ngay luc GET - khong luu DB) len tung dong Khach hang."""
    for customer in customers:
        cid = customer.get("id")
        progress = compute_customer_progress(
            customer.get("status"),
            deals_by_customer.get(cid, []),
            quotes_by_customer.get(cid, []),
            contracts_by_customer.get(cid, []),
        )
        customer["next_action"] = progress["nextAction"]


def recompute_customer_progress(customer_id: str | None, *, source: str) -> dict[str, Any]:
    """Tinh lai va GHI (neu du dieu kien nang nhom) cho DUNG 1 Khach hang - khong bao gio raise, dung
    lam side-effect sau thao tac Bao gia/Hop dong (giong deal_stage_sync_service.sync_deal_stage)."""
    result: dict[str, Any] = {"customerId": customer_id, "changed": False}
    if not customer_id:
        return result
    try:
        sb = get_supabase_client()
        inst = settings.crm_instance
        customers = (
            sb.table("crm_customers").select("id, status").eq("id", customer_id).eq("instance", inst)
            .limit(1).execute().data or []
        )
        if not customers:
            result["reason"] = "khong_thay_khach_hang"
            return result
        current_status = customers[0].get("status")
        deals = (
            sb.table("customer_leads").select("id, deal_stage, updated_at, created_at")
            .eq("customer_id", customer_id).eq("instance", inst).execute().data or []
        )
        deal_ids = [d["id"] for d in deals]
        quotes: list[dict[str, Any]] = []
        contracts: list[dict[str, Any]] = []
        if deal_ids:
            quotes = (
                sb.table("quotes").select("id, deal_id, status, deleted_at")
                .in_("deal_id", deal_ids).eq("instance", inst).execute().data or []
            )
            contracts = (
                sb.table("contracts").select("id, deal_id, status")
                .in_("deal_id", deal_ids).eq("instance", inst).execute().data or []
            )
        # Hop dong tao truc tiep tren Customer (khong qua Deal, migration 130/contracts.customer_id) -
        # gan tam vao Deal dau tien (coi nhu cung 1 "mach tien do") de khong bi lot khoi tinh toan chi
        # vi thieu deal_id - khong ghi nguoc lai contracts.deal_id, chi dung noi bo de tinh.
        direct_contracts = (
            sb.table("contracts").select("id, deal_id, status, customer_id")
            .eq("customer_id", customer_id).eq("instance", inst).execute().data or []
        )
        fallback_deal_id = deals[0]["id"] if deals else None
        for c in direct_contracts:
            if c.get("deal_id") or not fallback_deal_id:
                continue
            contracts.append({**c, "deal_id": fallback_deal_id})

        progress = compute_customer_progress(current_status, deals, quotes, contracts)
        result.update({"nextAction": progress["nextAction"], "from": current_status})
        if not progress["autoStatus"]:
            return result

        # Dieu kien khop status cu -> idempotent + khong ghi de neu Sale vua tu doi tay trong luc xu ly
        updated = (
            sb.table("crm_customers").update({"status": progress["autoStatus"]})
            .eq("id", customer_id).eq("instance", inst).eq("status", current_status).execute().data or []
        )
        if not updated:
            result["reason"] = "trang_thai_da_doi_boi_nguoi_khac"
            return result
        result.update({"changed": True, "to": progress["autoStatus"]})
        try:
            from app.modules.all_platform.services.customer_lead_service import _write_activity_log

            if fallback_deal_id:
                _write_activity_log(
                    fallback_deal_id,
                    "customer_status_auto_sync",
                    from_stage=current_status,
                    to_stage=progress["autoStatus"],
                    note=f"Tự động nâng nhóm khách hàng theo {source}",
                )
        except Exception:  # noqa: BLE001
            logger.warning("Khong ghi duoc activity log customer_status_auto_sync cho %s", customer_id, exc_info=True)
    except Exception:  # noqa: BLE001
        logger.warning("recompute_customer_progress that bai (%s, %s) - bo qua", customer_id, source, exc_info=True)
    return result
