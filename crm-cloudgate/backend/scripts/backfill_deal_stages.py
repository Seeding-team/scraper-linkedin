"""Backfill Sales Pipeline (customer_leads.deal_stage) tu bao gia / hop dong LICH SU - TAT CA workspace.

  python scripts/backfill_deal_stages.py                       # DRY-RUN (mac dinh): chi bao cao, KHONG ghi DB
  python scripts/backfill_deal_stages.py --report out.json     # dry-run + ghi bao cao chi tiet tung Deal
  python scripts/backfill_deal_stages.py --apply --backup b.json   # GHI THAT (can --backup; chi sau khi duoc duyet)
  python scripts/backfill_deal_stages.py --rollback b.json     # hoan tac tu file backup

Quy tac (cung ham voi luong realtime: deal_stage_sync_service.compute_target_stage): chi tien len stage 3/4/5, giu nguyen 6-10 / on_hold / lost.
Bo qua (khong ghi) Deal thieu bang chung ro rang hoac mau thuan: bao gia/hop dong khac workspace, hop dong khac khach hang, Deal da OUT/6-10.
Apply: moi Deal ghi 1 dong customer_lead_activity_log (action=stage_change, note 'Backfill'); chi ghi neu deal_stage hien tai van = luc dry-run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.supabase_client import get_supabase_client  # noqa: E402
from app.modules.all_platform.services.deal_stage_sync_service import compute_target_stage, stage_order  # noqa: E402

PAGE = 1000


def fetch_all(sb, table: str, columns: str) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        chunk = sb.table(table).select(columns).range(start, start + PAGE - 1).execute().data or []
        rows += chunk
        if len(chunk) < PAGE:
            return rows
        start += PAGE


def plan(sb) -> list[dict]:
    deals = fetch_all(sb, "customer_leads", "id, instance, deal_stage, customer_id, stage_entered_at")
    quotes = fetch_all(sb, "quotes", "id, instance, deal_id, status, processing_stage, deleted_at, customer_outcome")
    contracts = fetch_all(sb, "contracts", "id, instance, deal_id, customer_id, status, deal_phase")
    q_by, c_by = defaultdict(list), defaultdict(list)
    for q in quotes:
        if q.get("deal_id"):
            q_by[q["deal_id"]].append(q)
    for c in contracts:
        if c.get("deal_id"):
            c_by[c["deal_id"]].append(c)
    out: list[dict] = []
    for d in deals:
        row = {"dealId": d["id"], "instance": d.get("instance"), "from": d.get("deal_stage"), "stageEnteredAt": d.get("stage_entered_at"), "action": "keep", "to": None, "reason": ""}
        if stage_order(d.get("deal_stage")) is None:
            row.update(action="skip", reason="stage_thu_cong_6_10_hoac_on_hold_lost")
            out.append(row)
            continue
        qs, cs = q_by.get(d["id"], []), c_by.get(d["id"], [])
        if any(q.get("instance") != d.get("instance") for q in qs) or any(c.get("instance") != d.get("instance") for c in cs):
            row.update(action="skip", reason="mau_thuan_workspace_giua_deal_va_bao_gia_hop_dong")
            out.append(row)
            continue
        if any(c.get("customer_id") and d.get("customer_id") and c["customer_id"] != d["customer_id"] for c in cs):
            row.update(action="skip", reason="hop_dong_khac_khach_hang_voi_deal")
            out.append(row)
            continue
        target, reason = compute_target_stage(d.get("deal_stage"), qs, cs)
        if target:
            row.update(action="change", to=target, reason=reason)
        else:
            row.update(action="keep", reason=reason)
        out.append(row)
    return out


def summarize(rows: list[dict]) -> dict:
    summary: dict = {"total": len(rows), "byAction": Counter(r["action"] for r in rows), "changes": Counter(), "reasons": Counter(), "byInstance": {}}
    for r in rows:
        summary["reasons"][f"{r['action']}:{r['reason']}"] += 1
        if r["action"] == "change":
            summary["changes"][f"{r['from']} -> {r['to']}"] += 1
        inst = summary["byInstance"].setdefault(r["instance"], Counter())
        inst[r["action"]] += 1
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup")
    parser.add_argument("--rollback")
    parser.add_argument("--report")
    args = parser.parse_args()
    sb = get_supabase_client()

    if args.rollback:
        backup = json.load(open(args.rollback, encoding="utf-8"))
        restored = 0
        for item in backup["changes"]:
            res = (sb.table("customer_leads").update({"deal_stage": item["from"], "stage_entered_at": item["stageEnteredAt"]})
                   .eq("id", item["dealId"]).eq("instance", item["instance"]).eq("deal_stage", item["to"]).execute().data or [])
            restored += len(res)
        print(f"ROLLBACK: khoi phuc {restored}/{len(backup['changes'])} Deal (Deal da bi doi stage sau backfill duoc giu nguyen).")
        return

    rows = plan(sb)
    summary = summarize(rows)
    print("== DRY-RUN" if not args.apply else "== APPLY")
    print(json.dumps({k: (dict(v) if isinstance(v, Counter) else {i: dict(c) for i, c in v.items()} if k == "byInstance" else v) for k, v in summary.items()}, ensure_ascii=False, indent=2))
    if args.report:
        json.dump({"summary": json.loads(json.dumps(summary, default=dict)), "deals": rows}, open(args.report, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=dict)
        print("Bao cao chi tiet:", args.report)
    if not args.apply:
        print("Chua ghi DB. Them --apply --backup <file> sau khi duoc duyet.")
        return
    if not args.backup:
        sys.exit("--apply bat buoc kem --backup <file>")
    changes = [r for r in rows if r["action"] == "change"]
    json.dump({"createdAt": datetime.now(timezone.utc).isoformat(), "changes": changes}, open(args.backup, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    now = datetime.now(timezone.utc).isoformat()
    done = 0
    for r in changes:
        res = (sb.table("customer_leads").update({"deal_stage": r["to"], "stage_entered_at": now})
               .eq("id", r["dealId"]).eq("instance", r["instance"]).eq("deal_stage", r["from"]).execute().data or [])
        if res:
            done += 1
            sb.table("customer_lead_activity_log").insert({
                "customer_id": r["dealId"], "instance": r["instance"], "action": "stage_change", "from_stage": r["from"], "to_stage": r["to"],
                "note": f"Backfill tự động: {r['reason']}",
            }).execute()
    print(f"APPLIED {done}/{len(changes)} Deal. Backup: {args.backup}")


if __name__ == "__main__":
    main()
