"""Users & Teams endpoints."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user, require_admin, require_admin_or_leader
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import (
    get_user,
    upsert_user,
    admin_create_user,
    update_user_slug,
    update_user_role,
    update_user_active_status,
    update_user_quote_approver,
    update_user_quote_business_role,
    list_users_by_quote_business_role,
    get_member_options,
    get_team_members,
    add_team_member,
    get_all_users,
    get_users_by_role,
    get_all_teams,
    get_all_teams_with_kpi,
    create_team,
    update_team,
    delete_team,
)

router = APIRouter()

# Migration 049 - phai khop CHECK constraint teams_team_type_check.
TEAM_TYPES = (
    "dev", "marketing", "sale", "presales", "technical",
    "back_office", "intern", "freelancer", "khac",
)


@router.get("/me")
def users_get_me(email: str = Query(...), user: dict = Depends(get_current_user)) -> BaseResponse:
    """Get current user profile."""
    try:
        data = get_user(email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/update-slug")
def users_update_slug(payload: dict) -> BaseResponse:
    """Update user's profile slug."""
    try:
        email = payload.get("email")
        slug = payload.get("slug")
        if not email or not slug:
            return BaseResponse(success=False, message="email and slug are required")
        data = update_user_slug(email, slug)
        return BaseResponse(success=True, message="Slug updated", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/update-role")
def users_update_role(payload: dict, _admin: dict = Depends(require_admin)) -> BaseResponse:
    """Update user's role. CHỈ admin — endpoint này trước đây không có auth gì cả,
    bất kỳ ai (kể cả member) cũng tự đổi role mình thành admin được."""
    try:
        email = payload.get("email")
        role = payload.get("role")
        if not email or not role:
            return BaseResponse(success=False, message="email and role are required")
        data = update_user_role(email, role)
        return BaseResponse(success=True, message="Role updated", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/set-active")
def users_set_active(payload: dict, _admin: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    """Admin/leader: kích hoạt/vô hiệu hóa 1 tài khoản (khoá đăng nhập ngay,
    is_active được check lại mỗi request qua get_current_user). Nới cho leader
    theo quyết định 2026-07-23 khi gộp trang Quản lý thành viên + Quản lý
    người dùng thành 1 bảng duy nhất."""
    try:
        email = payload.get("email")
        is_active = payload.get("is_active")
        if not email or is_active is None:
            return BaseResponse(success=False, message="email and is_active are required")
        data = update_user_active_status(email, bool(is_active))
        return BaseResponse(success=True, message="Đã cập nhật trạng thái", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/update-quote-approver")
def users_update_quote_approver(payload: dict, _admin: dict = Depends(require_admin)) -> BaseResponse:
    """Admin-only: bật/tắt quyền duyệt Báo giá cho 1 tài khoản (migration 053)."""
    try:
        email = payload.get("email")
        can_approve_quotes = payload.get("can_approve_quotes")
        if not email or can_approve_quotes is None:
            return BaseResponse(success=False, message="email and can_approve_quotes are required")
        data = update_user_quote_approver(email, bool(can_approve_quotes))
        return BaseResponse(success=True, message="Đã cập nhật quyền duyệt báo giá", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/update-quote-business-role")
def users_update_quote_business_role(payload: dict, _caller: dict = Depends(get_current_user)) -> BaseResponse:
    """CHI Admin THAT (khong phai Leader) - dung yeu cau moi nhat: "Leader
    khong duoc gan hoac thay doi business role cua user". KHONG dung
    Depends(require_admin) o day - ham do (auth_deps.py) that ra cho phep CA
    Leader (`role not in ("admin", "leader")`), ten gay hieu nham - phai tu
    kiem tra role == "admin" that su, giong pattern quotes_hard_delete da
    dung trong quote.py. Leader van dung duoc Presale/Sale/Both NEU duoc
    Admin gan, va van cau hinh duoc Rule/Mail (2 quyen khac, khong lien
    quan). Gan vai tro NGHIEP VU bao gia (Presale/Sale/Both/None) cho 1 tai
    khoan Leader/Member (migration 095) - TACH BIET voi system role
    (admin/leader/member). Khong tao role he thong moi."""
    role = str(_caller.get("role") or "").strip().lower()
    if role != "admin":
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được gán vai trò nghiệp vụ báo giá")
    try:
        email = payload.get("email")
        quote_business_role = payload.get("quote_business_role")
        if not email:
            return BaseResponse(success=False, message="email is required")
        if quote_business_role is not None and quote_business_role not in ("presale", "sale", "both"):
            return BaseResponse(success=False, message="quote_business_role phải là presale/sale/both hoặc null")
        data = update_user_quote_business_role(email, quote_business_role)
        return BaseResponse(success=True, message="Đã cập nhật vai trò báo giá", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/by-quote-business-role")
def users_by_quote_business_role(role: str = Query(...), _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Danh sach nguoi dung du dieu kien lam Presale/Sale phu trach 1 bao
    gia - dung cho owner-picker trong workspace bao gia (moi nguoi dang
    nhap goi duoc, khong chi Admin/Leader - day chi la 1 danh sach de chon,
    khong phai endpoint quan tri)."""
    try:
        if role not in ("presale", "sale"):
            return BaseResponse(success=False, message="role phải là presale hoặc sale")
        return BaseResponse(success=True, data=list_users_by_quote_business_role(role))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/member-options")
def users_member_options(
    active: bool = Query(True),
    include_id: str = Query(""),
    _user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Danh sach nhan su cho cac picker "Người phụ trách" (vi du Nguoi phu
    trach du an) - CHI tra allowlist DTO (khong email/password/token). Bat ky
    ai dang nhap cung goi duoc (day la 1 danh sach de chon, khong phai
    endpoint quan tri). `include_id` (tuy chon, phan cach boi dau phay): ep
    tra THEM 1 vai id cu the du dang bi vo hieu hoa - dung khi mo form Sua 1
    project ma nguoi phu trach hien tai da ngung hoat dong, form van phai
    hien ten nguoi do kem badge "Đã ngưng hoạt động"."""
    try:
        include_ids = [i.strip() for i in include_id.split(",") if i.strip()] if include_id else []
        data = get_member_options(active_only=active, include_ids=include_ids)
        return BaseResponse(success=True, data={"items": data})
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/create")
def users_create(payload: dict, caller: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    """Admin/leader: provision a new login account (app_users row) for someone,
    so they can then sign in with Google using that email. Does not set a
    usable password — Google Sign-In is the only intended login path for
    accounts created this way.

    Leader được tạo member/leader tự do, nhưng KHÔNG được tạo role=admin — nếu
    không sẽ mở đường tự leo thang quyền qua 1 email mới (bypass /update-role,
    vẫn chỉ admin mới đổi được role tài khoản có sẵn)."""
    try:
        email = payload.get("email")
        role = payload.get("role") or "member"
        name = payload.get("name")
        if not email:
            return BaseResponse(success=False, message="email is required")
        if role == "admin" and str(caller.get("role") or "").strip().lower() != "admin":
            return BaseResponse(success=False, message="Chỉ admin mới tạo được tài khoản role admin")
        data = admin_create_user(email=email, name=name, role=role)
        message = "Email đã có tài khoản, đã liên kết vào tài khoản hiện có" if data.get("already_existed") else "Đã tạo tài khoản"
        return BaseResponse(success=True, message=message, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/all-profiles")
def users_get_all(user: dict = Depends(get_current_user)) -> BaseResponse:
    """Get all user profiles."""
    try:
        data = get_all_users()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/by-role")
def users_get_by_role(role: str = Query(...), user: dict = Depends(get_current_user)) -> BaseResponse:
    """Get users filtered by role."""
    try:
        data = get_users_by_role(role)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Teams ──────────────────────────────────────────────────────────────────────

teams_router = APIRouter()


@teams_router.get("/members")
def teams_get_members(leader_id: str = Query(...)) -> BaseResponse:
    """Get all members of a leader's team (by leader id)."""
    try:
        data = get_team_members(leader_id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@teams_router.post("/add-member")
def teams_add_member(payload: dict) -> BaseResponse:
    """Add a member to a leader's team (by ids)."""
    try:
        leader_id = payload.get("leader_id")
        member_id = payload.get("member_id")
        if not leader_id or not member_id:
            return BaseResponse(success=False, message="leader_id and member_id are required")
        data = add_team_member(leader_id, member_id)
        return BaseResponse(success=True, message="Member added to team", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@teams_router.get("")
def teams_get_all() -> BaseResponse:
    """Get all teams."""
    try:
        data = get_all_teams()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@teams_router.get("/with-kpi")
def teams_get_with_kpi(
    start_date: str | None = Query(None, description="ISO date YYYY-MM-DD (VN). Mặc định = tuần hiện tại."),
    end_date:   str | None = Query(None, description="ISO date YYYY-MM-DD (VN). Mặc định = CN tuần hiện tại."),
) -> BaseResponse:
    """Phase 5: All-in-one teams + KPI cho admin teams-management page.

    Thay thế 1 + N HTTP request song song:
      • `/teams` (1 endpoint, có cache 60s)
      • N × `/kpi/get-team-overview-v3` (N = số team)

    bằng 1 RPC duy nhất `get_admin_teams_kpi_overview` →
    1 round-trip Postgres, aggregate hoàn toàn server-side.
    Cache 30s (khoảng ngày thay đổi chậm trong phiên admin).

    Schema response:
      {
        "teams":    [{id, name_team, leader_email, members, number_of_member}, ...],
        "kpi_data": [{team_id, member_id, member_email, kpi_*, post/inbox/lead actual}, ...],
        "range":    {start, end}
      }
    """
    try:
        data = get_all_teams_with_kpi(start_date=start_date, end_date=end_date)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@teams_router.post("")
def teams_create(payload: dict) -> BaseResponse:
    """Create a new team. Leader duoc chon tu danh ba members (140 nguoi) -
    leader_member_id la bat buoc (nguon that), leader_id/leader_email la
    OPTIONAL, chi dung khi Leader do da lien ket tai khoan dang nhap
    (app_users). Xem migration 047 - members va app_users la 2 nghiep vu
    doc lap, khong bat member phai co tai khoan moi lam Leader/Member duoc."""
    try:
        name_team = payload.get("name_team", "").strip()
        leader_member_id = (payload.get("leader_member_id") or "").strip() or None
        # Accept either leader_id (UUID) or leader_email from UI - optional
        leader_identifier = (payload.get("leader_id") or payload.get("leader_email") or "").strip()
        member_ids: List[str] = payload.get("member_ids", [])
        member_emails: List[str] = payload.get("member_emails", [])
        # Merge both — members can be IDs or emails
        all_members: List[str] = list(set((member_ids or []) + (member_emails or [])))
        team_type = (payload.get("team_type") or "").strip() or None
        if team_type and team_type not in TEAM_TYPES:
            return BaseResponse(success=False, message=f"team_type phải là một trong: {', '.join(TEAM_TYPES)}")
        if not name_team or not (leader_member_id or leader_identifier):
            return BaseResponse(success=False, message="name_team và leader là bắt buộc")
        data = create_team(name_team, leader_identifier, all_members, leader_member_id=leader_member_id, team_type=team_type)
        return BaseResponse(success=True, message="Đã tạo team", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@teams_router.put("")
def teams_update(payload: dict) -> BaseResponse:
    """Update a team (replace members, optionally rename). Leader tu danh ba
    members - leader_id/leader_email la OPTIONAL (xem teams_create).

    team_id (optional): khi UI biet ro id cua team dang sua, gui kem de tim theo id thay vi
    theo name_team - cho phep doi ten team ma khong bi hieu nham thanh "tao team moi".
    """
    try:
        name_team = payload.get("name_team", "").strip()
        team_id = (payload.get("team_id") or "").strip() or None
        leader_member_id = (payload.get("leader_member_id") or "").strip() or None
        leader_identifier = (payload.get("leader_id") or payload.get("leader_email") or "").strip()
        member_ids: List[str] = payload.get("member_ids", [])
        member_emails: List[str] = payload.get("member_emails", [])
        all_members: List[str] = list(set((member_ids or []) + (member_emails or [])))
        team_type = (payload.get("team_type") or "").strip() or None
        if team_type and team_type not in TEAM_TYPES:
            return BaseResponse(success=False, message=f"team_type phải là một trong: {', '.join(TEAM_TYPES)}")
        if not name_team or not (leader_member_id or leader_identifier):
            return BaseResponse(success=False, message="name_team và leader là bắt buộc")
        data = update_team(name_team, leader_identifier, all_members, team_id=team_id, leader_member_id=leader_member_id, team_type=team_type)
        return BaseResponse(success=True, message="Đã cập nhật team", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@teams_router.delete("")
def teams_delete(
    name_team: str = Query(...),
    leader: str = Query(default=""),
    team_id: str = Query(default=""),
) -> BaseResponse:
    """Delete a team. Uu tien team_id (chinh xac, hoat dong ca khi Leader chua
    co tai khoan dang nhap nen khong resolve duoc leader) - leader chi con la
    fallback tuong thich nguoc khi FE khong gui team_id."""
    try:
        deleted = delete_team(name_team, leader, team_id=team_id or None)
        return BaseResponse(success=True, message=f"Đã xóa {deleted} bản ghi team", data={"deleted": deleted})
    except Exception as e:
        return BaseResponse(success=False, message=str(e))

