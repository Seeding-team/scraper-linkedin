"""Seeding YouTube: liên kết kênh YouTube với tài khoản Markee + ghi nhận KPI khi comment.

Luồng (tab "Seeding bên ngoài" -> YouTube):
1. Liên kết kênh: extension tự đọc kênh YouTube đang đăng nhập trên trình duyệt (channel_id +
   @handle + tên), FE gửi lên `link_youtube_channel` -> lưu thành 1 dòng social_accounts
   (platform youtube, account_profile_id = channel_id, hoặc @handle nếu không lấy được id).
2. Nhân viên gõ comment trên app, bấm "Mở YouTube & điền sẵn" -> FE xin 1 phiên comment
   (`create_comment_session`): token JWT ký bằng secret của hệ thống, gắn cứng
   người dùng + video + kênh đã liên kết, hết hạn sau vài giờ.
3. Extension mở tab video, điền sẵn nội dung; nhân viên TỰ bấm "Bình luận" trên YouTube.
   Extension thấy comment đã hiện lên kèm kênh đang đăng nhập -> gửi token + kênh nhận diện
   được lên `report_comment`. Chỉ ghi KPI khi kênh đang đăng nhập trùng kênh đã liên kết.

KPI ghi vào seeding_content_kpi (cùng bảng Facebook/LinkedIn/Threads) với id_platform = dòng
"youtube" trong bảng platforms (migration 155), nên các thẻ KPI/xu hướng hiện có tự tính được.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

COMMENT_TOKEN_TYPE = "yt_comment"
COMMENT_TOKEN_TTL_HOURS = 6
_VN_TZ = timezone(timedelta(hours=7))


def get_youtube_platform_id() -> Optional[int]:
    res = get_supabase_client().table("platforms").select("id, name").execute()
    for row in res.data or []:
        if (row.get("name") or "").strip().lower() == "youtube":
            return row["id"]
    return None


def _require_platform_id() -> int:
    pid = get_youtube_platform_id()
    if pid is None:
        raise ValueError("Hệ thống chưa có nền tảng YouTube trong bảng platforms (chưa áp migration 155).")
    return pid


def _norm_handle(handle: Any) -> str:
    h = str(handle or "").strip().lower()
    if not h:
        return ""
    return h if h.startswith("@") else f"@{h}"


def channel_matches(account: dict, channel_id: Optional[str], handle: Optional[str]) -> bool:
    """Kênh nhận diện được có phải kênh đã liên kết không.

    account_profile_id lưu channel_id (UC..., hoặc @handle nếu lúc liên kết không lấy được id),
    account_handle lưu @handle — khớp khi trùng id HOẶC trùng handle.
    """
    stored_id = (account.get("account_profile_id") or "").strip()
    if channel_id and stored_id and stored_id == channel_id.strip():
        return True
    if not handle:
        return False
    stored_handles = {_norm_handle(account.get("account_handle"))}
    if stored_id.startswith("@"):
        stored_handles.add(_norm_handle(stored_id))
    stored_handles.discard("")
    return _norm_handle(handle) in stored_handles


def link_youtube_channel(
    *,
    user_id: str,
    channel_id: Optional[str],
    handle: Optional[str],
    name: Optional[str],
) -> dict:
    platform_id = _require_platform_id()
    channel_id = (channel_id or "").strip() or None
    handle_norm = _norm_handle(handle) or None
    profile_id = channel_id or handle_norm
    if not profile_id:
        raise ValueError("Không nhận diện được kênh YouTube đang đăng nhập (thiếu mã kênh và @handle).")

    sb = get_supabase_client()
    existing = (
        sb.table("social_accounts")
        .select("*")
        .eq("app_user_id", user_id)
        .eq("id_platform", platform_id)
        .execute()
    ).data or []

    display_name = (name or "").strip() or handle_norm or channel_id
    notes = f"Kênh YouTube {handle_norm}" if handle_norm else "Kênh YouTube"

    for acc in existing:
        if channel_matches(acc, channel_id, handle_norm):
            updated = (
                sb.table("social_accounts")
                .update({
                    "account_name": display_name,
                    # Nâng cấp @handle -> channel_id khi lần này lấy được id (ổn định hơn, handle đổi được).
                    "account_profile_id": channel_id or acc.get("account_profile_id") or profile_id,
                    "account_handle": handle_norm or acc.get("account_handle"),
                    "notes": notes,
                    "is_active": True,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", acc["id"])
                .execute()
            ).data or [acc]
            item = updated[0]
            item["platform"] = "youtube"
            item["already_linked"] = True
            return item

    inserted = (
        sb.table("social_accounts")
        .insert({
            "app_user_id": user_id,
            "account_name": display_name,
            "account_profile_id": profile_id,
            "account_handle": handle_norm,
            "id_platform": platform_id,
            "is_primary": len(existing) == 0,
            "is_active": True,
            "notes": notes,
        })
        .execute()
    ).data
    if not inserted:
        raise ValueError("Không lưu được liên kết kênh YouTube.")
    item = inserted[0]
    item["platform"] = "youtube"
    item["already_linked"] = False
    return item


def create_comment_session(*, user: dict, post_id: str, social_account_id: str) -> dict:
    platform_id = _require_platform_id()
    sb = get_supabase_client()

    post_rows = (
        sb.table("youtube_posts").select("id, video_id, post_url, title").eq("id", post_id).limit(1).execute()
    ).data or []
    if not post_rows:
        raise ValueError("Không tìm thấy video YouTube này (có thể đã bị xoá).")
    post = post_rows[0]

    acc_rows = (
        sb.table("social_accounts")
        .select("id, account_name, account_profile_id, account_handle, id_platform, is_active, is_banned")
        .eq("id", social_account_id)
        .eq("app_user_id", user["id"])
        .limit(1)
        .execute()
    ).data or []
    if not acc_rows or acc_rows[0].get("id_platform") != platform_id:
        raise ValueError("Kênh YouTube đã chọn không thuộc tài khoản của bạn.")
    acc = acc_rows[0]
    if not acc.get("account_profile_id"):
        raise ValueError("Kênh YouTube này chưa có mã kênh — hãy liên kết lại bằng Extension.")
    if acc.get("is_banned") or acc.get("is_active") is False:
        raise ValueError("Kênh YouTube này đang bị khoá/tạm ngưng trong hệ thống.")

    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "type": COMMENT_TOKEN_TYPE,
            "sub": user["id"],
            "email": user.get("email"),
            "post_id": post["id"],
            "video_id": post["video_id"],
            "link_post": post["post_url"],
            "social_account_id": acc["id"],
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=COMMENT_TOKEN_TTL_HOURS)).timestamp()),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return {
        "token": token,
        "post_url": post["post_url"],
        "video_id": post["video_id"],
        "expected_channel": {
            "profile_id": acc["account_profile_id"],
            "handle": acc.get("account_handle"),
            "name": acc.get("account_name"),
        },
    }


def _decode_comment_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Phiên comment không hợp lệ hoặc đã hết hạn — mở lại video từ app Markee.") from exc
    if payload.get("type") != COMMENT_TOKEN_TYPE:
        raise ValueError("Phiên comment không hợp lệ.")
    return payload


def report_comment(
    *,
    token: str,
    content: Optional[str],
    link_comment: Optional[str],
    detected_channel_id: Optional[str],
    detected_handle: Optional[str],
    detected_name: Optional[str],
) -> dict:
    session = _decode_comment_token(token)
    platform_id = _require_platform_id()
    sb = get_supabase_client()

    acc_rows = (
        sb.table("social_accounts")
        .select("id, account_name, account_profile_id, account_handle")
        .eq("id", session["social_account_id"])
        .eq("app_user_id", session["sub"])
        .limit(1)
        .execute()
    ).data or []
    if not acc_rows:
        raise ValueError("Kênh YouTube đã liên kết không còn tồn tại.")
    acc = acc_rows[0]

    if not (detected_channel_id or detected_handle):
        return {
            "counted": False,
            "reason": "Không nhận diện được kênh YouTube đang đăng nhập nên chưa tính KPI.",
        }
    if not channel_matches(acc, detected_channel_id, detected_handle):
        who = detected_name or detected_handle or detected_channel_id
        return {
            "counted": False,
            "reason": f"Bạn đang comment bằng kênh \"{who}\", không phải kênh đã liên kết \"{acc.get('account_name')}\" — không tính KPI.",
        }

    data: dict[str, Any] = {
        "content": (content or "").strip() or None,
        "verify": "yes",
        "id_social_account": acc["id"],
        "id_platform": platform_id,
        "id_post": session["post_id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if link_comment:
        data["link_comment"] = link_comment

    existing = (
        sb.table("seeding_content_kpi")
        .select("id")
        .eq("link_post", session["link_post"])
        .eq("id_member", session["sub"])
        .limit(1)
        .execute()
    ).data or []
    if existing:
        rows = sb.table("seeding_content_kpi").update(data).eq("id", existing[0]["id"]).execute().data
    else:
        rows = (
            sb.table("seeding_content_kpi")
            .insert({
                **{k: v for k, v in data.items() if k != "updated_at"},
                "id_member": session["sub"],
                "link_post": session["link_post"],
                "current_day": datetime.now(_VN_TZ).date().isoformat(),
            })
            .execute()
        ).data

    logger.info(
        "[YOUTUBE-SEEDING] KPI comment member=%s video=%s kênh=%s link=%s",
        session["sub"], session.get("video_id"), acc.get("account_profile_id"), link_comment,
    )
    return {
        "counted": True,
        "kpi_id": (rows or [{}])[0].get("id"),
        "post_id": session["post_id"],
        "link_post": session["link_post"],
        "account_name": acc.get("account_name"),
    }
