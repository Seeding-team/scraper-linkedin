"""Dong bo Sales Pipeline TU DONG cho Deal theo Bao gia / Hop dong (nguon su that: customer_leads.deal_stage - KHONG phai crm_leads.status).

Pipeline GIU NGUYEN 10 stage (ID that): 1 dealing | 2 requirement | 3 proposal_sent | 4 negotiation | 5 contract_signed |
6 payment_1 | 7 implementation | 8 acceptance | 9 payment_final | 10 post_sale_care  (+ on_hold, lost).

Quy tac TU DONG (chi tien len, KHONG BAO GIO keo lui, chi dung stage 1-5):
  - Deal co bao gia con hieu luc (khong huy/xoa/OUT) DANG LAP BAO GIA NHAP (processing_stage pricing/review: Sale hoan thien gia ban,
    cho duyet) -> proposal_sent (3). processing_stage 'request'/'technical' = Presale moi tiep nhan/nhap ky thuat -> CHUA tinh la Proposal.
  - Deal co bao gia con hieu luc DA duyet (approved/confirmed)        -> negotiation (4)
  - Deal co hop dong hop le gan voi Deal (da luu, khong terminated/expired, khong phai hop dong mua/ban)  -> contract_signed (5)
  - Stage 6-10, on_hold, lost, won (legacy): CHI chuyen thu cong - khong bao gio bi ghi de.
  - Stage 2 'requirement' (Lay yeu cau): KHONG tu dong (chua co su kien nghiep vu ro rang) - chi la stage thap hon 3 nen bao gia se day len 3.
Chi cap nhat DUNG Deal gan voi bao gia/hop dong (theo deal_id), dung instance (tenant); idempotent; ghi customer_lead_activity_log.
Moi loi chi duoc log - KHONG lam hong thao tac bao gia/hop dong goi no.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

# Thu tu cac stage ma he thong DUOC PHEP tu dong dieu khien (legacy ve stage 1/3 theo DEAL_STAGE_MAP).
AUTO_STAGE_ORDER: dict[str, int] = {
    "new_lead": 1, "contacted": 1, "qualified": 1, "dealing": 1,
    "requirement": 2,
    "proposal_sent": 3, "contract_sent": 3,
    "negotiation": 4,
    "contract_signed": 5,
}
APPROVED_QUOTE_STATUSES = {"approved", "confirmed"}
# Enum THAT (migration 085/089): quotes.status = draft|confirmed|approved|cancelled; quotes.processing_stage = request|technical|pricing|review|ready_to_publish|published.
# Bao gia nhap chi tinh la "lap bao gia" khi da qua buoc Presale (request/technical): tu 'pricing' tro di.
DRAFTING_PROCESSING_STAGES = {"pricing", "review", "ready_to_publish", "published"}
INVALID_CONTRACT_STATUSES = {"terminated", "expired"}
# Stage 5 tu Hop dong: True => hop dong hop le (da luu, khong terminated/expired, khong phai hop dong
# mua/ban) keo Deal len contract_signed (ca hook hop dong lan hook bao gia/backfill). Da BAT LAI
# 2026-10-10 (audit thao/crm/REGRESSION_CHECKLIST.md Known gaps #1 - module Hop dong da du on dinh
# theo xac nhan cua mentor). Van chi tien len, khong bao gio ha (xem compute_target_stage()).
CONTRACT_STAGE_SYNC_ENABLED = True


def stage_order(stage: str | None) -> int | None:
    """Thu tu 1-5 neu la stage tu dong; None neu la stage thu cong (6-10, on_hold, lost, won, la)."""
    return AUTO_STAGE_ORDER.get(str(stage or "dealing"))


def valid_quotes(quotes: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bao gia con hieu luc: khong huy, khong xoa mem, khong OUT (Khong chot)."""
    return [
        q for q in quotes
        if q.get("status") != "cancelled" and not q.get("deleted_at") and q.get("customer_outcome") != "lost"
    ]


def valid_contracts(contracts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Hop dong cua khach gan voi Deal: da luu (co ban ghi), khong terminated/expired, khong phai hop dong mua vao/ban ra (deal_phase)."""
    return [c for c in contracts if not c.get("deal_phase") and c.get("status") not in INVALID_CONTRACT_STATUSES]


def compute_target_stage(current_stage: str | None, quotes: list[dict[str, Any]], contracts: list[dict[str, Any]]) -> tuple[str | None, str]:
    """-> (stage_dich | None, ly_do). None = giu nguyen. Chi tra stage CAO HON stage hien tai."""
    current = stage_order(current_stage)
    if current is None:
        return None, "stage_thu_cong_6_10"
    live_quotes = valid_quotes(quotes)
    target: str | None = None
    reason = "khong_co_bang_chung"
    if CONTRACT_STAGE_SYNC_ENABLED and valid_contracts(contracts):
        target, reason = "contract_signed", "co_hop_dong_hop_le"
    elif any(q.get("status") in APPROVED_QUOTE_STATUSES for q in live_quotes):
        target, reason = "negotiation", "bao_gia_da_duyet"
    elif any(q.get("processing_stage") in DRAFTING_PROCESSING_STAGES for q in live_quotes):
        target, reason = "proposal_sent", "bao_gia_nhap_dang_lap_gia"
    if target is None:
        return None, reason
    if AUTO_STAGE_ORDER[target] <= current:
        return None, "da_o_hoac_vuot_stage_dich"
    return target, reason


def _load(deal_id: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]]:
    sb = get_supabase_client()
    inst = settings.crm_instance
    deals = sb.table("customer_leads").select("id, deal_stage, customer_id, instance").eq("id", deal_id).eq("instance", inst).limit(1).execute().data or []
    if not deals:
        return None, [], []
    quotes = sb.table("quotes").select("id, status, processing_stage, deleted_at, customer_outcome, deal_id").eq("deal_id", deal_id).eq("instance", inst).execute().data or []
    contracts = sb.table("contracts").select("id, status, deal_phase, deal_id, customer_id").eq("deal_id", deal_id).eq("instance", inst).execute().data or []
    return deals[0], quotes, contracts


def sync_deal_stage(deal_id: str | None, *, source: str, actor_id: str | None = None) -> dict[str, Any]:
    """Tinh lai stage cua DUNG 1 Deal tu bao gia/hop dong con hieu luc va cap nhat neu can. Khong bao gio raise."""
    result: dict[str, Any] = {"dealId": deal_id, "changed": False}
    if not deal_id:
        return result
    try:
        deal, quotes, contracts = _load(deal_id)
        if not deal:
            result["reason"] = "khong_thay_deal_trong_workspace"
            return result
        current = deal.get("deal_stage")
        target, reason = compute_target_stage(current, quotes, contracts)
        result.update({"from": current, "reason": reason})
        if not target:
            return result
        now = datetime.now(timezone.utc).isoformat()
        sb = get_supabase_client()
        # Dieu kien khop stage cu -> idempotent + khong ghi de neu Sale vua chuyen thu cong trong luc xu ly
        updated = (
            sb.table("customer_leads").update({"deal_stage": target, "stage_entered_at": now})
            .eq("id", deal_id).eq("instance", settings.crm_instance).eq("deal_stage", current).execute().data or []
        )
        if not updated:
            result["reason"] = "stage_da_doi_boi_nguoi_khac"
            return result
        result.update({"changed": True, "to": target})
        try:
            from app.modules.all_platform.services.customer_lead_service import _write_activity_log

            _write_activity_log(
                deal_id, "stage_change", from_stage=current, to_stage=target, actor=actor_id,
                note=f"Tự động theo {source}: {reason}",
            )
        except Exception:  # noqa: BLE001
            logger.warning("Khong ghi duoc activity log stage_auto_sync cho %s", deal_id, exc_info=True)
    except Exception:  # noqa: BLE001
        logger.warning("sync_deal_stage that bai (%s, %s) - bo qua", deal_id, source, exc_info=True)
    return result
