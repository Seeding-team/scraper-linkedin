"""Gui bao gia THAT cho khach qua email (Gmail SMTP da cau hinh o
quote_email_provider_service.py). Migration 093 (quote_delivery_log, CHUA
apply). Tai su dung nguyen ham render PDF THAT da co
(quote_telegram_service._render_quote_pdf - Playwright headless render dung
trang public/print, khong dung PDF gia/template rieng)."""
from __future__ import annotations

import re
import smtplib
import uuid
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Optional

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import quote_email_provider_service as email_provider_service
from app.modules.all_platform.services.crm_permission_service import can_send_quote_email

_DELIVERY_LOG_TABLE = "quote_delivery_log"
_MAX_ATTEMPTS_PER_QUOTE_VERSION = 3
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class QuoteSendValidationError(ValueError):
    """Loi validate TRUOC khi gui (chua tao delivery log nao) - vd chua
    duyet/chua publish/thieu recipient/kenh chua bat - khac loi gui that bai
    (co delivery log voi status='failed')."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_recipient(quote: dict[str, Any], deal: Optional[dict[str, Any]], user: dict[str, Any]) -> dict[str, Any]:
    """Uu tien THAT (dung field co san, khong bia):
      1) `customer_leads.email` (deal.email) - "email duoc chon tren Deal".
      2) `crm_customers.email` neu deal co lien ket customer_id.
      3) Khong co -> tra ve rong, nguoi gui nhap tay trong popup.
    recipientName luon lay `deal.customer_name` (ton tai tren ca 2 nguon tren,
    khong doan)."""
    if deal and (deal.get("email") or "").strip():
        return {"name": deal.get("customer_name"), "email": deal["email"].strip(), "source": "deal_contact"}

    if deal and deal.get("customer_id"):
        try:
            from app.modules.all_platform.services.crm_customer_service import get_customer
            customer = get_customer(deal["customer_id"], user)
            if customer and (customer.get("email") or "").strip():
                return {
                    "name": customer.get("customer_name") or deal.get("customer_name"),
                    "email": customer["email"].strip(),
                    "source": "crm_customer",
                }
        except Exception:
            # Khong chan luong gui neu khong xem duoc ho so khach hang (vd
            # quyen han che) - chi la 1 nguon fallback, khong bat buoc.
            pass

    return {"name": deal.get("customer_name") if deal else None, "email": None, "source": None}


def build_greeting(recipient_name: Optional[str]) -> str:
    """KHONG BAO GIO render 'undefined'/'null' - co ten thi chao dung ten,
    khong co thi chao chung chung."""
    name = (recipient_name or "").strip()
    if name:
        return f"Chào anh/chị {name},"
    return "Chào anh/chị,"


def build_subject(quote: dict[str, Any]) -> str:
    data = quote.get("data") or {}
    title = data.get("quoteTitle") or ""
    quote_number = quote.get("quoteNumber") or ""
    return f"Báo giá {quote_number} · {title}".strip(" ·")


def _public_full_url(quote: dict[str, Any]) -> str:
    import os
    base = os.environ.get("PUBLIC_APP_BASE_URL", "http://localhost:3001").rstrip("/")
    return f"{base}{quote.get('publicUrl') or ''}"


def _validate_before_send(quote: dict[str, Any], user: dict[str, Any], recipient_email: str) -> None:
    if quote.get("status") == "cancelled" or quote.get("deletedAt"):
        raise QuoteSendValidationError("Báo giá đã huỷ/xoá, không thể gửi.")
    if quote.get("status") != "approved":
        raise QuoteSendValidationError("Cần duyệt báo giá trước khi gửi.")
    if quote.get("processingStage") != "published":
        raise QuoteSendValidationError("Cần phát hành báo giá trước khi gửi.")
    if not quote.get("publicEnabled") or not quote.get("publicUrl"):
        raise QuoteSendValidationError("Public link chưa hoạt động, không thể gửi.")
    if not can_send_quote_email(user, quote):
        raise QuoteSendValidationError("Bạn không có quyền gửi báo giá này.")
    if not recipient_email or not _EMAIL_RE.match(recipient_email):
        raise QuoteSendValidationError("Email người nhận không hợp lệ.")
    # Raise EmailProviderNotConfiguredError (con ke thua ValueError) neu kenh
    # chua bat/chua test SMTP thanh cong - message da ro rang tu ham nay.
    email_provider_service.get_active_email_channel_for_sending()


def _count_recent_attempts(quote_id: str, quote_version: Optional[int]) -> int:
    supabase = get_supabase_client()
    query = supabase.table(_DELIVERY_LOG_TABLE).select("id", count="exact").eq("quote_id", quote_id).eq("channel", "email")
    if quote_version is not None:
        query = query.eq("quote_version", quote_version)
    result = query.execute()
    return result.count or 0


def _record_email_sent(
    log_id: str, quote_id: str, actor_id: Optional[str], message_id: str, sent_at: str, pdf_error: Optional[str]
) -> None:
    """Ghi nhan "da gui email THANH CONG" vao DB - goi SAU KHI SMTP that su
    thanh cong, nen HAM NAY KHONG BAO GIO DUOC RAISE ra ngoai (email da roi
    khoi backend that su, khong con y nghia bao "gui that bai" nua du DB co
    truc trac). Uu tien RPC transactional (migration 098, CHUA apply) - neu
    RPC chua ton tai (PostgREST "Could not find the function"), fallback ve
    3 buoc roi rac (van dung, chi khong atomic bang RPC) de tinh nang van
    hoat dong dung trong luc cho xac nhan apply 098."""
    supabase = get_supabase_client()
    try:
        supabase.rpc("quote_mark_email_sent", {
            "p_delivery_log_id": log_id,
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_provider_message_id": message_id,
            "p_sent_at": sent_at,
            "p_pdf_error": pdf_error,
        }).execute()
        return
    except Exception as exc:
        message = str(exc)
        if "Could not find the function" not in message and "PGRST202" not in message:
            # Loi THAT (khac "RPC chua ton tai") - van KHONG raise (email da
            # gui roi), nhung khong fallback tiep vi co the la loi nghiem
            # trong hon (vd quote_id/log_id sai) - de tranh ghi du lieu sai.
            return

    try:
        update_payload: dict[str, Any] = {"status": "sent", "sent_at": sent_at, "provider_message_id": message_id}
        if pdf_error:
            update_payload["error_message"] = f"Đã gửi nhưng không đính kèm được PDF: {pdf_error}"
        supabase.table(_DELIVERY_LOG_TABLE).update(update_payload).eq("id", log_id).execute()
        supabase.table("quotes").update({
            "sent_at": sent_at, "sent_by": actor_id, "completed_at": sent_at,
        }).eq("id", quote_id).execute()
        supabase.table("quote_activity_log").insert({
            "quote_id": quote_id, "actor_id": actor_id, "action": "sent_email",
            "changes": {"delivery_log_id": log_id},
        }).execute()
    except Exception:
        # Email DA GUI THAT SU - khong the lam gi hon neu ghi DB fallback
        # cung loi (da thu RPC that bai, thu fallback cung that bai). Khong
        # raise - tranh bao "gui that bai" sai su that cho nguoi dung.
        pass


def _find_existing_by_idempotency_key(idempotency_key: str) -> Optional[dict[str, Any]]:
    supabase = get_supabase_client()
    result = supabase.table(_DELIVERY_LOG_TABLE).select("*").eq("idempotency_key", idempotency_key).maybe_single().execute()
    return result.data if result else None


def _row_to_delivery_log(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "quoteId": row["quote_id"],
        "quoteVersion": row.get("quote_version"),
        "channel": row.get("channel"),
        "recipientName": row.get("recipient_name"),
        "recipientEmail": row.get("recipient_email"),
        "recipientSource": row.get("recipient_source"),
        "subject": row.get("subject"),
        "status": row.get("status"),
        "attemptCount": row.get("attempt_count"),
        "errorMessage": row.get("error_message"),
        "requestedAt": row.get("requested_at"),
        "requestedById": row.get("requested_by"),
        "sentAt": row.get("sent_at"),
    }


def get_quote_delivery_log(quote_id: str) -> list[dict[str, Any]]:
    supabase = get_supabase_client()
    result = (
        supabase.table(_DELIVERY_LOG_TABLE)
        .select("*")
        .eq("quote_id", quote_id)
        .order("requested_at", desc=True)
        .execute()
    )
    return [_row_to_delivery_log(row) for row in (result.data or [])]


def send_quote_email(
    quote: dict[str, Any],
    deal: Optional[dict[str, Any]],
    user: dict[str, Any],
    recipient_name: Optional[str],
    recipient_email: str,
    recipient_source: Optional[str],
    message: str,
    attach_pdf: bool,
    idempotency_key: str,
    subject_override: Optional[str] = None,
) -> dict[str, Any]:
    """Gui 1 email THAT toi khach - moi buoc:
      1) Validate dieu kien (KHONG tao delivery log neu fail o day - loi
         "chua du dieu kien", chua phai "gui that bai").
      2) Idempotency: idempotency_key da xu ly roi -> tra ve KET QUA CU
         (khong gui lai, khong tao row moi).
      3) Cap so lan thu cho cung quote+version (toi da 3).
      4) Tao delivery log status='sending' TRUOC khi goi SMTP that.
      5) Goi SMTP that (Gmail) - KHONG fake ket qua duoi bat ky hinh thuc
         nao. Thanh cong -> status='sent' + set quotes.sent_at/sent_by +
         ghi quote_activity_log. That bai -> status='failed', KHONG set
         sent_at, khong ghi activity."""
    quote_id = quote["id"]
    quote_version = quote.get("versionNumber")

    _validate_before_send(quote, user, recipient_email)

    existing = _find_existing_by_idempotency_key(idempotency_key)
    if existing:
        return _row_to_delivery_log(existing)

    attempts_so_far = _count_recent_attempts(quote_id, quote_version)
    if attempts_so_far >= _MAX_ATTEMPTS_PER_QUOTE_VERSION:
        raise QuoteSendValidationError(
            f"Đã thử gửi {attempts_so_far} lần cho phiên bản báo giá này — vui lòng liên hệ quản trị viên nếu vẫn cần gửi."
        )

    supabase = get_supabase_client()
    subject = (subject_override or "").strip() or build_subject(quote)
    public_url = _public_full_url(quote)

    log_row = {
        "quote_id": quote_id,
        "quote_version": quote_version,
        "channel": "email",
        "recipient_name": recipient_name,
        "recipient_email": recipient_email,
        "recipient_source": recipient_source,
        "subject": subject,
        "message": message,
        "public_url": public_url,
        "attach_pdf": bool(attach_pdf),
        "status": "sending",
        "attempt_count": attempts_so_far + 1,
        "idempotency_key": idempotency_key,
        "requested_at": _now_iso(),
        "requested_by": user.get("id"),
    }
    inserted = supabase.table(_DELIVERY_LOG_TABLE).insert(log_row).execute().data[0]
    log_id = inserted["id"]

    try:
        creds = email_provider_service.get_active_email_channel_for_sending()
        pdf_bytes = None
        pdf_error = None
        if attach_pdf:
            try:
                # Tai su dung DUNG ham render PDF that da co (khong dung PDF
                # gia/template thu 2 lech du lieu).
                from app.modules.all_platform.services.quote_telegram_service import _render_quote_pdf
                pdf_bytes = _render_quote_pdf(quote["publicUrl"])
            except Exception as exc:
                pdf_error = str(exc)

        msg = MIMEMultipart()
        msg["From"] = f"{creds['sender_name']} <{creds['sender_address']}>"
        msg["To"] = recipient_email
        msg["Subject"] = subject
        greeting = build_greeting(recipient_name)
        body_lines = [
            greeting,
            "",
            (message or "").strip(),
            "",
            f"Xem báo giá tại: {public_url}",
            "",
            f"Trân trọng,\n{creds['sender_name']}",
        ]
        msg.attach(MIMEText("\n".join(line for line in body_lines if line is not None), "plain", "utf-8"))
        if pdf_bytes:
            part = MIMEApplication(pdf_bytes, _subtype="pdf")
            part.add_header("Content-Disposition", "attachment", filename=f"Bao-gia-{quote.get('quoteNumber') or quote_id}.pdf")
            msg.attach(part)

        message_id = f"<{uuid.uuid4()}@{creds['sender_address'].split('@')[-1]}>"
        msg["Message-ID"] = message_id

        with smtplib.SMTP(email_provider_service.GMAIL_SMTP_HOST, email_provider_service.GMAIL_SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(creds["sender_address"], creds["app_password"])
            server.sendmail(creds["sender_address"], [recipient_email], msg.as_string())

        # === SMTP DA GUI THANH CONG THAT SU tu day tro xuong - KHONG BAO GIO
        # duoc coi la "gui that bai" nua, ke ca neu ghi DB o duoi co truc
        # trac (email that su da roi khoi backend, khong the "rollback"). ===
        sent_at = _now_iso()
        _record_email_sent(log_id, quote_id, user.get("id"), message_id, sent_at, pdf_error)

        final_row = dict(inserted)
        final_row.update({"status": "sent", "sent_at": sent_at, "provider_message_id": message_id})
        return _row_to_delivery_log(final_row)
    except Exception as exc:
        error_message = str(exc)
        if isinstance(exc, smtplib.SMTPAuthenticationError):
            error_message = "Đăng nhập SMTP thất bại — Admin cần cập nhật lại App Password."
        supabase.table(_DELIVERY_LOG_TABLE).update({
            "status": "failed",
            "error_message": error_message,
        }).eq("id", log_id).execute()
        raise ValueError(f"Gửi email thất bại: {error_message}") from exc
