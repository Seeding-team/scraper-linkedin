"""Google OAuth (authorization-code flow) RIENG cho nguoi dung - nhap tai lieu Google Docs/
Drive RIENG TU ma service account (markee-recruitment-bot@...) khong doc duoc (2026-10-27,
yeu cau sep sau khi phat hien hop dong Markee_HopDong_License_Claude_CPC khong nhap duoc).

KIEN TRUC (quan trong, doc truoc khi sua):
  - Service account van la nguoi DUY NHAT ghi vao Shared Drive "Hop Dong CRM" (Content
    Manager) - KHONG bao gio cho OAuth token cua nguoi dung ghi truc tiep vao Shared Drive
    (nguoi dung co the khong phai thanh vien Shared Drive do).
  - OAuth token cua nguoi dung CHI dung de: (1) kiem tra quyen doc 1 file rieng tu, (2) tai/
    export noi dung file do VE SERVER (bang chinh quyen cua nguoi dung). Sau khi co bytes,
    dung LAI contract_drive_service.upload_new_file_with_hash() (service account) de day len
    Shared Drive - giong het luong "Tai file len tu may", chi khac nguon lay bytes.
  - Scope xin toi thieu: "drive.readonly" (chi doc, KHONG xin quyen ghi/xoa tren Drive ca
    nhan cua ho) + "userinfo.email" (hien "Da ket noi: x@gmail.com" cho ro rang, khong doan
    mo ho).
  - KHONG BAO GIO log access_token/refresh_token (nguyen tac #7 tu plan Drive truoc do, ap
    dung y het cho OAuth).
  - TAI SU DUNG 1 OAuth Client (Web application) CO SAN tren Google Cloud Console - CHINH LA
    Client ID dang dung cho nut "Dang nhap bang Google" (GSI, `GOOGLE_CLIENT_ID`/
    `settings.google_oauth_client_id`). Google Cloud KHONG bat nguoi dung tao OAuth Client
    moi chi vi doi tu ID-token sang authorization-code - CHI can:
      1. Mo OAuth Client do tren Google Cloud Console > APIs & Services > Credentials.
      2. Lay "Client secret" co san (moi OAuth Client "Web application" deu da duoc Google
         tu sinh 1 secret tu luc tao, du GSI khong dung toi) -> dien vao .env
         `GOOGLE_CLIENT_SECRET`.
      3. Them "Authorized redirect URI": `{CRM_PUBLIC_URL}/api/all-platform/google-oauth/callback`
         (xem settings.crm_public_url, mac dinh http://localhost:18090 o dev).
      4. Neu OAuth consent screen dang o che do "Testing" (chua publish), phai them tai khoan
         Google se dung de ket noi vao danh sach "Test users".
    KHONG tao OAuth Client thu 2 - chi mo rong dung Client da co.

State CSRF: ky bang CHINH `settings.jwt_secret_key`/jose.jwt (da dung cho JWT dang nhap, tai
su dung thay vi tu dung co che ky rieng) - encode {user_id, return_to, nonce, exp 10 phut}.
"""
from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from jose import JWTError, jwt

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

# BUG THAT DA GAP (xac nhan qua test that, 2026-10-27): redirect_uri dev dung "http://" (khong
# phai "https://", vd http://localhost:18090) - thu vien `oauthlib` (ma `google-auth-oauthlib`
# dung ben duoi) MAC DINH TU CHOI trao doi token qua HTTP (InsecureTransportError), KHONG phai
# loi code logic. Loi nay bi `except Exception` nuot roi redirect ve trang danh sach hop dong
# chung (khong hien loi), nhin giong nhu nut "Ket noi Google" khong lam gi ca. Bat co `env var`
# chinh thuc cua oauthlib de cho phep dev qua HTTP - KHONG anh huong production (production
# dung CRM_PUBLIC_URL that la https://, bien nay khong lam HTTP "an toan hon", chi tat bot kiem
# tra thua cua oauthlib khi scheme THAT SU la https roi).
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
# Google hay tra ve scope khac thu tu/dang bieu dien so voi scope da xin (vd tu them "openid"
# implicit) - oauthlib mac dinh raise loi "Scope has changed" trong truong hop nay du ban chat
# khong co van de bao mat gi. Bat co de khong bi raise nham.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_REVOKE_URI = "https://oauth2.googleapis.com/revoke"
_USERINFO_URI = "https://www.googleapis.com/oauth2/v2/userinfo"

_STATE_AUDIENCE = "google_oauth_state"


class GoogleOAuthNotConfigured(RuntimeError):
    pass


def _require_config() -> None:
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise GoogleOAuthNotConfigured(
            "Chưa cấu hình GOOGLE_CLIENT_SECRET — mở OAuth Client (cùng GOOGLE_CLIENT_ID đang "
            "dùng cho nút Đăng nhập Google) trên Google Cloud Console, lấy Client secret có sẵn "
            "và thêm Authorized redirect URI (xem docstring đầu file)."
        )


def redirect_uri() -> str:
    return f"{settings.crm_public_url}/api/all-platform/google-oauth/callback"


def _client_config() -> dict[str, Any]:
    return {
        "web": {
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "auth_uri": _AUTH_URI,
            "token_uri": _TOKEN_URI,
            "redirect_uris": [redirect_uri()],
        }
    }


def _sign_state(user_id: str, return_to: str) -> str:
    payload = {
        "aud": _STATE_AUDIENCE, "sub": user_id, "return_to": return_to,
        "nonce": secrets.token_urlsafe(12), "exp": int(time.time()) + 600,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _verify_state(state: str) -> tuple[str, str]:
    try:
        payload = jwt.decode(state, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm], audience=_STATE_AUDIENCE)
    except JWTError as exc:
        raise ValueError("Phiên kết nối Google không hợp lệ hoặc đã hết hạn — hãy thử lại.") from exc
    return payload["sub"], payload.get("return_to") or "/"


def peek_return_to(state: str | None) -> str:
    """Co gang lay lai `return_to` tu state DU handle_callback() sau do that bai vi ly do gi
    (vd loi trao doi token that su) - de redirect loi VE DUNG trang hop dong dang mo thay vi
    trang danh sach chung (noi KHONG doc query param `googleOauth` nen loi bi "mat tich" khoi
    mat nguoi dung, giong bug that da gap: bam Ket noi Google loi am tham nhay ve danh sach)."""
    if not state:
        return "/all-platform/contracts"
    try:
        _user_id, return_to = _verify_state(state)
        return return_to
    except ValueError:
        return "/all-platform/contracts"


def build_authorization_url(user_id: str, return_to: str) -> str:
    """`return_to` phai la 1 duong dan tuong doi AN TOAN (bat dau `/all-platform/`) - callback
    se redirect ve day sau khi xu ly xong, KHONG chap nhan URL tuyet doi (tranh open-redirect)."""
    _require_config()
    if not return_to.startswith("/all-platform/"):
        return_to = "/all-platform/contracts"
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=redirect_uri())
    state = _sign_state(user_id, return_to)
    url, _ = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent", state=state,
    )
    return url


def handle_callback(code: str, state: str) -> dict[str, Any]:
    """Doi `code` lay token, luu/cap nhat 1 dong duy nhat cho user nay. Tra ve
    {userId, returnTo, email} de router redirect dung cho + hien thong bao."""
    _require_config()
    user_id, return_to = _verify_state(state)
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=redirect_uri())
    flow.fetch_token(code=code)
    creds = flow.credentials

    email = None
    try:
        resp = httpx.get(_USERINFO_URI, headers={"Authorization": f"Bearer {creds.token}"}, timeout=15.0)
        if resp.status_code == 200:
            email = resp.json().get("email")
    except Exception as exc:  # noqa: BLE001 - khong lam fail ca luong ket noi chi vi khong lay duoc email hien thi
        logger.warning("Không lấy được email Google sau khi kết nối OAuth: %s", exc)

    sb = get_supabase_client()
    existing = sb.table("google_oauth_connections").select("refresh_token").eq("user_id", user_id).limit(1).execute().data
    # Google CHI tra refresh_token o lan consent DAU TIEN (prompt=consent moi lan van co the
    # khong tra lai neu da cap truoc do trong vai truong hop) - giu refresh_token cu neu lan
    # nay khong co token moi, KHONG ghi de thanh NULL lam mat kha nang refresh sau nay.
    refresh_token = creds.refresh_token or (existing[0]["refresh_token"] if existing else None)
    expires_at = creds.expiry.replace(tzinfo=timezone.utc).isoformat() if creds.expiry else None
    sb.table("google_oauth_connections").upsert({
        "user_id": user_id, "google_email": email, "access_token": creds.token,
        "refresh_token": refresh_token, "scope": " ".join(creds.scopes or SCOPES),
        "token_expires_at": expires_at, "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id").execute()

    return {"userId": user_id, "returnTo": return_to, "email": email}


def get_status(user_id: str) -> dict[str, Any] | None:
    sb = get_supabase_client()
    rows = sb.table("google_oauth_connections").select("google_email, updated_at").eq("user_id", user_id).limit(1).execute().data
    if not rows:
        return None
    return {"email": rows[0].get("google_email"), "connectedAt": rows[0].get("updated_at")}


def disconnect(user_id: str) -> None:
    sb = get_supabase_client()
    rows = sb.table("google_oauth_connections").select("access_token").eq("user_id", user_id).limit(1).execute().data
    if rows:
        try:
            httpx.post(_REVOKE_URI, params={"token": rows[0]["access_token"]}, timeout=10.0)
        except Exception as exc:  # noqa: BLE001 - best-effort, van xoa ban ghi local du revoke that bai
            logger.warning("Revoke token Google OAuth thất bại (vẫn xoá kết nối local): %s", exc)
    sb.table("google_oauth_connections").delete().eq("user_id", user_id).execute()


def _get_credentials(user_id: str):
    """Tra ve `google.oauth2.credentials.Credentials` da refresh (neu can) cho user, hoac None
    neu chua ket noi. Tu luu lai access_token/expiry moi sau khi refresh."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    sb = get_supabase_client()
    rows = sb.table("google_oauth_connections").select("*").eq("user_id", user_id).limit(1).execute().data
    if not rows:
        return None
    row = rows[0]
    creds = Credentials(
        token=row["access_token"], refresh_token=row.get("refresh_token"),
        token_uri=_TOKEN_URI, client_id=settings.google_oauth_client_id,
        client_secret=settings.google_oauth_client_secret, scopes=(row.get("scope") or "").split() or SCOPES,
    )
    expires_at = row.get("token_expires_at")
    needs_refresh = True
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            needs_refresh = exp_dt <= datetime.now(timezone.utc) + timedelta(minutes=2)
        except ValueError:
            needs_refresh = True
    if needs_refresh and creds.refresh_token:
        try:
            creds.refresh(Request())
            sb.table("google_oauth_connections").update({
                "access_token": creds.token,
                "token_expires_at": creds.expiry.replace(tzinfo=timezone.utc).isoformat() if creds.expiry else None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Refresh Google OAuth token thất bại cho user %s: %s", user_id, exc)
            return None
    return creds


def _drive_client_for_user(user_id: str):
    from googleapiclient.discovery import build

    creds = _get_credentials(user_id)
    if creds is None:
        return None
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def check_user_can_read_file(user_id: str, file_id: str) -> bool:
    """Kiem tra THAT (goi files.get that, khong doan) tai khoan Google da ket noi cua user nay
    co doc duoc file_id khong - KHAC han check_file_readable() cua contract_drive_service.py
    (ham do kiem tra bang SERVICE ACCOUNT, ham nay kiem tra bang OAuth token CUA USER)."""
    from googleapiclient.errors import HttpError

    client = _drive_client_for_user(user_id)
    if client is None:
        return False
    try:
        client.files().get(fileId=file_id, fields="id").execute()
        return True
    except HttpError:
        return False


def download_file_via_user(user_id: str, file_id: str) -> tuple[bytes, str, str] | None:
    """Tai noi dung file_id BANG CHINH quyen cua user da ket noi - Google Doc/Sheet/Slide thi
    export sang PDF (snapshot tinh, KHONG dung Google Docs API, KHONG sua gi file goc - giong
    nguyen tac export_google_doc_as_pdf() cua contract_drive_service.py); file nhi phan (PDF/
    DOCX da upload san len Drive) thi tai thang (`get_media`). Tra ve (content, filename, mime)
    hoac None neu chua ket noi/khong doc duoc."""
    from googleapiclient.errors import HttpError

    client = _drive_client_for_user(user_id)
    if client is None:
        return None
    try:
        meta = client.files().get(fileId=file_id, fields="id, name, mimeType").execute()
    except HttpError:
        return None
    name = meta.get("name") or file_id
    mime = meta.get("mimeType") or ""
    try:
        if mime.startswith("application/vnd.google-apps."):
            content = client.files().export(fileId=file_id, mimeType="application/pdf").execute()
            return content, f"{name}.pdf", "application/pdf"
        content = client.files().get_media(fileId=file_id).execute()
        return content, name, mime or "application/octet-stream"
    except HttpError as exc:
        logger.warning("Tải file %s qua OAuth user %s thất bại: %s", file_id, user_id, exc)
        return None
