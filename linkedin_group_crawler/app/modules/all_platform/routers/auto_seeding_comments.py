"""API cho "nhiệm vụ comment seeding tự động" (bảng auto_seeding_comments, migration 160) —
tạo tự động khi lead_score_service.py chấm 1 bài Facebook >=70. Frontend poll GET / để biết
nhiệm vụ nào đang chờ, gọi thẳng extension để comment thật, rồi mark-posted/mark-failed.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.logger import get_logger
from app.core.phone import vn_phone_to_e164
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.schemas.common import BaseResponse
from app.modules.all_platform.services.auto_seeding_comment_service import (
    _build_comment,
    list_pending,
    mark_posted,
    mark_failed,
)

logger = get_logger(__name__)

router = APIRouter()


@router.get("/")
def list_comments(limit: int = 50) -> BaseResponse:
    try:
        data = list_pending(limit)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class RecordZaloSentRequest(BaseModel):
    post_id: Optional[str] = None
    platform: Optional[str] = "facebook"
    phone_number: str
    zalo_display_name: Optional[str] = None
    zalo_conversation_id: Optional[str] = None
    message_content: Optional[str] = None
    sent_by: Optional[str] = None


@router.post("/record-zalo-sent")
def record_zalo_sent_endpoint(payload: RecordZaloSentRequest) -> BaseResponse:
    """Ghi nhận việc đã gửi tin nhắn Zalo tư vấn (qua Extension hoặc thao tác tay).
    Cập nhật bản ghi auto_seeding_comments của bài viết (post_id) hoặc tạo mới nếu chưa có,
    đồng thời đồng bộ trạng thái zalo_status='sent' cho tất cả các bản ghi khác có cùng SĐT.
    """
    if not payload.phone_number or not payload.phone_number.strip():
        return BaseResponse(success=False, message="SĐT không được để trống.")

    raw_phone = payload.phone_number.strip()
    normalized_phone = vn_phone_to_e164(raw_phone) or raw_phone
    now_iso = datetime.now(timezone.utc).isoformat()
    platform = (payload.platform or "facebook").strip().lower()

    # Tập hợp các biến thể số điện thoại để đồng bộ toàn bộ dòng có cùng SĐT
    phones_to_sync = {raw_phone, normalized_phone}
    digits_only = re.sub(r"\D", "", raw_phone)
    if digits_only:
        phones_to_sync.add(digits_only)
        if digits_only.startswith("0") and len(digits_only) == 10:
            phones_to_sync.add("+84" + digits_only[1:])
        elif digits_only.startswith("84") and len(digits_only) == 11:
            phones_to_sync.add("0" + digits_only[2:])
            phones_to_sync.add("+" + digits_only)

    try:
        supabase = get_supabase_client()
        updated_row = None

        update_fields: dict[str, Any] = {
            "zalo_status": "sent",
            "zalo_sent_at": now_iso,
        }
        # Lưu sent_by nếu có (nếu DB chưa có cột zalo_sent_by sẽ tự động fallback an toàn)
        if payload.sent_by:
            update_fields["zalo_sent_by"] = payload.sent_by
            update_fields["zalo_error"] = f"sent_by:{payload.sent_by}"
        if payload.zalo_display_name:
            update_fields["zalo_display_name"] = payload.zalo_display_name
        if payload.zalo_conversation_id:
            update_fields["zalo_conversation_id"] = payload.zalo_conversation_id
        if payload.message_content:
            update_fields["zalo_message_content"] = payload.message_content

        # 1. Nếu có post_id: Cập nhật hoặc insert row trong auto_seeding_comments
        if payload.post_id:
            id_column = "id_post_li" if platform == "linkedin" else "id_post_fb"
            post_table = "linkedin_posts" if platform == "linkedin" else "facebook_posts"

            existing = (
                supabase.table("auto_seeding_comments")
                .select("*")
                .eq(id_column, payload.post_id)
                .limit(1)
                .execute()
            )

            if existing.data:
                target_id = existing.data[0]["id"]
                row_update = dict(update_fields)
                row_update["phone_number"] = normalized_phone
                try:
                    res = (
                        supabase.table("auto_seeding_comments")
                        .update(row_update)
                        .eq("id", target_id)
                        .execute()
                    )
                    if res.data:
                        updated_row = res.data[0]
                except Exception as up_err:
                    if "zalo_sent_by" in str(up_err):
                        row_update.pop("zalo_sent_by", None)
                        res = (
                            supabase.table("auto_seeding_comments")
                            .update(row_update)
                            .eq("id", target_id)
                            .execute()
                        )
                        if res.data:
                            updated_row = res.data[0]
                    else:
                        raise up_err
            else:
                # Tìm thông tin bài viết để điền post_url, group_name, lead_need_category...
                post_url = ""
                group_name = None
                id_member = None
                need_cat = "other"
                try:
                    p_res = (
                        supabase.table(post_table)
                        .select("post_url, group_name, id_member, lead_need_category")
                        .eq("id", payload.post_id)
                        .limit(1)
                        .execute()
                    )
                    if p_res.data:
                        p_row = p_res.data[0]
                        post_url = p_row.get("post_url") or ""
                        group_name = p_row.get("group_name")
                        id_member = p_row.get("id_member")
                        need_cat = p_row.get("lead_need_category") or "other"
                except Exception as p_err:
                    logger.warning(f"Không thể lấy thông tin bài viết {payload.post_id}: {p_err}")

                insert_payload = {
                    id_column: payload.post_id,
                    "platform": platform,
                    "post_url": post_url or f"https://{platform}.com/{payload.post_id}",
                    "group_name": group_name,
                    "id_member": id_member,
                    "comment_content": _build_comment(need_cat),
                    "need_category": need_cat,
                    "phone_number": normalized_phone,
                    "status": "pending",
                    **update_fields,
                }
                try:
                    res = supabase.table("auto_seeding_comments").insert(insert_payload).execute()
                    if res.data:
                        updated_row = res.data[0]
                except Exception as ins_err:
                    if "zalo_sent_by" in str(ins_err):
                        insert_payload.pop("zalo_sent_by", None)
                        res = supabase.table("auto_seeding_comments").insert(insert_payload).execute()
                        if res.data:
                            updated_row = res.data[0]
                    else:
                        raise ins_err

        # 2. Cập nhật TẤT CẢ các dòng auto_seeding_comments khác có cùng phone_number
        sync_fields = dict(update_fields)
        sync_fields.pop("zalo_sent_by", None) # Đảm bảo không lỗi nếu chưa có cột
        for sync_phone in phones_to_sync:
            try:
                supabase.table("auto_seeding_comments").update(sync_fields).eq("phone_number", sync_phone).execute()
            except Exception as sync_err:
                logger.warning(f"Lỗi đồng bộ Zalo sent cho SĐT {sync_phone}: {sync_err}")

        # Đồng bộ luôn vào customer_leads nếu có zalo_conversation_id
        if payload.zalo_conversation_id:
            try:
                clean_dig = re.sub(r"\D", "", raw_phone)
                if clean_dig.startswith("84") and len(clean_dig) >= 10:
                    clean_dig = "0" + clean_dig[2:]
                supabase.table("customer_leads").insert({
                    "customer_name": payload.zalo_display_name or f"Zalo User {clean_dig[-4:]}",
                    "phone": clean_dig,
                    "conv_id": payload.zalo_conversation_id,
                    "source_platform": "zalo",
                    "status": "new",
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }).execute()
            except Exception as c_err:
                logger.debug(f"Sync customer_leads in record_zalo_sent: {c_err}")

        return BaseResponse(
            success=True,
            data=updated_row or {
                "phone_number": normalized_phone,
                "zalo_status": "sent",
                "zalo_sent_at": now_iso,
                "zalo_sent_by": payload.sent_by,
                "zalo_display_name": payload.zalo_display_name,
                "zalo_conversation_id": payload.zalo_conversation_id,
            },
            message="Đã ghi nhận gửi tin nhắn Zalo thành công."
        )
    except Exception as e:
        logger.exception(f"Lỗi record_zalo_sent: {e}")
        return BaseResponse(success=False, message=str(e))


class MarkPostedRequest(BaseModel):
    link_comment: str = ""


@router.post("/{comment_id}/mark-posted")
def mark_posted_endpoint(comment_id: str, payload: MarkPostedRequest) -> BaseResponse:
    try:
        data = mark_posted(comment_id, payload.link_comment)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class MarkFailedRequest(BaseModel):
    error_message: str = ""


@router.post("/{comment_id}/mark-failed")
def mark_failed_endpoint(comment_id: str, payload: MarkFailedRequest) -> BaseResponse:
    try:
        data = mark_failed(comment_id, payload.error_message)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class RetryZaloRequest(BaseModel):
    contact_phone: str
    need_category: Optional[str] = None


@router.post("/{comment_id}/retry-zalo")
async def retry_zalo_endpoint(comment_id: str, payload: RetryZaloRequest) -> BaseResponse:
    """Thử lại (hoặc kích hoạt lần đầu) nhánh tư vấn Zalo cho 1 nhiệm vụ đã có (migration
    161) — dùng khi bài được chấm điểm TRƯỚC lúc tính năng Zalo deploy (chưa có
    contact_phone), hoặc khi lần gửi trước zalo_status='failed' do lỗi tạm thời. Lưu
    phone_number TRƯỚC khi thử gửi — card hiển thị đúng SĐT ngay cả khi lần gửi này vẫn lỗi."""
    from app.core.phone import vn_phone_to_e164
    from app.core.supabase_client import get_supabase_client
    from app.modules.all_platform.services.auto_seeding_zalo_service import maybe_send_zalo_consult

    e164 = vn_phone_to_e164(payload.contact_phone)
    if not e164:
        return BaseResponse(success=False, message="SĐT không hợp lệ.")
    from app.modules.all_platform.services.lead_score_service import _OWN_COMPANY_PHONES_E164
    if e164 in _OWN_COMPANY_PHONES_E164:
        return BaseResponse(success=False, message="Đây là số điện thoại CỦA CHÍNH CÔNG TY (Markee/CloudGate) — không được nhắn tin cho chính mình.")
    try:
        supabase = get_supabase_client()
        existing = supabase.table("auto_seeding_comments").select("need_category").eq("id", comment_id).limit(1).execute()
        if not existing.data:
            return BaseResponse(success=False, message="Không tìm thấy nhiệm vụ seeding này.")
        need_category = payload.need_category or existing.data[0].get("need_category")
        supabase.table("auto_seeding_comments").update({"phone_number": e164}).eq("id", comment_id).execute()
        await maybe_send_zalo_consult(comment_id=comment_id, contact_phone=e164, need_category=need_category)
        data = supabase.table("auto_seeding_comments").select("*").eq("id", comment_id).limit(1).execute()
        return BaseResponse(success=True, data=data.data[0] if data.data else None)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
