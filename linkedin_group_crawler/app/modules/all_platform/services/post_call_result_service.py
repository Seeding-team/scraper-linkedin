"""Service handling Post Call Results (Kết quả liên hệ, số lần gọi, thời điểm gọi gần nhất)."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.supabase_categories_service import get_categories_by_type
from app.modules.all_platform.services.supabase_kpi_service import VN_TZ, _vn_week_range_to_utc
from app.modules.all_platform.services.unified_posts_service import _extract_phone_from_text

logger = logging.getLogger(__name__)

_UNREACHABLE_ID = "00000000-0000-0000-0000-000000000000"

# Card "Tổng bài" (widget Kết quả liên hệ) — đếm bài crawl theo `crawl_date` (NOT NULL,
# có index ở cả 4 bảng), KHÔNG lọc theo member/role (bài dùng chung để seeding, giống
# đúng tiền lệ "totalPostsToday/totalPosts" ở unified_posts_service._fetch_stats).
_POST_TABLE_BY_PLATFORM = {
    "facebook": "facebook_posts",
    "linkedin": "linkedin_posts",
    "threads": "threads_posts",
    "youtube": "youtube_posts",
}

POST_CALL_RESULT_COLUMNS = (
    "id, post_id, platform, result_code, attempts, last_call_at, note, updated_by, created_at, updated_at, "
    "updated_by_user:app_users!updated_by(id, name, email)"
)


def _normalize_call_result(row: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Chuẩn hoá object call result, đảm bảo updated_by_user luôn nhất quán."""
    if not row:
        return row
    user_obj = row.pop("app_users", None)
    if user_obj and "updated_by_user" not in row:
        row["updated_by_user"] = user_obj
    return row


def get_call_result(post_id: str, platform: str = "facebook") -> Optional[dict[str, Any]]:
    """Lấy bản ghi kết quả liên hệ hiện tại của 1 bài viết theo post_id và platform."""
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("post_call_results")
        .select(POST_CALL_RESULT_COLUMNS)
        .eq("post_id", str(post_id))
        .eq("platform", str(platform))
        .maybe_single()
        .execute()
    )
    return _normalize_call_result(res.data) if res and res.data else None


def get_call_results_by_post_ids(post_ids: list[str], platform: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """Lấy map post_id -> call_result cho danh sách bài viết (dùng cho feed tổng hợp)."""
    if not post_ids:
        return {}

    supabase = get_supabase_client()
    query = supabase.table("post_call_results").select(POST_CALL_RESULT_COLUMNS).in_("post_id", post_ids)
    if platform:
        query = query.eq("platform", platform)

    res = execute_supabase_query(lambda: query.execute())
    rows = res.data or []
    return {str(r["post_id"]): _normalize_call_result(r) for r in rows}


def update_call_result(
    post_id: str,
    payload: dict[str, Any],
    user: dict[str, Any],
) -> dict[str, Any]:
    """Cập nhật kết quả liên hệ cho 1 bài viết (tự động tăng số lần gọi và lưu thời điểm gọi)."""
    supabase = get_supabase_client()
    platform = payload.get("platform") or "facebook"
    result_code = payload.get("result_code")
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    existing = get_call_result(post_id, platform)
    curr_attempts = int(existing.get("attempts") or 0) if existing else 0

    # Nếu người dùng chọn 1 kết quả liên hệ (khác rỗng) -> Tăng số lần gọi lên 1
    if result_code:
        next_attempts = curr_attempts + 1
        last_call = now_iso
    else:
        next_attempts = curr_attempts
        last_call = existing.get("last_call_at") if existing else None

    upsert_data: dict[str, Any] = {
        "post_id": str(post_id),
        "platform": platform,
        "result_code": str(result_code or ""),
        "attempts": next_attempts,
        "last_call_at": last_call,
        "updated_by": user_id,
        "updated_at": now_iso,
    }

    res = execute_supabase_query(
        lambda: supabase.table("post_call_results")
        .upsert(upsert_data, on_conflict="post_id,platform")
        .execute()
    )
    saved_result = res.data[0] if res.data else upsert_data

    # Tín hiệu "đã liên hệ" — tự nâng đánh giá bài lên 'can-lien-he' nếu đang
    # 'chua-danh-gia' (mọi result_code, không phân loại). Best-effort: lỗi ở đây
    # không được làm hỏng việc lưu kết quả liên hệ đã thành công ở trên.
    try:
        from app.modules.all_platform.services.post_evaluation_service import (
            auto_promote_to_can_lien_he,
        )

        auto_promote_to_can_lien_he(post_id, platform)
    except Exception as exc:
        logger.warning(f"update_call_result: auto_promote_to_can_lien_he thất bại post_id={post_id}: {exc}")

    fresh = get_call_result(post_id, platform)
    if fresh:
        saved_result = fresh
    logger.info(
        "update_call_result post_id=%s platform=%s result_code=%s attempts=%d",
        post_id,
        platform,
        result_code,
        next_attempts,
    )
    return saved_result


def update_call_result_note(
    post_id: str,
    platform: str,
    note: Optional[str],
    user: dict[str, Any],
) -> dict[str, Any]:
    """Việc 3 (BƯỚC 2/3): cập nhật riêng cột `note` của 1 bài — KHÔNG đổi result_code, KHÔNG
    tăng attempts/last_call_at, KHÔNG tạo bản ghi mới. Bài phải đã có kết quả liên hệ từ
    trước (post_call_results là upsert theo post_id+platform ở `update_call_result`, note chỉ
    đi kèm 1 dòng đã tồn tại — không có gì để UPDATE nếu dòng đó chưa được tạo)."""
    supabase = get_supabase_client()
    existing = get_call_result(post_id, platform)
    if not existing:
        raise ValueError("Bài viết chưa có kết quả liên hệ nào để ghi chú.")

    now_iso = datetime.now(timezone.utc).isoformat()
    execute_supabase_query(
        lambda: supabase.table("post_call_results")
        .update({"note": (note or "").strip() or None, "updated_by": user.get("id"), "updated_at": now_iso})
        .eq("post_id", str(post_id))
        .eq("platform", str(platform))
        .execute()
    )
    return get_call_result(post_id, platform) or existing


def _team_roster(team_id: str) -> list[str]:
    """Danh sách id_member thuộc 1 team cụ thể (bảng `member_of_teams`)."""
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("member_of_teams").select("id_member").eq("id_teams", team_id).execute()
    )
    return [r["id_member"] for r in (res.data or []) if r.get("id_member")]


def _resolve_scoped_member_ids(
    user: dict[str, Any], member_id: Optional[str], team_id: Optional[str] = None
) -> Optional[list[str]]:
    """Trả list id_member được phép xem thống kê, hoặc None nếu không giới hạn (admin, không lọc).

    Theo đúng nguồn team đang thực sự dùng cho KPI/Dashboard leader (`teams` +
    `member_of_teams` + `teams.id_leader` — xem `get_team_kpi_overview` ở migration
    222 và endpoint `/kpi/get-verified-conv-ids`), KHÔNG dùng `team_associations`
    (bảng cũ từ migration 001/002, giờ chỉ còn là fallback resolve 1 chiều ở
    `fb_post_kpi_service._resolve_id_leader`) và KHÔNG dùng `crm_teams`/
    `crm_permission_group*` (hệ thống phân quyền RIÊNG của module CRM Lead/Customer/
    Deal, không liên quan tới team quản lý seeding/KPI — xem docstring
    `crm_team_service.py`).

    - member: chỉ chính mình (bỏ qua `team_id`/`member_id` truyền lên).
    - leader: các thành viên thuộc (các) team mà leader đó là `id_leader`, cộng
      chính leader. Nếu có `team_id` (bộ lọc Team ở Dashboard Leader), giao thêm
      với roster của đúng team đó — leader chọn team không phải của mình sẽ ra
      rỗng an toàn, không lỗi. `member_id` (nếu có) phải nằm trong tập cuối cùng.
    - admin: `team_id` giới hạn theo đúng roster team đó (không giới hạn role);
      không có `team_id`/`member_id` thì None (không giới hạn).
    """
    role = str(user.get("role") or "member").strip().lower()
    user_id = user.get("id")

    if role == "member":
        return [user_id]

    if role == "leader":
        supabase = get_supabase_client()
        teams_res = execute_supabase_query(
            lambda: supabase.table("teams").select("id").eq("id_leader", user_id).execute()
        )
        team_ids = [t["id"] for t in (teams_res.data or []) if t.get("id")]

        member_ids: list[str] = []
        if team_ids:
            mot_res = execute_supabase_query(
                lambda: supabase.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
            )
            member_ids = [r["id_member"] for r in (mot_res.data or []) if r.get("id_member")]
        member_ids.append(user_id)
        member_ids = list(set(member_ids))

        if team_id:
            roster = set(_team_roster(team_id))
            member_ids = [m for m in member_ids if m in roster]

        if member_id:
            return [member_id] if member_id in member_ids else [_UNREACHABLE_ID]
        return member_ids or [_UNREACHABLE_ID]

    # admin
    if team_id:
        roster = _team_roster(team_id)
        if member_id:
            return [member_id] if member_id in roster else [_UNREACHABLE_ID]
        return roster or [_UNREACHABLE_ID]

    if member_id:
        return [member_id]
    return None


def get_call_result_stats(
    user: dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    platform: Optional[str] = None,
    member_id: Optional[str] = None,
    result_code: Optional[str] = None,
    team_id: Optional[str] = None,
) -> dict[str, Any]:
    """Thống kê "Kết quả liên hệ" theo loại / theo thành viên / theo ngày (giờ VN).

    Phân quyền: member chỉ thấy dòng của chính mình (ép `updated_by = user.id`,
    bỏ qua `member_id` truyền lên); leader chỉ thấy thành viên trong team mình
    quản lý (nguồn `teams`/`member_of_teams`, xem `_resolve_scoped_member_ids`);
    admin thấy toàn bộ, lọc được theo `member_id`.

    `result_code`: khi FE đang bấm chọn 1 pill (lọc feed theo loại đó), `by_member`
    và `by_day` cũng chỉ tính trên đúng loại này — để 2 khối đó khớp với pill đang
    chọn thay vì luôn là tổng mọi loại. `by_type` (và `total`, dùng cho pill "Tổng")
    LUÔN tính trên toàn bộ loại, không bị ảnh hưởng bởi `result_code`, để các pill
    khác vẫn hiển thị đúng số của chúng cho người dùng bấm chuyển qua lại.
    """
    supabase = get_supabase_client()

    today_vn = datetime.now(VN_TZ).date()
    end_d = _parse_date_safe(date_to) or today_vn
    start_d = _parse_date_safe(date_from) or (end_d - timedelta(days=29))
    if start_d > end_d:
        start_d, end_d = end_d, start_d
    start_utc, end_utc = _vn_week_range_to_utc(start_d.isoformat(), end_d.isoformat())

    allowed_member_ids = _resolve_scoped_member_ids(user, member_id, team_id)

    query = (
        supabase.table("post_call_results")
        .select("result_code, platform, updated_by, last_call_at, updated_by_user:app_users!updated_by(id, name, email)")
        .not_.is_("last_call_at", "null")
        .gte("last_call_at", start_utc)
        .lte("last_call_at", end_utc)
    )
    if platform:
        query = query.eq("platform", platform)
    if allowed_member_ids is not None:
        query = query.in_("updated_by", allowed_member_ids or [_UNREACHABLE_ID])

    rows = execute_supabase_query(lambda: query.execute()).data or []

    type_meta = {c["code"]: c for c in get_categories_by_type("call_result", active_only=True)}

    # Luôn liệt kê đủ các mã call_result đang active trong Cấu hình (kể cả count=0) —
    # không chỉ những mã đã thực sự có dòng trong post_call_results — để widget khớp
    # đúng danh mục đang cấu hình thay vì chỉ hiện những loại tình cờ có dữ liệu.
    by_type_count: dict[str, int] = {code: 0 for code in type_meta}
    total = 0

    for row in rows:
        code = row.get("result_code") or ""
        if not code:
            continue
        if not _to_vn_day_str(row.get("last_call_at")):
            continue
        total += 1
        by_type_count[code] = by_type_count.get(code, 0) + 1

    # by_member / by_day: nếu có result_code thì chỉ tính trên đúng loại đó (khớp
    # với pill FE đang chọn) — by_type/total ở trên LUÔN là tổng mọi loại, tính riêng.
    by_member_entry: dict[str, dict[str, Any]] = {}
    by_day_count: dict[str, int] = {}
    for row in rows:
        code = row.get("result_code") or ""
        if not code:
            continue
        if result_code and code != result_code:
            continue
        day_vn = _to_vn_day_str(row.get("last_call_at"))
        if not day_vn:
            continue

        by_day_count[day_vn] = by_day_count.get(day_vn, 0) + 1

        mid = row.get("updated_by")
        if mid:
            user_obj = row.get("updated_by_user") or {}
            entry = by_member_entry.setdefault(
                mid,
                {
                    "member_id": mid,
                    "name": user_obj.get("name"),
                    "email": user_obj.get("email"),
                    "count": 0,
                },
            )
            entry["count"] += 1

    by_type = [
        {
            "code": code,
            "name": (type_meta.get(code) or {}).get("name") or code,
            "sort_order": (type_meta.get(code) or {}).get("sort_order") or 999,
            "count": count,
        }
        for code, count in by_type_count.items()
    ]
    by_type.sort(key=lambda x: (x["sort_order"], x["code"]))

    by_member = sorted(by_member_entry.values(), key=lambda x: x["count"], reverse=True)

    by_day = [{"day": day, "count": count} for day, count in sorted(by_day_count.items())]

    # Cột "Comment" (widget Kết quả liên hệ) — đếm số dòng seeding_content_kpi trong cùng kỳ
    # và kỳ trước liền kề (cùng độ dài) để tính xu hướng "+N"/"-N", giống cách get_post_feed_message_stats
    # (zalo_inbox_kpi_service.py) tính prev_sent cho cột Zalo. seeding_content_kpi không có cột
    # platform đáng tin cậy ở mọi dòng lịch sử (xem post_contact_activity_service.py) nên KHÔNG lọc
    # theo platform ở đây, chỉ lọc theo id_member — giống mọi chỗ khác đang đếm bảng này.
    span_days = (end_d - start_d).days + 1
    prev_end_d = start_d - timedelta(days=1)
    prev_start_d = prev_end_d - timedelta(days=span_days - 1)
    prev_start_utc, prev_end_utc = _vn_week_range_to_utc(prev_start_d.isoformat(), prev_end_d.isoformat())

    def _count_seeding_comments(gte_utc: str, lte_utc: str) -> int:
        try:
            query = supabase.table("seeding_content_kpi").select("id_member").gte("created_at", gte_utc).lte("created_at", lte_utc)
            if allowed_member_ids is not None:
                query = query.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
            return len(execute_supabase_query(lambda: query.execute()).data or [])
        except Exception as exc:
            logger.warning(f"get_call_result_stats: lỗi đếm seeding_content_kpi: {exc}")
            return 0

    comment_count = _count_seeding_comments(start_utc, end_utc)
    comment_count_prev = _count_seeding_comments(prev_start_utc, prev_end_utc)

    def _count_crawled_posts(gte_utc: str, lte_utc: str) -> int:
        tables = [_POST_TABLE_BY_PLATFORM[platform]] if platform in _POST_TABLE_BY_PLATFORM else list(_POST_TABLE_BY_PLATFORM.values())
        total_count = 0
        for table in tables:
            try:
                res = execute_supabase_query(
                    lambda t=table: supabase.table(t)
                    .select("id", count="exact")
                    .gte("crawl_date", gte_utc)
                    .lte("crawl_date", lte_utc)
                    .execute()
                )
                total_count += res.count or 0
            except Exception as exc:
                logger.warning(f"get_call_result_stats: lỗi đếm bài crawl ở bảng {table}: {exc}")
        return total_count

    def _get_suitable_post_ids(gte_utc: str, lte_utc: str, scope_member_id: Optional[str] = None) -> set[str]:
        """Tập id bài "phù hợp" trong kỳ (đã crawl theo `crawl_date`, KHÔNG bị đánh giá
        'khong-phu-hop' trong `post_quick_review`) — lõi dùng chung giữa card "Tổng bài"
        (`_count_crawled_posts_excluding_unsuitable`, Việc 2) và card "Comment"
        (`_count_commented_posts_suitable`, Việc 3) để không viết lại logic loại trừ 2 lần.

        Supabase REST không hỗ trợ JOIN SQL thật (xem _attach_group_lead_stats ở
        supabase_groups_service.py) nên phải lấy riêng danh sách id bài trong kỳ (theo từng
        bảng/platform) + danh sách post_id 'khong-phu-hop' của đúng platform đó, rồi loại trừ
        bằng Python — cùng kỹ thuật với `can_lien_he_post_count` ở supabase_groups_service.py.

        `scope_member_id` (Việc 4, 2026-11-23): None = không giới hạn (hành vi gốc — BẮT BUỘC
        giữ nguyên cho card "Tổng bài", xem tooltip "không lọc theo thành viên" ở FE). Khi có
        giá trị, thu hẹp về đúng phạm vi "bài của thành viên đó" theo ĐÚNG định nghĩa đã dùng ở
        `unified_posts_service.MEMBER_SCOPED_TABLES`/`apply_scope` (không phát minh khái niệm
        mới): facebook_posts/threads_posts/youtube_posts lọc trực tiếp theo cột `id_member`
        (người bấm cào); linkedin_posts không có cột này, lọc gián tiếp qua
        `linkedin_groups.id_member` (nhóm do thành viên đó sở hữu).
        """
        platform_table_pairs = (
            [(platform, _POST_TABLE_BY_PLATFORM[platform])]
            if platform in _POST_TABLE_BY_PLATFORM
            else list(_POST_TABLE_BY_PLATFORM.items())
        )

        linkedin_group_ids: Optional[list[str]] = None
        if scope_member_id:
            try:
                lg_rows = execute_supabase_query(
                    lambda m=scope_member_id: supabase.table("linkedin_groups").select("id").eq("id_member", m).execute()
                ).data or []
                linkedin_group_ids = [str(r["id"]) for r in lg_rows if r.get("id")]
            except Exception as exc:
                logger.warning(
                    f"get_call_result_stats: lỗi tra nhóm LinkedIn theo thành viên ({scope_member_id}): {exc}"
                )
                linkedin_group_ids = []

        suitable_ids: set[str] = set()
        for plat, table in platform_table_pairs:
            def _run_posts_query(t=table, m=scope_member_id, lg_ids=linkedin_group_ids):
                q = supabase.table(t).select("id").gte("crawl_date", gte_utc).lte("crawl_date", lte_utc)
                if m:
                    if t == "linkedin_posts":
                        q = q.in_("id_group", lg_ids or [_UNREACHABLE_ID])
                    else:
                        q = q.eq("id_member", m)
                return q.execute()

            try:
                post_rows = execute_supabase_query(_run_posts_query).data or []
            except Exception as exc:
                logger.warning(f"get_call_result_stats: lỗi đếm bài crawl (loại trừ không phù hợp) ở bảng {table}: {exc}")
                continue
            post_ids = {str(r["id"]) for r in post_rows if r.get("id") is not None}
            if not post_ids:
                continue
            try:
                unsuitable_rows = execute_supabase_query(
                    lambda p=plat: supabase.table("post_quick_review")
                    .select("post_id")
                    .eq("platform", p)
                    .eq("evaluation_code", "khong-phu-hop")
                    .execute()
                ).data or []
            except Exception as exc:
                logger.warning(
                    f"get_call_result_stats: lỗi đọc post_quick_review (loại trừ không phù hợp, platform={plat}): {exc}"
                )
                unsuitable_rows = []
            unsuitable_ids = {str(r["post_id"]) for r in unsuitable_rows if r.get("post_id") is not None}
            suitable_ids |= post_ids - unsuitable_ids
        return suitable_ids

    def _count_commented_posts_suitable(gte_utc: str, lte_utc: str, suitable_post_ids: set[str]) -> int:
        """Tử số X của card "Comment" (Việc 3, 2026-11-23): số BÀI khác nhau (COUNT(DISTINCT
        id_post), không phải số lượt/dòng như `_count_seeding_comments`) có ít nhất 1 dòng
        seeding/bình luận trong `seeding_content_kpi` trong kỳ, CHỈ TÍNH bài nằm trong
        `suitable_post_ids` truyền vào (LUÔN là tập "phù hợp" TOÀN CỤC — không thu hẹp theo
        thành viên — vì 1 thành viên vẫn có thể seeding bài ngoài phạm vi nhóm họ phụ trách,
        bài dùng chung; thu hẹp ở đây sẽ đếm thiếu). Lọc theo `allowed_member_ids` giống hệt
        `_count_seeding_comments` (cùng kỳ, cùng quyền xem).

        Dòng `id_member IS NULL` (dữ liệu cũ từ trước khi bảng có cột liên kết `id_member`
        đáng tin cậy — xem `ALTER TABLE seeding_content_kpi ADD COLUMN app_user_id` ở
        `001_auth_social_accounts.sql`) LUÔN bị loại trừ khỏi `commented_post_ids`, kể cả khi
        `allowed_member_ids is None` ("Tất cả thành viên" — trước đây KHÔNG lọc id_member chút
        nào trong nhánh này). Đồng bộ 2026-11-25 với `get_who_did_what`/`get_day_breakdown`
        (post_contact_activity_service.py, `if not mid: continue`) — nếu không, X ("Bài đã
        comment") có thể tính cả bài mà lượt bình luận DUY NHẤT là dòng NULL id_member, trong
        khi bảng "Lượt bình luận" bỏ qua hoàn toàn dòng đó, khiến X > Tổng "Lượt bình luận".
        """
        try:
            def _run_query():
                q = (
                    supabase.table("seeding_content_kpi")
                    .select("id_post, id_member")
                    .gte("created_at", gte_utc)
                    .lte("created_at", lte_utc)
                )
                if allowed_member_ids is not None:
                    q = q.in_("id_member", allowed_member_ids or [_UNREACHABLE_ID])
                return q.execute()

            rows = execute_supabase_query(_run_query).data or []
        except Exception as exc:
            logger.warning(f"get_call_result_stats: lỗi đếm bài đã comment (distinct) ở seeding_content_kpi: {exc}")
            return 0
        commented_post_ids = {
            str(r["id_post"]) for r in rows if r.get("id_post") is not None and r.get("id_member")
        }
        return len(commented_post_ids & suitable_post_ids)

    def _count_unique_phones(gte_utc: str, lte_utc: str) -> int:
        """"Tổng số điện thoại" (card Cuộc gọi/Zalo, 2026-11-25): COUNT(DISTINCT SĐT) trích
        từ `content` của tập bài "phù hợp" trong kỳ (cùng định nghĩa "phù hợp" với
        `_get_suitable_post_ids` — đã crawl theo `crawl_date`, KHÔNG bị đánh giá
        'khong-phu-hop'). LUÔN toàn cục, KHÔNG thu hẹp theo `member_id` dù dropdown đang
        chọn ai (xác nhận người dùng 2026-11-25): đây là con số mô tả QUY MÔ dữ liệu
        ("tập bài này có bao nhiêu SĐT khác nhau"), không phải chỉ số hiệu suất theo người
        như callOk/zaloSent — không có khái niệm "% so với kỳ trước" hay "*_prev" cho số này.

        Dùng chung 1 con số cho CẢ "Cuộc gọi" lẫn "Zalo" (xác nhận người dùng 2026-11-25):
        không có cột SĐT lưu sẵn ở bất kỳ bảng post nào (facebook_posts/linkedin_posts/
        threads_posts/youtube_posts), và `post_call_results` cũng không lưu SĐT — SĐT chỉ
        có thể suy ra bằng regex trên `content`, giống hệt cách PostCard hiển thị SĐT
        (`_extract_phone_from_text` ở `unified_posts_service.py`). Nguồn thay thế
        `auto_seeding_comments.phone_number`/`zalo_inbox_kpi.phone_number` KHÔNG dùng được
        vì chỉ tồn tại cho Facebook+LinkedIn (không có Threads/YouTube) và chỉ có dòng cho
        bài đã qua bot auto-seeding, không phải mọi bài "phù hợp".

        Viết hàm riêng thay vì sửa `_get_suitable_post_ids` (trả `set[str]` id, đang được
        nhiều nơi khác dùng) vì ở đây cần thêm cột `content` (text) — SELECT nặng hơn, nên
        tách riêng thay vì đổi kiểu trả về của hàm dùng chung.
        """
        platform_table_pairs = (
            [(platform, _POST_TABLE_BY_PLATFORM[platform])]
            if platform in _POST_TABLE_BY_PLATFORM
            else list(_POST_TABLE_BY_PLATFORM.items())
        )
        unique_phones: set[str] = set()
        for plat, table in platform_table_pairs:
            try:
                post_rows = execute_supabase_query(
                    lambda t=table: supabase.table(t)
                    .select("id, content")
                    .gte("crawl_date", gte_utc)
                    .lte("crawl_date", lte_utc)
                    .execute()
                ).data or []
            except Exception as exc:
                logger.warning(f"get_call_result_stats: lỗi đọc bài để đếm SĐT ở bảng {table}: {exc}")
                continue
            if not post_rows:
                continue
            try:
                unsuitable_rows = execute_supabase_query(
                    lambda p=plat: supabase.table("post_quick_review")
                    .select("post_id")
                    .eq("platform", p)
                    .eq("evaluation_code", "khong-phu-hop")
                    .execute()
                ).data or []
            except Exception as exc:
                logger.warning(
                    f"get_call_result_stats: lỗi đọc post_quick_review (đếm SĐT, platform={plat}): {exc}"
                )
                unsuitable_rows = []
            unsuitable_ids = {str(r["post_id"]) for r in unsuitable_rows if r.get("post_id") is not None}
            for row in post_rows:
                pid = row.get("id")
                if pid is None or str(pid) in unsuitable_ids:
                    continue
                phone = _extract_phone_from_text(row.get("content"))
                if phone:
                    unique_phones.add(phone)
        return len(unique_phones)

    total_posts_count = _count_crawled_posts(start_utc, end_utc)
    total_posts_count_prev = _count_crawled_posts(prev_start_utc, prev_end_utc)
    # Card "Tổng bài": LUÔN toàn cục, không lọc theo thành viên (giữ nguyên hành vi/tooltip cũ).
    suitable_post_ids = _get_suitable_post_ids(start_utc, end_utc)
    total_posts_suitable_count = len(suitable_post_ids)
    total_unique_phones_count = _count_unique_phones(start_utc, end_utc)

    # Card "Comment" — Việc 3+4 (2026-11-23):
    # - X (comment_distinct_post_count): luôn so với tập "phù hợp" TOÀN CỤC ở trên (lý do xem
    #   docstring _count_commented_posts_suitable). comment_distinct_post_count_prev dùng để
    #   tính % xu hướng TRÊN X (quyết định đã chốt), không còn theo delta tuyệt đối của "lượt".
    # - comment_post_pool_count (mẫu số Y RIÊNG cho card Comment, KHÔNG dùng chung với
    #   total_posts_suitable_count): khi có `member_id` cụ thể (khác "Tất cả thành viên"), thu
    #   hẹp về đúng phạm vi bài của thành viên đó; không thì bằng chính total_posts_suitable_count.
    comment_distinct_post_count = _count_commented_posts_suitable(start_utc, end_utc, suitable_post_ids)
    suitable_post_ids_prev = _get_suitable_post_ids(prev_start_utc, prev_end_utc)
    comment_distinct_post_count_prev = _count_commented_posts_suitable(
        prev_start_utc, prev_end_utc, suitable_post_ids_prev
    )
    comment_post_pool_count = (
        total_posts_suitable_count
        if not member_id
        else len(_get_suitable_post_ids(start_utc, end_utc, scope_member_id=member_id))
    )

    return {
        "by_type": by_type,
        "by_member": by_member,
        "by_day": by_day,
        "total": total,
        "comment_count": comment_count,
        "comment_count_prev": comment_count_prev,
        "comment_distinct_post_count": comment_distinct_post_count,
        "comment_distinct_post_count_prev": comment_distinct_post_count_prev,
        "comment_post_pool_count": comment_post_pool_count,
        "total_posts_count": total_posts_count,
        "total_posts_count_prev": total_posts_count_prev,
        "total_posts_suitable_count": total_posts_suitable_count,
        "total_unique_phones_count": total_unique_phones_count,
        "range": {"start": start_d.isoformat(), "end": end_d.isoformat()},
    }


def get_overdue_callbacks_count(
    user: dict[str, Any],
    team_id: Optional[str] = None,
    member_id: Optional[str] = None,
    platform: Optional[str] = None,
    threshold_days: int = 1,
) -> int:
    """Số bài có kết quả liên hệ MỚI NHẤT là 'callback' (hẹn gọi lại) nhưng đã quá
    `threshold_days` kể từ `last_call_at` mà chưa có lần gọi mới hơn — dùng cho thẻ
    KPI/cảnh báo "Hẹn gọi lại quá hạn" ở Dashboard Leader.

    `post_call_results` là upsert theo `(post_id, platform)` nên mỗi dòng LUÔN là kết
    quả gần nhất của bài đó — không cần join lịch sử để biết "còn hiệu lực" hay không.
    """
    supabase = get_supabase_client()
    allowed_member_ids = _resolve_scoped_member_ids(user, member_id, team_id)
    threshold_utc = (datetime.now(timezone.utc) - timedelta(days=max(0, threshold_days))).isoformat()

    query = (
        supabase.table("post_call_results")
        .select("id", count="exact")
        .eq("result_code", "callback")
        .lt("last_call_at", threshold_utc)
        .limit(1)
    )
    if platform:
        query = query.eq("platform", platform)
    if allowed_member_ids is not None:
        query = query.in_("updated_by", allowed_member_ids or [_UNREACHABLE_ID])

    res = execute_supabase_query(lambda: query.execute())
    return int(res.count or 0)


def _parse_date_safe(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


_FRACTION_SECONDS_RE = re.compile(r"\.(\d+)(?=[+-]\d{2}(?::?\d{2})?$|$)")


def _normalize_fraction_seconds(value: str) -> str:
    """Chuẩn hoá phần lẻ giây về đúng 6 chữ số (pad '0' hoặc cắt bớt).

    Postgres/PostgREST bỏ số 0 ở cuối phần lẻ giây (vd ``05.12345+00:00``), trong khi
    ``datetime.fromisoformat`` của Python < 3.11 (image backend ``playwright/python:*-jammy``)
    chỉ nhận đúng 3 hoặc 6 chữ số -> ValueError.
    """
    return _FRACTION_SECONDS_RE.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), value, count=1)


def _to_vn_day_str(value: Optional[str], context: Optional[str] = None) -> Optional[str]:
    """Chuyển timestamptz (UTC, dạng ISO trả về từ PostgREST) sang ngày theo giờ VN.

    Timestamp hỏng thật sự -> log warning (kèm ``context``, vd tên bảng/cột + id dòng) và trả
    None, KHÔNG làm sập cả request.
    """
    if not value:
        return None
    raw = str(value)
    try:
        dt = datetime.fromisoformat(_normalize_fraction_seconds(raw.strip().replace("Z", "+00:00")))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(VN_TZ).date().isoformat()
    except ValueError:
        logger.warning(f"_to_vn_day_str: không parse được timestamp {raw!r} (context={context}) -> bỏ qua dòng")
        return None

