"""GD3 - Ban giao xu ly / Assign / Re-assign Lead + email ban giao.

3 tinh huong:
  1) Chua du SQL -> `assign_lead()` (kind 'handover' / 'reassign'): luu nguoi phu trach + CRM Team + link Doc/Sheet hang muc bao gia,
     gui email (Ma LH, thong tin Lead, link, checklist con thieu, deep link vao Xac minh Lead).
  2) Du SQL, nguoi thao tac chon nguoi nhan -> `record_convert_handover()` (kind 'assign_qualified') goi SAU `convert_lead()`
     (Customer + Co hoi da tao): email Ma KH + Ma LH + link Chi tiet khach hang.
  3) Tu xu ly (nguoi nhan == nguoi thao tac) -> khong ban giao, KHONG gui email.

Chong gui trung: moi thao tac co `idempotency_key`; hang lich su duoc INSERT truoc (unique (instance, idempotency_key)),
trung key -> tra ket qua cu, khong gui lai. Email chi gui SAU khi thao tac chinh thanh cong; loi email KHONG lam hong thao tac.
"""

from __future__ import annotations

import html
import logging
import os
import smtplib
import uuid
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from urllib.parse import urlparse

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

LINK_LIMIT = 20
HANDOVER_TABLE = "crm_lead_handovers"

# Test/local: dat HANDOVER_EMAIL_DRY_RUN=1 de KHONG gui SMTP that (trang thai 'dry_run').
def _dry_run() -> bool:
    return str(os.environ.get("HANDOVER_EMAIL_DRY_RUN", "")).strip().lower() in ("1", "true", "yes")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class EmailLinkConfigError(ValueError):
    """Khong xac dinh duoc domain hop le de tao link trong email (thieu cau hinh) - khong am tham dung domain sai."""


def _origin_of(url: str | None) -> str:
    parsed = urlparse((url or "").strip())
    return f"{parsed.scheme}://{parsed.netloc}".lower() if parsed.scheme and parsed.netloc else ""


def _is_local(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host in ("localhost", "127.0.0.1", "0.0.0.0") or host.endswith(".local")


def resolve_base_url(instance: str | None, request_base: str | None = None) -> str:
    """Domain goc cho link trong email = domain CRM CHINH THUC cua workspace (instance) cua Lead/Customer/Deal
    (cau hinh tap trung o app/core/workspace_domains.py, ghi de bang env). Khong tin Host/Origin client de TAO link:
    origin chi duoc dung khi la chinh domain do, alias cung workspace (INSTANCE_DOMAIN_MAP) hoac nam trong EMAIL_LINK_ALLOWED_ORIGINS.
    Instance khong co domain nao -> chi khi do moi dung PUBLIC_APP_BASE_URL (deployment don le); khong co nua -> EmailLinkConfigError.
    localhost chi duoc khi nam trong EMAIL_LINK_ALLOWED_ORIGINS."""
    from app.core.workspace_domains import workspace_domain

    inst = (instance or getattr(settings, "crm_instance", "") or "").strip()
    extra = {_origin_of(x) for x in os.environ.get("EMAIL_LINK_ALLOWED_ORIGINS", "").split(",") if x.strip()}
    trusted = _origin_of(workspace_domain(inst)) or _origin_of(os.environ.get("PUBLIC_APP_BASE_URL", "").strip())
    if not trusted:
        raise EmailLinkConfigError(
            f"Chưa cấu hình domain CRM cho workspace '{inst}' (EMAIL_LINK_WORKSPACE_DOMAINS) — không thể tạo link trong email."
        )

    req = _origin_of(request_base)
    if req and req != trusted:
        domain_map = {str(k).strip().lower(): str(v).strip() for k, v in (getattr(settings, "instance_domain_map", None) or {}).items()}
        req_host = (urlparse(req).hostname or "").lower()
        if req in extra or (bool(inst) and domain_map.get(req_host, "").lower() == inst.lower()):
            trusted = req
    if _is_local(trusted) and trusted not in extra:
        raise EmailLinkConfigError("Domain link email đang là localhost — cấu hình domain CRM thật cho workspace này.")
    return trusted


# ── link Doc/Sheet ───────────────────────────────────────────────────────────────────────────
def _title_for(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    path = parsed.path.lower()
    if "docs.google.com" in host or "drive.google.com" in host:
        if "/spreadsheets" in path:
            return "Google Sheet"
        if "/document" in path:
            return "Google Doc"
        if "/presentation" in path:
            return "Google Slides"
        return "Google Drive"
    return host or url


def normalize_doc_links(raw: Any) -> list[dict[str, str]]:
    """Nhan chuoi (nhieu dong/khoang trang) hoac list[str|dict{url,title}] -> list[{url,title}] hop le (http/https), khong trung."""
    if raw is None:
        return []
    items: list[Any]
    if isinstance(raw, str):
        items = [part for part in raw.replace(",", "\n").split() if part.strip()]
    elif isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        raise ValueError("Danh sách link tài liệu không hợp lệ.")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        url = (item.get("url") if isinstance(item, dict) else str(item or "")).strip()
        title = (item.get("title") if isinstance(item, dict) else "") or ""
        if not url:
            continue
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(f"Link không hợp lệ (cần bắt đầu bằng http:// hoặc https://): {url}")
        if url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "title": str(title).strip() or _title_for(url)})
    if len(out) > LINK_LIMIT:
        raise ValueError(f"Tối đa {LINK_LIMIT} link tài liệu.")
    return out


# ── nguoi dung ───────────────────────────────────────────────────────────────────────────────
def _user_row(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    rows = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select("id, name, email").eq("id", user_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def _names(ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select("id, name, email").in_("id", list(ids)).execute()
    ).data or []
    return {r["id"]: (r.get("name") or r.get("email") or "") for r in rows}


# ── email ────────────────────────────────────────────────────────────────────────────────────
def compute_missing_items(lead: dict[str, Any]) -> list[str]:
    """Dieu kien SQL con thieu cua Lead - lay TU RULE ENGINE (crm_lead_rule_service, rule dang cau hinh), khong hardcode.
    Lead da convert/qualified -> rong. Rule khong doc duoc -> rong (khong bia)."""
    if lead.get("converted_customer_id") or lead.get("converted_deal_id") or lead.get("status") in ("sql", "qualified"):
        return []
    try:
        from app.modules.all_platform.services import crm_lead_rule_service as rules

        fields = {
            "has_product": bool(str(lead.get("qualification_need") or "").strip()),
            "has_interest_level": lead.get("score") is not None,
            "has_value": lead.get("qualification_estimated_value") is not None,
            "has_team": bool(lead.get("qualification_ae_id")),
            "has_next": bool(str(lead.get("next_step") or "").strip()),
            "has_follow": bool(lead.get("follow_up_date")),
            "has_contact": bool(str(lead.get("phone") or "").strip() or str(lead.get("email") or "").strip()),
            "fit_unfit": lead.get("qualification_icp_fit") is False,
            "fit_known": lead.get("qualification_icp_fit") is not None,
        }
        return list(rules.evaluate_lead_conditions(fields, rules.get_rule_set().get("conditions"))["missing"])
    except Exception:  # noqa: BLE001
        logger.warning("Khong tinh duoc checklist tu rule engine", exc_info=True)
        return []


def _money(value: Any) -> str:
    try:
        return f"{int(float(value)):,}".replace(",", ".") + " ₫"
    except (TypeError, ValueError):
        return str(value)


def _vn_date(value: Any) -> str:
    """ISO (yyyy-mm-dd[Thh:mm...]) -> dd/MM/yyyy; khong parse duoc -> chuoi goc."""
    text = str(value or "").strip()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")[:19] if "T" in text else text[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return text


def _contact_name(lead: dict[str, Any]) -> str | None:
    """Ten nguoi lien he THAT: Lead da convert -> tu crm_contacts; chua convert -> ten tren Lead (chinh la nguoi lien he)."""
    cid = lead.get("converted_contact_id")
    if cid:
        try:
            rows = execute_supabase_query(lambda: get_supabase_client().table("crm_contacts").select("name").eq("id", cid).limit(1).execute()).data or []
            if rows and rows[0].get("name"):
                return rows[0]["name"]
        except Exception:  # noqa: BLE001
            logger.warning("Khong doc duoc lien he %s", cid, exc_info=True)
    return lead.get("lead_name") or None


def _short_url(url: str, limit: int = 56) -> str:
    plain = url.split("://", 1)[-1]
    return plain if len(plain) <= limit else plain[: limit - 1] + "…"


def build_handover_email(
    *, kind: str, lead: dict[str, Any], lead_code: str | None, actor_name: str, to_name: str, links: list[dict[str, str]],
    missing_items: list[str], customer: dict[str, Any] | None = None, customer_code: str | None = None, note: str | None = None,
    base_url: str | None = None, contact_name: str | None = None, prev_name: str | None = None,
) -> tuple[str, str, str]:
    """(subject, text, html). Loi thoai theo ngu canh - noi ro nguoi nhan can lam gi tiep, khong dung thuat ngu noi bo:
    A) ban giao Lead chua du thong tin  B) xac minh dat chuan & ban giao khach  C) re-assign Lead chua convert  D) re-assign sau convert."""
    from app.modules.all_platform.services.crm_handover_email_template import render_handover_email

    esc = html.escape
    base = resolve_base_url(lead.get("instance") or settings.crm_instance, base_url)
    lead_url = f"{base}/all-platform/crm/leads?lead={lead['id']}&mode=verify"
    customer_url = f"{base}/all-platform/crm/customers/{customer['id']}?tab=quotes" if customer and customer.get("id") else None
    lead_name = lead.get("lead_name") or "Lead"
    company = lead.get("company_name") or ""
    who = company or lead_name                          # ten hien thi: cong ty, khong co thi ten lien he
    converted = bool(customer_url) or bool(lead.get("converted_customer_id"))
    code = lead_code or lead.get("contact_code")
    missing = [] if converted or kind == "assign_qualified" else [m for m in missing_items if str(m).strip()]
    follow = lead.get("follow_up_date") or lead.get("next_step_at")
    org = f"<b>{esc(who)}</b>"
    from_prev = f" từ <b>{esc(prev_name)}</b>" if prev_name else ""

    if kind == "assign_qualified" or converted:
        state = "converted"
    elif missing:
        state = "missing"
    else:
        state = "ready"

    if kind == "assign_qualified":                                                          # B
        shown_code = customer_code or code
        subject = f"[Khách hàng mới] {shown_code + ' · ' if shown_code else ''}{who}"
        heading, badge, tone = "Bàn giao khách hàng", "Làm báo giá", "ok"
        intro = f"Khách hàng {org} đã được chuyển đến bạn phụ trách.<br>Vui lòng xem hồ sơ khách hàng và các tài liệu được bàn giao để tiếp tục xử lý cơ hội và lập báo giá."
        steps = ["Xem hồ sơ khách hàng và cơ hội", "Mở tài liệu hạng mục báo giá được bàn giao", "Lập và gửi báo giá cho khách"]
        cta_label, cta_url = "Xem hồ sơ khách hàng", customer_url or lead_url
    elif kind == "reassign":
        subject = f"[Đổi người phụ trách] {code or ''} · {who}"
        heading = "Đổi người phụ trách"
        if state == "converted":                                                            # D
            badge, tone = "Tiếp tục xử lý", "ok"
            intro = f"Bạn được phân công tiếp nhận khách hàng {org}{from_prev}.<br>Vui lòng xem hồ sơ, tài liệu bàn giao và tiếp tục xử lý cơ hội, lập báo giá theo các hạng mục được cung cấp."
            steps = ["Xem hồ sơ khách hàng và cơ hội đang mở", "Mở tài liệu hạng mục báo giá được bàn giao", "Lập và gửi báo giá cho khách"]
            cta_label, cta_url = "Xem hồ sơ & lập báo giá", customer_url or lead_url
        elif state == "missing":                                                            # C
            badge, tone = "Cần bổ sung thông tin", "warn"
            intro = f"Bạn được phân công tiếp nhận Lead {org}{from_prev}.<br>Vui lòng kiểm tra thông tin, bổ sung các mục còn thiếu và tiếp tục xác minh Lead."
            steps = ["Mở Lead và bổ sung các mục còn thiếu", "Hoàn tất xác minh Lead", "Lập báo giá khi khách hàng được tạo"]
            cta_label, cta_url = "Tiếp nhận và xử lý Lead", lead_url
        else:
            badge, tone = "Sẵn sàng xác minh", "info"
            intro = f"Bạn được phân công tiếp nhận Lead {org}{from_prev}.<br>Vui lòng kiểm tra thông tin và tiếp tục xác minh Lead."
            steps = ["Mở Lead và kiểm tra thông tin", "Hoàn tất xác minh Lead"]
            cta_label, cta_url = "Tiếp nhận và xử lý Lead", lead_url
    else:
        subject = f"[Bàn giao Lead] {code or ''} · {who}"
        heading = "Thông báo bàn giao Lead"
        if state == "converted":
            badge, tone = "Tiếp tục xử lý", "ok"
            intro = f"Khách hàng {org} đã được chuyển đến bạn phụ trách.<br>Vui lòng xem hồ sơ khách hàng và các tài liệu được bàn giao để tiếp tục xử lý cơ hội và lập báo giá."
            steps = ["Xem hồ sơ khách hàng và cơ hội", "Mở tài liệu hạng mục báo giá được bàn giao", "Lập và gửi báo giá cho khách"]
            cta_label, cta_url = "Xem hồ sơ & lập báo giá", customer_url or lead_url
        elif state == "missing":                                                            # A
            badge, tone = "Cần bổ sung thông tin", "warn"
            intro = f"Bạn được giao phụ trách Lead {org}.<br>Vui lòng kiểm tra thông tin, bổ sung các mục còn thiếu bên dưới và hoàn tất xác minh để tiếp tục xử lý."
            steps = ["Mở Lead và bổ sung các mục còn thiếu", "Hoàn tất xác minh Lead", "Lập báo giá khi khách hàng được tạo"]
            cta_label, cta_url = "Mở Lead và bổ sung thông tin", lead_url
        else:
            badge, tone = "Sẵn sàng xác minh", "info"
            intro = f"Bạn được giao phụ trách Lead {org}.<br>Vui lòng kiểm tra thông tin và hoàn tất xác minh để tiếp tục xử lý."
            steps = ["Mở Lead và kiểm tra thông tin", "Hoàn tất xác minh Lead"]
            cta_label, cta_url = "Mở Lead để xác minh", lead_url

    rows: list[tuple[str, str, bool]] = []

    def add(label: str, value: Any, strong: bool = False) -> None:
        if value in (None, "", [], {}):
            return
        rows.append((label, esc(str(value)), strong))

    # Uu tien: Ma LH/KH, Cong ty (o tieu de card), Nguoi lien he, SDT, Nhu cau, Gia tri; truong phu o cuoi.
    add("Mã LH", code, True)
    if kind == "assign_qualified" or state == "converted":
        add("Mã KH", customer_code or (customer or {}).get("customer_code"), True)
    add("Người phụ trách", to_name, True)
    add("Người liên hệ", contact_name or _contact_name(lead))
    add("SĐT", lead.get("phone"))
    add("Nhu cầu", lead.get("qualification_need"))
    if lead.get("qualification_estimated_value") is not None:
        add("Giá trị dự kiến", _money(lead.get("qualification_estimated_value")), True)
    add("Email", lead.get("email"))
    add("Nguồn", lead.get("source"))
    add("Việc tiếp theo", lead.get("next_step"))
    add("Hạn theo dõi", _vn_date(follow) if follow else "")

    html_body, text_body = render_handover_email(
        heading=heading, badge=badge, badge_tone=tone, to_name=to_name, intro=intro,
        info_title="Thông tin khách hàng" if state == "converted" else "Thông tin Lead",
        title_line=who, rows=rows,
        missing_title="Thông tin cần bổ sung", missing_items=missing, next_steps=steps,
        links=links or [], note=note, cta_label=cta_label, cta_url=cta_url, cta_short=_short_url(cta_url),
    )
    return subject.strip(), text_body, html_body


def _build_and_deliver(row: dict[str, Any], to_user: dict[str, Any], **build_kwargs: Any) -> dict[str, Any]:
    """Dung noi dung roi gui; loi cau hinh link/SMTP chi ghi 'failed' cho dong lich su, KHONG lam hong thao tac chinh."""
    try:
        if build_kwargs.get("prev_name") is None and row.get("prev_assignee_id"):
            prev = _user_row(row.get("prev_assignee_id"))
            build_kwargs["prev_name"] = (prev or {}).get("name") or (prev or {}).get("email")
        subject, text, body_html = build_handover_email(**build_kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Khong dung duoc email ban giao (%s): %s", row.get("id"), exc)
        patch = {"email_status": "failed", "email_to": (to_user or {}).get("email"), "email_from": _current_sender(), "email_error": str(exc)[:500]}
        _update_row_tolerant(row["id"], patch)
        return {**row, **patch}
    return _deliver(row, to_user, subject, text, body_html)


def _customer_of(lead: dict[str, Any]) -> dict[str, Any] | None:
    cid = lead.get("converted_customer_id")
    if not cid:
        return None
    rows = execute_supabase_query(
        lambda: get_supabase_client().table("crm_customers").select("id, customer_name, company_name, customer_code").eq("id", cid).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def _send_email(to_email: str, subject: str, text: str, body_html: str) -> str:
    """Gui that qua kenh email da cau hinh (SMTP). Tra ve 'sent' | 'dry_run'. Loi -> raise."""
    if _dry_run():
        logger.info("HANDOVER_EMAIL_DRY_RUN: khong gui that toi %s (%s)", to_email, subject)
        return "dry_run"
    from app.modules.all_platform.services import quote_email_provider_service as provider

    creds = provider.get_active_email_channel_for_sending()
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{creds['sender_name']} <{creds['sender_address']}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Message-ID"] = f"<{uuid.uuid4()}@{creds['sender_address'].split('@')[-1]}>"
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))
    with smtplib.SMTP(provider.GMAIL_SMTP_HOST, provider.GMAIL_SMTP_PORT, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(creds["sender_address"], creds["app_password"])
        server.sendmail(creds["sender_address"], [to_email], msg.as_string())
    return "sent"


# ── lich su ──────────────────────────────────────────────────────────────────────────────────
def _find_by_key(key: str | None) -> dict[str, Any] | None:
    if not key:
        return None
    rows = execute_supabase_query(
        lambda: get_supabase_client().table(HANDOVER_TABLE).select("*").eq("instance", settings.crm_instance).eq("idempotency_key", key).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def _insert_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """INSERT; trung idempotency_key (unique) -> None (nguoi goi tra ket qua cu)."""
    try:
        res = execute_supabase_query(lambda: get_supabase_client().table(HANDOVER_TABLE).insert(row).execute())
        return res.data[0]
    except Exception as exc:  # noqa: BLE001
        if "crm_lead_handovers_idem_unique" in str(exc) or "duplicate" in str(exc).lower():
            return None
        raise


def _update_row(row_id: str, patch: dict[str, Any]) -> None:
    execute_supabase_query(lambda: get_supabase_client().table(HANDOVER_TABLE).update(patch).eq("id", row_id).execute())


def _current_sender() -> str | None:
    """Dia chi Gmail he thong dang kich hoat (luu vao lich su de doi Gmail sau nay khong lam doi ban ghi cu)."""
    try:
        from app.modules.all_platform.services import quote_email_provider_service as provider
        return provider.get_email_provider_settings().get("senderAddress")
    except Exception:  # noqa: BLE001
        return None


def _update_row_tolerant(row_id: str, patch: dict[str, Any]) -> None:
    """Ghi trang thai email; neu DB chua co cot email_from (migration 182 chua ap) thi bo cot do, KHONG lam mat trang thai gui."""
    try:
        _update_row(row_id, patch)
    except Exception:  # noqa: BLE001
        if "email_from" not in patch:
            raise
        _update_row(row_id, {k: v for k, v in patch.items() if k != "email_from"})


def _deliver(row: dict[str, Any], to_user: dict[str, Any], subject: str, text: str, body_html: str) -> dict[str, Any]:
    """Gui email cho 1 hang lich su (da INSERT). Cap nhat trang thai; loi email khong nem ra ngoai."""
    email = (to_user or {}).get("email")
    if not email:
        patch = {"email_status": "failed", "email_error": "Người nhận chưa có email."}
        _update_row_tolerant(row["id"], patch)
        return {**row, **patch}
    sender = _current_sender()
    try:
        status = _send_email(email, subject, text, body_html)
        patch = {"email_status": status, "email_to": email, "email_from": sender, "email_sent_at": _now() if status == "sent" else None, "email_error": None}
    except Exception as exc:  # noqa: BLE001 - thao tac chinh da thanh cong; chi ghi nhan email that bai
        logger.warning("Gui email ban giao that bai (%s): %s", row.get("id"), exc)
        patch = {"email_status": "failed", "email_to": email, "email_from": sender, "email_error": str(exc)[:500]}
    _update_row_tolerant(row["id"], patch)
    return {**row, **patch}


def list_handovers(lead_id: str, user: dict[str, Any], limit: int = 30) -> list[dict[str, Any]]:
    from app.modules.all_platform.services.crm_lead_service import get_lead

    get_lead(lead_id, user)  # quyen xem + 404
    rows = execute_supabase_query(
        lambda: get_supabase_client().table(HANDOVER_TABLE).select("*").eq("instance", settings.crm_instance).eq("lead_id", lead_id)
        .order("created_at", desc=True).limit(limit).execute()
    ).data or []
    names = _names({r.get(k) for r in rows for k in ("from_user_id", "to_user_id", "prev_assignee_id")})
    return [
        {
            "id": r["id"], "kind": r["kind"], "at": r["created_at"], "from": names.get(r.get("from_user_id") or ""), "to": names.get(r.get("to_user_id") or ""),
            "prev": names.get(r.get("prev_assignee_id") or ""), "links": r.get("doc_links") or [], "missing": r.get("missing_items") or [],
            "note": r.get("note"), "emailStatus": r.get("email_status"), "emailTo": r.get("email_to"), "emailFrom": r.get("email_from"), "emailError": r.get("email_error"), "emailSentAt": r.get("email_sent_at"),
        }
        for r in rows
    ]


def _lead_code(lead_id: str) -> str | None:
    try:
        rows = execute_supabase_query(
            lambda: get_supabase_client().table("crm_leads").select("contact_code").eq("id", lead_id).limit(1).execute()
        ).data or []
        return (rows[0].get("contact_code") if rows else None) or None
    except Exception:  # noqa: BLE001
        return None


def _save_links(lead_id: str, links: list[dict[str, str]], actor_id: str | None) -> None:
    execute_supabase_query(
        lambda: get_supabase_client().table("crm_leads")
        .update({"handover_links": links, "handover_by": actor_id, "handover_at": _now()})
        .eq("id", lead_id).eq("instance", settings.crm_instance).execute()
    )


# ── 1) Ban giao / Re-assign (chua du SQL) ────────────────────────────────────────────────────
def assign_lead(lead_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    from app.modules.all_platform.services.crm_lead_service import get_lead, update_lead
    from app.modules.all_platform.services.crm_permission_service import can_write_lead, get_crm_team_id_for_user

    lead = get_lead(lead_id, user)
    if not can_write_lead(user, lead):
        raise PermissionError("Khong co quyen ban giao lead nay.")
    if lead.get("status") in ("unqualified", "disqualified"):
        raise ValueError("Lead đã đánh dấu Không đạt chuẩn, không thể bàn giao.")

    key = (payload.get("idempotency_key") or "").strip() or None
    existing = _find_by_key(key)
    if existing:  # reload/retry cung 1 thao tac -> tra ket qua cu, KHONG gui lai
        return {"lead": lead, "handover": existing, "duplicate": True, "emailStatus": existing.get("email_status")}

    actor_id = str(user.get("id") or "")
    to_id = str(payload.get("to_user_id") or "").strip()
    to_user = _user_row(to_id)
    if not to_user:
        raise ValueError("Vui lòng chọn người nhận xử lý hợp lệ.")
    prev_id = lead.get("qualification_ae_id") or None
    links = normalize_doc_links(payload["doc_links"]) if "doc_links" in payload else list(lead.get("handover_links") or [])
    missing = [str(m).strip() for m in (payload.get("missing_items") or []) if str(m).strip()][:30]
    note = (payload.get("note") or "").strip() or None

    kind = "reassign" if (prev_id and prev_id != actor_id and prev_id != to_id) else "handover"
    team_id = payload.get("crm_team_id") or get_crm_team_id_for_user(to_id) or lead.get("team_id")
    is_self = to_id == actor_id
    wants_email = bool(payload.get("send_email", True)) and not is_self  # khong gui email cho chinh minh

    row = _insert_row({
        "instance": settings.crm_instance, "lead_id": lead_id, "kind": kind, "from_user_id": actor_id or None, "prev_assignee_id": prev_id,
        "to_user_id": to_id, "crm_team_id": team_id, "doc_links": links, "missing_items": missing, "note": note, "send_email": wants_email,
        "email_status": "pending" if wants_email else "skipped", "idempotency_key": key,
    })
    if row is None:  # dua dua giua 2 request cung key
        return {"lead": lead, "handover": _find_by_key(key), "duplicate": True}

    try:
        update_lead(lead_id, {"qualification_ae_id": to_id, "team_id": team_id}, user)
        _save_links(lead_id, links, actor_id or None)
    except Exception:
        execute_supabase_query(lambda: get_supabase_client().table(HANDOVER_TABLE).delete().eq("id", row["id"]).execute())
        raise

    fresh = get_lead(lead_id, user)
    # Checklist = dieu kien SQL THUC SU con thieu theo Rule Engine tai thoi diem ban giao (Lead da convert -> rong).
    missing = compute_missing_items(fresh) or ([] if (fresh.get("converted_customer_id") or fresh.get("status") in ("sql", "qualified")) else missing)
    try:
        _update_row(row["id"], {"missing_items": missing})
    except Exception:  # noqa: BLE001
        logger.warning("Khong cap nhat checklist cho lich su ban giao %s", row.get("id"), exc_info=True)
    if wants_email:
        row = _build_and_deliver(
            row, to_user, kind=kind, lead=fresh, lead_code=_lead_code(lead_id), actor_name=user.get("name") or user.get("email") or "Đồng nghiệp",
            to_name=to_user.get("name") or to_user.get("email") or "bạn", links=links, missing_items=missing, customer=_customer_of(fresh),
            customer_code=(_customer_of(fresh) or {}).get("customer_code"), note=note, base_url=payload.get("_base_url"),
        )
    return {"lead": fresh, "handover": row, "duplicate": False, "emailStatus": row.get("email_status")}


# ── 2) Du SQL: sau khi convert (Customer + Co hoi da tao) ─────────────────────────────────────
def record_convert_handover(
    lead: dict[str, Any], result: dict[str, Any], payload: dict[str, Any], user: dict[str, Any], lead_code: str | None,
) -> dict[str, Any] | None:
    """Goi SAU convert_lead() thanh cong. Nguoi nhan = Sale duoc chon (deal.sdr_id). Tu xu ly (== nguoi thao tac) -> khong lam gi."""
    handover = payload.get("handover") if isinstance(payload.get("handover"), dict) else {}
    deal_payload = payload.get("deal") if isinstance(payload.get("deal"), dict) else {}
    actor_id = str(user.get("id") or "")
    to_id = str(deal_payload.get("sdr_id") or lead.get("qualification_ae_id") or "").strip()
    links = normalize_doc_links(handover["doc_links"]) if "doc_links" in handover else None
    if links is not None:
        _save_links(lead["id"], links, actor_id or None)
    if not to_id or to_id == actor_id:
        return None
    key = (handover.get("idempotency_key") or payload.get("idempotency_key") or "").strip() or None
    if key:
        key = f"convert:{key}"
    existing = _find_by_key(key)
    if existing:
        return existing
    to_user = _user_row(to_id)
    if not to_user:
        return None
    wants_email = bool(handover.get("send_email", True))
    final_links = links if links is not None else list(lead.get("handover_links") or [])
    customer = (result or {}).get("customer") or {}
    row = _insert_row({
        "instance": settings.crm_instance, "lead_id": lead["id"], "kind": "assign_qualified", "from_user_id": actor_id or None,
        "prev_assignee_id": lead.get("qualification_ae_id"), "to_user_id": to_id, "crm_team_id": lead.get("team_id"), "doc_links": final_links,
        "missing_items": [], "send_email": wants_email, "email_status": "pending" if wants_email else "skipped", "idempotency_key": key,
    })
    if row is None or not wants_email:
        return row
    return _build_and_deliver(
        row, to_user, kind="assign_qualified", lead=lead, lead_code=lead_code, actor_name=user.get("name") or user.get("email") or "Đồng nghiệp",
        to_name=to_user.get("name") or to_user.get("email") or "bạn", links=final_links, missing_items=[], customer=customer,
        customer_code=customer.get("customer_code"), base_url=payload.get("_base_url"),
    )


# ── gui lai email (khi lan dau that bai: chua cau hinh SMTP, loi mang...) ─────────────────────
def resend_handover_email(lead_id: str, handover_id: str, user: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
    """Gui lai email cua 1 dong lich su CHUA gui thanh cong (failed/pending/skipped-nhung-co-nguoi-nhan). Da 'sent' thi KHONG gui lai (chong trung)."""
    from app.modules.all_platform.services.crm_lead_service import get_lead
    from app.modules.all_platform.services.crm_permission_service import can_write_lead

    lead = get_lead(lead_id, user)
    if not can_write_lead(user, lead):
        raise PermissionError("Khong co quyen gui lai email ban giao cua lead nay.")
    rows = execute_supabase_query(
        lambda: get_supabase_client().table(HANDOVER_TABLE).select("*").eq("id", handover_id).eq("lead_id", lead_id).eq("instance", settings.crm_instance).limit(1).execute()
    ).data or []
    if not rows:
        raise ValueError("Khong tim thay lich su ban giao.")
    row = rows[0]
    if row.get("email_status") in ("sent", "dry_run"):
        raise ValueError("Email này đã được gửi thành công, không gửi lại.")
    to_user = _user_row(row.get("to_user_id"))
    if not to_user:
        raise ValueError("Người nhận không còn tồn tại.")
    customer = _customer_of(lead)
    # Noi dung = dung cua lan ban giao do: nguoi ban giao la nguoi da thao tac luc do, khong phai nguoi bam "Gui lai".
    orig_actor = _user_row(row.get("from_user_id")) or user
    subject, text, body_html = build_handover_email(
        kind=row["kind"], lead=lead, lead_code=_lead_code(lead_id), actor_name=orig_actor.get("name") or orig_actor.get("email") or "Đồng nghiệp",
        to_name=to_user.get("name") or to_user.get("email") or "bạn", links=row.get("doc_links") or [], missing_items=row.get("missing_items") or [],
        customer=customer, customer_code=(customer or {}).get("customer_code"), note=row.get("note"), base_url=base_url,
        prev_name=((_user_row(row.get("prev_assignee_id")) or {}).get("name") if row.get("prev_assignee_id") else None),
    )
    # Chiem quyen gui nguyen tu (chong double-click / 2 request song song): chi 1 request chuyen duoc failed|skipped -> pending.
    claimed = execute_supabase_query(
        lambda: get_supabase_client().table(HANDOVER_TABLE).update({"send_email": True, "email_status": "pending"})
        .eq("id", row["id"]).in_("email_status", ["failed", "skipped"]).execute()
    ).data or []
    if not claimed:
        raise ValueError("Email này đang được gửi hoặc đã gửi xong, không gửi lại.")
    return _deliver({**row, "send_email": True}, to_user, subject, text, body_html)


def customer_handover_docs(customer_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    """Link tai lieu ban giao cua cac Lead da convert thanh Customer nay (Customer Detail / Co hoi). Nguon duy nhat: crm_leads.handover_links."""
    from app.modules.all_platform.services.crm_customer_service import get_customer

    get_customer(customer_id, user)  # kiem tra quyen xem + 404
    rows = execute_supabase_query(
        lambda: get_supabase_client().table("crm_leads").select("id, lead_name, contact_code, converted_deal_id, handover_links, handover_by, handover_at, qualification_ae_id")
        .eq("instance", settings.crm_instance).eq("converted_customer_id", customer_id).execute()
    ).data or []
    names = _names({r.get(k) for r in rows for k in ("handover_by", "qualification_ae_id")})
    return [
        {
            "leadId": r["id"], "leadName": r.get("lead_name"), "leadCode": r.get("contact_code"), "dealId": r.get("converted_deal_id"),
            "links": [l for l in (r.get("handover_links") or []) if isinstance(l, dict) and l.get("url")],
            "handedOverBy": names.get(r.get("handover_by") or ""), "handedOverAt": r.get("handover_at"), "assignee": names.get(r.get("qualification_ae_id") or ""),
        }
        for r in rows if r.get("handover_links")
    ]
