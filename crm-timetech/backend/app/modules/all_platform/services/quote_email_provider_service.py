"""Cau hinh kenh gui email that (Gmail IMAP+SMTP) cho tinh nang "Phat hanh
va gui khach that" - migration 092 (quote_delivery_channels, channel_type='email').

BAO MAT (yeu cau nghiem ngat cua nguoi dung, khong duoc vi pham o bat ky
duong nao trong file nay):
  - App Password CHI di 1 chieu tu Admin -> backend qua HTTPS (request body).
  - Ma hoa (Fernet) TRUOC khi ghi DB - khong bao gio luu plaintext.
  - Khong co ham nao o day tra ve app_password da giai ma cho client - chi
    dung NOI BO (test-imap/test-smtp/send-test tu giai ma trong tien trinh
    backend, khong tra ra ngoai).
  - Khong log app_password: MOI cau logger/print trong file nay chi duoc
    nhac toi email/from_name, khong bao gio interpolate app_password.
  - Update de trong app_password -> GIU credential cu (khong ghi de bang NULL).
"""
from __future__ import annotations

import imaplib
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from cryptography.fernet import InvalidToken

from app.core.supabase_client import get_supabase_client

_CHANNEL_TYPE = "email"

# Co dinh theo yeu cau - Gmail IMAP/SMTP, khong cho sua qua API (tranh danh
# lua tro toi host la khac qua tham so client-side).
GMAIL_IMAP_HOST = "imap.gmail.com"
GMAIL_IMAP_PORT = 993
GMAIL_IMAP_SECURITY = "ssl"
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587
GMAIL_SMTP_SECURITY = "starttls"


class EmailProviderNotConfiguredError(ValueError):
    pass


def _get_fernet():
    """Giong het pattern _get_fernet() cua zca_auth_store.py (Zalo) - dung
    chung 1 quy uoc trong repo: bat encryption bang env var, KHONG hard-code
    key. Neu chua set key -> khong the ma hoa/giai ma, tu choi luu/doc thay vi
    fallback plaintext (KHAC voi Zalo - o day la App Password email That, bat
    buoc phai co key truoc khi cho luu)."""
    key_b64 = os.environ.get("QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY", "").strip()
    if not key_b64:
        return None
    from cryptography.fernet import Fernet
    return Fernet(key_b64.encode() if isinstance(key_b64, str) else key_b64)


def _encrypt_password(app_password: str) -> bytes:
    fernet = _get_fernet()
    if fernet is None:
        raise ValueError(
            "Chưa cấu hình QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY ở backend — "
            "không thể lưu App Password an toàn. Liên hệ người quản trị hệ thống."
        )
    return fernet.encrypt(app_password.encode("utf-8"))


def _decrypt_password(encrypted: bytes | str) -> str:
    fernet = _get_fernet()
    if fernet is None:
        raise ValueError("Chưa cấu hình QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY ở backend.")
    # Supabase tra ve cot text (encrypted_app_password luu bang .decode("ascii")
    # luc save) la 1 str, KHONG phai bytes - bytes(str) khong encoding se loi
    # "string argument without an encoding" (bug that da gap). Encode ro rang
    # truoc khi decrypt, chi bytes() thang qua neu da la bytes/bytearray san.
    raw = encrypted.encode("ascii") if isinstance(encrypted, str) else bytes(encrypted)
    try:
        return fernet.decrypt(raw).decode("utf-8")
    except InvalidToken as exc:
        # InvalidToken KHONG CO message (str(exc) rong) - neu de rot xuong
        # thang cac router (except Exception as e: message=str(e)) se tao ra
        # dung bug that da gap: HTTP 200 + success=false + message rong
        # ("Lỗi máy chủ (200)" o FE). Luon quy thanh 1 loi CO Y NGHIA o day -
        # 1 choke point duy nhat, khong sua rai rac o tung router.
        raise ValueError(
            "Không giải mã được App Password đã lưu (dữ liệu hỏng hoặc sai key mã hoá) — "
            "vui lòng nhập lại App Password."
        ) from exc


def record_audit_log(user: dict, action: str) -> None:
    """Ghi 1 dong audit - CHI actorId/actorName/role/action/timestamp, KHONG
    BAO GIO nhan hay ghi bat ky truong nao khac (khong truyen payload request
    vao day, tranh vo tinh log ca App Password neu code sau nay sua sai)."""
    try:
        supabase = get_supabase_client()
        supabase.table("quote_delivery_channel_audit_log").insert({
            "channel_type": _CHANNEL_TYPE,
            "actor_id": user.get("id"),
            "actor_name": user.get("full_name") or user.get("display_name") or user.get("email"),
            "actor_role": str(user.get("role") or "").strip().lower(),
            "action": action,
        }).execute()
    except Exception:
        # Audit khong duoc lam sap luong chinh (luu/test that su van thanh
        # cong ngay ca khi ghi audit loi) - chi bo qua, khong raise.
        pass


def get_audit_log(limit: int = 100) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("quote_delivery_channel_audit_log")
        .select("*")
        .eq("channel_type", _CHANNEL_TYPE)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    return [
        {
            "actorId": row.get("actor_id"),
            "actorName": row.get("actor_name"),
            "actorRole": row.get("actor_role"),
            "action": row.get("action"),
            "createdAt": row.get("created_at"),
        }
        for row in rows
    ]


def _get_row() -> Optional[dict]:
    supabase = get_supabase_client()
    # .maybe_single().execute() tra ve None (khong phai 1 object co .data)
    # khi 0 dong khop - phai kiem tra result truoc khi doc .data, neu khong
    # se loi "'NoneType' object has no attribute 'data'" (bug that da gap).
    result = (
        supabase.table("quote_delivery_channels")
        .select("*")
        .eq("channel_type", _CHANNEL_TYPE)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


def get_email_provider_settings() -> dict:
    """Tra ve cau hinh KHONG BAO GIO kem app_password - chi
    credentialConfigured=true/false (dung yeu cau "GET API không trả lại App
    Password")."""
    row = _get_row()
    if not row:
        return {
            "channelType": _CHANNEL_TYPE,
            "isEnabled": False,
            "senderName": None,
            "senderAddress": None,
            "imapHost": GMAIL_IMAP_HOST,
            "imapPort": GMAIL_IMAP_PORT,
            "imapSecurity": GMAIL_IMAP_SECURITY,
            "smtpHost": GMAIL_SMTP_HOST,
            "smtpPort": GMAIL_SMTP_PORT,
            "smtpSecurity": GMAIL_SMTP_SECURITY,
            "credentialConfigured": False,
            "credentialUpdatedAt": None,
            "imapConnectionStatus": "unknown",
            "imapLastTestedAt": None,
            "smtpConnectionStatus": "unknown",
            "smtpLastTestedAt": None,
        }
    return {
        "channelType": row.get("channel_type"),
        "isEnabled": bool(row.get("is_enabled")),
        "senderName": row.get("sender_name"),
        "senderAddress": row.get("sender_address"),
        "imapHost": row.get("imap_host") or GMAIL_IMAP_HOST,
        "imapPort": row.get("imap_port") or GMAIL_IMAP_PORT,
        "imapSecurity": row.get("imap_security") or GMAIL_IMAP_SECURITY,
        "smtpHost": row.get("smtp_host") or GMAIL_SMTP_HOST,
        "smtpPort": row.get("smtp_port") or GMAIL_SMTP_PORT,
        "smtpSecurity": row.get("smtp_security") or GMAIL_SMTP_SECURITY,
        "credentialConfigured": row.get("encrypted_app_password") is not None,
        "credentialUpdatedAt": row.get("credential_updated_at"),
        "imapConnectionStatus": row.get("imap_connection_status") or "unknown",
        "imapLastTestedAt": row.get("imap_last_tested_at"),
        "smtpConnectionStatus": row.get("smtp_connection_status") or "unknown",
        "smtpLastTestedAt": row.get("smtp_last_tested_at"),
    }


def save_email_provider_settings(
    sender_address: str,
    sender_name: str,
    app_password: Optional[str],
    actor_id: Optional[str],
) -> dict:
    """Luu cau hinh. app_password=None/rong -> GIU credential cu nguyen ven
    (dung yeu cau "de trong password thi giu credential cu") - CHI ghi de cot
    encrypted_app_password khi app_password that su duoc nhap."""
    supabase = get_supabase_client()
    existing = _get_row()

    payload = {
        "channel_type": _CHANNEL_TYPE,
        "display_name": "Gmail SMTP",
        "sender_address": sender_address.strip(),
        "sender_name": (sender_name or "").strip() or None,
        "imap_host": GMAIL_IMAP_HOST,
        "imap_port": GMAIL_IMAP_PORT,
        "imap_security": GMAIL_IMAP_SECURITY,
        "smtp_host": GMAIL_SMTP_HOST,
        "smtp_port": GMAIL_SMTP_PORT,
        "smtp_security": GMAIL_SMTP_SECURITY,
        "updated_by": actor_id,
    }
    if app_password:
        payload["encrypted_app_password"] = _encrypt_password(app_password).decode("ascii")
        payload["credential_updated_at"] = datetime.now(timezone.utc).isoformat()
        payload["credential_updated_by"] = actor_id

    if existing:
        supabase.table("quote_delivery_channels").update(payload).eq("channel_type", _CHANNEL_TYPE).execute()
    else:
        payload["is_enabled"] = False
        supabase.table("quote_delivery_channels").insert(payload).execute()

    return get_email_provider_settings()


def set_email_provider_enabled(is_enabled: bool, actor_id: Optional[str]) -> dict:
    row = _get_row()
    if not row or row.get("encrypted_app_password") is None:
        raise EmailProviderNotConfiguredError("Cần cấu hình App Password trước khi bật kênh gửi email.")
    supabase = get_supabase_client()
    supabase.table("quote_delivery_channels").update(
        {"is_enabled": is_enabled, "updated_by": actor_id}
    ).eq("channel_type", _CHANNEL_TYPE).execute()
    return get_email_provider_settings()


def clear_email_provider_credentials(actor_id: Optional[str]) -> dict:
    supabase = get_supabase_client()
    row = _get_row()
    if not row:
        return get_email_provider_settings()
    supabase.table("quote_delivery_channels").update(
        {
            "encrypted_app_password": None,
            "credential_updated_at": None,
            "credential_updated_by": None,
            "is_enabled": False,
            "updated_by": actor_id,
        }
    ).eq("channel_type", _CHANNEL_TYPE).execute()
    return get_email_provider_settings()


def get_active_email_channel_for_sending() -> dict:
    """Tra ve config THAT (gom app_password DA GIAI MA) - CHI dung NOI BO tu
    quote_email_delivery_service khi thuc su gui mail cho khach, KHONG BAO
    GIO tra ra ngoai qua bat ky API nao. Raise EmailProviderNotConfiguredError
    neu chua cau hinh / chua bat kenh / SMTP chua test thanh cong gan nhat
    (dung dieu kien "Mail config đang bật" + "SMTP đã test thành công")."""
    row = _get_row()
    if not row or row.get("encrypted_app_password") is None:
        raise EmailProviderNotConfiguredError("Admin chưa cấu hình email gửi báo giá.")
    if not row.get("is_enabled"):
        raise EmailProviderNotConfiguredError("Kênh email hiện không hoạt động.")
    if row.get("smtp_connection_status") != "ok":
        raise EmailProviderNotConfiguredError("Kênh email hiện không hoạt động.")
    return {
        "sender_address": row["sender_address"],
        "sender_name": row.get("sender_name") or row["sender_address"],
        "app_password": _decrypt_password(row["encrypted_app_password"]),
    }


def _resolve_credentials(inline_email: Optional[str], inline_app_password: Optional[str]) -> tuple[str, str]:
    """Dung cho test-imap/test-smtp: cho phep test truoc khi luu (nhap tam,
    CHUA ghi DB) bang cach truyen inline_email/inline_app_password; neu
    khong truyen gi thi dung credential DA LUU. Khong bao gio ghi lai inline
    credential vao DB o day - chi test-and-discard."""
    if inline_app_password:
        if not inline_email:
            raise ValueError("Thiếu email để test kết nối.")
        return inline_email, inline_app_password
    row = _get_row()
    if not row or row.get("encrypted_app_password") is None:
        raise EmailProviderNotConfiguredError("Chưa cấu hình App Password — nhập App Password để test hoặc lưu cấu hình trước.")
    return row["sender_address"], _decrypt_password(row["encrypted_app_password"])


def _record_connection_status(kind: str, ok: bool) -> None:
    """Ghi lai trang thai test gan nhat vao DB - CHI ghi khi test dung
    credential DA LUU (inline test truoc khi luu se KHONG ghi, tranh ghi
    trang thai cho 1 credential chua chac se duoc luu)."""
    row = _get_row()
    if not row:
        return
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc).isoformat()
    field_status = f"{kind}_connection_status"
    field_tested = f"{kind}_last_tested_at"
    supabase.table("quote_delivery_channels").update(
        {field_status: "ok" if ok else "error", field_tested: now}
    ).eq("channel_type", _CHANNEL_TYPE).execute()


def test_imap_connection(inline_email: Optional[str] = None, inline_app_password: Optional[str] = None) -> dict:
    is_inline_test = bool(inline_app_password)
    email_addr, app_password = _resolve_credentials(inline_email, inline_app_password)
    try:
        conn = imaplib.IMAP4_SSL(GMAIL_IMAP_HOST, GMAIL_IMAP_PORT, timeout=15)
        try:
            conn.login(email_addr, app_password)
            # Chi doc (select mailbox read-only) - dung yeu cau "Test IMAP
            # read-only", khong sua/xoa gi trong mailbox.
            conn.select("INBOX", readonly=True)
            conn.logout()
        finally:
            try:
                conn.shutdown()
            except Exception:
                pass
        if not is_inline_test:
            _record_connection_status("imap", True)
        return {"ok": True, "message": "Kết nối IMAP thành công."}
    except imaplib.IMAP4.error:
        if not is_inline_test:
            _record_connection_status("imap", False)
        return {"ok": False, "message": "Đăng nhập IMAP thất bại — kiểm tra lại email/App Password."}
    except Exception as exc:
        if not is_inline_test:
            _record_connection_status("imap", False)
        return {"ok": False, "message": f"Không kết nối được IMAP ({type(exc).__name__})."}


def test_smtp_connection(inline_email: Optional[str] = None, inline_app_password: Optional[str] = None) -> dict:
    is_inline_test = bool(inline_app_password)
    email_addr, app_password = _resolve_credentials(inline_email, inline_app_password)
    try:
        with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(email_addr, app_password)
        if not is_inline_test:
            _record_connection_status("smtp", True)
        return {"ok": True, "message": "Kết nối SMTP thành công."}
    except smtplib.SMTPAuthenticationError:
        if not is_inline_test:
            _record_connection_status("smtp", False)
        return {"ok": False, "message": "Đăng nhập SMTP thất bại — kiểm tra lại email/App Password."}
    except Exception as exc:
        if not is_inline_test:
            _record_connection_status("smtp", False)
        return {"ok": False, "message": f"Không kết nối được SMTP ({type(exc).__name__})."}


def send_test_email(test_recipient: str) -> dict:
    """Gui 1 email THU that toi dung dia chi Admin nhap (test_recipient) -
    KHONG BAO GIO dung dia chi nay lam recipient that cua bao gia (day la
    endpoint rieng chi cho muc dich test ket noi, tach biet hoan toan khoi
    luong gui bao gia that cho khach - luong do CHUA duoc noi day)."""
    row = _get_row()
    if not row or row.get("encrypted_app_password") is None:
        raise EmailProviderNotConfiguredError("Chưa cấu hình App Password.")
    if not row.get("sender_address"):
        raise EmailProviderNotConfiguredError("Chưa cấu hình email gửi.")

    sender_address = row["sender_address"]
    app_password = _decrypt_password(row["encrypted_app_password"])
    from_name = row.get("sender_name") or sender_address

    msg = MIMEMultipart()
    msg["From"] = f"{from_name} <{sender_address}>"
    msg["To"] = test_recipient
    msg["Subject"] = "[Test] Kết nối gửi báo giá qua Gmail"
    msg.attach(MIMEText(
        "Đây là email thử nghiệm kết nối gửi báo giá qua Gmail SMTP.\n"
        "Nếu bạn nhận được email này, cấu hình đã hoạt động đúng.",
        "plain",
        "utf-8",
    ))

    try:
        with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(sender_address, app_password)
            server.sendmail(sender_address, [test_recipient], msg.as_string())
        return {"ok": True, "message": f"Đã gửi email thử tới {test_recipient}."}
    except smtplib.SMTPAuthenticationError:
        return {"ok": False, "message": "Đăng nhập SMTP thất bại — kiểm tra lại email/App Password."}
    except Exception as exc:
        return {"ok": False, "message": f"Gửi email thử thất bại ({type(exc).__name__})."}
