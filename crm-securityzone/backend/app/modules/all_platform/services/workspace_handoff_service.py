"""Chuyển workspace (brand) cho admin — chỉ admin mới thấy switcher, các role
khác mặc định thấy dữ liệu theo domain họ đang đứng (theo CRM_INSTANCE của
từng deploy), không liên quan tới file này.

Cookie phiên đăng nhập (`crawlpro_access_token`) bị trình duyệt giới hạn theo
domain — admin chuyển sang domain brand khác (thật) thì cookie KHÔNG tự mang
theo. Cơ chế "handoff" ở đây: mint 1 mã dùng 1 lần (TTL ngắn) gắn với user
hiện tại, redirect admin sang domain đích kèm mã, domain đích đổi mã lấy
cookie mới cho chính domain đó — không đi qua URL/log 1 JWT sống, chỉ đi qua
1 mã dùng 1 lần rồi bị đốt ngay.

Lưu mã trong bảng `workspace_handoff_codes` của DB self-host DÙNG CHUNG (migration
004_workspace_handoff_codes.sql) — KHÔNG lưu RAM process. Markee/CloudGate/
SecurityZone là 3 deploy TÁCH RIÊNG (3 container/host khác nhau, mỗi cái 1
CRM_INSTANCE cố định) nhưng cùng đọc/ghi 1 DB — mint ở process A (vd
crm-module phục vụ crm.markee.vn), consume ở process B (vd crm-securityzone
phục vụ crm.securityzone.vn) vẫn hoạt động đúng vì cả 2 cùng nhìn thấy bảng
này trong DB chung. KHÔNG yêu cầu "phải gộp 3 stack thành 1 process".
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from app.core.supabase_client import execute_supabase_query, get_supabase_client

_CODE_TTL_SECONDS = 30


def mint_handoff_code(user_id: str) -> str:
    code = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_CODE_TTL_SECONDS)
    execute_supabase_query(
        lambda: get_supabase_client()
        .table("workspace_handoff_codes")
        .insert({"code": code, "user_id": user_id, "expires_at": expires_at.isoformat()})
        .execute()
    )
    return code


def consume_handoff_code(code: str) -> str | None:
    """Đốt mã (dùng 1 lần) — trả về user_id nếu hợp lệ/chưa hết hạn, None nếu không.

    Xoá row ngay khi đọc được (bất kể còn hạn hay không) để đảm bảo dùng-1-lần
    thật sự, kể cả khi 2 request consume cùng mã chạy gần như đồng thời.
    """
    result = execute_supabase_query(
        lambda: get_supabase_client()
        .table("workspace_handoff_codes")
        .select("user_id, expires_at")
        .eq("code", code)
        .execute()
    )
    if not result.data:
        return None

    row = result.data[0]
    execute_supabase_query(
        lambda: get_supabase_client().table("workspace_handoff_codes").delete().eq("code", code).execute()
    )

    expires_at = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
    if expires_at < datetime.now(timezone.utc):
        return None
    return row["user_id"]
