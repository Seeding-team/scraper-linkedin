"""Selective Inbox Sharing service for KPI verification.

Cho phép member (staff) tick cho phép leader xem các conversation Zalo nhất
định để verify "Tin nhắn KPI". Bảng lưu: ``zalo_module_conversation_permissions``
(sử dụng lại từ migration 003, mở rộng thêm ở migration 004).

Quy ước:
    - shared_role = 'leader'   → dùng cho luồng KPI verification
    - is_active   = true       → đang share; false = tắt share
    - id_member   = app_users.id của staff đã tick
    - id_leader   = app_users.id của leader được share. NULL = chưa bind /
                    member không thuộc leader nào (share cho admin).
    - Một member có thể thuộc nhiều leader → khi tick sẽ tạo N row,
      mỗi row ứng với 1 leader (1 row, id_leader=L1) + (1 row, id_leader=L2) + ...
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from loguru import logger
from supabase import Client

from app.core.supabase_client import get_supabase_client


def _resolve_user_id(supabase: Client, email: str) -> Optional[str]:
    """Tìm app_users.id theo email (lowercase). Trả None nếu không thấy."""
    res = (
        supabase.table("app_users")
        .select("id")
        .eq("email", email.strip().lower())
        .limit(1)
        .execute()
    )
    if res.data:
        return str(res.data[0]["id"])
    return None


def _list_leader_ids_for_member(supabase: Client, member_id: str) -> List[str]:
    """Lấy tất cả leader_id mà member này thuộc về.

    Gọi RPC ``fn_list_leader_ids_for_member`` (1 round-trip duy nhất).
    Fallback về 2 query PostgREST nếu RPC chưa tồn tại (DB chưa migrate 005).

    Trả về danh sách UUID leader (dedup, loại bỏ leader cùng id với member).
    """
    # Đường nhanh: gọi RPC trên DB
    try:
        res = supabase.rpc(
            "fn_list_leader_ids_for_member",
            {"p_member_id": member_id},
        ).execute()
        leader_ids: List[str] = []
        seen: set[str] = set()
        for row in res.data or []:
            lid = str(row.get("id_leader") or "").strip()
            if not lid or lid == member_id or lid in seen:
                continue
            seen.add(lid)
            leader_ids.append(lid)
        return leader_ids
    except Exception as exc:
        logger.warning(
            "fn_list_leader_ids_for_member RPC failed, fallback sang 2 query: {}",
            exc,
        )

    # Fallback: 2 query PostgREST (cũ, ~200ms thay vì ~30ms)
    res_mot = (
        supabase.table("member_of_teams")
        .select("id_teams")
        .eq("id_member", member_id)
        .execute()
    )
    team_ids = {
        str(r.get("id_teams") or "").strip()
        for r in (res_mot.data or [])
        if r.get("id_teams")
    }
    if not team_ids:
        return []

    res_t = (
        supabase.table("teams")
        .select("id_leader")
        .in_("id", list(team_ids))
        .not_.is_("id_leader", "null")
        .execute()
    )

    leader_ids = []
    seen = set()
    for row in res_t.data or []:
        lid = str(row.get("id_leader") or "").strip()
        if not lid or lid == member_id or lid in seen:
            continue
        seen.add(lid)
        leader_ids.append(lid)
    return leader_ids


def toggle_inbox_share(
    account_id: str,
    conversation_id: str,
    member_email: str,
    shared_role: str = "leader",
    is_active: bool = True,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Bật/tắt share cho 1 conversation.

    Optimized flow (target: <300ms cho member thuộc 2-3 leader):
        1. Resolve member_id từ email (1 query).
        2. List leader_ids từ member_of_teams → teams (2 query).
        3. (BẬT) 1 query duy nhất lấy TẤT CẢ existing rows cho member này
           (account_id, conversation_id, shared_role) → build dict {id_leader: id}.
        4. (BẬT) 1 bulk upsert (PostgREST on_conflict unique key) — 1 request duy nhất
           xử lý cả insert row mới + update row cũ.
        5. (BẬT) 1 query duy nhất deactivate các row orphan (id_leader không
           còn trong team). KHÔNG block response — chạy trong background.

    Returns:
        Dict ``{ok: True, rows: [...], is_active: bool, leader_ids: [...]}``
        hoặc ``{ok: False, error: "..."}``.
    """
    import time
    _t0 = time.perf_counter()
    supabase: Client = get_supabase_client()

    if not account_id or not conversation_id or not member_email:
        return {"ok": False, "error": "account_id, conversation_id, member_email là bắt buộc"}

    _t1 = time.perf_counter()
    member_id = _resolve_user_id(supabase, member_email)
    if not member_id:
        return {"ok": False, "error": f"Không tìm thấy user với email: {member_email}"}
    logger.debug("toggle_inbox_share: resolve_user_id took {:.0f}ms", (_t1 - _t0) * 1000)

    # Bước 1: Lấy tất cả leader mà member thuộc về
    _t2 = time.perf_counter()
    leader_ids: List[str] = []
    if shared_role == "leader":
        leader_ids = _list_leader_ids_for_member(supabase, member_id)
    logger.debug("toggle_inbox_share: list_leader_ids took {:.0f}ms (n={})", (_t2 - _t1) * 1000, len(leader_ids))

    # Bước 2: Tắt share (1 query duy nhất — không cần leader loop)
    if not is_active:
        try:
            res = (
                supabase.table("zalo_module_conversation_permissions")
                .update({"is_active": False, "updated_at": "now()"})
                .eq("account_id", str(account_id))
                .eq("conversation_id", str(conversation_id))
                .eq("shared_role", shared_role)
                .eq("id_member", member_id)
                .execute()
            )
            return {
                "ok": True,
                "rows": list(res.data or []),
                "is_active": False,
                "leader_ids": leader_ids,
            }
        except Exception as exc:
            logger.exception("toggle_inbox_share (disable) failed")
            return {"ok": False, "error": str(exc)}

    # Bước 3: Xác định danh sách target id_leader
    # Safety: dedup lần nữa vì RPC có thể trả về duplicate do team join lặp.
    target_leader_ids: List[Optional[str]]
    if shared_role == "leader":
        _seen_lid: set = set()
        target_leader_ids = []
        for lid in (leader_ids or []):
            if lid is None or lid in _seen_lid:
                continue
            _seen_lid.add(lid)
            target_leader_ids.append(lid)
    else:
        target_leader_ids = [None]

    # Nếu member thuộc shared_role=leader mà chưa thuộc leader nào → không tạo
    # row nào (tránh share "ma"). Trả về success=False để FE biết không share
    # được, kèm warning giải thích lý do.
    if not target_leader_ids:
        return {
            "ok": False,
            "error": "Member chưa thuộc leader nào — không thể share conversation với leader. "
                     "Liên hệ admin để được thêm vào team.",
            "leader_ids": [],
        }

    # Bước 5: Bulk upsert — 1 request duy nhất dùng on_conflict theo unique key
    # Unique key trong DB: zalo_conv_perm_unique (account_id, conversation_id, shared_role)
    # → khi insert trùng, PostgREST merge-duplicates sẽ update các cột được liệt kê.
    #
    # SAFETY: dedup theo (account_id, conversation_id, shared_role) trước khi gửi.
    # Nếu có 2 row cùng key trong cùng batch, Postgres raise 21000
    # "cannot affect row a second time". Khi key bị trùng, ta GIỮ row cuối (thường
    # là row mới nhất trong target_leader_ids).
    upsert_rows: List[Dict[str, Any]] = []
    seen_keys: set = set()
    for leader_id in target_leader_ids:
        row = {
            "account_id": str(account_id),
            "conversation_id": str(conversation_id),
            "shared_role": shared_role,
            "is_active": True,
            "is_verify": False,
            "id_member": member_id,
            "id_leader": leader_id,
            "note": note,
            "updated_at": "now()",
        }
        key = (row["account_id"], row["conversation_id"], row["shared_role"])
        if key in seen_keys:
            logger.warning(
                "toggle_inbox_share: bỏ row trùng key trong batch: {} (leader={})",
                key, leader_id,
            )
            continue
        seen_keys.add(key)
        upsert_rows.append(row)

    if not upsert_rows:
        return {"ok": True, "rows": [], "is_active": True, "leader_ids": leader_ids}

    try:
        # Unique key mới (sau migration 005): (account_id, conversation_id, shared_role, id_leader)
        # Trước đây không có id_leader trong key → batch upsert fail với 21000
        # khi member thuộc 2+ leader (nhiều row cùng acc/conv/role).
        upsert_res = (
            supabase.table("zalo_module_conversation_permissions")
            .upsert(upsert_rows, on_conflict="account_id,conversation_id,shared_role,id_leader")
            .execute()
        )
        upserted = list(upsert_res.data or [])
    except Exception as exc:
        logger.exception("toggle_inbox_share bulk upsert failed")
        return {"ok": False, "error": f"Bulk upsert thất bại: {exc}"}

    # Bước 6: Deactivate các row orphan (id_leader không còn trong team hiện tại).
    # RPC đã được tối ưu bằng index nên thường <50ms. Nếu fail → log warning,
    # không fail request (share chính đã thành công từ bước 5).
    if shared_role == "leader" and leader_ids:
        try:
            supabase.rpc(
                "fn_deactivate_orphan_inbox_shares",
                {
                    "p_account_id": str(account_id),
                    "p_conversation_id": str(conversation_id),
                    "p_member_id": member_id,
                    "p_active_leader_ids": leader_ids,
                },
            ).execute()
        except Exception as exc:
            logger.warning(
                "fn_deactivate_orphan_inbox_shares RPC failed (không ảnh hưởng "
                "share chính): {}",
                exc,
            )

    _t_end = time.perf_counter()
    logger.info("toggle_inbox_share total: {:.0f}ms (member={}, leaders={})",
                (_t_end - _t0) * 1000, member_email, len(leader_ids))
    return {
        "ok": True,
        "rows": upserted,
        "is_active": True,
        "leader_ids": leader_ids,
    }


def list_shared_conversations_by_member(
    member_email: str,
    is_active: Optional[bool] = True,
) -> List[Dict[str, Any]]:
    """Liệt kê conversations mà member này đã share (default: chỉ is_active=true)."""
    supabase: Client = get_supabase_client()
    member_id = _resolve_user_id(supabase, member_email)
    if not member_id:
        return []

    q = (
        supabase.table("zalo_module_conversation_permissions")
        .select("id, account_id, conversation_id, shared_role, is_active, is_verify, is_lead, note, created_at, updated_at")
        .eq("id_member", member_id)
    )
    if is_active is not None:
        q = q.eq("is_active", bool(is_active))

    res = q.order("updated_at", desc=True).execute()
    return list(res.data or [])


def list_shared_conversations_for_leader(
    leader_email: str,
    member_email: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Liệt kê conversations mà leader này có quyền xem.

    Sau khi fix multi-leader: mỗi row share có ``id_leader`` được bind rõ ràng
    với 1 leader cụ thể. Leader chỉ thấy row có ``id_leader = leader_id của mình``.

    Nếu ``member_email`` được truyền, lọc thêm theo member cụ thể.
    Trả về list đã join tên member/account để FE hiển thị.
    """
    supabase: Client = get_supabase_client()
    user_res = supabase.table("app_users").select("id, role").eq("email", leader_email).limit(1).execute()
    if not user_res.data:
        return []
    
    leader_id = str(user_res.data[0]["id"])
    is_admin = user_res.data[0].get("role") in ["admin", "superadmin"]

    q = (
        supabase.table("zalo_module_conversation_permissions")
        .select(
            "id, account_id, conversation_id, shared_role, is_active, is_verify, is_lead, note, "
            "id_member, id_leader, verified_at, verified_by, created_at, updated_at, "
            "zalo_module_accounts!fk_zalo_conv_perm_account(label, phone)"
        )
        .eq("is_active", True)
        .eq("shared_role", "leader")
    )
    
    if not is_admin:
        q = q.eq("id_leader", leader_id)

    if member_email:
        member_id = _resolve_user_id(supabase, member_email)
        if member_id:
            q = q.eq("id_member", member_id)
        else:
            return []

    res = q.order("updated_at", desc=True).execute()
    items = list(res.data or [])
    
    if items:
        conv_ids = list({str(item["conversation_id"]) for item in items if item.get("conversation_id")})
        acc_ids = list({str(item["account_id"]) for item in items if item.get("account_id")})
        if conv_ids and acc_ids:
            try:
                groups_res = (
                    supabase.table("zalo_module_groups")
                    .select("user_id, group_id, group_name")
                    .in_("group_id", conv_ids)
                    .in_("user_id", acc_ids)
                    .execute()
                )
                group_map = {
                    f"{g['user_id']}_{g['group_id']}": g.get("group_name")
                    for g in (groups_res.data or [])
                    if g.get("group_name")
                }
                
                missing = [i for i in items if f"{i['account_id']}_{i['conversation_id']}" not in group_map]
                if missing:
                    for mi in missing:
                        msg_res = (
                            supabase.table("zalo_module_messages")
                            .select("group_name")
                            .eq("user_id", mi["account_id"])
                            .eq("group_id", mi["conversation_id"])
                            .not_.is_("group_name", "null")
                            .neq("group_name", "")
                            .order("created_at", desc=True)
                            .limit(1)
                            .execute()
                        )
                        if msg_res.data and msg_res.data[0].get("group_name"):
                            group_map[f"{mi['account_id']}_{mi['conversation_id']}"] = msg_res.data[0]["group_name"]
                            
                for item in items:
                    key = f"{item['account_id']}_{item['conversation_id']}"
                    item["group_name"] = group_map.get(key) or ""
            except Exception as exc:
                logger.warning(f"Could not load group_name for shared conversations: {exc}")
                
    return items


def verify_inbox_share(
    row_id: int,
    leader_email: str,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Leader xác minh 1 share conversation.

    Sau khi verify, share đó mới được tính vào kpi_inbox_current.
    Có thể revoke verify bằng cách gọi lại với note="__unverify__" (sentinel),
    hoặc dùng hàm ``unverify_inbox_share``.

    Returns:
        ``{ok: True, row: {...}}`` hoặc ``{ok: False, error: "..."}``.
    """
    supabase: Client = get_supabase_client()
    leader_id = _resolve_user_id(supabase, leader_email)
    if not leader_id:
        return {"ok": False, "error": f"Không tìm thấy user: {leader_email}"}

    payload: Dict[str, Any] = {
        "verified_at": "now()",
        "verified_by": leader_id,
        "is_verify": True,
        "updated_at": "now()",
    }
    if note is not None:
        payload["note"] = note

    try:
        res = (
            supabase.table("zalo_module_conversation_permissions")
            .update(payload)
            .eq("id", int(row_id))
            .execute()
        )
        if not res.data:
            return {"ok": False, "error": "Không tìm thấy share row"}
        return {"ok": True, "row": res.data[0]}
    except Exception as exc:
        logger.exception("verify_inbox_share failed")
        return {"ok": False, "error": str(exc)}


def unverify_inbox_share(row_id: int) -> Dict[str, Any]:
    """Leader thu hồi verify (set verified_at = NULL)."""
    supabase: Client = get_supabase_client()
    try:
        res = (
            supabase.table("zalo_module_conversation_permissions")
            .update({"verified_at": None, "verified_by": None, "is_verify": False, "updated_at": "now()"})
            .eq("id", int(row_id))
            .execute()
        )
        if not res.data:
            return {"ok": False, "error": "Không tìm thấy share row"}
        return {"ok": True, "row": res.data[0]}
    except Exception as exc:
        logger.exception("unverify_inbox_share failed")
        return {"ok": False, "error": str(exc)}


def toggle_lead_inbox_share(
    row_id: int,
    leader_email: str,
    is_lead: bool,
) -> Dict[str, Any]:
    """Leader đánh dấu 1 share conversation có tiềm năng (is_lead) hay không.
    
    Khi is_lead=True, conversation này sẽ được tính vào kpi_lead.
    """
    supabase: Client = get_supabase_client()
    leader_id = _resolve_user_id(supabase, leader_email)
    if not leader_id:
        return {"ok": False, "error": f"Không tìm thấy user: {leader_email}"}

    try:
        res = (
            supabase.table("zalo_module_conversation_permissions")
            .update({"is_lead": is_lead, "updated_at": "now()"})
            .eq("id", int(row_id))
            .execute()
        )
        if not res.data:
            return {"ok": False, "error": "Không tìm thấy share row"}
        return {"ok": True, "row": res.data[0]}
    except Exception as exc:
        logger.exception("toggle_lead_inbox_share failed")
        return {"ok": False, "error": str(exc)}


def count_verified_inbox_shares(
    member_email: str,
    start_dt: str,
    end_dt: str,
) -> Dict[str, Any]:
    """Đếm số share conversation đã được leader verify cho 1 member.

    Chỉ đếm các row:
        - id_member = member_id
        - shared_role = 'leader'
        - is_active = true
        - is_verify = true
        - updated_at nằm trong khoảng [start_dt, end_dt]

    Returns:
        ``{ok: True, count: int, items: [...]}``
    """
    supabase: Client = get_supabase_client()
    member_id = _resolve_user_id(supabase, member_email)
    if not member_id:
        return {"ok": False, "count": 0, "items": [], "error": f"Không tìm thấy user: {member_email}"}

    try:
        res = (
            supabase.table("zalo_module_conversation_permissions")
            .select(
                "id, account_id, conversation_id, is_verify, verified_at, updated_at, note, "
                "zalo_module_accounts!fk_zalo_conv_perm_account(label, phone)"
            )
            .eq("id_member", member_id)
            .eq("shared_role", "leader")
            .eq("is_active", True)
            .eq("is_verify", True)
            .not_.is_("verified_at", "null")
            .gte("updated_at", start_dt)
            .lte("updated_at", end_dt)
            .order("updated_at", desc=True)
            .execute()
        )
        items = list(res.data or [])
        return {"ok": True, "count": len(items), "items": items}
    except Exception as exc:
        logger.exception("count_verified_inbox_shares failed")
        return {"ok": False, "count": 0, "items": [], "error": str(exc)}


def bulk_sync_shares(
    member_email: str,
    shares: List[Dict[str, Any]],
    shared_role: str = "leader",
) -> Dict[str, Any]:
    """Sync hàng loạt: tiện cho FE gửi 1 lần list (account_id, conversation_id, is_active).

    Args:
        shares: list ``[{account_id, conversation_id, is_active, note?}, ...]``

    Returns:
        ``{ok: True, synced: int, failed: int, errors: [...]}``
    """
    supabase: Client = get_supabase_client()
    member_id = _resolve_user_id(supabase, member_email)
    if not member_id:
        return {"ok": False, "error": f"Không tìm thấy user: {member_email}"}

    synced = 0
    failed = 0
    errors: List[str] = []
    for item in shares or []:
        acc = item.get("account_id")
        conv = item.get("conversation_id")
        active = item.get("is_active", True)
        note = item.get("note")
        if not acc or not conv:
            failed += 1
            errors.append("account_id / conversation_id thiếu")
            continue
        result = toggle_inbox_share(
            account_id=str(acc),
            conversation_id=str(conv),
            member_email=member_email,
            shared_role=shared_role,
            is_active=bool(active),
            note=note,
        )
        if result.get("ok"):
            synced += 1
        else:
            failed += 1
            errors.append(result.get("error", "unknown"))

    return {"ok": True, "synced": synced, "failed": failed, "errors": errors}


def revoke_all_shares(account_id: str, member_email: str) -> Dict[str, Any]:
    """Hủy chia sẻ tất cả các cuộc hội thoại chưa được duyệt KPI của account_id."""
    supabase: Client = get_supabase_client()
    member_id = _resolve_user_id(supabase, member_email)
    if not member_id:
        return {"ok": False, "error": f"Không tìm thấy user: {member_email}"}

    try:
        # Cập nhật is_active = false cho toàn bộ các permission của account_id này mà chưa được verified
        res = (
            supabase.table("zalo_module_conversation_permissions")
            .update({"is_active": False})
            .eq("account_id", account_id)
            .eq("id_member", member_id)
            .is_("verified_at", "null") # chỉ hủy các hội thoại chưa được duyệt KPI
            .execute()
        )
        return {"ok": True, "count": len(res.data or [])}
    except Exception as exc:
        logger.exception("revoke_all_shares failed")
        return {"ok": False, "error": str(exc)}

