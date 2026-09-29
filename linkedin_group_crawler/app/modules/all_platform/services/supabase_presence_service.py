"""Theo dõi thời gian online của thành viên (member_online_minutes) — xem docstring
migration 156_member_online_minutes.sql cho cơ chế heartbeat-theo-phút."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import Client

from app.core.supabase_client import get_supabase_client

_VN_TZ = timezone(timedelta(hours=7))
# Heartbeat gửi mỗi ~45s (xem AppAuthContext.tsx) — quá 2.5 lần khoảng đó không nhận
# heartbeat mới thì coi là đã rời (đóng tab/mất mạng), không phải "vẫn đang online".
_ONLINE_STALE_SECONDS = 120


def _get_member_id(email: str) -> Optional[str]:
    sb: Client = get_supabase_client()
    res = sb.table("app_users").select("id").eq("email", (email or "").strip().lower()).limit(1).execute()
    return res.data[0]["id"] if res.data else None


def record_heartbeat(email: str) -> dict:
    """Ghi nhận 1 heartbeat — upsert đúng 1 dòng cho phút hiện tại (giờ UTC, không quan
    trọng timezone vì chỉ dùng COUNT DISTINCT, không hiển thị trực tiếp minute_bucket)."""
    sb: Client = get_supabase_client()
    id_member = _get_member_id(email)
    if not id_member:
        return {"recorded": False}

    now = datetime.now(timezone.utc)
    minute_bucket = now.replace(second=0, microsecond=0)
    try:
        sb.table("member_online_minutes").upsert(
            {"id_member": id_member, "minute_bucket": minute_bucket.isoformat()},
            on_conflict="id_member,minute_bucket",
        ).execute()
    except Exception:
        # Best-effort — heartbeat KHONG duoc phep lam vo trang neu insert loi/trung tam thoi.
        pass
    return {"recorded": True}


def _resolve_scope(email: str) -> tuple[str, list[str]]:
    """Trả về (role, member_ids_được_xem) — admin: None nghĩa 'tất cả' (rỗng đặc biệt xử lý
    riêng ở caller), leader: chỉ members team mình quản lý, member: chặn (rỗng)."""
    sb: Client = get_supabase_client()
    user_res = sb.table("app_users").select("id, role").eq("email", (email or "").strip().lower()).limit(1).execute()
    if not user_res.data:
        return "member", []
    caller_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")

    if role not in ("admin", "leader"):
        return role, []

    if role == "admin":
        users_res = sb.table("app_users").select("id").eq("is_active", True).execute()
        return role, [u["id"] for u in (users_res.data or [])]

    teams_res = sb.table("teams").select("id").eq("id_leader", caller_id).execute()
    team_ids = [t["id"] for t in (teams_res.data or [])]
    if not team_ids:
        return role, []
    mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
    member_ids = list({m["id_member"] for m in (mot_res.data or []) if m.get("id_member")})
    if caller_id not in member_ids:
        member_ids.append(caller_id)
    return role, member_ids


def get_online_summary(email: str) -> dict:
    """"Thời gian online" cho Dashboard leader — admin thấy mọi thành viên đang hoạt
    động (is_active), leader chỉ thấy team mình quản lý. Trả số phút online hôm nay/
    tuần này/tháng này (giờ VN) cho mỗi người, kèm trạng thái đang online ngay lúc này."""
    sb: Client = get_supabase_client()
    role, member_ids = _resolve_scope(email)
    if role not in ("admin", "leader") or not member_ids:
        return {"role": role, "members": []}

    now_vn = datetime.now(_VN_TZ)
    today_start = now_vn.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)
    month_start_utc = month_start.astimezone(timezone.utc)

    rows = (
        sb.table("member_online_minutes")
        .select("id_member, minute_bucket")
        .in_("id_member", member_ids)
        .gte("minute_bucket", month_start_utc.isoformat())
        .execute()
    ).data or []

    today_start_utc = today_start.astimezone(timezone.utc)
    week_start_utc = week_start.astimezone(timezone.utc)
    now_utc = datetime.now(timezone.utc)

    today_minutes: dict[str, set] = {}
    week_minutes: dict[str, set] = {}
    month_minutes: dict[str, set] = {}
    last_seen: dict[str, datetime] = {}

    for row in rows:
        mid = row.get("id_member")
        raw = row.get("minute_bucket")
        if not mid or not raw:
            continue
        try:
            bucket = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if bucket.tzinfo is None:
            bucket = bucket.replace(tzinfo=timezone.utc)

        month_minutes.setdefault(mid, set()).add(bucket)
        if bucket >= week_start_utc:
            week_minutes.setdefault(mid, set()).add(bucket)
        if bucket >= today_start_utc:
            today_minutes.setdefault(mid, set()).add(bucket)
        if mid not in last_seen or bucket > last_seen[mid]:
            last_seen[mid] = bucket

    users_res = sb.table("app_users").select("id, name, email").in_("id", member_ids).execute()
    user_map = {u["id"]: u for u in (users_res.data or [])}

    members = []
    for mid in member_ids:
        u = user_map.get(mid, {})
        last_seen_at = last_seen.get(mid)
        is_online = bool(last_seen_at and (now_utc - last_seen_at).total_seconds() <= _ONLINE_STALE_SECONDS)
        members.append({
            "id_member": mid,
            "name": u.get("name") or (u.get("email") or "").split("@")[0] or "Thành viên ẩn",
            "email": u.get("email"),
            "today_minutes": len(today_minutes.get(mid, ())),
            "week_minutes": len(week_minutes.get(mid, ())),
            "month_minutes": len(month_minutes.get(mid, ())),
            "is_online": is_online,
            "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
        })

    members.sort(key=lambda m: (not m["is_online"], -m["today_minutes"]))
    return {"role": role, "members": members}
