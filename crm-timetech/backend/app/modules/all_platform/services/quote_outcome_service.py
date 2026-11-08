"""Ket qua bao gia sau khi PHAT HANH/GUI KHACH: "Khong chot / OUT".

OUT la ket qua cua KHACH HANG sau phat hanh - KHONG phai buoc thu 4 cua workflow Presale -> Sale -> Duyet
(processing_stage / status cua quote khong doi). Luu o cac cot rieng cua `quotes` (migration 179):
customer_outcome ('lost' | NULL = dang cho phan hoi khach), lost_reason, lost_reason_other, lost_note, lost_by,
lost_by_name, lost_at. Moi lan OUT ghi 1 dong quote_activity_log (action 'marked_lost').

Khi 1 Quote OUT, KIEM TRA cac nhanh bao gia khac cua cung Deal: chi chuyen Deal sang `deal_stage='lost'` (stage co san,
tai su dung transition_stage de co audit) neu khong con nhanh ban hang nao dang hoat dong - 1 Quote mat khong lam OUT ca Deal.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

# Nguon DUY NHAT cua danh sach ly do (FE lay qua GET /quotes/lost-reasons, khong hard-code).
LOST_REASONS: list[dict[str, str]] = [
    {"code": "price_high", "label": "Giá cao"},
    {"code": "chose_competitor", "label": "Chọn đối thủ"},
    {"code": "new_quote", "label": "Tạo báo giá mới"},
    {"code": "no_need", "label": "Không còn nhu cầu"},
    {"code": "no_response", "label": "Không phản hồi"},
    {"code": "project_postponed", "label": "Hoãn dự án"},
    {"code": "other", "label": "Khác"},
]
_REASON_LABEL = {r["code"]: r["label"] for r in LOST_REASONS}
_TERMINAL_DEAL_STAGES = ("won", "post_sale_care", "lost")


def list_lost_reasons() -> list[dict[str, str]]:
    return [dict(r) for r in LOST_REASONS]


def lost_reason_label(code: str | None) -> str | None:
    return _REASON_LABEL.get(code or "")


def _is_published(row: dict[str, Any]) -> bool:
    return bool(row.get("published_at") or row.get("sent_at") or row.get("processing_stage") == "published")


def _active_branches_left(deal_id: str, exclude_quote_id: str) -> tuple[int, int]:
    """(so nhanh bao gia con hoat dong, so hop dong con hieu luc) cua Deal, KHONG tinh quote vua OUT.
    Nhanh = version_chain_id (chi tinh phien ban moi nhat); khong hoat dong = da xoa mem / huy / OUT."""
    supabase = get_supabase_client()
    rows = execute_supabase_query(
        lambda: supabase.table("quotes")
        .select("id, version_chain_id, version_number, status, customer_outcome, deleted_at")
        .eq("deal_id", deal_id)
        .eq("instance", settings.crm_instance)
        .execute()
    ).data or []
    latest: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r.get("deleted_at"):
            continue
        key = r.get("version_chain_id") or r["id"]
        cur = latest.get(key)
        if cur is None or (r.get("version_number") or 1) > (cur.get("version_number") or 1):
            latest[key] = r
    active = [
        r for r in latest.values()
        if r["id"] != exclude_quote_id and r.get("status") != "cancelled" and r.get("customer_outcome") != "lost"
    ]
    contracts = execute_supabase_query(
        lambda: supabase.table("contracts").select("id, status").eq("deal_id", deal_id).eq("instance", settings.crm_instance).execute()
    ).data or []
    live_contracts = [c for c in contracts if c.get("status") != "terminated"]
    return len(active), len(live_contracts)


def mark_quote_lost(
    quote_id: str,
    actor: dict[str, Any],
    reason: str,
    reason_other: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    """Danh dau Quote 'Khong chot / OUT'. Tra ve {quote, dealOut: {changed, stage, message}}."""
    from app.modules.all_platform.services.supabase_quote_service import get_quote

    reason = (reason or "").strip()
    if reason not in _REASON_LABEL:
        raise ValueError("Vui lòng chọn lý do Không chốt hợp lệ.")
    reason_other = (reason_other or "").strip() or None
    note = (note or "").strip() or None
    if reason == "other" and not reason_other:
        raise ValueError("Vui lòng nhập lý do cụ thể khi chọn 'Khác'.")
    if reason != "other":
        reason_other = None

    supabase = get_supabase_client()
    rows = execute_supabase_query(
        lambda: supabase.table("quotes").select("*").eq("id", quote_id).eq("instance", settings.crm_instance).limit(1).execute()
    ).data or []
    if not rows or rows[0].get("deleted_at"):
        raise ValueError("Không tìm thấy báo giá.")
    row = rows[0]
    if row.get("status") == "cancelled":
        raise ValueError("Báo giá đã huỷ, không thể đánh dấu Không chốt.")
    if row.get("status") != "approved" or not _is_published(row):
        raise ValueError("Chỉ đánh dấu Không chốt sau khi báo giá đã được duyệt và phát hành/gửi khách.")
    if row.get("customer_outcome") == "lost":
        raise ValueError("Báo giá này đã được đánh dấu Không chốt.")

    now = _now_iso()
    actor_id = actor.get("id")
    actor_name = actor.get("name") or actor.get("email")
    execute_supabase_query(
        lambda: supabase.table("quotes")
        .update({
            "customer_outcome": "lost", "lost_reason": reason, "lost_reason_other": reason_other, "lost_note": note,
            "lost_by": actor_id, "lost_by_name": actor_name, "lost_at": now,
        })
        .eq("id", quote_id).eq("instance", settings.crm_instance).execute()
    )
    execute_supabase_query(
        lambda: supabase.table("quote_activity_log").insert({
            "quote_id": quote_id, "actor_id": actor_id, "action": "marked_lost",
            "changes": {"reason": reason, "reasonLabel": _REASON_LABEL[reason], "reasonOther": reason_other, "note": note},
        }).execute()
    )

    deal_out = _maybe_mark_deal_out(row, actor, reason, reason_other, note)
    return {"quote": get_quote(quote_id), "dealOut": deal_out}


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _maybe_mark_deal_out(
    quote_row: dict[str, Any], actor: dict[str, Any], reason: str, reason_other: str | None, note: str | None
) -> dict[str, Any]:
    """Chi OUT Deal khi KHONG con nhanh bao gia hoat dong va KHONG co hop dong hieu luc."""
    deal_id = quote_row.get("deal_id")
    if not deal_id:
        return {"changed": False, "message": "Báo giá không gắn Cơ hội."}
    active, contracts = _active_branches_left(deal_id, quote_row["id"])
    if active or contracts:
        return {"changed": False, "message": f"Cơ hội còn {active} báo giá đang hoạt động và {contracts} hợp đồng — giữ nguyên."}

    from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id, transition_stage

    deal = get_customer_lead_by_id(deal_id)
    stage = (deal or {}).get("deal_stage")
    if not deal:
        return {"changed": False, "message": "Không tìm thấy Cơ hội."}
    if stage in _TERMINAL_DEAL_STAGES:
        return {"changed": False, "stage": stage, "message": "Cơ hội đã ở trạng thái kết thúc."}
    label = _REASON_LABEL[reason] + (f" — {reason_other}" if reason_other else "")
    try:
        transition_stage(
            deal_id,
            {
                "to_stage": "lost",
                "reject_reason_type": reason,
                "reject_reason_text": reason_other or note,
                "note": f"Báo giá {quote_row.get('quote_number') or ''} Không chốt (OUT): {label}" + (f". {note}" if note else ""),
            },
            actor,
        )
        return {"changed": True, "stage": "lost", "message": "Không còn báo giá hoạt động — Cơ hội chuyển OUT."}
    except Exception as exc:  # noqa: BLE001 - quote da OUT thanh cong; khong rollback chi vi khong chuyen duoc deal
        logger.warning("Khong chuyen duoc Co hoi %s sang OUT: %s", deal_id, exc)
        return {"changed": False, "message": f"Không chuyển được Cơ hội sang OUT: {exc}"}
