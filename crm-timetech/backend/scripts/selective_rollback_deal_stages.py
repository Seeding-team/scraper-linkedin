"""Rollback CHON LOC cac Deal bi backfill sai (khong con duoc quy tac hien hanh cong nhan).

  python scripts/selective_rollback_deal_stages.py --backup b.json                       # DRY-RUN (mac dinh): chi bao cao, KHONG ghi DB
  python scripts/selective_rollback_deal_stages.py --backup b.json --report out.json     # dry-run + xuat bang chi tiet
  python scripts/selective_rollback_deal_stages.py --backup b.json --apply --confirm     # GHI THAT (chi sau khi duoc duyet lan cuoi)

Chi khoi phuc 1 Deal khi TAT CA dieu kien an toan thoa:
  1. Deal con ton tai dung workspace (instance) trong backup.
  2. deal_stage hien tai == stage ma lan backfill da ghi (item.to) - chua ai doi tay sau do.
  3. Khong co dong activity_log stage_change nao MOI hon dong do chinh backfill tao ra.
  4. Voi bang chung HIEN TAI (bao gia/hop dong con hieu luc), quy tac hien hanh tu stage goc KHONG cho ra dung stage da ghi
     (tuc backfill do la sai). Neu da co bang chung moi hop le -> giu nguyen.
Chi ghi 2 cot: deal_stage + stage_entered_at (tra lai gia tri goc), moi Deal 1 dong activity_log. Update co dieu kien deal_stage = item.to (idempotent).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.modules.all_platform.services.deal_stage_sync_service import compute_target_stage  # noqa: E402

BACKFILL_NOTE_PREFIX = "Backfill"


def evaluate_item(
    item: dict[str, Any],
    deal: dict[str, Any] | None,
    logs: list[dict[str, Any]],
    quotes: list[dict[str, Any]],
    contracts: list[dict[str, Any]],
) -> dict[str, Any]:
    """-> {action: 'restore'|'skip_keep'|'conflict', reason, checks}. Ham thuan, khong cham DB."""
    base = {
        "workspace": item.get("instance"), "dealId": item["dealId"], "originalStage": item["from"], "appliedStage": item["to"],
        "currentStage": deal.get("deal_stage") if deal else None, "restoreTo": None,
    }
    if not deal or deal.get("instance") != item.get("instance"):
        return {**base, "action": "conflict", "reason": "deal_khong_ton_tai_hoac_khac_workspace", "checks": {"deal_ton_tai_dung_workspace": False}}
    checks: dict[str, bool] = {"deal_ton_tai_dung_workspace": True}
    checks["stage_hien_tai_van_la_stage_do_backfill_ghi"] = deal.get("deal_stage") == item["to"]
    backfill_logs = [
        lg for lg in logs
        if lg.get("action") == "stage_change" and lg.get("to_stage") == item["to"] and str(lg.get("note") or "").startswith(BACKFILL_NOTE_PREFIX)
    ]
    anchor = max((lg["created_at"] for lg in backfill_logs), default=None)
    later = [lg for lg in logs if lg.get("action") == "stage_change" and (anchor is None or lg["created_at"] > anchor)]
    checks["co_dong_log_cua_backfill"] = anchor is not None
    checks["khong_co_stage_change_sau_backfill"] = not later
    if not checks["stage_hien_tai_van_la_stage_do_backfill_ghi"] or not checks["khong_co_stage_change_sau_backfill"] or not checks["co_dong_log_cua_backfill"]:
        why = "stage_da_doi_sau_backfill" if not checks["stage_hien_tai_van_la_stage_do_backfill_ghi"] or not checks["khong_co_stage_change_sau_backfill"] else "khong_tim_thay_log_backfill"
        return {**base, "action": "conflict", "reason": f"{why}_xu_ly_thu_cong", "checks": checks}
    target, why = compute_target_stage(item["from"], quotes, contracts)
    checks["quy_tac_hien_hanh_khong_cong_nhan_stage_da_ghi"] = target != item["to"]
    if target == item["to"]:
        return {**base, "action": "skip_keep", "reason": f"co_bang_chung_hop_le:{why}", "checks": checks}
    return {**base, "action": "restore", "restoreTo": item["from"], "reason": "backfill_sai_quy_tac_request_technical", "checks": checks}


def load_context(sb, item: dict[str, Any]):
    d = item["dealId"]
    deal = (sb.table("customer_leads").select("id, instance, deal_stage, stage_entered_at").eq("id", d).limit(1).execute().data or [None])[0]
    logs = sb.table("customer_lead_activity_log").select("id, action, from_stage, to_stage, note, created_at").eq("customer_id", d).order("created_at").execute().data or []
    quotes = sb.table("quotes").select("id, status, processing_stage, deleted_at, customer_outcome").eq("deal_id", d).eq("instance", item["instance"]).execute().data or []
    contracts = sb.table("contracts").select("id, status, deal_phase").eq("deal_id", d).eq("instance", item["instance"]).execute().data or []
    return deal, logs, quotes, contracts


def restore_deal(sb, item: dict[str, Any]) -> bool:
    """Ghi 1 Deal: chi 2 cot, co dieu kien deal_stage = stage backfill da ghi (idempotent). Tra True neu da ghi."""
    res = (
        sb.table("customer_leads").update({"deal_stage": item["from"], "stage_entered_at": item["stageEnteredAt"]})
        .eq("id", item["dealId"]).eq("instance", item["instance"]).eq("deal_stage", item["to"]).execute().data or []
    )
    if res:
        sb.table("customer_lead_activity_log").insert({
            "customer_id": item["dealId"], "instance": item["instance"], "action": "stage_change",
            "from_stage": item["to"], "to_stage": item["from"],
            "note": "Rollback chọn lọc: backfill trước đó đẩy lên Proposal chỉ vì báo giá request/technical (không đủ điều kiện)",
        }).execute()
    return bool(res)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", required=True)
    parser.add_argument("--report")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approved-report", help="JSON dry-run da duyet: chi rollback dung cac Deal co action=restore trong file nay")
    parser.add_argument("--confirm", action="store_true", help="bat buoc cung --apply (xac nhan lan cuoi)")
    args = parser.parse_args()
    from app.core.config import settings  # noqa: F401  nap .env truoc khi tao client
    from app.core.supabase_client import get_supabase_client

    sb = get_supabase_client()
    backup = json.load(open(args.backup, encoding="utf-8"))
    if args.approved_report:
        approved = {r["dealId"] for r in json.load(open(args.approved_report, encoding="utf-8")) if r["action"] == "restore"}
        backup["changes"] = [c for c in backup["changes"] if c["dealId"] in approved]
        print(f"Gioi han theo bao cao da duyet: {len(backup['changes'])} Deal")
    rows = []
    for item in backup["changes"]:
        deal, logs, quotes, contracts = load_context(sb, item)
        rows.append({**evaluate_item(item, deal, logs, quotes, contracts), "_item": item})
    # Chi 'restore' hoac 'conflict' la dang quan tam; skip_keep = 15 Deal hop le
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r["action"]] += 1
    print("== DRY-RUN ROLLBACK CHON LOC" if not args.apply else "== APPLY ROLLBACK CHON LOC", dict(counts))
    for r in rows:
        if r["action"] != "skip_keep":
            print(f"{r['action']:9} {r['workspace']:13} {r['dealId']} goc={r['originalStage']} hien_tai={r['currentStage']} khoi_phuc={r['restoreTo']} | {r['reason']}")
    if args.report:
        json.dump([{k: v for k, v in r.items() if k != "_item"} for r in rows], open(args.report, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("Bao cao:", args.report)
    if not args.apply:
        print("Chua ghi DB.")
        return
    if not args.confirm:
        sys.exit("--apply can them --confirm")
    done = sum(1 for r in rows if r["action"] == "restore" and restore_deal(sb, r["_item"]))
    print(f"ROLLBACK da khoi phuc {done}/{counts['restore']} Deal.")


if __name__ == "__main__":
    main()
