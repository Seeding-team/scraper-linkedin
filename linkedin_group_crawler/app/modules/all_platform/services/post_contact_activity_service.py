"""Tổng hợp "Ai đã làm" (who-bar) và "Nhật ký hoạt động" cho widget Kết quả liên hệ trên Post
Feed — gộp 3 nguồn hành động THẬT đã có sẵn trong hệ thống, không tạo bảng mới:

1. Seeding / bình luận — bảng ``seeding_content_kpi`` (1 dòng = 1 lần thành viên bình luận/seeding
   1 bài, cột ``id_member, id_post, link_post, content, verify, link_comment, created_at``).
2. Gọi điện — bảng ``post_call_results`` (``post_call_result_service.py``).
3. Nhắn tin Zalo tư vấn từ Post Feed — bảng ``zalo_inbox_kpi``, chỉ tính ``source_type IN
   ('post_feed_outbound', 'post_feed_inbound')`` (loại trừ nhắn trực tiếp trên Zalo Inbox —
   ``direct_inbox``/``legacy_verified`` — không liên quan bài seeding).

Lưu ý: ``seeding_content_kpi`` không có cột platform đáng tin cậy ở mọi dòng lịch sử, nên các
hàm ở đây đếm "seeding" theo `id_member` mà KHÔNG lọc theo platform (gọi điện + Zalo vẫn lọc
đúng platform). Đây là giới hạn đã biết, không phải thiếu sót — xem kế hoạch triển khai tính
năng "Kết quả liên hệ" ngày 2026-11-14.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.post_call_result_service import (
    _resolve_scoped_member_ids,
    _to_vn_day_str,
)
from app.modules.all_platform.services.supabase_categories_service import get_categories_by_type
from app.modules.all_platform.services.zalo_inbox_kpi_service import _vn_range_to_utc_bounds

logger = logging.getLogger(__name__)

_UNREACHABLE_ID = "00000000-0000-0000-0000-000000000000"
_POST_FEED_ZALO_SOURCES = ["post_feed_outbound", "post_feed_inbound"]

# 8 ma call_result that (migration 215), chia co dinh 2 nhom Thanh cong/That bai cho UI —
# day la quy uoc TRINH BAY (giong he OUT trong prototype), khong phai du lieu nghiep vu moi.
_OK_CALL_CODES = {"interested", "consulting", "callback", "waiting"}
_BAD_CALL_CODES = {"noanswer", "refused", "nointerest", "invalid"}

_ZALO_DIRECTION_LABEL = {
    "outbound_sent": "Đã gửi, chờ phản hồi",
    "inbound_pending": "Khách nhắn trước, chưa trả lời",
    "two_way": "Đã trao đổi 2 chiều",
    "inbound_replied": "Khách đã trả lời",
    "manual_verified": "Đã duyệt thủ công",
}


def get_who_did_what(
    user: dict[str, Any],
    platform: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    member_id: Optional[str] = None,
    team_id: Optional[str] = None,
    ignore_role_scope: bool = False,
) -> list[dict[str, Any]]:
    """Tổng số hành động (seeding + gọi điện + nhắn Zalo) theo từng thành viên trong kỳ, cho
    thanh "Ai đã làm {kỳ}" — vừa để hiển thị vừa để bấm lọc nhanh 1 thành viên.

    Phân quyền giống hệt ``post_call_result_service.get_call_result_stats`` (tái dùng
    ``_resolve_scoped_member_ids``). ``ignore_role_scope``: xem docstring
    ``_resolve_scoped_member_ids`` — chỉ widget "Kết quả liên hệ" trên Dashboard chính truyền
    ``True``, Dashboard Leader/Member360Drawer/exportCsv không đổi hành vi.
    """
    sb = get_supabase_client()
    allowed_member_ids = _resolve_scoped_member_ids(user, member_id, team_id, ignore_role_scope=ignore_role_scope)
    _, _, start_utc, end_utc = _vn_range_to_utc_bounds(date_from, date_to)

    totals: dict[str, dict[str, Any]] = {}

    def _bucket(mid: str) -> dict[str, Any]:
        return totals.setdefault(
            mid,
            {
                "member_id": mid, "name": None, "email": None,
                "seed": 0, "seed_verified": 0, "call": 0, "call_ok": 0, "call_bad": 0, "zalo": 0,
            },
        )

    def _apply_member_info(bucket: dict[str, Any], info: Optional[dict[str, Any]]) -> None:
        info = info or {}
        bucket["name"] = bucket["name"] or info.get("name")
        bucket["email"] = bucket["email"] or info.get("email")

    try:
        query = (
            sb.table("seeding_content_kpi")
            .select("id_member, created_at, verify, member:app_users!id_member(id, name, email)")
            .gte("created_at", start_utc)
            .lt("created_at", end_utc)
        )
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            mid = row.get("id_member")
            if not mid:
                continue
            bucket = _bucket(str(mid))
            _apply_member_info(bucket, row.get("member"))
            bucket["seed"] += 1
            if row.get("verify"):
                bucket["seed_verified"] += 1
    except Exception as exc:
        logger.warning(f"get_who_did_what: lỗi đếm seeding: {exc}")

    try:
        query = (
            sb.table("post_call_results")
            .select("updated_by, result_code, last_call_at, updated_by_user:app_users!updated_by(id, name, email)")
            .not_.is_("last_call_at", "null")
            .gte("last_call_at", start_utc)
            .lt("last_call_at", end_utc)
        )
        if platform:
            query = query.eq("platform", platform)
        if allowed_member_ids is not None:
            query = query.in_("updated_by", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            mid = row.get("updated_by")
            if not mid:
                continue
            bucket = _bucket(str(mid))
            _apply_member_info(bucket, row.get("updated_by_user"))
            bucket["call"] += 1
            code = row.get("result_code")
            if code in _OK_CALL_CODES:
                bucket["call_ok"] += 1
            elif code in _BAD_CALL_CODES:
                bucket["call_bad"] += 1
    except Exception as exc:
        logger.warning(f"get_who_did_what: lỗi đếm gọi điện: {exc}")

    try:
        query = (
            sb.table("zalo_inbox_kpi")
            .select("id_member, first_outbound_at, member:app_users!id_member(id, name, email)")
            .in_("source_type", _POST_FEED_ZALO_SOURCES)
            .gte("first_outbound_at", start_utc)
            .lt("first_outbound_at", end_utc)
        )
        if platform:
            query = query.eq("source_platform", platform)
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            mid = row.get("id_member")
            if not mid:
                continue
            bucket = _bucket(str(mid))
            _apply_member_info(bucket, row.get("member"))
            bucket["zalo"] += 1
    except Exception as exc:
        logger.warning(f"get_who_did_what: lỗi đếm Zalo: {exc}")

    items = []
    for bucket in totals.values():
        total = bucket["seed"] + bucket["call"] + bucket["zalo"]
        if total <= 0:
            continue
        items.append({**bucket, "total": total})
    items.sort(key=lambda x: x["total"], reverse=True)
    return items


def get_day_breakdown(
    user: dict[str, Any],
    platform: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    member_id: Optional[str] = None,
    team_id: Optional[str] = None,
    ignore_role_scope: bool = False,
) -> list[dict[str, Any]]:
    """Bảng "Theo ngày": seeding + gọi điện (tách OK/BAD) + Zalo (gửi/trả lời) theo từng ngày
    (giờ VN), đầy đủ MỌI ngày trong ``[date_from, date_to]`` kể cả ngày không có hoạt động nào —
    khớp với bảng "Theo ngày" của prototype (không chỉ liệt kê ngày có dữ liệu).

    Mỗi dòng ngày còn có ``by_member`` — breakdown theo thành viên trong đúng ngày đó
    (``member_id, member_name, seed, zalo_sent, total``), cho FE expand sub-row. Chỉ liệt kê
    thành viên có ``total > 0`` trong ngày đó, sắp giảm dần theo ``total``.

    Dòng nào có id_member/updated_by là NULL bị BỎ QUA HOÀN TOÀN (không tính vào bất cứ cột
    nào, kể cả tổng ngày) — y hệt quy tắc của ``get_who_did_what`` (``if not mid: continue``),
    để 2 tab "Theo thành viên" và "Theo ngày" luôn ra cùng tổng với cùng bộ lọc.
    """
    sb = get_supabase_client()
    allowed_member_ids = _resolve_scoped_member_ids(user, member_id, team_id, ignore_role_scope=ignore_role_scope)
    start_vn, end_vn, start_utc, end_utc = _vn_range_to_utc_bounds(date_from, date_to)

    days: dict[str, dict[str, Any]] = {}
    day_members: dict[str, dict[str, dict[str, Any]]] = {}
    cursor = datetime.fromisoformat(start_vn).date()
    end_date = datetime.fromisoformat(end_vn).date()
    while cursor <= end_date:
        day_str = cursor.isoformat()
        days[day_str] = {
            "day": day_str, "seed": 0, "seed_verified": 0, "call": 0, "call_ok": 0, "call_bad": 0,
            "zalo_sent": 0, "zalo_replied": 0,
        }
        day_members[day_str] = {}
        cursor += timedelta(days=1)

    def _bump(day_str: Optional[str], key: str) -> None:
        if day_str and day_str in days:
            days[day_str][key] += 1

    def _member_bucket(day_str: str, mid: str) -> dict[str, Any]:
        return day_members[day_str].setdefault(
            mid, {"member_id": mid, "name": None, "email": None, "seed": 0, "call": 0, "zalo_sent": 0}
        )

    def _apply_member_info(bucket: dict[str, Any], info: Optional[dict[str, Any]]) -> None:
        info = info or {}
        bucket["name"] = bucket["name"] or info.get("name")
        bucket["email"] = bucket["email"] or info.get("email")

    try:
        query = (
            sb.table("seeding_content_kpi")
            .select("id_member, id_post, created_at, verify, member:app_users!id_member(id, name, email)")
            .gte("created_at", start_utc)
            .lt("created_at", end_utc)
        )
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            mid = row.get("id_member")
            if not mid:
                continue
            day_str = _to_vn_day_str(
                row.get("created_at"), context=f"seeding_content_kpi.created_at id_post={row.get('id_post')}"
            )
            _bump(day_str, "seed")
            if row.get("verify"):
                _bump(day_str, "seed_verified")
            if day_str and day_str in days:
                mb = _member_bucket(day_str, str(mid))
                _apply_member_info(mb, row.get("member"))
                mb["seed"] += 1
    except Exception as exc:
        logger.warning(f"get_day_breakdown: lỗi đếm seeding: {exc}")

    try:
        query = (
            sb.table("post_call_results")
            .select(
                "post_id, result_code, updated_by, last_call_at, "
                "updated_by_user:app_users!updated_by(id, name, email)"
            )
            .not_.is_("last_call_at", "null")
            .gte("last_call_at", start_utc)
            .lt("last_call_at", end_utc)
        )
        if platform:
            query = query.eq("platform", platform)
        if allowed_member_ids is not None:
            query = query.in_("updated_by", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            mid = row.get("updated_by")
            if not mid:
                continue
            day_str = _to_vn_day_str(
                row.get("last_call_at"), context=f"post_call_results.last_call_at post_id={row.get('post_id')}"
            )
            _bump(day_str, "call")
            code = row.get("result_code")
            if code in _OK_CALL_CODES:
                _bump(day_str, "call_ok")
            elif code in _BAD_CALL_CODES:
                _bump(day_str, "call_bad")
            if day_str and day_str in days:
                mb = _member_bucket(day_str, str(mid))
                _apply_member_info(mb, row.get("updated_by_user"))
                mb["call"] += 1
    except Exception as exc:
        logger.warning(f"get_day_breakdown: lỗi đếm gọi điện: {exc}")

    try:
        query = (
            sb.table("zalo_inbox_kpi")
            .select(
                "id_member, source_post_id, first_outbound_at, first_customer_msg_at, "
                "member:app_users!id_member(id, name, email)"
            )
            .in_("source_type", _POST_FEED_ZALO_SOURCES)
            .gte("first_outbound_at", start_utc)
            .lt("first_outbound_at", end_utc)
        )
        if platform:
            query = query.eq("source_platform", platform)
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            mid = row.get("id_member")
            if not mid:
                continue
            day_str = _to_vn_day_str(
                row.get("first_outbound_at"),
                context=f"zalo_inbox_kpi.first_outbound_at source_post_id={row.get('source_post_id')}",
            )
            _bump(day_str, "zalo_sent")
            if row.get("first_customer_msg_at"):
                _bump(day_str, "zalo_replied")
            if day_str and day_str in days:
                mb = _member_bucket(day_str, str(mid))
                _apply_member_info(mb, row.get("member"))
                mb["zalo_sent"] += 1
    except Exception as exc:
        logger.warning(f"get_day_breakdown: lỗi đếm Zalo: {exc}")

    result = []
    for k in sorted(days.keys()):
        day = days[k]
        total = day["seed"] + day["call"] + day["zalo_sent"]
        by_member = []
        for mb in day_members[k].values():
            m_total = mb["seed"] + mb["call"] + mb["zalo_sent"]
            if m_total <= 0:
                continue
            by_member.append({
                "member_id": mb["member_id"],
                "member_name": mb["name"] or mb["email"] or mb["member_id"],
                "seed": mb["seed"],
                "zalo_sent": mb["zalo_sent"],
                "total": m_total,
            })
        by_member.sort(key=lambda m: m["total"], reverse=True)
        result.append({**day, "total": total, "by_member": by_member})
    return result


_SEEDING_COVERAGE_TABLE_BY_PLATFORM = {
    "facebook": "facebook_posts",
    "linkedin": "linkedin_posts",
    "threads": "threads_posts",
    "youtube": "youtube_posts",
}


def get_seeding_group_coverage(
    user: dict[str, Any],
    team_id: Optional[str] = None,
    member_id: Optional[str] = None,
    platform: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Tab Comment: độ phủ seeding/bình luận theo nhóm/nguồn trong kỳ.

    `seeding_content_kpi` không lưu platform/group trực tiếp — tra `id_post` qua bảng bài viết
    từng platform (`facebook_posts`/`linkedin_posts` join `facebook_groups`/`linkedin_groups` lấy
    `group_name` thật, giống cách `unified_posts_service.py` build PostCard; `threads_posts`/
    `youtube_posts` dùng nhãn cố định "Threads"/"YouTube" thay vì tách theo từng kênh — đủ cho
    biểu đồ độ phủ, không cần chi tiết như hiển thị PostCard).
    """
    sb = get_supabase_client()
    allowed_member_ids = _resolve_scoped_member_ids(user, member_id, team_id)
    _, _, start_utc, end_utc = _vn_range_to_utc_bounds(date_from, date_to)

    query = (
        sb.table("seeding_content_kpi")
        .select("id_post, created_at")
        .gte("created_at", start_utc)
        .lt("created_at", end_utc)
    )
    if allowed_member_ids is not None:
        query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])

    try:
        rows = execute_supabase_query(lambda: query.execute()).data or []
    except Exception as exc:
        logger.warning(f"get_seeding_group_coverage: lỗi lấy seeding: {exc}")
        return []

    post_ids = sorted({str(r["id_post"]) for r in rows if r.get("id_post")})
    if not post_ids:
        return []

    group_name_by_post: dict[str, str] = {}
    platforms_to_check = [platform] if platform else list(_SEEDING_COVERAGE_TABLE_BY_PLATFORM)

    for plat in platforms_to_check:
        table = _SEEDING_COVERAGE_TABLE_BY_PLATFORM.get(plat)
        if not table:
            continue
        if plat == "facebook":
            select_cols = "id, facebook_groups(group_name)"
        elif plat == "linkedin":
            select_cols = "id, linkedin_groups(group_name)"
        else:
            select_cols = "id"
        fallback_label = "Threads" if plat == "threads" else "YouTube" if plat == "youtube" else "Không rõ nhóm"
        try:
            for i in range(0, len(post_ids), 200):
                batch = post_ids[i:i + 200]
                res = execute_supabase_query(
                    lambda b=batch, t=table, s=select_cols: sb.table(t).select(s).in_("id", b).execute()
                )
                for row in (res.data or []):
                    pid = str(row.get("id"))
                    if plat == "facebook":
                        name = (row.get("facebook_groups") or {}).get("group_name")
                    elif plat == "linkedin":
                        name = (row.get("linkedin_groups") or {}).get("group_name")
                    else:
                        name = None
                    group_name_by_post[pid] = name or fallback_label
        except Exception as exc:
            logger.warning(f"get_seeding_group_coverage: lỗi tra {table}: {exc}")

    counts: dict[str, int] = {}
    for r in rows:
        pid = str(r.get("id_post") or "")
        if not pid:
            continue
        name = group_name_by_post.get(pid, "Không rõ nhóm")
        counts[name] = counts.get(name, 0) + 1

    items = [{"group_name": name, "count": count} for name, count in counts.items()]
    items.sort(key=lambda x: x["count"], reverse=True)
    return items[:limit]


def get_activity_log(
    user: dict[str, Any],
    platform: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    member_id: Optional[str] = None,
    team_id: Optional[str] = None,
    action_type: Optional[str] = None,
    result_code: Optional[str] = None,
    overdue_only: bool = False,
    needs_followup_only: bool = False,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
    ignore_role_scope: bool = False,
    *,
    max_rows_per_source: int = 500,
) -> dict[str, Any]:
    """Nhật ký hoạt động: gộp seeding + gọi điện + nhắn Zalo thành 1 danh sách sự kiện, sắp theo
    thời gian mới nhất trước, phân trang ở Python sau khi gộp (đủ nhanh vì đã giới hạn theo
    date_from/date_to — period tối đa 30 ngày — và platform trước khi gộp).

    ``action_type``: ``None``/``"all"`` = cả 3 loại, hoặc ``"seed"``/``"call"``/``"zalo"`` để chỉ
    hiện đúng 1 loại nguồn trong ``items``. Luôn truy vấn đủ cả 3 nguồn (không bỏ qua theo
    ``action_type``) để trả thêm ``counts`` — số lượng mỗi loại trong kỳ, dùng hiển thị badge
    trên chip lọc mà không đổi theo chip đang chọn (giống hành vi prototype). `counts` KHÔNG bị
    ảnh hưởng bởi `result_code`/`overdue_only`/`needs_followup_only`/`search` — các filter này chỉ
    thu hẹp `items`/`total` (phục vụ drawer Dashboard Leader: "Lead", "Hẹn gọi lại", "Follow-up
    quá hạn", "Tin nhắn cần follow-up", và ô tìm kiếm chung).

    `result_code`/`overdue_only` chỉ áp dụng cho sự kiện `call`; `needs_followup_only` chỉ áp
    dụng cho sự kiện `zalo`. `search` áp dụng hậu kỳ (Python, không phân biệt hoa/thường) trên
    `member_name`/`post_label` — không có khái niệm "tên khách hàng" chung cho cả 3 nguồn.
    """
    sb = get_supabase_client()
    allowed_member_ids = _resolve_scoped_member_ids(user, member_id, team_id, ignore_role_scope=ignore_role_scope)
    _, _, start_utc, end_utc = _vn_range_to_utc_bounds(date_from, date_to)
    now_utc = datetime.now(timezone.utc)

    want = action_type if action_type in ("seed", "call", "zalo") else None
    events: list[dict[str, Any]] = []

    try:
        query = (
            sb.table("seeding_content_kpi")
            .select(
                "id_member, link_post, verify, created_at, "
                "member:app_users!id_member(id, name, email)"
            )
            .gte("created_at", start_utc)
            .lt("created_at", end_utc)
            .order("created_at", desc=True)
            .limit(max_rows_per_source)
        )
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            info = row.get("member") or {}
            events.append({
                "ts": row.get("created_at"),
                "action_type": "seed",
                "member_id": row.get("id_member"),
                "member_name": info.get("name") or info.get("email"),
                "post_label": row.get("link_post"),
                "result_label": "Đã xác minh" if row.get("verify") else "Chưa xác minh",
            })
    except Exception as exc:
        logger.warning(f"get_activity_log: lỗi lấy seeding: {exc}")

    try:
        query = (
            sb.table("post_call_results")
            .select(
                "post_id, platform, result_code, note, updated_by, updated_at, last_call_at, "
                "updated_by_user:app_users!updated_by(id, name, email)"
            )
            .gte("updated_at", start_utc)
            .lt("updated_at", end_utc)
            .order("updated_at", desc=True)
            .limit(max_rows_per_source)
        )
        if platform:
            query = query.eq("platform", platform)
        if allowed_member_ids is not None:
            query = query.in_("updated_by", allowed_member_ids or [_UNREACHABLE_ID])
        type_meta = {c["code"]: c for c in get_categories_by_type("call_result", active_only=False)}
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            info = row.get("updated_by_user") or {}
            code = row.get("result_code") or ""
            events.append({
                "ts": row.get("updated_at"),
                "action_type": "call",
                "member_id": row.get("updated_by"),
                "member_name": info.get("name") or info.get("email"),
                # Việc 4: post_call_results chỉ có 1 dòng/post (latest-state, không phải lịch
                # sử) — note ở đây LUÔN là ghi chú của LẦN GỌI GẦN NHẤT, không gắn riêng được
                # cho từng dòng log quá khứ của cùng 1 post (xem docstring đầu file).
                "note": row.get("note"),
                "post_label": row.get("post_id"),
                "result_label": (type_meta.get(code) or {}).get("name") or code or "—",
                "_result_code": code,
                "_last_call_at": row.get("last_call_at"),
            })
    except Exception as exc:
        logger.warning(f"get_activity_log: lỗi lấy gọi điện: {exc}")

    try:
        query = (
            sb.table("zalo_inbox_kpi")
            .select(
                "id_member, source_post_id, source_post_url, direction_status, phone_number, "
                "first_outbound_at, first_customer_msg_at, member:app_users!id_member(id, name, email)"
            )
            .in_("source_type", _POST_FEED_ZALO_SOURCES)
            .gte("first_outbound_at", start_utc)
            .lt("first_outbound_at", end_utc)
            .order("first_outbound_at", desc=True)
            .limit(max_rows_per_source)
        )
        if platform:
            query = query.eq("source_platform", platform)
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
        for row in (execute_supabase_query(lambda: query.execute()).data or []):
            info = row.get("member") or {}
            direction = row.get("direction_status")
            events.append({
                "ts": row.get("first_outbound_at"),
                "action_type": "zalo",
                "member_id": row.get("id_member"),
                "member_name": info.get("name") or info.get("email"),
                "post_label": row.get("source_post_url") or row.get("source_post_id") or row.get("phone_number"),
                "result_label": _ZALO_DIRECTION_LABEL.get(direction, direction or "—"),
                "_needs_followup": not row.get("first_customer_msg_at"),
            })
    except Exception as exc:
        logger.warning(f"get_activity_log: lỗi lấy Zalo: {exc}")

    events.sort(key=lambda e: e.get("ts") or "", reverse=True)
    counts = {
        "all": len(events),
        "seed": sum(1 for e in events if e["action_type"] == "seed"),
        "call": sum(1 for e in events if e["action_type"] == "call"),
        "zalo": sum(1 for e in events if e["action_type"] == "zalo"),
    }

    def _parse_ts(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    def _passes_extra_filters(e: dict[str, Any]) -> bool:
        if e["action_type"] == "call":
            if result_code and e.get("_result_code") != result_code:
                return False
            if overdue_only:
                dt = _parse_ts(e.get("_last_call_at"))
                if dt is None or dt > now_utc - timedelta(days=1):
                    return False
        elif e["action_type"] == "zalo" and needs_followup_only:
            if not e.get("_needs_followup"):
                return False
            dt = _parse_ts(e.get("ts"))
            if dt is None or dt < now_utc - timedelta(days=2):
                return False
        if search:
            needle = search.strip().lower()
            if needle:
                haystack = f"{e.get('member_name') or ''} {e.get('post_label') or ''}".lower()
                if needle not in haystack:
                    return False
        return True

    filtered = [e for e in events if (want is None or e["action_type"] == want) and _passes_extra_filters(e)]
    total = len(filtered)
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 10), 2000))
    start_idx = (page - 1) * page_size
    items = [
        {k: v for k, v in e.items() if not k.startswith("_")}
        for e in filtered[start_idx:start_idx + page_size]
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "counts": counts}
