"""Dịch vụ tính KPI Inbox Zalo chuẩn hóa (2 chiều + Anti-Gaming 30 ngày + Post Feed Attribution).

Nghiệp vụ cốt lõi:
1. Tách riêng bảng KPI ``public.zalo_inbox_kpi`` khỏi bảng chia sẻ quyền ``zalo_conversation_permissions``.
2. Mặc định tính KPI theo **xác nhận 2 chiều** (khách đã trả lời / tương tác 2 chiều), vẫn hỗ trợ
   Leader/Admin xác nhận thủ công cho ca khách gọi/chốt ngoài Zalo.
3. Theo dõi nguồn hội thoại: ``post_feed_outbound`` (nhắn từ card Post Feed), ``post_feed_inbound``
   (khách nhắn vào có khớp link/SĐT từ Post Feed), ``direct_inbox`` (nhắn/nhận trực tiếp trên Zalo Inbox),
   ``legacy_verified`` (dữ liệu lịch sử đã duyệt trước khi nâng cấp).
4. **Khóa chống trùng 30 ngày**: mỗi ``(account_id, conversation_id)`` hoặc cùng ``phone_number`` chỉ
   được tính +1 KPI trong 30 ngày gần nhất; mọi tin nhắn nhắc/chăm sóc lại sau đó KHÔNG tạo KPI trùng
   và KHÔNG ghi đè ``confirmed_at`` hay ``id_member`` lịch sử.
5. Tự động loại trừ nhóm chat (``thread_type='group'`` / không phải chat 1-1) và tin nhắn tự động từ bot.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from supabase import Client

from app.core.phone import vn_phone_to_e164
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
ZALO_INBOX_KPI_LOCK_DAYS = 30

_POST_URL_REGEX = re.compile(
    r"https?://(?:www\.|m\.)?(?:facebook\.com|fb\.com|linkedin\.com|threads\.net|threads\.com|youtube\.com|youtu\.be)/[^\s<>\"']+",
    re.IGNORECASE,
)
_VN_PHONE_REGEX = re.compile(r"(?:\+?84|0)(?:[\s.\-]*\d){8,10}")


def normalize_phone_local(phone: Optional[str]) -> Optional[str]:
    """Chuẩn hóa SĐT VN về dạng local ``0xxxxxxxxx`` để làm khóa khử trùng đồng nhất."""
    if not phone:
        return None
    raw = str(phone).strip()
    if not raw:
        return None
    e164 = vn_phone_to_e164(raw)
    if e164 and e164.startswith("+84"):
        return "0" + e164[3:]
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("84") and len(digits) in (11, 12):
        digits = "0" + digits[2:]
    if 9 <= len(digits) <= 12:
        return digits
    return None


def phone_variants(phone: Optional[str]) -> List[str]:
    """Trả về tất cả biến thể phổ biến (`0...`, `+84...`) để truy vấn ``auto_seeding_comments`` & ``zalo_inbox_kpi``."""
    variants: List[str] = []
    local = normalize_phone_local(phone)
    e164 = vn_phone_to_e164(phone) if phone else None
    for candidate in (local, e164, str(phone).strip() if phone else None):
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants


def _is_missing_kpi_table_error(exc: Exception) -> bool:
    """Nhận diện lỗi chưa chạy migration 223 để fallback mượt sang legacy view/bảng cũ."""
    msg = str(exc).lower()
    return (
        "zalo_inbox_kpi" in msg
        or "42p01" in msg
        or "pgrst205" in msg
        or "does not exist" in msg
        or "could not find the table" in msg
    )


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now_utc().isoformat()


def _parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _vn_range_to_utc_bounds(start_date: Optional[str], end_date: Optional[str]) -> Tuple[str, str, str, str]:
    """Chuyển ``[start_date, end_date]`` theo ngày VN sang cửa sổ UTC ISO nửa mở ``[start_utc, end_utc)``."""
    today_vn = datetime.now(VN_TZ).date()
    monday = today_vn - timedelta(days=today_vn.weekday())
    sunday = monday + timedelta(days=6)
    s_str = (start_date or monday.isoformat())[:10]
    e_str = (end_date or sunday.isoformat())[:10]

    s_date = datetime.fromisoformat(s_str).date()
    e_date = datetime.fromisoformat(e_str).date()
    start_utc = datetime(s_date.year, s_date.month, s_date.day, tzinfo=VN_TZ).astimezone(timezone.utc)
    end_utc_exclusive = (
        datetime(e_date.year, e_date.month, e_date.day, tzinfo=VN_TZ) + timedelta(days=1)
    ).astimezone(timezone.utc)
    return s_str, e_str, start_utc.isoformat(), end_utc_exclusive.isoformat()


def _resolve_user_and_leader(supabase: Client, email: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Resolve ``(app_users.id, leader_id)`` từ email nhân viên."""
    clean = (email or "").strip().lower()
    if not clean:
        return None, None
    try:
        res = (
            supabase.table("app_users")
            .select("id")
            .eq("email", clean)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None, None
        member_id = str(res.data[0]["id"])
    except Exception as exc:
        logger.warning(f"[ZALO-KPI] Không resolve được user {clean}: {exc}")
        return None, None

    leader_id: Optional[str] = None
    try:
        m_res = (
            supabase.table("member_of_teams")
            .select("teams(id_leader)")
            .eq("id_member", member_id)
            .limit(1)
            .execute()
        )
        for row in (m_res.data or []):
            team = row.get("teams")
            if isinstance(team, dict) and team.get("id_leader"):
                leader_id = str(team["id_leader"])
                break
            if isinstance(team, list) and team and isinstance(team[0], dict) and team[0].get("id_leader"):
                leader_id = str(team[0]["id_leader"])
                break
    except Exception:
        pass
    return member_id, leader_id


def _is_group_conversation(supabase: Client, account_id: str, conversation_id: Optional[str]) -> bool:
    """Loại trừ nhóm chat Zalo: chỉ trả ``True`` nếu bản ghi ``zalo_groups`` xác định rõ là nhóm."""
    if not account_id or not conversation_id:
        return False
    try:
        res = (
            supabase.table("zalo_groups")
            .select("thread_type, is_friend")
            .eq("user_id", str(account_id))
            .eq("group_id", str(conversation_id))
            .limit(1)
            .execute()
        )
        if not res.data:
            return False
        row = res.data[0]
        thread_type = str(row.get("thread_type") or "").strip().lower()
        is_friend = bool(row.get("is_friend"))
        return thread_type == "group" and not is_friend
    except Exception:
        return False


def _conversation_has_customer_inbound(supabase: Client, account_id: str, conversation_id: Optional[str]) -> bool:
    """Kiểm tra trong ``zalo_messages`` xem khách đã từng gửi ít nhất 1 tin (`is_sent=False`) chưa."""
    if not account_id or not conversation_id:
        return False
    try:
        res = (
            supabase.table("zalo_messages")
            .select("message_id")
            .eq("user_id", str(account_id))
            .eq("group_id", str(conversation_id))
            .eq("is_sent", False)
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def _has_confirmed_within_lock(
    supabase: Client,
    account_id: str,
    conversation_id: Optional[str],
    phone_number: Optional[str],
    lock_days: int = ZALO_INBOX_KPI_LOCK_DAYS,
    exclude_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Trả về bản ghi ``zalo_inbox_kpi`` đã confirm trong vòng 30 ngày gần nhất nếu bị khóa chống trùng."""
    cutoff_iso = (_now_utc() - timedelta(days=lock_days)).isoformat()
    select_cols = "id, id_member, account_id, conversation_id, phone_number, direction_status, is_confirmed, is_lead, confirmed_at"

    if account_id and conversation_id:
        res = (
            supabase.table("zalo_inbox_kpi")
            .select(select_cols)
            .eq("account_id", str(account_id))
            .eq("conversation_id", str(conversation_id))
            .eq("is_confirmed", True)
            .gte("confirmed_at", cutoff_iso)
            .order("confirmed_at", desc=True)
            .limit(2)
            .execute()
        )
        for row in (res.data or []):
            if exclude_id is None or row.get("id") != exclude_id:
                return row

    p_variants = phone_variants(phone_number)
    if p_variants:
        res_phone = (
            supabase.table("zalo_inbox_kpi")
            .select(select_cols)
            .in_("phone_number", p_variants)
            .eq("is_confirmed", True)
            .gte("confirmed_at", cutoff_iso)
            .order("confirmed_at", desc=True)
            .limit(2)
            .execute()
        )
        for row in (res_phone.data or []):
            if exclude_id is None or row.get("id") != exclude_id:
                return row

    return None


def _find_pending_row(
    supabase: Client,
    account_id: str,
    conversation_id: Optional[str],
    phone_number: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Tìm bản ghi đang chờ xác nhận (``is_confirmed=False``) theo ``(account_id, conversation_id)`` hoặc SĐT."""
    if account_id and conversation_id:
        res = (
            supabase.table("zalo_inbox_kpi")
            .select("*")
            .eq("account_id", str(account_id))
            .eq("conversation_id", str(conversation_id))
            .eq("is_confirmed", False)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]

    p_variants = phone_variants(phone_number)
    if account_id and p_variants:
        res_phone = (
            supabase.table("zalo_inbox_kpi")
            .select("*")
            .eq("account_id", str(account_id))
            .in_("phone_number", p_variants)
            .eq("is_confirmed", False)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if res_phone.data:
            return res_phone.data[0]
    return None


def _match_post_feed_attribution(
    supabase: Client,
    conversation_id: Optional[str],
    phone_number: Optional[str],
    content: Optional[str],
) -> Dict[str, Optional[str]]:
    """Tự động khớp hội thoại Zalo với bài Post Feed qua ``zalo_conversation_id``, SĐT hoặc link bài trong tin nhắn."""
    found: Dict[str, Optional[str]] = {
        "source_platform": None,
        "source_post_id": None,
        "source_post_url": None,
        "phone_number": normalize_phone_local(phone_number),
    }

    # 1. Khớp theo zalo_conversation_id trong auto_seeding_comments
    if conversation_id:
        try:
            res = (
                supabase.table("auto_seeding_comments")
                .select("id_post_fb, id_post_li, phone_number, zalo_conversation_id")
                .eq("zalo_conversation_id", str(conversation_id))
                .order("zalo_sent_at", desc=True)
                .limit(1)
                .execute()
            )
            if res.data:
                r = res.data[0]
                if r.get("id_post_fb"):
                    found["source_platform"] = "facebook"
                    found["source_post_id"] = str(r["id_post_fb"])
                elif r.get("id_post_li"):
                    found["source_platform"] = "linkedin"
                    found["source_post_id"] = str(r["id_post_li"])
                if not found["phone_number"] and r.get("phone_number"):
                    found["phone_number"] = normalize_phone_local(r.get("phone_number"))
                return found
        except Exception:
            pass

    # 2. Khớp theo SĐT trong auto_seeding_comments (trích từ sender_phone hoặc nội dung tin nhắn)
    candidate_phone = found["phone_number"]
    if not candidate_phone and content:
        m_phone = _VN_PHONE_REGEX.search(content)
        if m_phone:
            candidate_phone = normalize_phone_local(m_phone.group(0))
            if candidate_phone:
                found["phone_number"] = candidate_phone

    for p_var in phone_variants(candidate_phone):
        try:
            res = (
                supabase.table("auto_seeding_comments")
                .select("id_post_fb, id_post_li, phone_number")
                .eq("phone_number", p_var)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if res.data:
                r = res.data[0]
                if r.get("id_post_fb"):
                    found["source_platform"] = "facebook"
                    found["source_post_id"] = str(r["id_post_fb"])
                elif r.get("id_post_li"):
                    found["source_platform"] = "linkedin"
                    found["source_post_id"] = str(r["id_post_li"])
                return found
        except Exception:
            continue

    # 3. Khớp theo link bài viết mạng xã hội khách gửi trong tin nhắn
    if content:
        m_url = _POST_URL_REGEX.search(content)
        if m_url:
            url = m_url.group(0).rstrip(".,);/")
            found["source_post_url"] = url
            lower_u = url.lower()
            if "facebook.com" in lower_u or "fb.com" in lower_u:
                found["source_platform"] = "facebook"
            elif "linkedin.com" in lower_u:
                found["source_platform"] = "linkedin"
            elif "threads." in lower_u:
                found["source_platform"] = "threads"
            elif "youtube." in lower_u or "youtu.be" in lower_u:
                found["source_platform"] = "youtube"

            # Lookup bài gốc trên DB theo post_url (lấy đoạn slug sạch không gồm ?query hay / cuối)
            clean_slug = url.split("?")[0].rstrip("/")[-40:]
            table_map = {
                "facebook": ("facebook_posts", "id"),
                "linkedin": ("linkedin_posts", "id"),
                "threads": ("threads_posts", "id"),
                "youtube": ("youtube_posts", "id"),
            }
            target = table_map.get(found["source_platform"] or "")
            if target and clean_slug:
                tbl, id_col = target
                try:
                    p_res = (
                        supabase.table(tbl)
                        .select(f"{id_col}, post_url")
                        .ilike("post_url", f"%{clean_slug}%")
                        .limit(1)
                        .execute()
                    )
                    if p_res.data:
                        found["source_post_id"] = str(p_res.data[0][id_col])
                        found["source_post_url"] = p_res.data[0].get("post_url") or url
                except Exception:
                    pass

    return found


def record_post_feed_outbound(
    *,
    account_id: str,
    conversation_id: Optional[str] = None,
    phone_number: Optional[str] = None,
    sender_email: Optional[str] = None,
    source_platform: Optional[str] = None,
    source_post_id: Optional[str] = None,
    source_post_url: Optional[str] = None,
    sent_at: Optional[str] = None,
    is_system_auto: bool = False,
    note: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Ghi nhận khi nhân viên (hoặc hệ thống auto-seeding) gửi tin Zalo khởi tạo từ card Post Feed."""
    sb = supabase or get_supabase_client()
    norm_acc = (account_id or "").strip()
    norm_conv = (conversation_id or "").strip() or None
    norm_phone = normalize_phone_local(phone_number)
    now_iso = sent_at or _now_iso()

    if not norm_acc:
        return {"status": "skipped_no_account", "is_confirmed": False}

    try:
        if norm_conv and _is_group_conversation(sb, norm_acc, norm_conv):
            return {"status": "ignored_group", "is_confirmed": False}

        locked = _has_confirmed_within_lock(sb, norm_acc, norm_conv, norm_phone)
        if locked:
            return {
                "status": "locked_30d",
                "direction_status": "locked_30d",
                "is_confirmed": False,
                "locked_row": locked,
            }

        member_id, leader_id = (None, None) if is_system_auto else _resolve_user_and_leader(sb, sender_email)
        pending = _find_pending_row(sb, norm_acc, norm_conv, norm_phone)

        # Kiểm tra xem khách đã nhắn vào hội thoại trước đó hay chưa
        has_inbound = bool(pending and pending.get("first_customer_msg_at")) or _conversation_has_customer_inbound(sb, norm_acc, norm_conv)
        should_confirm = bool(has_inbound and not is_system_auto and member_id)

        payload_updates: Dict[str, Any] = {
            "source_type": "post_feed_outbound",
            "updated_at": now_iso,
        }
        if norm_conv:
            payload_updates["conversation_id"] = norm_conv
        if norm_phone:
            payload_updates["phone_number"] = norm_phone
        if source_platform:
            payload_updates["source_platform"] = source_platform
        if source_post_id:
            payload_updates["source_post_id"] = source_post_id
        if source_post_url:
            payload_updates["source_post_url"] = source_post_url
        if note:
            payload_updates["note"] = note

        if pending:
            if not pending.get("id_member") and member_id:
                payload_updates["id_member"] = member_id
            if not pending.get("id_leader") and leader_id:
                payload_updates["id_leader"] = leader_id
            if not pending.get("first_outbound_at"):
                payload_updates["first_outbound_at"] = now_iso
            if should_confirm:
                payload_updates["direction_status"] = "two_way"
                payload_updates["is_confirmed"] = True
                payload_updates["confirmed_at"] = now_iso
                if not pending.get("first_staff_reply_at"):
                    payload_updates["first_staff_reply_at"] = now_iso

            upd_res = (
                sb.table("zalo_inbox_kpi")
                .update(payload_updates)
                .eq("id", pending["id"])
                .execute()
            )
            row = (upd_res.data or [pending])[0]
            return {
                "status": "auto_confirmed_two_way" if should_confirm else "outbound_waiting",
                "direction_status": row.get("direction_status", "outbound_sent"),
                "is_confirmed": bool(row.get("is_confirmed")),
                "row": row,
            }

        insert_row: Dict[str, Any] = {
            "id_member": member_id,
            "id_leader": leader_id,
            "account_id": norm_acc,
            "conversation_id": norm_conv,
            "phone_number": norm_phone,
            "source_type": "post_feed_outbound",
            "source_platform": source_platform,
            "source_post_id": source_post_id,
            "source_post_url": source_post_url,
            "direction_status": "two_way" if should_confirm else "outbound_sent",
            "is_confirmed": should_confirm,
            "is_lead": False,
            "first_outbound_at": now_iso,
            "first_staff_reply_at": now_iso if should_confirm else None,
            "confirmed_at": now_iso if should_confirm else None,
            "note": note,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        ins_res = sb.table("zalo_inbox_kpi").insert(insert_row).execute()
        row = (ins_res.data or [insert_row])[0]
        return {
            "status": "auto_confirmed_two_way" if should_confirm else "outbound_waiting",
            "direction_status": row.get("direction_status", "outbound_sent"),
            "is_confirmed": bool(row.get("is_confirmed")),
            "row": row,
        }
    except Exception as exc:
        if _is_missing_kpi_table_error(exc):
            logger.info(f"[ZALO-KPI] Bảng zalo_inbox_kpi chưa sẵn sàng, bỏ qua record_post_feed_outbound: {exc}")
            return {"status": "table_not_ready", "is_confirmed": False}
        logger.warning(f"[ZALO-KPI] record_post_feed_outbound error: {exc}")
        return {"status": "error", "is_confirmed": False, "error": str(exc)}


def on_customer_inbound_message(
    *,
    account_id: str,
    conversation_id: str,
    content: Optional[str] = None,
    sender_phone: Optional[str] = None,
    received_at: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Xử lý khi ZCA persistent listener nhận tin nhắn mới từ khách (`is_sent=False`)."""
    sb = supabase or get_supabase_client()
    norm_acc = (account_id or "").strip()
    norm_conv = (conversation_id or "").strip()
    if not norm_acc or not norm_conv:
        return {"status": "skipped", "is_confirmed": False}

    now_iso = received_at or _now_iso()

    try:
        if _is_group_conversation(sb, norm_acc, norm_conv):
            return {"status": "ignored_group", "is_confirmed": False}

        matched = _match_post_feed_attribution(sb, norm_conv, sender_phone, content)
        norm_phone = matched.get("phone_number") or normalize_phone_local(sender_phone)

        # Kiểm tra khóa chống trùng 30 ngày trước khi tác động KPI
        locked = _has_confirmed_within_lock(sb, norm_acc, norm_conv, norm_phone)
        if locked:
            return {
                "status": "locked_30d",
                "direction_status": "locked_30d",
                "is_confirmed": True,
                "locked_row": locked,
            }

        pending = _find_pending_row(sb, norm_acc, norm_conv, norm_phone)
        if pending:
            # Nếu đã có bản ghi đang chờ khách rep (outbound_sent) -> mở khóa hoặc chuyển inbound_pending nếu tin mở đầu do hệ thống auto-seeding gửi
            updates: Dict[str, Any] = {
                "updated_at": now_iso,
            }
            if not pending.get("first_customer_msg_at"):
                updates["first_customer_msg_at"] = now_iso
            if norm_phone and not pending.get("phone_number"):
                updates["phone_number"] = norm_phone
            if matched.get("source_post_id") and not pending.get("source_post_id"):
                updates["source_post_id"] = matched["source_post_id"]
                updates["source_platform"] = matched.get("source_platform")

            has_human_owner = bool(pending.get("id_member"))
            if has_human_owner and pending.get("direction_status") == "outbound_sent":
                updates["direction_status"] = "two_way"
                updates["is_confirmed"] = True
                updates["confirmed_at"] = now_iso
                upd_res = sb.table("zalo_inbox_kpi").update(updates).eq("id", pending["id"]).execute()
                row = (upd_res.data or [pending])[0]
                return {"status": "auto_confirmed_two_way", "is_confirmed": True, "row": row}

            # Nếu opener là hệ thống auto-seeding (id_member IS NULL) -> chuyển inbound_pending đợi nhân viên vào trả lời tiếp
            if pending.get("direction_status") == "outbound_sent":
                updates["direction_status"] = "inbound_pending"
            sb.table("zalo_inbox_kpi").update(updates).eq("id", pending["id"]).execute()
            return {"status": "inbound_pending", "is_confirmed": False}

        # Tạo bản ghi inbound_pending mới (ưu tiên tag nguồn Post Feed nếu tự khớp được)
        source_type = "post_feed_inbound" if (matched.get("source_post_id") or matched.get("source_post_url")) else "direct_inbox"
        insert_row = {
            "id_member": None,
            "id_leader": None,
            "account_id": norm_acc,
            "conversation_id": norm_conv,
            "phone_number": norm_phone,
            "source_type": source_type,
            "source_platform": matched.get("source_platform"),
            "source_post_id": matched.get("source_post_id"),
            "source_post_url": matched.get("source_post_url"),
            "direction_status": "inbound_pending",
            "is_confirmed": False,
            "is_lead": False,
            "first_customer_msg_at": now_iso,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        ins_res = sb.table("zalo_inbox_kpi").insert(insert_row).execute()
        return {
            "status": "inbound_pending",
            "source_type": source_type,
            "is_confirmed": False,
            "row": (ins_res.data or [insert_row])[0],
        }
    except Exception as exc:
        if _is_missing_kpi_table_error(exc):
            return {"status": "table_not_ready", "is_confirmed": False}
        logger.warning(f"[ZALO-KPI] on_customer_inbound_message error: {exc}")
        return {"status": "error", "is_confirmed": False, "error": str(exc)}


def on_staff_reply_message(
    *,
    account_id: str,
    conversation_id: str,
    caller_email: Optional[str],
    replied_at: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Xử lý khi nhân viên thật gửi tin/media trên Zalo Inbox -> xác nhận 2 chiều nếu khách đã nhắn trước đó."""
    sb = supabase or get_supabase_client()
    norm_acc = (account_id or "").strip()
    norm_conv = (conversation_id or "").strip()
    clean_email = (caller_email or "").strip().lower()

    if not norm_acc or not norm_conv or not clean_email:
        return {"status": "skipped", "is_confirmed": False}

    now_iso = replied_at or _now_iso()

    try:
        if _is_group_conversation(sb, norm_acc, norm_conv):
            return {"status": "ignored_group", "is_confirmed": False}

        member_id, leader_id = _resolve_user_and_leader(sb, clean_email)
        if not member_id:
            return {"status": "unknown_caller", "is_confirmed": False}

        matched = _match_post_feed_attribution(sb, norm_conv, None, None)
        norm_phone = matched.get("phone_number")

        # Anti-repeat gaming: nếu conv hoặc SĐT đã confirm trong 30 ngày -> tuyệt đối không sửa lịch sử
        locked = _has_confirmed_within_lock(sb, norm_acc, norm_conv, norm_phone)
        if locked:
            return {
                "status": "locked_30d",
                "direction_status": "locked_30d",
                "is_confirmed": True,
                "locked_row": locked,
            }

        pending = _find_pending_row(sb, norm_acc, norm_conv, norm_phone)
        has_inbound = bool(pending and pending.get("first_customer_msg_at")) or _conversation_has_customer_inbound(sb, norm_acc, norm_conv)

        if pending:
            updates: Dict[str, Any] = {
                "updated_at": now_iso,
            }
            if not pending.get("id_member"):
                updates["id_member"] = member_id
            if not pending.get("id_leader") and leader_id:
                updates["id_leader"] = leader_id
            if not pending.get("first_staff_reply_at"):
                updates["first_staff_reply_at"] = now_iso
            if norm_phone and not pending.get("phone_number"):
                updates["phone_number"] = norm_phone
            if matched.get("source_post_id") and not pending.get("source_post_id"):
                updates["source_post_id"] = matched["source_post_id"]
                updates["source_platform"] = matched.get("source_platform")

            if has_inbound:
                updates["direction_status"] = "two_way" if pending.get("first_outbound_at") else "inbound_replied"
                updates["is_confirmed"] = True
                updates["confirmed_at"] = now_iso
            else:
                if not pending.get("first_outbound_at"):
                    updates["first_outbound_at"] = now_iso
                updates["direction_status"] = "outbound_sent"

            upd_res = sb.table("zalo_inbox_kpi").update(updates).eq("id", pending["id"]).execute()
            row = (upd_res.data or [pending])[0]
            return {
                "status": "confirmed" if has_inbound else "outbound_waiting",
                "direction_status": row.get("direction_status"),
                "is_confirmed": bool(row.get("is_confirmed")),
                "row": row,
            }

        source_type = "post_feed_outbound" if matched.get("source_post_id") else "direct_inbox"
        insert_row = {
            "id_member": member_id,
            "id_leader": leader_id,
            "account_id": norm_acc,
            "conversation_id": norm_conv,
            "phone_number": norm_phone,
            "source_type": source_type,
            "source_platform": matched.get("source_platform"),
            "source_post_id": matched.get("source_post_id"),
            "source_post_url": matched.get("source_post_url"),
            "direction_status": "inbound_replied" if has_inbound else "outbound_sent",
            "is_confirmed": has_inbound,
            "is_lead": False,
            "first_outbound_at": None if has_inbound else now_iso,
            "first_staff_reply_at": now_iso,
            "confirmed_at": now_iso if has_inbound else None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        ins_res = sb.table("zalo_inbox_kpi").insert(insert_row).execute()
        row = (ins_res.data or [insert_row])[0]
        return {
            "status": "confirmed" if has_inbound else "outbound_waiting",
            "direction_status": row.get("direction_status"),
            "is_confirmed": bool(row.get("is_confirmed")),
            "row": row,
        }
    except Exception as exc:
        if _is_missing_kpi_table_error(exc):
            return {"status": "table_not_ready", "is_confirmed": False}
        logger.warning(f"[ZALO-KPI] on_staff_reply_message error: {exc}")
        return {"status": "error", "is_confirmed": False, "error": str(exc)}


def manual_verify_conversation(
    *,
    account_id: str,
    conversation_id: str,
    verifier_email: str,
    member_email: Optional[str] = None,
    member_id: Optional[str] = None,
    is_confirmed: bool = True,
    is_lead: Optional[bool] = None,
    note: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Leader/Admin duyệt hoặc hủy KPI thủ công / gắn Lead cho hội thoại Zalo (tôn trọng khóa 30 ngày)."""
    sb = supabase or get_supabase_client()
    norm_acc = (account_id or "").strip()
    norm_conv = (conversation_id or "").strip()
    if not norm_acc or not norm_conv:
        return {"ok": False, "error": "Thiếu account_id hoặc conversation_id"}

    now_iso = _now_iso()
    verifier_id, _ = _resolve_user_and_leader(sb, verifier_email)
    if member_email:
        target_member_id, target_leader_id = _resolve_user_and_leader(sb, member_email)
    elif member_id:
        target_member_id, target_leader_id = str(member_id), verifier_id
    else:
        target_member_id, target_leader_id = verifier_id, verifier_id

    try:
        existing_res = (
            sb.table("zalo_inbox_kpi")
            .select("*")
            .eq("account_id", norm_acc)
            .eq("conversation_id", norm_conv)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        existing = existing_res.data[0] if existing_res.data else None

        if is_confirmed:
            matched = _match_post_feed_attribution(sb, norm_conv, existing.get("phone_number") if existing else None, None)
            norm_phone = matched.get("phone_number")
            locked = _has_confirmed_within_lock(
                sb,
                norm_acc,
                norm_conv,
                norm_phone,
                exclude_id=existing.get("id") if existing else None,
            )
            if locked:
                return {
                    "ok": False,
                    "status": "locked_30d",
                    "error": "Hội thoại hoặc SĐT này đã được tính KPI trong 30 ngày gần nhất.",
                    "locked_row": locked,
                }

            if existing:
                updates: Dict[str, Any] = {
                    "is_confirmed": True,
                    "verified_by": verifier_id,
                    "updated_at": now_iso,
                }
                if not existing.get("confirmed_at"):
                    updates["confirmed_at"] = now_iso
                if not existing.get("is_confirmed"):
                    updates["direction_status"] = "manual_verified"
                if not existing.get("id_member") and target_member_id:
                    updates["id_member"] = target_member_id
                if not existing.get("id_leader") and target_leader_id:
                    updates["id_leader"] = target_leader_id
                if is_lead is not None:
                    updates["is_lead"] = bool(is_lead)
                if note is not None:
                    updates["note"] = note
                res = sb.table("zalo_inbox_kpi").update(updates).eq("id", existing["id"]).execute()
                return {"ok": True, "row": (res.data or [existing])[0]}

            insert_row = {
                "id_member": target_member_id,
                "id_leader": target_leader_id,
                "account_id": norm_acc,
                "conversation_id": norm_conv,
                "phone_number": norm_phone,
                "source_type": "post_feed_outbound" if matched.get("source_post_id") else "direct_inbox",
                "source_platform": matched.get("source_platform"),
                "source_post_id": matched.get("source_post_id"),
                "source_post_url": matched.get("source_post_url"),
                "direction_status": "manual_verified",
                "is_confirmed": True,
                "is_lead": bool(is_lead) if is_lead is not None else False,
                "confirmed_at": now_iso,
                "verified_by": verifier_id,
                "note": note,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            res = sb.table("zalo_inbox_kpi").insert(insert_row).execute()
            return {"ok": True, "row": (res.data or [insert_row])[0]}

        # Thu hồi verify (is_confirmed=False)
        if not existing:
            return {"ok": True, "row": None}
        updates_unverify: Dict[str, Any] = {
            "is_confirmed": False,
            "confirmed_at": None,
            "verified_by": None,
            "direction_status": "outbound_sent" if existing.get("first_outbound_at") else "inbound_pending",
            "updated_at": now_iso,
        }
        if is_lead is not None:
            updates_unverify["is_lead"] = bool(is_lead)
        if note is not None:
            updates_unverify["note"] = note
        res = sb.table("zalo_inbox_kpi").update(updates_unverify).eq("id", existing["id"]).execute()
        return {"ok": True, "row": (res.data or [existing])[0]}
    except Exception as exc:
        if _is_missing_kpi_table_error(exc):
            return {"ok": False, "status": "table_not_ready", "error": "Bảng zalo_inbox_kpi chưa được tạo."}
        logger.warning(f"[ZALO-KPI] manual_verify_conversation error: {exc}")
        return {"ok": False, "error": str(exc)}


def compute_zalo_kpi_counts(
    member_ids: Iterable[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    *,
    supabase: Optional[Client] = None,
) -> Dict[str, Dict[str, int]]:
    """Đếm ``inbox_confirmed``, ``lead_confirmed`` và ``waiting_reply`` từ ``zalo_inbox_kpi`` theo khung tuần VN.

    Nếu DB chưa chạy migration 223, tự động fallback về ``zalo_conversation_permissions`` để không gián đoạn.
    """
    sb = supabase or get_supabase_client()
    mids = [str(m).strip() for m in member_ids if m]
    counts: Dict[str, Dict[str, int]] = {
        mid: {"inbox": 0, "lead": 0, "waiting": 0}
        for mid in mids
    }
    if not mids:
        return counts

    _, _, start_utc, end_utc = _vn_range_to_utc_bounds(start_date, end_date)

    try:
        res_conf = (
            sb.table("zalo_inbox_kpi")
            .select("id_member, is_lead, confirmed_at")
            .in_("id_member", mids)
            .eq("is_confirmed", True)
            .gte("confirmed_at", start_utc)
            .lt("confirmed_at", end_utc)
            .execute()
        )
        for r in (res_conf.data or []):
            mid = str(r.get("id_member") or "")
            if mid not in counts:
                continue
            counts[mid]["inbox"] += 1
            if r.get("is_lead"):
                counts[mid]["lead"] += 1

        res_wait = (
            sb.table("zalo_inbox_kpi")
            .select("id_member, created_at")
            .in_("id_member", mids)
            .eq("is_confirmed", False)
            .gte("created_at", start_utc)
            .lt("created_at", end_utc)
            .execute()
        )
        for r in (res_wait.data or []):
            mid = str(r.get("id_member") or "")
            if mid in counts:
                counts[mid]["waiting"] += 1
        return counts
    except Exception as exc:
        if not _is_missing_kpi_table_error(exc):
            logger.warning(f"[ZALO-KPI] compute_zalo_kpi_counts error: {exc}")
            return counts

    # Fallback tương thích ngược trước khi DB chạy migration 223
    try:
        res_legacy = (
            sb.table("zalo_conversation_permissions")
            .select("id_member, is_lead, verified_at")
            .in_("id_member", mids)
            .eq("shared_role", "leader")
            .eq("is_active", True)
            .eq("is_verify", True)
            .gte("verified_at", start_utc)
            .lt("verified_at", end_utc)
            .execute()
        )
        for r in (res_legacy.data or []):
            mid = str(r.get("id_member") or "")
            if mid not in counts:
                continue
            counts[mid]["inbox"] += 1
            if r.get("is_lead"):
                counts[mid]["lead"] += 1
    except Exception as exc_legacy:
        logger.warning(f"[ZALO-KPI] legacy fallback failed: {exc_legacy}")

    return counts


def get_zalo_kpi_status_by_conversations(
    account_id: str,
    conversation_ids: Iterable[str],
    *,
    supabase: Optional[Client] = None,
) -> Dict[str, Dict[str, Any]]:
    """Trả map ``conversation_id -> metadata nguồn/KPI`` để gắn badge trên danh sách hội thoại Zalo."""
    sb = supabase or get_supabase_client()
    cids = [str(c).strip() for c in conversation_ids if c]
    if not account_id or not cids:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    try:
        for i in range(0, len(cids), 100):
            batch = cids[i:i + 100]
            res = (
                sb.table("zalo_inbox_kpi")
                .select(
                    "id, conversation_id, id_member, phone_number, source_type, source_platform, "
                    "source_post_id, source_post_url, direction_status, is_confirmed, is_lead, "
                    "confirmed_at, created_at"
                )
                .eq("account_id", str(account_id))
                .in_("conversation_id", batch)
                .order("created_at", desc=True)
                .execute()
            )
            for row in (res.data or []):
                cid = str(row.get("conversation_id") or "")
                if cid and cid not in out:
                    out[cid] = row
    except Exception as exc:
        if not _is_missing_kpi_table_error(exc):
            logger.warning(f"[ZALO-KPI] get_zalo_kpi_status_by_conversations error: {exc}")
    return out


def list_member_zalo_inbox_kpi(
    *,
    member_email: Optional[str] = None,
    account_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    supabase: Optional[Client] = None,
) -> List[Dict[str, Any]]:
    """Liệt kê chi tiết các hội thoại trong bảng ``zalo_inbox_kpi`` theo bộ lọc."""
    sb = supabase or get_supabase_client()
    _, _, start_utc, end_utc = _vn_range_to_utc_bounds(start_date, end_date)
    try:
        query = (
            sb.table("zalo_inbox_kpi")
            .select("*")
            .gte("created_at", start_utc)
            .lt("created_at", end_utc)
            .order("updated_at", desc=True)
            .limit(max(1, min(limit, 500)))
        )
        if member_email:
            member_id, _ = _resolve_user_and_leader(sb, member_email)
            if not member_id:
                return []
            query = query.eq("id_member", member_id)
        if account_id:
            query = query.eq("account_id", str(account_id))
        if status_filter == "confirmed":
            query = query.eq("is_confirmed", True)
        elif status_filter == "waiting":
            query = query.eq("is_confirmed", False)
        res = query.execute()
        return list(res.data or [])
    except Exception as exc:
        if not _is_missing_kpi_table_error(exc):
            logger.warning(f"[ZALO-KPI] list_member_zalo_inbox_kpi error: {exc}")
        return []


def _status_label_from_kpi_row(row: Dict[str, Any]) -> str:
    if row.get("is_confirmed"):
        return "confirmed"
    direction = str(row.get("direction_status") or "")
    if direction == "inbound_pending":
        return "inbound_pending"
    return "waiting_reply"


def enrich_posts_with_zalo_kpi(
    sb: Client,
    posts: List[Dict[str, Any]],
) -> None:
    """Gắn trạng thái KPI Zalo (``zalo_kpi_status``, ``zalo_kpi_direction``, ``zalo_kpi_confirmed_at``, ...) lên danh sách bài Post Feed."""
    if not posts:
        return

    post_ids = [str(p["id"]) for p in posts if p.get("id")]
    all_phones: List[str] = []
    for p in posts:
        raw_phone = (p.get("auto_seeding_comment") or {}).get("phone_number") or p.get("phone_number")
        for v in phone_variants(raw_phone):
            if v not in all_phones:
                all_phones.append(v)

    by_post_id: Dict[str, Dict[str, Any]] = {}
    by_phone: Dict[str, Dict[str, Any]] = {}

    def _merge_best(target_map: Dict[str, Dict[str, Any]], key: str, row: Dict[str, Any]) -> None:
        prev = target_map.get(key)
        if not prev:
            target_map[key] = row
            return
        # Ưu tiên bản ghi đã confirm mới nhất
        if row.get("is_confirmed") and not prev.get("is_confirmed"):
            target_map[key] = row

    try:
        cols = "source_post_id, phone_number, source_type, direction_status, is_confirmed, is_lead, confirmed_at, updated_at"
        for i in range(0, len(post_ids), 25):
            batch_ids = post_ids[i:i + 25]
            res = (
                sb.table("zalo_inbox_kpi")
                .select(cols)
                .in_("source_post_id", batch_ids)
                .order("updated_at", desc=True)
                .execute()
            )
            for row in (res.data or []):
                pid = row.get("source_post_id")
                if pid:
                    _merge_best(by_post_id, str(pid), row)

        for i in range(0, len(all_phones), 25):
            batch_phones = all_phones[i:i + 25]
            res_p = (
                sb.table("zalo_inbox_kpi")
                .select(cols)
                .in_("phone_number", batch_phones)
                .order("updated_at", desc=True)
                .execute()
            )
            for row in (res_p.data or []):
                loc = normalize_phone_local(row.get("phone_number"))
                if loc:
                    _merge_best(by_phone, loc, row)
    except Exception as exc:
        if not _is_missing_kpi_table_error(exc):
            logger.warning(f"[ZALO-KPI] enrich_posts_with_zalo_kpi error: {exc}")
        return

    cutoff_30d = _now_utc() - timedelta(days=ZALO_INBOX_KPI_LOCK_DAYS)
    for p in posts:
        pid = str(p.get("id") or "")
        raw_phone = (p.get("auto_seeding_comment") or {}).get("phone_number") or p.get("phone_number")
        loc_phone = normalize_phone_local(raw_phone)
        row = by_post_id.get(pid) or (by_phone.get(loc_phone) if loc_phone else None)
        if not row:
            continue

        # Nếu match qua SĐT khác bài viết và đã confirm trong 30 ngày -> gắn trạng thái locked_30d nếu bài hiện tại chưa trực tiếp sở hữu record
        status = _status_label_from_kpi_row(row)
        if (
            pid not in by_post_id
            and status == "confirmed"
            and row.get("source_post_id")
            and str(row.get("source_post_id")) != pid
        ):
            c_dt = _parse_iso_dt(row.get("confirmed_at"))
            if c_dt and c_dt >= cutoff_30d:
                status = "locked_30d"

        p["zalo_kpi_status"] = status
        p["zalo_kpi_direction"] = row.get("direction_status")
        p["zalo_kpi_confirmed_at"] = row.get("confirmed_at")
        p["zalo_kpi_is_lead"] = bool(row.get("is_lead"))
        if isinstance(p.get("auto_seeding_comment"), dict):
            p["auto_seeding_comment"]["zalo_kpi_status"] = status
            p["auto_seeding_comment"]["zalo_kpi_direction"] = row.get("direction_status")
            p["auto_seeding_comment"]["zalo_kpi_confirmed_at"] = row.get("confirmed_at")
            p["auto_seeding_comment"]["zalo_kpi_is_lead"] = bool(row.get("is_lead"))
