"""KPI endpoints — platform-agnostic."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, List, Optional
from supabase import Client
from loguru import logger

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.services.supabase_kpi_service import (
    VN_TZ,
    _vn_week_range_to_utc,
)

from app.modules.all_platform.schemas import (
    AssignKpiRequest,
    GetKpiByEmailRequest,
    GetAllKpiRequest,
    CheckPermissionRequest,
    VerifyLeaderCodeRequest,
    UpdateRoleToMemberRequest,
    SyncProgressRequest,
    BaseResponse,
)
from app.modules.all_platform.services import (
    assign_kpi,
    get_all_kpis_for_leader,
    get_kpi_by_email,
    get_kpi_inbox_progress_by_email,
    sync_kpi_progress,
    check_permission,
    verify_leader_code,
    update_user_role_to_member,
    count_fb_inbox_kpi,
    get_fb_inbox_kpi_summary,
    get_pending_fb_inbox_kpi,
)
from app.modules.all_platform.services.supabase_kpi_service import (
    _compute_fb_inbox_progress,
    get_team_kpi_overview_v2,
    get_team_kpi_overview_v2_rpc,
    _build_team_kpi_history_optimized,
    invalidate_overview_cache,
)

router = APIRouter()


def _role(user: dict) -> str:
    return str(user.get("role") or "member").strip().lower()


def _require_leader_or_admin(user: dict) -> None:
    """Chi leader/admin duoc gan/duyet KPI cho nguoi khac."""
    if _role(user) not in ("admin", "leader"):
        raise HTTPException(status_code=403, detail="Chi leader/admin duoc thao tac KPI nay")


def _require_admin(user: dict) -> None:
    if _role(user) != "admin":
        raise HTTPException(status_code=403, detail="Chi admin duoc thao tac nay")


def _require_view_access(user: dict, target_email: Optional[str]) -> None:
    """Admin/leader xem KPI cua bat ky ai; member chi xem cua chinh minh.

    Truoc day toan bo router nay khong co Depends() nao ca -> ai cung xem/sua
    duoc KPI cua bat ky email nao chi can biet/doan email. Gio bat buoc phai
    dang nhap, va member chi duoc xem du lieu cua chinh minh.
    """
    if _role(user) in ("admin", "leader"):
        return
    caller_email = str(user.get("email") or "").strip().lower()
    target = str(target_email or "").strip().lower()
    if caller_email and target and caller_email == target:
        return
    raise HTTPException(status_code=403, detail="Khong co quyen xem KPI cua nguoi khac")


def _require_self_or_leader(user: dict, target_email: Optional[str]) -> None:
    """Nhu _require_view_access nhung dung cho hanh dong GHI cua chinh member
    (vd tu de xuat inbox KPI cho ban than)."""
    _require_view_access(user, target_email)


@router.post("/assign")
def kpi_assign(payload: AssignKpiRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Leader assigns KPI to a member."""
    try:
        _require_leader_or_admin(user)
        data = assign_kpi(payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="KPI assigned", data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Bulk Assign KPI ───────────────────────────────────────────────────────────

from pydantic import BaseModel, Field


class BulkAssignMemberItem(BaseModel):
    email: str
    profile_slug: str = ""
    kpi_comment: int = 0
    kpi_post: int = 0
    kpi_call: int = 0
    kpi_lead: int = 0
    kpi_inbox: int = 0


class BulkAssignKpiRequest(BaseModel):
    leader_email: str
    id_team: str
    start_day: str
    end_day: str
    members: List[BulkAssignMemberItem] = Field(..., min_length=1)
    platform: str = "Facebook"


@router.post("/bulk-assign")
def kpi_bulk_assign(payload: BulkAssignKpiRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Leader assigns KPI hàng loạt cho nhiều thành viên cùng lúc.

    Nhanh hơn gọi /assign N lần vì chỉ cần 1 round-trip.
    """
    try:
        _require_leader_or_admin(user)
        from app.modules.all_platform.services.supabase_kpi_service import assign_kpi as _assign_one

        results: List[dict] = []
        for member in payload.members:
            try:
                call_val = member.kpi_call or member.kpi_post
                result = _assign_one({
                    "leader_role": "leader",
                    "role": "member",
                    "email": member.email,
                    "profile_slug": member.profile_slug or member.email,
                    "email_leader": payload.leader_email,
                    "id_team": payload.id_team,
                    "kpi": [{
                        "start_day": payload.start_day,
                        "end_day": payload.end_day,
                        "kpi_comment": member.kpi_comment,
                        "kpi_post": call_val,
                        "kpi_call": call_val,
                        "kpi_lead": member.kpi_lead,
                        "kpi_inbox": member.kpi_inbox,
                    }],
                    "platform": payload.platform,
                })
                results.append({
                    "email": member.email,
                    "success": True,
                    "message": "KPI assigned",
                })
            except Exception as exc:
                logger.error(f"kpi_bulk_assign: failed for {member.email}: {exc}")
                results.append({
                    "email": member.email,
                    "success": False,
                    "message": str(exc),
                })

        success_count = sum(1 for r in results if r["success"])
        # Invalidate cache để dashboard reload data mới
        invalidate_overview_cache(payload.leader_email)

        return BaseResponse(success=True, data={
            "total": len(results),
            "success_count": success_count,
            "failed_count": len(results) - success_count,
            "results": results,
            "message": f"Đã giao KPI cho {success_count}/{len(results)} thành viên",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"kpi_bulk_assign error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/get-all")
def kpi_get_all(payload: GetAllKpiRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Leader gets all KPIs for their team members."""
    try:
        _require_leader_or_admin(user)
        data = get_all_kpis_for_leader(
            leader_email=payload.email_leader,
            id_team=payload.id_team,
            start_date=payload.start_date,
            end_date=payload.end_date
        )
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class TeamKpiHistoryRequest(BaseModel):
    leader_email: Optional[str] = Field(None, description="Lọc theo leader. Bỏ trống = admin (tất cả team).")
    weeks: int = Field(4, ge=1, le=12, description="Số tuần gần nhất cần lấy (mặc định 4).")


@router.post("/team-history-v2")
def team_kpi_history_v2(payload: TeamKpiHistoryRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Phase 4 (admin perf) — phiên bản tối ưu của /team-history.

    Cải thiện so với endpoint cũ (admin dashboard load chậm):
      • In-memory cache TTL 30s (key theo leader_email|weeks) — request thứ 2
        trong 30s là instant, dùng chung cache với V2/V3 overview.
      • Pre-index `inbox_rows` / `post_rows` thành dict theo member + week
        trước khi lặp week × team → tránh O(W × T × len(rows)) của hàm cũ.
      • Bulk query giới hạn lte `latest_end_dt` → không kéo dữ liệu quá cũ.

    Schema trả về giống hệt /team-history để FE có thể swap endpoint dễ dàng.
    Endpoint cũ /team-history vẫn hoạt động bình thường cho leader (đã ổn định).
    """
    try:
        if payload.leader_email:
            _require_leader_or_admin(user)
        else:
            _require_admin(user)  # bo trong leader_email = xem TAT CA team
        data = _build_team_kpi_history_optimized(
            leader_email=payload.leader_email,
            weeks=payload.weeks,
        )
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"team-history-v2 error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/get-team-overview-v2")
def kpi_get_team_overview_v2(payload: GetAllKpiRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Phase 1 — phiên bản tối ưu của /kpi/get-all.

    Khác biệt so với endpoint cũ:
      • Batch queries (≈7 truy vấn cố định thay vì N×5).
      • 1 HTTP call tới seeder service (batch) thay vì N.
      • In-memory cache 30s (tự invalidate khi assign_kpi / verify inbox).
      • Schema trả về tương thích với /kpi/get-all — FE có thể swap dần.

    FE nên chuyển sang endpoint này để cải thiện tốc độ tải team lớn.
    Endpoint /kpi/get-all vẫn được giữ nguyên để rollback an toàn.
    """
    try:
        _require_leader_or_admin(user)
        data = get_team_kpi_overview_v2(
            leader_email=payload.email_leader,
            id_team=payload.id_team,
            start_date=payload.start_date or "",
            end_date=payload.end_date or "",
        )
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"kpi_get_team_overview_v2 error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/get-team-overview-v3")
def kpi_get_team_overview_v3(payload: GetAllKpiRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Phase 2 — gọi RPC `get_team_kpi_overview` của Supabase (1 round-trip).

    Nhanh nhất trong 3 phiên bản (RPC + server-side aggregate).
    Tự fallback về /get-team-overview-v2 nếu RPC chưa được deploy.
    """
    try:
        _require_leader_or_admin(user)
        data = get_team_kpi_overview_v2_rpc(
            leader_email=payload.email_leader,
            id_team=payload.id_team,
            start_date=payload.start_date or "",
            end_date=payload.end_date or "",
        )
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"kpi_get_team_overview_v3 error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/get-by-email")
def kpi_get_by_email(payload: GetKpiByEmailRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Get KPI for a specific member."""
    try:
        _require_view_access(user, payload.email)
        data = get_kpi_by_email(payload.email)
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/sync-all")
def kpi_sync_all(payload: SyncProgressRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Sync engagement progress from posts."""
    try:
        _require_view_access(user, payload.email)
        data = sync_kpi_progress(payload.email, payload.posts)
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Zalo inbox KPI ───────────────────────────────────────────────────────────


class ZaloInboxProgressRequest(BaseModel):
    email: str = Field(..., min_length=3, description="Email member (app_users.email)")
    start_date: str = Field("", description="YYYY-MM-DD, mặc định = Monday tuần hiện tại")
    end_date: str = Field("", description="YYYY-MM-DD, mặc định = Sunday tuần hiện tại")


@router.post("/zalo-inbox-progress")
def zalo_inbox_progress(payload: ZaloInboxProgressRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Tính số tin nhắn Zalo khách gửi tới member trong khoảng [start_date, end_date].

    Phục vụ progress bar "Tin nhắn KPI" — chỉ đếm ``is_sent=false`` trên
    tất cả Zalo accounts mà member này đang sở hữu.
    """
    try:
        _require_view_access(user, payload.email)
        start = payload.start_date.strip() or None
        end = payload.end_date.strip() or None
        data = get_kpi_inbox_progress_by_email(
            payload.email.strip().lower(),
            start,
            end,
        )
        return BaseResponse(success=True, data=data or {
            "kpi_inbox_current": 0,
            "account_ids": [],
            "range": {"start": start or "", "end": end or ""},
        })
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class FbInboxProgressRequest(BaseModel):
    email: str = Field(..., min_length=3, description="Email member (app_users.email)")
    start_date: str = Field("", description="YYYY-MM-DD, mặc định = Monday tuần hiện tại")
    end_date: str = Field("", description="YYYY-MM-DD, mặc định = Sunday tuần hiện tại")


class FbInboxProgressBulkRequest(BaseModel):
    emails: List[str] = Field(..., min_length=1, description="Danh sách email member (app_users.email)")
    start_date: str = Field("", description="YYYY-MM-DD, mặc định = Monday tuần hiện tại")
    end_date: str = Field("", description="YYYY-MM-DD, mặc định = Sunday tuần hiện tại")


class SyncFbInboxRequest(BaseModel):
    """Yêu cầu đếm/tính inbox KPI cho 1 hoặc nhiều hội thoại FB.
    Sau khi leader/admin xác nhận hội thoại là lead, gọi endpoint này."""
    leader_email: str = Field(..., min_length=3)
    member_email: str = Field(..., min_length=3)
    conv_ids: List[str] = Field(..., min_length=1)
    user_id: str = Field(..., description="FB user_id (account)")
    is_lead: bool = Field(False, description="Đánh dấu là lead tiềm năng")


class GetFbInboxKpiSummaryRequest(BaseModel):
    email: str = Field(..., min_length=3)
    start_date: str = Field("", description="YYYY-MM-DD")
    end_date: str = Field("", description="YYYY-MM-DD")


class BulkVerifyInboxRequest(BaseModel):
    leader_email: str = Field(..., min_length=3)
    target_date: str = Field(..., description="YYYY-MM-DD")


def _resolve_email_to_member_id(supabase: Client, emails: List[str]) -> Dict[str, str]:
    """Map email -> app_users.id.

    `_compute_fb_inbox_progress`/seeder nhận UUID (owner mà extension gửi khi
    provision cookie là app_users.id, không phải email — xem chú thích ở
    supabase_kpi_service._compute_fb_inbox_progress). API công khai của 2
    endpoint dưới đây vẫn nhận/trả email để không đổi contract phía frontend,
    nên phải resolve ở biên router này.
    """
    if not emails:
        return {}
    res = (
        supabase.table("app_users")
        .select("id, email")
        .in_("email", emails)
        .execute()
    )
    return {str(r["email"]).strip().lower(): str(r["id"]) for r in (res.data or []) if r.get("email")}


@router.post("/fb-inbox-progress")
def fb_inbox_progress(payload: FbInboxProgressRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Tính số tin nhắn Facebook Messenger khách gửi tới member trong khoảng [start_date, end_date].

    Gọi seeder service để đếm tin nhắn ``from='them'`` trong khoảng tuần KPI.
    Seeder service lưu tin nhắn vào data/inbox_messages/{owner}/{yyyy-MM-dd}.json.
    """
    try:
        _require_view_access(user, payload.email)
        email = payload.email.strip().lower()
        start = payload.start_date.strip()
        end = payload.end_date.strip()

        if not start or not end:
            today_d = datetime.now(VN_TZ).date()
            monday = today_d - timedelta(days=today_d.weekday())
            sunday = monday + timedelta(days=6)
            start = start or monday.isoformat()
            end = end or sunday.isoformat()

        supabase: Client = get_supabase_client()
        email_to_id = _resolve_email_to_member_id(supabase, [email])
        member_id = email_to_id.get(email)
        if not member_id:
            return BaseResponse(
                success=True,
                data={"kpi_fb_inbox_count": 0, "range": {"start": start, "end": end}},
            )

        result = _compute_fb_inbox_progress([member_id], start, end)
        data = result.get(member_id, {"kpi_fb_inbox_count": 0, "range": {"start": start, "end": end}})
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/fb-inbox-progress-bulk")
def fb_inbox_progress_bulk(payload: FbInboxProgressBulkRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """"Khách reply" - dem tin nhan Facebook Messenger tu khach (from='them') toi
    tung member trong danh sach, trong khoang [start_date, end_date].

    1 truy van batch cho ca team (tranh N+1 goi /fb-inbox-progress rieng le
    cho tung thanh vien). Khac voi "KPI Inbox" (fb_inbox_kpi, chi tinh hoi
    thoai DA duoc leader xac nhan) - day la SO TIN NHAN THUC TE khach gui,
    khong phu thuoc da xac nhan KPI hay chua.
    """
    try:
        # Bulk = xem nhieu member cung luc -> chi leader/admin duoc goi (member
        # chi xem duoc chinh minh qua /fb-inbox-progress don le o tren).
        _require_leader_or_admin(user)
        emails = [e.strip().lower() for e in payload.emails if e.strip()]
        start = payload.start_date.strip()
        end = payload.end_date.strip()

        if not start or not end:
            today_d = datetime.now(VN_TZ).date()
            monday = today_d - timedelta(days=today_d.weekday())
            sunday = monday + timedelta(days=6)
            start = start or monday.isoformat()
            end = end or sunday.isoformat()

        supabase: Client = get_supabase_client()
        email_to_id = _resolve_email_to_member_id(supabase, emails)
        id_to_email = {v: k for k, v in email_to_id.items()}
        member_ids = list(email_to_id.values())

        by_id = _compute_fb_inbox_progress(member_ids, start, end)
        default_data = {"kpi_fb_inbox_count": 0, "range": {"start": start, "end": end}}
        # Trả về email-keyed để giữ contract cũ cho frontend; email nào không
        # resolve được id (chưa có app_users) thì mặc định 0.
        result = {
            email: by_id.get(email_to_id.get(email, ""), default_data)
            for email in emails
        }
        return BaseResponse(success=True, data=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"fb_inbox_progress_bulk error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/fb-inbox-sync")
def fb_inbox_sync(payload: SyncFbInboxRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Xác nhận/duyệt KPI inbox cho 1 hoặc nhiều hội thoại FB.

    Được gọi khi leader/admin bấm nút "Xác nhận KPI" trên hộp thoại FB.
    Update is_confirmed = TRUE cho các row đã được member đề xuất.
    Nếu is_lead=True -> đánh dấu là lead tiềm năng.
    """
    try:
        supabase: Client = get_supabase_client()
        leader_email = payload.leader_email.strip().lower()
        member_email = payload.member_email.strip().lower()
        user_id = payload.user_id.strip()

        # Member tu dong/tu tay xac nhan KPI cho CHINH minh (vd bam "La khach"
        # hoac "Xac nhan Lead" tren hoi thoai cua chinh acc FB minh dang lam) thi
        # khong can leader/admin duyet - chi khi thao tac HO nguoi khac (leader
        # xac nhan KPI thay cho 1 member khac) moi bat buoc leader/admin. Truoc
        # day check nay chan CA truong hop tu xac nhan, khien acc role "user" bam
        # "La khach" bi 403 im lang (frontend nuot loi) va KPI khong bao gio duoc
        # ghi - xem CLAUDE.md 2026-07-27.
        from app.modules.all_platform.services.fb_inbox_account_service import resolve_id_member

        caller_email = str(user.get("email") or "").strip().lower()
        if caller_email != member_email:
            _require_leader_or_admin(user)

        # Get leader ID
        leader_res = supabase.table("app_users").select("id").eq("email", leader_email).limit(1).execute()
        if not leader_res.data:
            return BaseResponse(success=False, message=f"Không tìm thấy leader với email: {leader_email}")
        id_leader = leader_res.data[0]["id"]

        # Resolve id_member tu chinh tai khoan FB (user_id) dang duoc xac nhan -
        # KHONG dua vao payload.member_email, vi FE co the truyen nham email cua
        # nguoi dang dang nhap (leader) thay vi email cua member so huu tai khoan
        # dang xem (gay KPI bi gan nham cho leader thay vi member thuc su lam viec).
        # Day la cung 1 ham resolve_id_member() da dung o count_fb_inbox_kpi.
        id_member: Optional[str] = resolve_id_member(user_id)
        if not id_member:
            # Fallback: thu resolve qua member_email neu tai khoan FB chua duoc
            # dang ky trong fb_inbox_accounts (vd chua bam "Bat tinh KPI").
            if member_email:
                member_res = supabase.table("app_users").select("id").eq("email", member_email).limit(1).execute()
                if member_res.data:
                    id_member = member_res.data[0]["id"]
        if not id_member:
            return BaseResponse(
                success=False,
                message=(
                    f"Không tìm thấy member sở hữu FB account [{user_id}]. "
                    f"Vui lòng vào Quản lý tài khoản seeding -> bấm 'Bật tính KPI' cho tài khoản này trước."
                ),
            )

        now = datetime.now(timezone.utc).isoformat()
        synced = 0
        lead = 0

        for conv_id in payload.conv_ids:
            # Find existing row (may be created by member's suggest)
            existing = (
                supabase.table("fb_inbox_kpi")
                .select("id, is_confirmed, is_lead, message_count")
                .eq("conv_id", conv_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )

            if existing.data:
                row = existing.data[0]
                # Update: set is_confirmed = True, va sua lai id_member cho dung
                # chu so huu that su (phong khi row cu bi tao sai truoc khi fix nay).
                update_data = {"is_confirmed": True, "synced_at": now, "id_member": id_member}
                if payload.is_lead and not row.get("is_lead"):
                    update_data["is_lead"] = True
                    lead += 1
                supabase.table("fb_inbox_kpi").update(update_data).eq("id", row["id"]).execute()
                synced += 1
            else:
                # Row chưa tồn tại - tạo mới với is_confirmed = True
                supabase.table("fb_inbox_kpi").insert({
                    "id_member": id_member,
                    "id_leader": id_leader,
                    "conv_id": conv_id,
                    "user_id": user_id,
                    "message_count": 1,
                    "is_lead": payload.is_lead,
                    "is_confirmed": True,
                    "synced_at": now,
                }).execute()
                synced += 1
                if payload.is_lead:
                    lead += 1

        # Invalidate cache 30s cua get_team_kpi_overview_v2_rpc - thieu dong nay
        # khien bang KPI team (vd trang quan ly team) van hien so cu toi 30s sau
        # khi leader vua bam "Xac nhan Lead" o Inbox, du da chuyen trang/F5.
        invalidate_overview_cache(leader_email)

        return BaseResponse(success=True, data={
            "synced": synced,
            "lead": lead,
            "member_email": member_email,
            "message": f"Đã xác nhận {synced} inbox KPI" + (f", {lead} lead" if lead else ""),
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"fb_inbox_sync error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/fb-inbox-bulk-verify")
def fb_inbox_bulk_verify(payload: BulkVerifyInboxRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Xác nhận KPI inbox hàng loạt cho Leader trong 1 ngày cụ thể."""
    try:
        _require_leader_or_admin(user)
        supabase: Client = get_supabase_client()
        leader_email = payload.leader_email.strip().lower()
        target_date = payload.target_date.strip()

        # Get leader ID
        leader_res = supabase.table("app_users").select("id").eq("email", leader_email).limit(1).execute()
        if not leader_res.data:
            return BaseResponse(success=False, message=f"Không tìm thấy leader với email: {leader_email}")
        id_leader = leader_res.data[0]["id"]

        now = datetime.now(timezone.utc).isoformat()
        # target_date là NGÀY GIỜ VN. Cột thời gian lưu UTC, nên phải quy đổi —
        # trước đây so chuỗi "YYYY-MM-DDT00:00:00" (naive) với timestamp UTC làm
        # hội thoại lúc rạng sáng giờ VN rơi nhầm sang ngày UTC hôm trước.
        # Lọc theo created_at (ổn định) thay vì synced_at (bị ghi đè mỗi lần xác
        # nhận lại) — xem migration 022_fix_fb_inbox_week_bucket.sql.
        start_ts, end_ts = _vn_week_range_to_utc(target_date, target_date)

        # Cập nhật tất cả các record chưa được xác nhận của leader này trong ngày target_date
        update_res = (
            supabase.table("fb_inbox_kpi")
            .update({"is_confirmed": True, "synced_at": now})
            .eq("id_leader", id_leader)
            .eq("is_confirmed", False)
            .gte("created_at", start_ts)
            .lte("created_at", end_ts)
            .execute()
        )
        
        updated_count = len(update_res.data or [])

        # Invalidate KPI overview cache so dashboard refreshes immediately
        invalidate_overview_cache(leader_email)

        return BaseResponse(success=True, data={
            "synced": updated_count,
            "message": f"Đã tính KPI hàng loạt thành công cho {updated_count} hội thoại trong ngày {target_date}"
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"fb_inbox_bulk_verify error: {e}")
        return BaseResponse(success=False, message=str(e))


class SuggestInboxKpiRequest(BaseModel):
    """Request model cho member tự đề xuất KPI inbox cho mình."""
    member_email: str = Field(..., min_length=3, description="Email của member tự đề xuất")
    conv_ids: List[str] = Field(..., min_length=1, description="Danh sách conv_ids cần tính KPI")
    user_id: str = Field(..., description="FB user_id (account)")


@router.post("/fb-inbox-suggest")
def suggest_inbox_kpi(payload: SuggestInboxKpiRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Member tự đề xuất KPI inbox cho mình.

    Flow:
    1. Tìm member thuộc team nào -> Lấy id_leader của team đó
    2. Resolve id_member từ fb_inbox_accounts hoặc app_users
    3. Insert vào fb_inbox_kpi với is_confirmed = FALSE

    Leader sẽ thấy các inbox đã được đề xuất khi filter "Chưa tính KPI".
    Mỗi conv_id = 1 inbox KPI tiềm năng (không phân biệt có rep hay không).
    """
    try:
        # Member tu de xuat cho chinh minh, hoac leader/admin de xuat ho.
        _require_self_or_leader(user, payload.member_email)
        member_email = payload.member_email.strip().lower()
        supabase: Client = get_supabase_client()

        # 1. Get member ID from email
        member_res = supabase.table("app_users").select("id").eq("email", member_email).limit(1).execute()
        if not member_res.data:
            return BaseResponse(success=False, message=f"Không tìm thấy member với email: {member_email}")
        id_member = member_res.data[0]["id"]

        # 2. Find which team this member belongs to
        member_teams_res = (
            supabase.table("member_of_teams")
            .select("id_teams")
            .eq("id_member", id_member)
            .limit(1)
            .execute()
        )

        id_leader = id_member  # fallback: member is their own leader
        if member_teams_res.data:
            id_team = member_teams_res.data[0]["id_teams"]
            # 3. Get leader ID from team
            team_res = supabase.table("teams").select("id_leader").eq("id", id_team).limit(1).execute()
            if team_res.data:
                id_leader = team_res.data[0]["id_leader"]

        logger.info(f"suggest_inbox_kpi: member={member_email}, id_member={id_member}, id_leader={id_leader}")

        # 4. Resolve id_member từ user_id (FB account) nếu có
        from app.modules.all_platform.services.fb_inbox_account_service import resolve_id_member
        resolved_id_member = resolve_id_member(payload.user_id)
        if resolved_id_member:
            id_member = resolved_id_member

        now = datetime.now(timezone.utc).isoformat()
        synced_count = 0

        for conv_id in payload.conv_ids:
            # Check if already exists
            existing = (
                supabase.table("fb_inbox_kpi")
                .select("id, is_confirmed")
                .eq("id_member", id_member)
                .eq("conv_id", conv_id)
                .eq("user_id", payload.user_id.strip())
                .limit(1)
                .execute()
            )

            if existing.data:
                row = existing.data[0]
                if not row.get("is_confirmed"):
                    # Cập nhật synced_at nếu chưa confirm
                    supabase.table("fb_inbox_kpi").update(
                        {"synced_at": now}
                    ).eq("id", row["id"]).execute()
                    synced_count += 1
            else:
                # Insert mới với is_confirmed = FALSE
                supabase.table("fb_inbox_kpi").insert({
                    "id_member": id_member,
                    "id_leader": id_leader,
                    "conv_id": conv_id,
                    "user_id": payload.user_id.strip(),
                    "message_count": 1,
                    "is_lead": False,
                    "is_confirmed": False,
                    "synced_at": now,
                }).execute()
                synced_count += 1

        return BaseResponse(success=True, data={
            "synced": synced_count,
            "member_email": member_email,
            "id_member": id_member,
            "id_leader": id_leader,
            "conv_ids": payload.conv_ids,
            "message": f"Đã đề xuất {synced_count} inbox cho KPI (chờ leader duyệt)",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"suggest_inbox_kpi error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/fb-inbox-summary")
def fb_inbox_summary(payload: GetFbInboxKpiSummaryRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Lấy tổng hợp inbox KPI ĐÃ XÁC NHẬN từ fb_inbox_kpi table (Supabase).

    Dùng để hiển thị breakdown cho leader/admin trong team management.
    """
    try:
        _require_view_access(user, payload.email)
        start = payload.start_date.strip() or ""
        end = payload.end_date.strip() or ""
        result = get_fb_inbox_kpi_summary(
            member_email=payload.email.strip().lower(),
            start_date=start or None,
            end_date=end or None,
        )
        return BaseResponse(success=True, data=result)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/fb-inbox-pending")
def fb_inbox_pending(payload: GetFbInboxKpiSummaryRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Lấy danh sách inbox KPI CHƯA XÁC NHẬN từ fb_inbox_kpi table (Supabase).

    Dùng cho filter "Chưa xác minh" - hiển thị inbox member đã đề xuất
    nhưng leader/admin chưa duyệt (is_confirmed=False).
    """
    try:
        _require_view_access(user, payload.email)
        start = payload.start_date.strip() or ""
        end = payload.end_date.strip() or ""
        result = get_pending_fb_inbox_kpi(
            member_email=payload.email.strip().lower(),
            start_date=start or None,
            end_date=end or None,
        )
        return BaseResponse(success=True, data=result)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post("/auth/check-permission")
def auth_check_permission(payload: CheckPermissionRequest) -> BaseResponse:
    """Check if user is leader or member."""
    try:
        data = check_permission(payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/auth/verify-leader-code")
def auth_verify_leader_code(payload: VerifyLeaderCodeRequest) -> BaseResponse:
    """Verify leader authorization code."""
    try:
        data = verify_leader_code(payload.code)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/auth/update-role-to-member")
def auth_update_role(payload: UpdateRoleToMemberRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Update user role to member.

    Truoc day khong co Depends() nao ca -> ai cung ha cap duoc role cua bat
    ky email nao (ke ca admin) ve "member". Gio bat buoc phai la admin.
    """
    try:
        _require_admin(user)
        data = update_user_role_to_member(payload.email)
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Verified Inbox Conv IDs ─────────────────────────────────────────────────


class GetVerifiedConvIdsRequest(BaseModel):
    leader_email: str = Field(..., min_length=3)
    id_team: Optional[str] = Field(None, description="Team ID filter")
    start_date: str = Field("", description="YYYY-MM-DD, mặc định = Monday tuần hiện tại")
    end_date: str = Field("", description="YYYY-MM-DD, mặc định = Sunday tuần hiện tại")


@router.post("/fb-inbox-verified-ids")
def get_verified_fb_inbox_ids(payload: GetVerifiedConvIdsRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Lấy danh sách conv_ids đã xác nhận KPI inbox trong tuần hiện tại.

    Dùng cho frontend filter "Chưa tính KPI" trong inbox page.
    Trả về tất cả conv_ids đã được xác nhận trong khoảng [start_date, end_date].
    """
    try:
        _require_leader_or_admin(user)
        leader_email = payload.leader_email.strip().lower()
        id_team = payload.id_team.strip() if payload.id_team else None

        # Default date range: current week
        start = payload.start_date.strip()
        end = payload.end_date.strip()
        if not start or not end:
            today_d = datetime.now(VN_TZ).date()
            monday = today_d - timedelta(days=today_d.weekday())
            sunday = monday + timedelta(days=6)
            start = start or monday.isoformat()
            end = end or sunday.isoformat()

        supabase: Client = get_supabase_client()

        # Get all members under this leader
        # First get leader's user id
        leader_res = supabase.table("app_users").select("id").eq("email", leader_email).limit(1).execute()
        if not leader_res.data:
            logger.warning(f"Leader not found: {leader_email}")
            return BaseResponse(success=True, data={
                "verified_conv_ids": [],
                "range": {"start": start, "end": end},
                "member_count": 0
            })

        leader_id = leader_res.data[0]["id"]

        # Get all member IDs under this leader (via teams)
        member_ids = []
        if id_team:
            # Specific team
            members_res = (
                supabase.table("member_of_teams")
                .select("id_member")
                .eq("id_teams", id_team)
                .execute()
            )
            member_ids = [r["id_member"] for r in (members_res.data or []) if r.get("id_member")]
        else:
            # All teams of this leader
            teams_res = (
                supabase.table("teams")
                .select("id")
                .eq("id_leader", leader_id)
                .execute()
            )
            team_ids = [t["id"] for t in (teams_res.data or [])]
            if team_ids:
                members_res = (
                    supabase.table("member_of_teams")
                    .select("id_member")
                    .in_("id_teams", team_ids)
                    .execute()
                )
                member_ids = [r["id_member"] for r in (members_res.data or []) if r.get("id_member")]

        # Include the leader themselves as a member
        member_ids.append(leader_id)
        member_ids = list(set(member_ids))  # remove duplicates

        if not member_ids:
            return BaseResponse(success=True, data={
                "verified_conv_ids": [],
                "range": {"start": start, "end": end},
                "member_count": 0
            })

        # Query fb_inbox_kpi for all these members in the date range - SEPARATE confirmed and pending
        # `start`/`end` là ngày giờ VN -> quy đổi sang UTC trước khi so với cột
        # timestamp (trước đây so chuỗi naive nên lệch tới 7 tiếng quanh nửa đêm).
        # Dùng created_at cho khớp với get_fb_inbox_kpi_summary / overview v2
        # (synced_at bị ghi đè mỗi lần xác nhận lại -> hội thoại cũ trôi tuần).
        start_utc, end_utc = _vn_week_range_to_utc(start, end)
        # "Da xac nhan" o day nghia la da xac nhan LEAD (is_lead=True), khong
        # phai da tinh KPI Inbox - vi Inbox gio tu dong tinh cho hau het reply,
        # neu chi loc theo is_confirmed se hien "Da xac nhan Lead" sai cho ca
        # hoi thoai chi tra loi binh thuong, chua he duoc danh dau la khach.
        #
        # KHONG loc theo created_at o day: is_lead la trang thai vinh vien cua
        # 1 hoi thoai (khong phai KPI theo tuan), con created_at la thoi diem
        # tin nhan DAU TIEN duoc auto-detect - co the tu nhieu tuan truoc, du
        # nguoi dung vua bam "Xac nhan Lead" HOM NAY. Loc theo created_at khien
        # nut hien lai "Chua xac nhan" ngay sau khi bam cho hoi thoai cu (UI
        # optimistic-update bi ghi de boi ket qua refetch thieu dong nay).
        confirmed_rows = (
            supabase.table("fb_inbox_kpi")
            .select("conv_id, synced_at")
            .in_("id_member", member_ids)
            .eq("is_confirmed", True)
            .eq("is_lead", True)
            .execute()
        )
        pending_rows = (
            supabase.table("fb_inbox_kpi")
            .select("conv_id")
            .in_("id_member", member_ids)
            .eq("is_confirmed", False)
            .gte("created_at", start_utc)
            .lte("created_at", end_utc)
            .execute()
        )

        confirmed_ids = list(set(row["conv_id"] for row in (confirmed_rows.data or []) if row.get("conv_id")))
        pending_ids = list(set(row["conv_id"] for row in (pending_rows.data or []) if row.get("conv_id")))
        # conv_id -> thoi diem xac nhan Lead (synced_at) - de FE hien "Da xac
        # nhan KPI tuan X" dung tuan LUC XAC NHAN, khong phai tuan dang xem.
        confirmed_at_by_conv = {
            row["conv_id"]: row["synced_at"]
            for row in (confirmed_rows.data or [])
            if row.get("conv_id") and row.get("synced_at")
        }

        # conv_id -> created_at cua TAT CA hoi thoai da tinh KPI Inbox (khong
        # phan biet co Lead hay khong) - dung created_at (khong phai synced_at)
        # vi day chinh la cot RPC get_team_kpi_overview dung de xac dinh hoi
        # thoai do thuoc tuan nao (xem migration 012). Cho leader biet dung 1
        # hoi thoai cu duoc tinh KPI Inbox vao tuan nao khi xem lai chat.
        inbox_week_rows = (
            supabase.table("fb_inbox_kpi")
            .select("conv_id, created_at")
            .in_("id_member", member_ids)
            .eq("is_confirmed", True)
            .execute()
        )
        inbox_confirmed_at_by_conv = {
            row["conv_id"]: row["created_at"]
            for row in (inbox_week_rows.data or [])
            if row.get("conv_id") and row.get("created_at")
        }

        logger.info(f"fb-inbox-verified-ids: leader={leader_email}, members={len(member_ids)}, confirmed={len(confirmed_ids)}, pending={len(pending_ids)}")

        return BaseResponse(success=True, data={
            "confirmed_conv_ids": confirmed_ids,
            "confirmed_at_by_conv": confirmed_at_by_conv,
            "inbox_confirmed_at_by_conv": inbox_confirmed_at_by_conv,
            "pending_conv_ids": pending_ids,  # đã đề xuất nhưng chưa confirmed
            "range": {"start": start, "end": end},
            "member_count": len(member_ids)
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"fb-inbox-verified-ids error: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/team-history")
def team_kpi_history(payload: TeamKpiHistoryRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Lịch sử KPI theo tuần cho từng team.

    Admin gọi không cần leader_email → trả tất cả team.
    Leader gọi với leader_email của mình → chỉ trả team mình phụ trách.
    Mỗi phần tử = 1 WeeklySnapshot { week_name, teams: [KpiTeamStats] }.
    """
    try:
        if payload.leader_email:
            _require_leader_or_admin(user)
        else:
            _require_admin(user)
        from app.modules.all_platform.services.supabase_kpi_service import get_team_kpi_history
        data = get_team_kpi_history(
            leader_email=payload.leader_email,
            weeks=payload.weeks,
        )
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"team-history error: {e}")
        return BaseResponse(success=False, message=str(e))
