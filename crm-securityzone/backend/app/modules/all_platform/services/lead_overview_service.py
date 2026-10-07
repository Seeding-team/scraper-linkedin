"""Lead 360 - tong quan xu ly Lead (READ-ONLY): tu 1 Lead di xuyen
Khach hang -> Co hoi -> Yeu cau bao gia -> Presale -> Sale hoan thien gia -> Duyet -> Bao gia -> Hop dong.

Nguyen tac (plan GD1):
  * KHONG tao status gia, KHONG copy status sang Lead: moi buoc duoc DERIVE tu record that
    (crm_leads / crm_customers / crm_contacts / customer_leads / quotes / contracts) va nhat ky that
    (crm_lead_activity_log / quote_activity_log / contract_activity_log).
  * Sale doc DU thong tin ngay tren 1 man: thong tin Lead/Khach, Phu trach/Ban giao, Viec hien tai, Co hoi/Du an,
    Bao gia (kem SP/DV chinh, gia, SLA, dang cho ai, duyet), Hop dong, Tien do, Timeline.
  * Tai dung logic co san: `get_quote` + `apply_quote_field_permissions` (gia von/loi nhuan theo QUYEN cua nguoi xem),
    `_quote_sla_payload` (progress_service), `_derive_quote_phase` (supabase_quote_service).
  * Quyen: dung `get_lead()` (can_view_lead). Gia von/margin chi tra khi nguoi xem co quyen (flag costViewAllowed...).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.crm_lead_service import get_lead

logger = logging.getLogger(__name__)

_STAGE_LABEL = {
    "request": "Yêu cầu báo giá",
    "technical": "Presale xử lý",
    "pricing": "Sale hoàn thiện giá",
    "review": "Chờ duyệt",
    "ready_to_publish": "Đã duyệt · chờ phát hành",
    "published": "Đã phát hành",
}
_LEAD_STATUS_LABEL = {
    "mql": "MQL", "sql": "SQL", "nurturing": "Nuôi dưỡng", "unqualified": "Không đạt", "converted": "Đã chuyển đổi",
}
_TIMELINE_LIMIT = 100


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(value: Any) -> str | None:
    dt = _parse_dt(value)
    return dt.isoformat() if dt else None


def _due_info(due_value: Any, *, completed: bool = False) -> dict[str, Any] | None:
    """Han chot -> {dueAt, status, daysRemaining/remainingHours | overdueDays/overdueHours}. Tinh theo chenh lech tuyet doi
    (khong phu thuoc tzdata cua container); FE doc "Con N ngay" (>=1 ngay) hoac "Con N gio", "Qua han N ngay/gio"."""
    due = _parse_dt(due_value)
    if not due:
        return None
    if completed:
        return {"dueAt": due.isoformat(), "status": "completed"}
    seconds = (due - datetime.now(timezone.utc)).total_seconds()
    if seconds < 0:
        late = -seconds
        return {"dueAt": due.isoformat(), "status": "overdue", "overdueDays": int(late // 86400), "overdueHours": int(late // 3600)}
    return {
        "dueAt": due.isoformat(), "status": "due_soon" if seconds <= 4 * 3600 else "in_progress",
        "daysRemaining": int(seconds // 86400), "remainingHours": int(seconds // 3600),
    }


def _user_names(ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    supabase = get_supabase_client()
    rows = execute_supabase_query(lambda: supabase.table("app_users").select("id, name, email").in_("id", list(ids)).execute()).data or []
    return {r["id"]: (r.get("name") or r.get("email") or "") for r in rows}


def _team_by_id(team_id: str | None) -> dict[str, Any] | None:
    if not team_id:
        return None
    supabase = get_supabase_client()
    rows = execute_supabase_query(lambda: supabase.table("crm_teams").select("id, name").eq("id", team_id).limit(1).execute()).data or []
    return {"id": team_id, "name": rows[0]["name"]} if rows else None


def _team_of(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    try:
        from app.modules.all_platform.services.crm_permission_service import get_crm_team_id_for_user
        team_id = get_crm_team_id_for_user(user_id)
        return _team_by_id(team_id) if team_id else None
    except Exception:  # noqa: BLE001 - team chi la thong tin hien thi
        logger.warning("lead overview: khong tra duoc team cua %s", user_id, exc_info=True)
        return None


def _select_all(table: str, columns: str, **eq) -> list[dict[str, Any]]:
    supabase = get_supabase_client()

    def build():
        q = supabase.table(table).select(columns)
        for k, v in eq.items():
            q = q.eq(k, v)
        return q.execute()

    return execute_supabase_query(build).data or []


def _latest_per_chain(quotes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Moi chuoi phien ban (version_chain_id) chi lay phien ban moi nhat."""
    best: dict[str, dict[str, Any]] = {}
    for q in quotes:
        key = q.get("version_chain_id") or q["id"]
        cur = best.get(key)
        if cur is None or (q.get("version_number") or 1) > (cur.get("version_number") or 1):
            best[key] = q
    return sorted(best.values(), key=lambda r: r.get("created_at") or "", reverse=True)


def _quote_step_states(quote: dict[str, Any] | None, contracts: list[dict[str, Any]]) -> dict[str, str]:
    """Trang thai tung buoc quote/contract: done | current | pending, DERIVE tu processing_stage/status/moc thoi gian."""
    states = {"quote_request": "pending", "presale": "pending", "sale": "pending", "approval": "pending", "quote": "pending", "contract": "pending"}
    if quote:
        stage = quote.get("processing_stage") or "request"
        approved = bool(quote.get("approved_at")) or quote.get("status") == "approved"
        published = bool(quote.get("published_at")) or stage == "published"
        sent = bool(quote.get("sent_at"))
        states["quote_request"] = "done"
        if stage in ("request", "technical"):
            states["presale"] = "current"
        else:
            states["presale"] = "done"
        if stage == "pricing":
            states["sale"] = "current"
        elif stage in ("review", "ready_to_publish", "published") or approved:
            states["sale"] = "done"
        if stage == "review" and not approved:
            states["approval"] = "current"
        elif approved or stage in ("ready_to_publish", "published"):
            states["approval"] = "done"
        if sent or published:
            states["quote"] = "done"
        elif approved:
            states["quote"] = "current"
        if contracts:
            states["contract"] = "done"
        elif quote.get("customer_outcome") == "lost":
            states["contract"] = "out"
        elif sent or published:
            states["contract"] = "current"
    return states


def _approval_state(q: dict[str, Any]) -> tuple[str, str]:
    """(key, nhan) - trang thai duyet DERIVE tu moc that: da duyet / cho duyet / bi yeu cau chinh sua / chua toi buoc duyet."""
    stage = q.get("processing_stage") or "request"
    if q.get("approved_at") or q.get("status") == "approved":
        return "approved", "Đã duyệt"
    if stage == "review":
        return "pending", "Chờ duyệt"
    if q.get("requested_changes_at") and stage in ("technical", "pricing"):
        return "changes_requested", "Bị yêu cầu chỉnh sửa"
    return "not_yet", "Chưa tới bước duyệt"


def _waiting_on(q: dict[str, Any], nm) -> str | None:
    """Dang cho ai xu ly bao gia nay."""
    stage = q.get("processing_stage") or "request"
    if q.get("approved_at") or q.get("status") == "approved":
        return "Chờ phát hành/gửi khách" if not (q.get("published_at") or q.get("sent_at")) else None
    if stage in ("request", "technical"):
        return f"Presale: {nm(q.get('technical_owner_id')) or 'chưa gán'}"
    if stage == "pricing":
        return f"Sale: {nm(q.get('quote_owner_id')) or 'chưa gán'}"
    if stage == "review":
        return "Người duyệt (Admin/Leader)"
    return None


_OUTCOME_COLS = "customer_outcome, lost_reason, lost_reason_other, lost_note, lost_by_name, lost_at"
_OUTCOME_OK: dict[str, bool] = {}


def _outcome_columns() -> str:
    """Cot ket qua bao gia (migration 179) - chi them vao SELECT khi cot da ton tai (tranh vo overview neu deploy truoc migration)."""
    if not _OUTCOME_OK.get("ok"):
        try:
            get_supabase_client().table("quotes").select("customer_outcome").limit(1).execute()
            _OUTCOME_OK["ok"] = True
        except Exception:  # noqa: BLE001
            return ""
    return ", " + _OUTCOME_COLS


def _outcome_card(q: dict[str, Any], has_contract: bool) -> dict[str, Any] | None:
    """Ket qua cua KHACH sau phat hanh: awaiting (dang cho phan hoi) | lost (Khong chot / OUT) | None (chua phat hanh)."""
    if q.get("customer_outcome") == "lost":
        from app.modules.all_platform.services.quote_outcome_service import lost_reason_label

        return {"state": "lost", "label": "OUT — Không chốt", "reason": q.get("lost_reason"), "reasonLabel": lost_reason_label(q.get("lost_reason")),
                "reasonOther": q.get("lost_reason_other"), "note": q.get("lost_note"), "by": q.get("lost_by_name"), "at": q.get("lost_at")}
    published = bool(q.get("published_at") or q.get("sent_at") or q.get("processing_stage") == "published")
    if published and not has_contract:
        return {"state": "awaiting", "label": "Đang chờ phản hồi khách"}
    return None


def _rollup_steps(*, lead, deal, quotes, contracts, open_tasks, contracts_of, lead_actor, convert_actor, contract_actor=None) -> list[dict[str, Any]]:
    """Tien do TONG cua Lead, roll-up tu du lieu that cua cac bao gia/hop dong: Lead -> KH/Co hoi -> Bao gia -> Hop dong.
    (Tien do chi tiet 6 buoc tung bao gia nam rieng o card tung bao gia.)

    Nhieu bao gia (khong lay bua 1 quote):
      - Bao gia: 'done' khi da co hop dong, HOAC moi bao gia con hieu luc (chua OUT/huy) deu da phat hanh/gui khach; con bao gia
        chua phat hanh -> 'current' ('overdue' neu viec gap nhat qua han SLA).
      - Hop dong: 'done' khi CO hop dong (bao gia nao cung duoc); 'out' khi MOI bao gia deu OUT (hoac Co hoi lost) va chua co hop dong;
        'current' khi con bao gia da phat hanh dang cho khach; con lai 'pending'."""
    def delivered(q):
        return bool(q.get("sent_at") or q.get("published_at") or q.get("processing_stage") == "published")

    def lost(q):
        return q.get("customer_outcome") == "lost"

    alive = [q for q in quotes if not lost(q)]
    undelivered = [q for q in alive if not delivered(q) and not contracts_of(q)]
    awaiting = [q for q in alive if delivered(q) and not contracts_of(q)]
    deal_lost = bool(deal and deal.get("deal_stage") == "lost")
    n = len(quotes)

    if contracts or (quotes and not undelivered):
        quote_state = "done"
    elif undelivered:
        quote_state = "overdue" if (open_tasks and open_tasks[0].get("_rank") == 0) else "current"
    elif deal:
        quote_state = "current"
    else:
        quote_state = "pending"
    top = open_tasks[0] if open_tasks else None
    quote_due = ((top.get("due") or {}).get("dueAt") if top else None) if quote_state in ("current", "overdue") else None
    quote_at = min((q.get("sent_at") or q.get("published_at") or "9999" for q in quotes if delivered(q)), default=None)
    quote_note = None
    if n > 1:
        quote_note = f"{sum(1 for q in quotes if delivered(q))}/{n} báo giá đã phát hành" + (f" · {sum(1 for q in quotes if lost(q))} OUT" if any(lost(q) for q in quotes) else "")

    if contracts:
        contract_state = "done"
    elif (quotes and all(lost(q) for q in quotes)) or (deal_lost and not awaiting and not undelivered):
        contract_state = "out"
    elif awaiting:
        contract_state = "current"
    else:
        contract_state = "pending"
    n_with_contract = sum(1 for q in quotes if contracts_of(q))
    contract_note = f"{n_with_contract}/{n} báo giá có hợp đồng" if n > 1 and contracts else None
    contract_first = contracts[0] if contracts else None

    return [
        {"key": "lead", "label": "Lead", "state": "done", "at": _iso(lead.get("created_at")), "due": None, "actor": lead_actor},
        {"key": "customer_deal", "label": "Khách hàng / Cơ hội", "state": "done" if deal else ("current" if lead.get("status") in ("sql", "converted") else "pending"),
         "at": _iso(lead.get("converted_at")), "due": None, "actor": convert_actor},
        {"key": "quote", "label": "Báo giá", "state": quote_state, "at": _iso(quote_at if quote_at != "9999" else None), "due": quote_due,
         "actor": (top.get("assignee") if top and quote_state in ("current", "overdue") else None), "note": quote_note},
        {"key": "contract", "label": "OUT" if contract_state == "out" else "Hợp đồng", "state": contract_state,
         "at": _iso(contract_first.get("created_at")) if contract_first else None, "due": None,
         "actor": contract_actor, "note": contract_note},
    ]


def _ensure_customer_code(customer: dict[str, Any]) -> str | None:
    """CHI DOC ma KH (sinh luc convert / tao Customer) - KHONG sinh ma khi mo Lead 360."""
    return customer.get("customer_code") or None


def _quote_card(q: dict[str, Any], user: dict[str, Any], nm, derive_phase, sla_for, approver: str | None = None) -> dict[str, Any]:
    """1 bao gia day du de Sale doc ngay: SP/DV chinh, Presale/Sale, workflow, gia (gia von/margin theo QUYEN), SLA, dang cho ai, duyet."""
    from app.modules.all_platform.services.supabase_quote_service import apply_quote_field_permissions, get_quote

    full: dict[str, Any] = {}
    try:
        full = apply_quote_field_permissions(dict(get_quote(q["id"])), user)
    except Exception:  # noqa: BLE001 - mot bao gia loi khong duoc lam hong ca man Lead 360
        logger.warning("lead overview: khong doc duoc bao gia %s", q.get("id"), exc_info=True)
    def _flat(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # Hang muc long theo muc (section -> children): duoi phang, bo dong tieu de muc.
        out: list[dict[str, Any]] = []
        for it in rows or []:
            if it.get("rowType") != "section":
                out.append(it)
            out.extend(_flat(it.get("children") or []))
        return out

    items = _flat(full.get("items") or [])
    main = items[0] if items else None
    main_name = ((main or {}).get("serviceDescription") or (main or {}).get("description") or "").strip()
    cost_ok = bool(full.get("costViewAllowed"))
    profit_ok = bool(full.get("profitabilityViewAllowed"))
    cost_total = full.get("costTotal") if cost_ok else None
    gross = full.get("grossProfit") if profit_ok else None
    net = full.get("netRevenue") or full.get("customerPriceBeforeVat")
    margin = round(gross / net * 100, 1) if (profit_ok and gross is not None and net) else None
    markup = round(gross / cost_total * 100, 1) if (profit_ok and gross is not None and cost_total) else None
    approval_key, approval_label = _approval_state(q)
    # Danh sach hang muc (toi da 8) - gia/dong la gia khach (nhom C, ai xem duoc bao gia deu xem); gia von/markup tung dong KHONG tra.
    item_rows = [
        {"name": ((it.get("serviceDescription") or it.get("description") or "").strip() or None), "quantity": it.get("quantity"),
         "unit": it.get("unit"), "amount": it.get("totalAmount")}
        for it in items[:8]
    ]
    return {
        "id": q["id"], "number": q.get("quote_number"), "version": q.get("version_number") or 1, "status": q.get("status"),
        "stage": q.get("processing_stage"), "stageLabel": _STAGE_LABEL.get(q.get("processing_stage") or "request"),
        "phase": derive_phase(q), "currency": q.get("currency") or "VND",
        "mainItem": main_name or None, "itemCount": len(items), "items": item_rows,
        "totalAmount": q.get("total_amount"), "netRevenue": net, "vatAmount": full.get("vatAmount"),
        "costTotal": cost_total, "grossProfit": gross, "marginPercent": margin, "markupPercent": markup,
        "costViewAllowed": cost_ok, "profitabilityViewAllowed": profit_ok,
        "presale": nm(q.get("technical_owner_id")), "sale": nm(q.get("quote_owner_id")),
        "technicalOwnerId": q.get("technical_owner_id"), "quoteOwnerId": q.get("quote_owner_id"),
        "sla": sla_for(q), "waitingOn": _waiting_on(q, nm),
        "approval": {"state": approval_key, "label": approval_label, "approvedAt": q.get("approved_at"), "approvedBy": approver,
                     "changesRequestedAt": q.get("requested_changes_at") if approval_key == "changes_requested" else None},
        "createdAt": q.get("created_at"), "approvedAt": q.get("approved_at"), "publishedAt": q.get("published_at"),
        "sentAt": q.get("sent_at"), "updatedAt": q.get("updated_at"),
    }


def get_lead_overview(lead_id: str, user: dict[str, Any]) -> dict[str, Any]:
    lead = get_lead(lead_id, user)  # kiem tra quyen + 404
    inst = settings.crm_instance

    customer = None
    if lead.get("converted_customer_id"):
        rows = _select_all("crm_customers", "id, customer_name, company_name, customer_code, owner_id, phone, email, tax_code", id=lead["converted_customer_id"], instance=inst)
        customer = rows[0] if rows else None
    contact = None
    if lead.get("converted_contact_id"):
        try:
            rows = _select_all("crm_contacts", "id, name, phone, email, position, position_label_snapshot, contact_code", id=lead["converted_contact_id"], instance=inst)
        except Exception:  # migration 177 (contact_code) chua ap -> van tra contact, ma de trong
            rows = _select_all("crm_contacts", "id, name, phone, email, position, position_label_snapshot", id=lead["converted_contact_id"], instance=inst)
        contact = rows[0] if rows else None
    deal = None
    if lead.get("converted_deal_id"):
        rows = _select_all(
            "customer_leads",
            "id, customer_name, company_name, deal_stage, project_id, leaded_by, sdr_id, estimated_budget, stage_entered_at, next_step, follow_up_date, "
            "service_package, primary_contact_id, created_at, reject_reason_type",
            id=lead["converted_deal_id"], instance=inst,
        )
        deal = rows[0] if rows else None
    project = None
    if deal and deal.get("project_id"):
        rows = _select_all("projects", "id, name, project_code, status", id=deal["project_id"], instance=inst)
        project = rows[0] if rows else None

    quotes_all: list[dict[str, Any]] = []
    contracts: list[dict[str, Any]] = []
    if deal:
        quotes_all = [
            q for q in _select_all(
                "quotes",
                "id, quote_number, status, processing_stage, version_number, version_chain_id, technical_owner_id, quote_owner_id, "
                "sla_started_at, sla_due_at, completed_at, approved_at, published_at, sent_at, created_at, updated_at, total_amount, currency, "
                "requested_changes_at, requested_changes_target_stage, deleted_at, deal_id, approved_by" + _outcome_columns(),
                deal_id=deal["id"], instance=inst,
            ) if not q.get("deleted_at") and q.get("status") != "cancelled"
        ]
        contracts = _select_all(
            "contracts", "id, contract_number, title, status, contract_value, currency, signed_at, file_url, source, deal_phase, created_at, quote_id, owner_id, start_date, end_date",
            deal_id=deal["id"], instance=inst,
        )
    quotes = _latest_per_chain(quotes_all)
    primary = quotes[0] if quotes else None

    ids = {
        lead.get("sdr_id"), lead.get("qualification_ae_id"), lead.get("created_by"), lead.get("converted_by"),
        (customer or {}).get("owner_id"), (deal or {}).get("leaded_by"), (deal or {}).get("sdr_id"),
    }
    for q in quotes_all:
        ids.update({q.get("technical_owner_id"), q.get("quote_owner_id"), q.get("approved_by")})
    for c in contracts:
        ids.add(c.get("owner_id"))

    # ── nhat ky that -> timeline + moc thoi gian tung buoc ─────────────────────
    lead_logs = _select_all("crm_lead_activity_log", "action, from_status, to_status, actor_id, note, created_at", lead_id=lead_id)
    quote_ids = [q["id"] for q in quotes_all]
    supabase = get_supabase_client()
    quote_logs = (
        execute_supabase_query(lambda: supabase.table("quote_activity_log").select("quote_id, action, changes, actor_id, created_at").in_("quote_id", quote_ids).execute()).data or []
        if quote_ids else []
    )
    contract_ids = [c["id"] for c in contracts]
    contract_logs = (
        execute_supabase_query(lambda: supabase.table("contract_activity_log").select("contract_id, action, changes, actor_id, created_at").in_("contract_id", contract_ids).execute()).data or []
        if contract_ids else []
    )
    for log in (*lead_logs, *quote_logs, *contract_logs):
        ids.add(log.get("actor_id"))
    names = _user_names({i for i in ids if i})
    nm = lambda i: names.get(i) if i else None  # noqa: E731

    quote_no = {q["id"]: q.get("quote_number") for q in quotes_all}
    contract_no = {c["id"]: (c.get("contract_number") or c.get("title")) for c in contracts}
    timeline: list[dict[str, Any]] = []

    for log in lead_logs:
        if log["action"] == "created":
            timeline.append({"at": log["created_at"], "kind": "lead", "title": "Lead được tạo", "actor": nm(log.get("actor_id")), "detail": None})
        elif log["action"] == "status_changed":
            to_label = _LEAD_STATUS_LABEL.get(str(log.get("to_status") or "").lower(), str(log.get("to_status") or ""))
            timeline.append({"at": log["created_at"], "kind": "lead", "title": f"Xác minh: {to_label}", "actor": nm(log.get("actor_id")), "detail": log.get("note")})
    if lead.get("converted_at"):
        who = nm(lead.get("converted_by"))
        timeline.append({"at": lead["converted_at"], "kind": "convert", "title": "Khách hàng được tạo", "actor": who, "detail": (customer or {}).get("customer_name")})
        timeline.append({"at": lead["converted_at"], "kind": "convert", "title": "Cơ hội được tạo", "actor": who, "detail": (deal or {}).get("customer_name")})
        if lead.get("qualification_ae_id"):
            timeline.append({"at": lead["converted_at"], "kind": "handover", "title": f"Bàn giao cho {nm(lead['qualification_ae_id'])}", "actor": who,
                             "detail": (_team_of(lead["qualification_ae_id"]) or {}).get("name")})

    # moc thoi gian vao tung buoc xu ly (tu nhat ky THAT) cho TUNG bao gia theo quote_id
    stage_at_by_q: dict[str, dict[str, str]] = {}
    created_at_by_q: dict[str, str] = {}
    for log in sorted(quote_logs, key=lambda x: str(x["created_at"])):
        qid = log["quote_id"]
        if log["action"] == "created" and qid not in created_at_by_q:
            created_at_by_q[qid] = log["created_at"]
        if log["action"] == "stage_changed":
            st = (log.get("changes") or {}).get("stage")
            if st and st not in stage_at_by_q.setdefault(qid, {}):
                stage_at_by_q[qid][st] = log["created_at"]

    stage_event_title = {
        "technical": "Bàn giao Presale xử lý",
        "pricing": "Presale xong — Sale hoàn thiện giá",
        "review": "Gửi duyệt",
        "ready_to_publish": "Báo giá đã duyệt",
        "published": "Báo giá được phát hành",
    }
    for log in quote_logs:
        action, ch, qn = log["action"], log.get("changes") or {}, quote_no.get(log["quote_id"])
        title: str | None = None
        detail: str | None = None
        if action == "created":
            title = "Yêu cầu báo giá"
        elif action == "owner_assigned":
            parts = []
            if ch.get("technicalOwnerId"):
                parts.append(f"Presale {nm(ch['technicalOwnerId']) or '—'}")
            if ch.get("quoteOwnerId"):
                parts.append(f"Sale {nm(ch['quoteOwnerId']) or '—'}")
            title, detail = "Phân công / đổi người phụ trách báo giá", " · ".join(parts) or None
        elif action == "stage_changed":
            st = str(ch.get("stage") or "")
            title = stage_event_title.get(st) or f"Chuyển bước: {_STAGE_LABEL.get(st, st)}"
        elif action in ("approved", "approved_with_exception"):
            title = "Báo giá được duyệt"
            detail = ch.get("exceptionReason") if action == "approved_with_exception" else None
        elif action == "changes_requested":
            title, detail = "Từ chối / yêu cầu chỉnh sửa", ch.get("reason")
        elif action == "published":
            title = "Báo giá được phát hành"
        elif action == "version_created":
            title = "Tạo phiên bản mới"
        if title:
            timeline.append({"at": log["created_at"], "kind": "quote", "title": title, "actor": nm(log.get("actor_id")), "detail": detail, "ref": qn})
    for log in contract_logs:
        action = log["action"]
        title = ("Hợp đồng được tạo/ghi nhận" if action == "created" else "Hợp đồng cập nhật" if action == "updated" else
                 f"Hợp đồng: {action.split(':', 1)[1]}" if action.startswith("status_changed:") else None)
        if title:
            timeline.append({"at": log["created_at"], "kind": "contract", "title": title, "actor": nm(log.get("actor_id")), "detail": None, "ref": contract_no.get(log["contract_id"])})
    timeline = [t for t in timeline if t.get("at")]
    timeline.sort(key=lambda t: str(t["at"]), reverse=True)
    timeline = timeline[:_TIMELINE_LIMIT]

    # ── tien do: DERIVE tu record that ──────────────────────────────────────────
    from app.modules.all_platform.services.progress_service import _quote_sla_payload
    from app.modules.all_platform.services.supabase_quote_service import _derive_quote_phase

    def _sla_for(q: dict[str, Any]) -> dict[str, Any]:
        # Du lieu cu khong ghi completed_at khi duyet/phat hanh -> coi moc duyet/phat hanh/gui la luc hoan thanh SLA
        # (khong thi bao gia da gui van bi bao "qua han").
        done_at = q.get("completed_at") or q.get("approved_at") or q.get("published_at") or q.get("sent_at")
        return _quote_sla_payload({**q, "completed_at": done_at})

    def _contracts_of(q: dict[str, Any]) -> list[dict[str, Any]]:
        chain = q.get("version_chain_id") or q["id"]
        ids_in_chain = {x["id"] for x in quotes_all if (x.get("version_chain_id") or x["id"]) == chain}
        linked = [c for c in contracts if c.get("quote_id") in ids_in_chain]
        if not linked and len(quotes) == 1:  # hop dong chua gan quote_id + Lead chi co 1 bao gia -> thuoc bao gia do
            linked = [c for c in contracts if not c.get("quote_id")]
        return linked

    def _quote_progress(q: dict[str, Any]) -> list[dict[str, Any]]:
        qc = _contracts_of(q)
        st = _quote_step_states(q, qc)
        sla_q = _sla_for(q)
        due = sla_q.get("dueAt")
        at_map = stage_at_by_q.get(q["id"], {})
        created = created_at_by_q.get(q["id"])
        rows = [
            {"key": "quote_request", "label": "Yêu cầu BG", "state": st["quote_request"], "at": _iso(created or q.get("created_at")), "due": None, "actor": None},
            {"key": "presale", "label": "Presale", "state": st["presale"],
             "at": _iso(at_map.get("pricing") if st["presale"] == "done" else (at_map.get("technical") or created)),
             "due": due if st["presale"] == "current" else None, "actor": nm(q.get("technical_owner_id"))},
            {"key": "sale", "label": "Sale hoàn thiện giá", "state": st["sale"],
             "at": _iso(at_map.get("review") if st["sale"] == "done" else at_map.get("pricing")),
             "due": due if st["sale"] == "current" else None, "actor": nm(q.get("quote_owner_id"))},
            {"key": "approval", "label": "Chờ duyệt", "state": st["approval"],
             "at": _iso(q.get("approved_at") if st["approval"] == "done" else at_map.get("review")),
             "due": due if st["approval"] == "current" else None, "actor": nm(q.get("approved_by")) if st["approval"] == "done" else None},
            {"key": "quote", "label": "Báo giá", "state": st["quote"], "at": _iso(q.get("sent_at") or q.get("published_at")), "due": None, "actor": None},
            {"key": "contract", "label": "OUT" if st["contract"] == "out" else "Hợp đồng", "state": st["contract"],
             "at": _iso(q.get("lost_at")) if st["contract"] == "out" else (_iso(qc[0].get("created_at")) if qc else None), "due": None,
             "actor": (q.get("lost_by_name") if st["contract"] == "out" else (nm(qc[0].get("owner_id")) if qc else None))},
        ]
        # Buoc dang xu ly ma SLA qua han -> 'overdue' (chi bao gia co SLA that; khong bia han cho buoc khac).
        if sla_q.get("status") == "overdue":
            for r in rows:
                if r["state"] == "current" and r["key"] in ("presale", "sale", "approval"):
                    r["state"] = "overdue"
        return rows

    def _task_of_quote(q: dict[str, Any]) -> dict[str, Any]:
        """Viec dang xu ly cua 1 bao gia + do uu tien (0 qua han, 1 dang xu ly, 2 cho phat hanh, 3 cho khach)."""
        stage = q.get("processing_stage") or "request"
        sla_q = _sla_for(q)
        due_q = _due_info(q.get("sla_due_at"), completed=bool(q.get("completed_at")))
        if q.get("sent_at") or q.get("published_at") or stage == "published":
            task = {"label": "Báo giá đã gửi khách — chờ khách phản hồi / ghi nhận hợp đồng", "stepKey": "contract", "assignee": nm(q.get("quote_owner_id")), "role": "Sale",
                    "due": _due_info((deal or {}).get("follow_up_date")), "nextStep": (deal or {}).get("next_step")}
            rank = 3
        elif q.get("approved_at") or q.get("status") == "approved":
            task = {"label": "Báo giá đã duyệt — chờ phát hành/gửi khách", "stepKey": "quote", "assignee": nm(q.get("quote_owner_id")), "role": "Sale", "due": None, "nextStep": None}
            rank = 2
        elif stage == "review":
            task = {"label": "Báo giá đang chờ duyệt", "stepKey": "approval", "assignee": None, "role": "Người duyệt", "due": due_q, "nextStep": None}
            rank = 1
        elif stage == "pricing":
            task = {"label": "Sale đang hoàn thiện giá bán", "stepKey": "sale", "assignee": nm(q.get("quote_owner_id")), "role": "Sale", "due": due_q, "nextStep": None}
            rank = 1
        else:
            task = {"label": "Presale đang xử lý yêu cầu/giá vốn", "stepKey": "presale", "assignee": nm(q.get("technical_owner_id")), "role": "Presale", "due": due_q, "nextStep": None}
            rank = 1
        if q.get("requested_changes_at") and stage in ("technical", "pricing"):
            task["label"] += " (đang sửa theo yêu cầu chỉnh sửa)"
        if rank == 1 and sla_q.get("status") == "overdue":
            rank = 0
        return {**task, "_rank": rank, "_due": q.get("sla_due_at") or "9999"}

    progress_by_quote = {q["id"]: _quote_progress(q) for q in quotes}
    open_tasks = []
    for q in quotes:
        if _contracts_of(q) or q.get("customer_outcome") == "lost":
            continue
        task = _task_of_quote(q)
        task.update({"quoteId": q["id"], "quoteNumber": q.get("quote_number")})
        open_tasks.append(task)
    open_tasks.sort(key=lambda x: (x["_rank"], str(x["_due"])))

    sla = _sla_for(primary) if primary else None  # SLA cua bao gia moi nhat (giu tuong thich)
    steps = _rollup_steps(
        lead=lead, deal=deal, quotes=quotes, contracts=contracts, open_tasks=open_tasks, contracts_of=_contracts_of,
        lead_actor=nm(lead.get("created_by")), convert_actor=nm(lead.get("converted_by")),
        contract_actor=nm(contracts[0].get("owner_id")) if contracts else None,
    )

    # ── "Viec hien tai": uu tien viec dang xu ly / qua han cua cac bao gia CON MO ───────────────
    ae_id = lead.get("qualification_ae_id") or lead.get("sdr_id")
    current: dict[str, Any]
    if not deal:
        current = {"label": "Chờ xác minh và bàn giao Sale", "stepKey": "customer_deal", "assignee": nm(ae_id), "role": "Sale", "due": _due_info(lead.get("follow_up_date")), "nextStep": lead.get("next_step")}
    elif not quotes:
        current = {"label": "Chưa có yêu cầu báo giá — tạo yêu cầu báo giá cho cơ hội", "stepKey": "quote_request", "assignee": nm((deal or {}).get("sdr_id") or ae_id), "role": "Sale", "due": _due_info((deal or {}).get("follow_up_date")), "nextStep": (deal or {}).get("next_step")}
    elif open_tasks:
        top = open_tasks[0]
        current = {k: v for k, v in top.items() if not k.startswith("_")}
        if len(quotes) > 1:
            current["label"] = f"BG {top['quoteNumber']}: {current['label']}"
        current["openQuotes"] = len(open_tasks)
    elif any(q.get("customer_outcome") == "lost" for q in quotes) and not contracts:
        lost_q = next(q for q in quotes if q.get("customer_outcome") == "lost")
        current = {"label": "Cơ hội đã OUT — tất cả báo giá Không chốt" if (deal or {}).get("deal_stage") == "lost" else "Tất cả báo giá đã Không chốt (OUT)",
                   "stepKey": "contract", "assignee": lost_q.get("lost_by_name"), "role": "Người ghi nhận OUT", "due": None, "nextStep": None, "openQuotes": 0}
    else:  # moi bao gia deu da co hop dong
        c0 = contracts[0] if contracts else {}
        current = {"label": "Tất cả báo giá đã có hợp đồng" if len(quotes) > 1 else "Đã có hợp đồng", "stepKey": "contract", "assignee": nm(c0.get("owner_id")),
                   "role": "Phụ trách hợp đồng", "due": None, "nextStep": None, "openQuotes": 0}

    try:  # ma LH cua Lead (migration 178); chua co cot thi de trong
        _lc = _select_all("crm_leads", "contact_code", id=lead_id)
        lead_contact_code = (_lc[0].get("contact_code") if _lc else None) or None
    except Exception:  # noqa: BLE001
        lead_contact_code = None

    owner_id = lead.get("qualification_ae_id") or (customer or {}).get("owner_id") or lead.get("sdr_id")
    sale_id = lead.get("qualification_ae_id") or lead.get("sdr_id")
    sale_team = _team_of(sale_id) or {}
    lead_team = _team_by_id(lead.get("team_id")) if lead.get("team_id") else None
    # Team Sale theo SALE PHU TRACH (plan: chon Sale -> tu ra Team); chi roi ve team da luu tren lead khi Sale chua thuoc team nao.
    team_sale = (sale_team or lead_team or {}).get("name")
    follow_src = lead.get("follow_up_date") or (deal or {}).get("follow_up_date")
    approver_by_quote: dict[str, str | None] = {}
    for log in sorted(quote_logs, key=lambda x: str(x["created_at"])):
        if log["action"] in ("approved", "approved_with_exception"):
            approver_by_quote[log["quote_id"]] = nm(log.get("actor_id"))
    # Nguoi duyet: uu tien quotes.approved_by (nguon that khi bam Duyet); thieu thi moi khoi phuc tu audit log. KHONG fallback Sale/Presale/nguoi tao.
    quote_cards = [
        _quote_card(q, user, nm, _derive_quote_phase, _sla_for, nm(q.get("approved_by")) if q.get("approved_by") else approver_by_quote.get(q["id"]))
        for q in quotes
    ]
    for card in quote_cards:
        _q_row = next((q for q in quotes if q["id"] == card["id"]), {})
        card["outcome"] = _outcome_card(_q_row, bool(_contracts_of(_q_row)) if _q_row else False)
        card["progress"] = progress_by_quote.get(card["id"], [])
        card["hasContract"] = bool(next((q for q in quotes if q["id"] == card["id"] and _contracts_of(q)), None))
    open_ids = {x["quoteId"] for x in open_tasks}
    presale_names = []
    for q in quotes:
        n = nm(q.get("technical_owner_id"))
        if n and q["id"] in open_ids and n not in presale_names:
            presale_names.append(n)
    presale_label = ", ".join(presale_names) or None

    return {
        "lead": {
            "id": lead["id"], "name": lead.get("lead_name"), "company": lead.get("company_name"), "phone": lead.get("phone"), "email": lead.get("email"),
            "status": lead.get("status"), "statusLabel": _LEAD_STATUS_LABEL.get(str(lead.get("status") or "").lower()), "source": lead.get("source"),
            "position": (contact or {}).get("position_label_snapshot") or (contact or {}).get("position") or lead.get("position_label_snapshot") or lead.get("position"),
            "need": lead.get("qualification_need"), "estimatedValue": lead.get("qualification_estimated_value"), "score": lead.get("score"),
            "expectedTimeline": lead.get("qualification_expected_timeline"), "dealStage": lead.get("deal_stage"), "note": lead.get("note"),
            "nextStep": lead.get("next_step"), "followUpDate": lead.get("follow_up_date"), "createdAt": lead.get("created_at"), "converted": bool(deal),
            "contactCode": lead_contact_code,
            "isOut": bool(deal and deal.get("deal_stage") == "lost"),
            "outReason": ((deal or {}).get("reject_reason_type") if deal and deal.get("deal_stage") == "lost" else None),
        },
        "customer": ({"id": customer["id"], "name": customer.get("customer_name"), "code": _ensure_customer_code(customer), "taxCode": customer.get("tax_code"),
                      "owner": nm(customer.get("owner_id")), "team": (_team_of(customer.get("owner_id")) or {}).get("name")} if customer else None),
        "contact": ({"id": contact["id"], "name": contact.get("name"), "phone": contact.get("phone"), "email": contact.get("email"), "contactCode": contact.get("contact_code") or lead_contact_code,
                     "position": contact.get("position_label_snapshot") or contact.get("position")} if contact else None),
        "deal": ({"id": deal["id"], "name": deal.get("customer_name"), "companyName": deal.get("company_name"), "stage": deal.get("deal_stage"),
                  "estimatedBudget": deal.get("estimated_budget"), "stageEnteredAt": deal.get("stage_entered_at"), "followUpDate": deal.get("follow_up_date"),
                  "createdAt": deal.get("created_at"), "nextStep": deal.get("next_step"), "nextStepDue": _due_info(deal.get("follow_up_date")),
                  "servicePackage": deal.get("service_package"),
                  "customerId": (customer or {}).get("id"), "projectId": deal.get("project_id"), "quoteId": (primary or {}).get("id"),
                  "sdrId": deal.get("sdr_id"), "sdrName": nm(deal.get("sdr_id")), "leadedById": deal.get("leaded_by"), "leadedByName": nm(deal.get("leaded_by")),
                  "ownerTeam": (_team_of(deal.get("sdr_id")) or {}).get("name"),
                  "project": ({"id": project["id"], "name": project.get("name"), "code": project.get("project_code")} if project else None)} if deal else None),
        "sale": {"id": sale_id, "name": nm(sale_id), "team": sale_team.get("name")},
        "presale": {"id": (primary or {}).get("technical_owner_id"), "name": presale_label} if primary else None,
        "owner": {"id": owner_id, "name": nm(owner_id), "team": (_team_of(owner_id) or {}).get("name")},
        "handover": {
            "teamSale": team_sale, "sale": nm(sale_id), "presale": presale_label,
            "handedOverBy": nm(lead.get("converted_by")) if deal else None, "handedOverAt": lead.get("converted_at") if deal else None,
            "nextStep": lead.get("next_step") or (deal or {}).get("next_step"), "followUp": _due_info(follow_src), "followUpAt": follow_src,
            # GD1 chua co field/audit tai lieu ban giao (thuoc GD3) -> luon rong; TUYET DOI khong lay file/link hop dong hay bao gia.
            "documents": [],
        },
        "currentTask": current,
        "steps": steps,
        "sla": sla,
        "quotes": quote_cards,
        "contracts": [
            {"id": c["id"], "number": c.get("contract_number"), "title": c.get("title"), "status": c.get("status"), "value": c.get("contract_value"),
             "currency": c.get("currency") or "VND", "signedAt": c.get("signed_at"), "fileUrl": c.get("file_url"), "source": c.get("source"),
             "createdAt": c.get("created_at"), "dealId": (deal or {}).get("id"), "quoteId": c.get("quote_id"), "quoteNumber": quote_no.get(c.get("quote_id")),
             "startDate": c.get("start_date"), "endDate": c.get("end_date"), "ownerId": c.get("owner_id"), "ownerName": nm(c.get("owner_id"))}
            for c in contracts
        ],
        "timeline": timeline,
    }
