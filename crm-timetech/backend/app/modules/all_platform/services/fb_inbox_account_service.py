"""FB Inbox Account service.

Quản lý mapping giữa FB inbox account (user_id từ seeder service)
với app_users.id của member.

Luồng:
  1. Member thêm FB inbox account → link_user_account()
  2. Admin/Leader bấm "Xác nhận Inbox" → resolve_id_member()
  3. KPI service dùng resolve_id_member() để lấy id_member chính xác
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from supabase import Client

from app.core.supabase_client import get_supabase_client


def link_user_account(
    id_member: str,
    user_id: str,
    fb_user_id: Optional[str] = None,
    account_label: Optional[str] = None,
) -> dict:
    """Link FB inbox account với member.

    Args:
        id_member: app_users.id của member
        user_id: Seeder service user_id (VD: "fb_10001")
        fb_user_id: Facebook UID thật (VD: "100000123456")
        account_label: Tên hiển thị do member đặt

    Returns:
        dict với thông tin account đã tạo/cập nhật
    """
    supabase: Client = get_supabase_client()

    now = datetime.now(timezone.utc).isoformat()

    # Check xem đã tồn tại chưa
    existing = (
        supabase.table("fb_inbox_accounts")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    upsert_data = {
        "id_member": id_member,
        "user_id": user_id,
        "fb_user_id": fb_user_id,
        "account_label": account_label,
        "is_active": True,
        "updated_at": now,
    }

    if existing.data:
        # Update existing - chỉ update nếu thuộc về cùng member
        existing_row = existing.data[0]
        if existing_row.get("id_member") != id_member:
            raise ValueError(
                f"Account '{user_id}' đã được link với member khác. "
                f"Liên hệ admin để được hỗ trợ."
            )
        result = (
            supabase.table("fb_inbox_accounts")
            .update(upsert_data)
            .eq("user_id", user_id)
            .execute()
        )
        logger.info(f"🔗 Updated fb_inbox_account: user_id={user_id}, id_member={id_member}")
    else:
        # Insert new
        upsert_data["created_at"] = now
        result = (
            supabase.table("fb_inbox_accounts")
            .insert(upsert_data)
            .execute()
        )
        logger.info(f"🔗 Created fb_inbox_account: user_id={user_id}, id_member={id_member}")

    return result.data[0] if result.data else upsert_data


def get_accounts_by_member(id_member: str) -> list[dict]:
    """Lấy danh sách FB inbox accounts của 1 member.

    Args:
        id_member: app_users.id của member

    Returns:
        Danh sách accounts
    """
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("fb_inbox_accounts")
        .select("*")
        .eq("id_member", id_member)
        .order("created_at", desc=True)
        .execute()
    )

    return result.data or []


def get_accounts_by_user_ids(user_ids: list[str]) -> dict[str, dict]:
    """Lấy thông tin accounts theo nhiều user_ids.

    Args:
        user_ids: Danh sách seeder service user_ids

    Returns:
        Dict map user_id -> account info
    """
    if not user_ids:
        return {}

    supabase: Client = get_supabase_client()

    result = (
        supabase.table("fb_inbox_accounts")
        .select("*")
        .in_("user_id", user_ids)
        .execute()
    )

    return {row["user_id"]: row for row in (result.data or [])}


def resolve_id_member(user_id: str) -> Optional[str]:
    """Resolve seeder user_id -> app_users.id (id_member).

    Đây là hàm quan trọng nhất - dùng để resolve id_member
    khi Admin/Leader bấm "Xác nhận Inbox".

    Args:
        user_id: Seeder service user_id (VD: "fb_10001")

    Returns:
        id_member (UUID) nếu tìm thấy, None nếu không tìm thấy
    """
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("fb_inbox_accounts")
        .select("id_member, is_active")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )

    if result.data:
        return result.data[0]["id_member"]

    # Fallback 1: Nếu user_id có dạng fb_XXX, tìm trong cột fb_user_id = XXX
    if user_id.startswith("fb_"):
        fb_uid = user_id[3:]
        result_fb = (
            supabase.table("fb_inbox_accounts")
            .select("id_member, is_active")
            .eq("fb_user_id", fb_uid)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if result_fb.data:
            return result_fb.data[0]["id_member"]

    # Fallback 2: Thử tìm trực tiếp user_id trong cột fb_user_id
    result_direct = (
        supabase.table("fb_inbox_accounts")
        .select("id_member, is_active")
        .eq("fb_user_id", user_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if result_direct.data:
        return result_direct.data[0]["id_member"]

    return None


def resolve_id_member_bulk(user_ids: list[str]) -> dict[str, Optional[str]]:
    """Resolve nhiều user_ids -> id_members.

    Args:
        user_ids: Danh sách seeder service user_ids

    Returns:
        Dict map user_id -> id_member (có thể là None)
    """
    if not user_ids:
        return {}

    supabase: Client = get_supabase_client()

    out = {uid: None for uid in user_ids}
    
    # Tìm theo user_id trước
    result_user_id = (
        supabase.table("fb_inbox_accounts")
        .select("user_id, id_member, fb_user_id")
        .in_("user_id", user_ids)
        .eq("is_active", True)
        .execute()
    )

    for row in (result_user_id.data or []):
        out[row["user_id"]] = row["id_member"]

    # Những uid chưa tìm thấy, ta sẽ thử map với fb_user_id
    missing_uids = [uid for uid, member_id in out.items() if member_id is None]
    if missing_uids:
        # Lấy danh sách fb_uid (bỏ prefix fb_ nếu có, và giữ nguyên)
        possible_fb_uids = []
        fb_uid_to_original = {}
        for uid in missing_uids:
            possible_fb_uids.append(uid)
            fb_uid_to_original[uid] = uid
            if uid.startswith("fb_"):
                pure_fb_uid = uid[3:]
                possible_fb_uids.append(pure_fb_uid)
                fb_uid_to_original[pure_fb_uid] = uid

        result_fb_uid = (
            supabase.table("fb_inbox_accounts")
            .select("fb_user_id, id_member")
            .in_("fb_user_id", possible_fb_uids)
            .eq("is_active", True)
            .execute()
        )
        
        for row in (result_fb_uid.data or []):
            fb_user_id = row.get("fb_user_id")
            if fb_user_id and fb_user_id in fb_uid_to_original:
                orig_uid = fb_uid_to_original[fb_user_id]
                out[orig_uid] = row["id_member"]

    return out


def delete_account(account_id: str, id_member: str) -> bool:
    """Xóa FB inbox account.

    Args:
        account_id: ID của account cần xóa
        id_member: ID của member sở hữu (để validate)

    Returns:
        True nếu xóa thành công
    """
    supabase: Client = get_supabase_client()

    # Verify ownership trước khi xóa
    existing = (
        supabase.table("fb_inbox_accounts")
        .select("id_member")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        return False

    if existing.data[0]["id_member"] != id_member:
        raise ValueError("Bạn không có quyền xóa account này.")

    result = (
        supabase.table("fb_inbox_accounts")
        .delete()
        .eq("id", account_id)
        .execute()
    )

    if result.data:
        logger.info(f"🗑️ Deleted fb_inbox_account: id={account_id}")
        return True

    return False


def update_account(
    account_id: str,
    id_member: str,
    fb_user_id: Optional[str] = None,
    account_label: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> dict:
    """Cập nhật FB inbox account.

    Args:
        account_id: ID của account cần cập nhật
        id_member: ID của member sở hữu (để validate)
        fb_user_id: Facebook UID mới (nếu có)
        account_label: Tên hiển thị mới (nếu có)
        is_active: Trạng thái active (nếu có)

    Returns:
        Thông tin account đã cập nhật
    """
    supabase: Client = get_supabase_client()

    # Verify ownership
    existing = (
        supabase.table("fb_inbox_accounts")
        .select("id_member")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise ValueError("Không tìm thấy account.")

    if existing.data[0]["id_member"] != id_member:
        raise ValueError("Bạn không có quyền cập nhật account này.")

    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}

    if fb_user_id is not None:
        update_data["fb_user_id"] = fb_user_id
    if account_label is not None:
        update_data["account_label"] = account_label
    if is_active is not None:
        update_data["is_active"] = is_active

    result = (
        supabase.table("fb_inbox_accounts")
        .update(update_data)
        .eq("id", account_id)
        .execute()
    )

    if result.data:
        logger.info(f"✏️ Updated fb_inbox_account: id={account_id}")

    return result.data[0] if result.data else {}


def get_account_by_user_id(user_id: str) -> Optional[dict]:
    """Lấy thông tin 1 account theo user_id.

    Args:
        user_id: Seeder service user_id

    Returns:
        Thông tin account hoặc None
    """
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("fb_inbox_accounts")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    return result.data[0] if result.data else None
