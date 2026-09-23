"""Supabase-based members (HR roster) service for all-platform module.

Bảng `members` độc lập hoàn toàn với `app_users` (bảng tài khoản đăng nhập) — xem
migration 043_members_directory.sql. `linked_user_id` (nullable) là cầu nối khi 1
member có tài khoản đăng nhập thật, dùng để dropdown nào cần lưu vào cột FK trỏ
app_users.id (vd customer_leads.leaded_by/sdr_id) vẫn lấy đúng giá trị.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

_MEMBER_FIELDS = (
    "id, display_name, full_name, email, telegram_username, phone, birth_date, "
    "gender, team, position, department, experience_year, linked_user_id, "
    "linked_user_id_2, employment_status, off_effective_at, leader_name, "
    "leader_email, cv_link, is_recruitment_synced, created_at, updated_at"
)

# Nhúng thẳng skills qua embed resource của PostgREST thay vì truy vấn riêng
# member_skills.in_(member_ids) — với vài trăm member, danh sách id trong IN(...)
# vượt quá độ dài URL cho phép của reverse proxy (502 Bad Gateway). Embed 1 query
# duy nhất không bị giới hạn này vì không cần liệt kê id ra query string.
_MEMBER_FIELDS_WITH_SKILLS = f"{_MEMBER_FIELDS}, member_skills(skills(id, name, category))"


def _flatten_skills(row: Dict[str, Any]) -> Dict[str, Any]:
    links = row.pop("member_skills", None) or []
    skills = [link["skills"] for link in links if link.get("skills")]
    row["skills"] = skills
    row["skill_ids"] = [s["id"] for s in skills]
    return row


def get_all_members(
    search: Optional[str] = None,
    team: Optional[str] = None,
    position: Optional[str] = None,
    department: Optional[str] = None,
    skill_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    supabase = get_supabase_client()
    # skill_id: dùng embed !inner để lọc theo skill ngay trong 1 query, không
    # cần round-trip riêng lấy danh sách member_id rồi .in_() (cùng vấn đề 502).
    fields = (
        f"{_MEMBER_FIELDS}, member_skills!inner(skills(id, name, category))"
        if skill_id
        else _MEMBER_FIELDS_WITH_SKILLS
    )
    query = supabase.table("members").select(fields)

    if search:
        like = f"%{search}%"
        query = query.or_(f"display_name.ilike.{like},full_name.ilike.{like}")
    if team:
        query = query.eq("team", team)
    if position:
        query = query.eq("position", position)
    if department:
        query = query.eq("department", department)
    if skill_id:
        query = query.eq("member_skills.skill_id", skill_id)

    result = query.order("display_name").execute()
    return [_flatten_skills(row) for row in (result.data or [])]


def get_member(member_id: str) -> Optional[Dict[str, Any]]:
    supabase = get_supabase_client()
    result = supabase.table("members").select(_MEMBER_FIELDS_WITH_SKILLS).eq("id", member_id).execute()
    if not result.data:
        return None
    return _flatten_skills(result.data[0])


def get_member_by_display_name(display_name: str) -> Optional[Dict[str, Any]]:
    """Phase 3.5 A5: xac nhan 1 ten hint (leaded_by_name_hint/sdr_name_hint,
    dung cho nhan su CHUA lien ket tai khoan) khop 1 dong that trong danh ba
    `members` - khong cho phep tu go 1 chuoi bat ky vao hint roi luu thang
    xuong DB ma khong doi chieu. Bang `members` khong co cot active/instance
    (danh ba HR dung chung, khong tenant-scoped) nen day la kiem tra ton tai
    duy nhat co the lam that su."""
    if not display_name or not display_name.strip():
        return None
    supabase = get_supabase_client()
    result = (
        supabase.table("members")
        .select("id, display_name")
        .eq("display_name", display_name.strip())
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def _set_member_skills(supabase: Client, member_id: str, skill_ids: List[str]) -> None:
    supabase.table("member_skills").delete().eq("member_id", member_id).execute()
    if skill_ids:
        supabase.table("member_skills").insert(
            [{"member_id": member_id, "skill_id": sid} for sid in skill_ids]
        ).execute()


def create_member(payload: Dict[str, Any]) -> Dict[str, Any]:
    supabase = get_supabase_client()
    skill_ids = payload.pop("skill_ids", None)

    if not str(payload.get("display_name", "")).strip():
        raise ValueError("Display Name không được để trống")
    if not str(payload.get("full_name", "")).strip():
        raise ValueError("Họ và tên không được để trống")

    insert_data = {k: v for k, v in payload.items() if v is not None}
    result = supabase.table("members").insert(insert_data).execute()
    member = result.data[0]

    if skill_ids is not None:
        _set_member_skills(supabase, member["id"], skill_ids)

    return get_member(member["id"]) or member


def update_member(member_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    supabase = get_supabase_client()
    skill_ids = payload.pop("skill_ids", None)
    payload.pop("id", None)

    if "display_name" in payload and not str(payload["display_name"]).strip():
        raise ValueError("Display Name không được để trống")
    if "full_name" in payload and not str(payload["full_name"]).strip():
        raise ValueError("Họ và tên không được để trống")

    update_data = {k: v for k, v in payload.items() if v is not None}
    update_data["updated_at"] = "now()"
    supabase.table("members").update(update_data).eq("id", member_id).execute()

    if skill_ids is not None:
        _set_member_skills(supabase, member_id, skill_ids)

    return get_member(member_id) or {}


def delete_member(member_id: str) -> Dict[str, Any]:
    supabase = get_supabase_client()
    result = supabase.table("members").delete().eq("id", member_id).execute()
    return {"deleted": len(result.data) if result.data else 0}


# ── Skills (nhóm theo category cho form checkbox, vd "Network Solutions > Switching & Routing") ──

def get_all_skills() -> List[Dict[str, Any]]:
    supabase = get_supabase_client()
    result = supabase.table("skills").select("id, name, category, created_at").order("category").order("name").execute()
    return result.data or []


def create_skill(name: str, category: Optional[str] = None) -> Dict[str, Any]:
    supabase = get_supabase_client()
    if not str(name or "").strip():
        raise ValueError("Tên kỹ năng không được để trống")
    result = supabase.table("skills").insert({"name": name.strip(), "category": (category or "").strip() or None}).execute()
    return result.data[0]


def update_skill(skill_id: str, name: Optional[str] = None, category: Optional[str] = None) -> Dict[str, Any]:
    supabase = get_supabase_client()
    update_data: Dict[str, Any] = {}
    if name is not None:
        if not name.strip():
            raise ValueError("Tên kỹ năng không được để trống")
        update_data["name"] = name.strip()
    if category is not None:
        update_data["category"] = category.strip() or None
    result = supabase.table("skills").update(update_data).eq("id", skill_id).execute()
    return result.data[0] if result.data else {}


def delete_skill(skill_id: str) -> Dict[str, Any]:
    supabase = get_supabase_client()
    result = supabase.table("skills").delete().eq("id", skill_id).execute()
    return {"deleted": len(result.data) if result.data else 0}


# ── Sync từ danh sách thô (giống RAW_DATA/sync_and_prune trong sync_members.py) ──

def sync_members_from_list(rows: List[Dict[str, Any]], prune: bool = False) -> Dict[str, Any]:
    """Upsert theo display_name (khớp đúng logic sync_members.py: full_name,
    telegram_username, team được ghi đè theo danh sách mới nhất). `prune=True` sẽ
    xóa các member hiện có trong DB nhưng KHÔNG còn trong danh sách `rows` — chỉ
    nên bật khi chắc chắn danh sách truyền vào là đầy đủ/mới nhất, vì đây là thao
    tác xóa dữ liệu không thể hoàn tác."""
    supabase = get_supabase_client()
    allowed_display_names = {r["display_name"] for r in rows if r.get("display_name")}

    existing_rows = supabase.table("members").select("id, display_name").execute().data or []
    existing_by_name = {r["display_name"]: r["id"] for r in existing_rows}

    added = 0
    updated = 0
    for row in rows:
        display_name = (row.get("display_name") or "").strip()
        if not display_name:
            continue
        full_name = (row.get("full_name") or "").strip() or display_name
        payload = {
            "display_name": display_name,
            "full_name": full_name,
            "telegram_username": (row.get("telegram_username") or None),
            "team": (row.get("team") or None),
        }
        if display_name in existing_by_name:
            supabase.table("members").update({**payload, "updated_at": "now()"}).eq(
                "id", existing_by_name[display_name]
            ).execute()
            updated += 1
        else:
            supabase.table("members").insert(payload).execute()
            added += 1

    pruned = 0
    if prune:
        to_delete = [r["id"] for r in existing_rows if r["display_name"] not in allowed_display_names]
        if to_delete:
            supabase.table("members").delete().in_("id", to_delete).execute()
            pruned = len(to_delete)

    return {"added": added, "updated": updated, "pruned": pruned}


# ── Excel import ─────────────────────────────────────────────────────────────

# Cột trong file Excel mẫu (danh_sach_145_nhan_vien.xlsx, sheet "Danh sách nhân viên"):
# STT, Display Name, Họ tên, Team, Chức vụ, Phòng ban, Telegram, Email
_EXCEL_HEADER_MAP = {
    "display name": "display_name",
    "họ tên": "full_name",
    "ho ten": "full_name",
    "team": "team",
    "chức vụ": "position",
    "chuc vu": "position",
    "phòng ban": "department",
    "phong ban": "department",
    "telegram": "telegram_username",
    "email": "email",
}


def parse_excel_rows(rows: List[List[Any]]) -> List[Dict[str, Any]]:
    """rows[0] là header, các dòng sau là data — trả list dict đã map field."""
    if not rows:
        return []

    header = [str(cell or "").strip().lower() for cell in rows[0]]
    field_by_col = {i: _EXCEL_HEADER_MAP[h] for i, h in enumerate(header) if h in _EXCEL_HEADER_MAP}

    parsed: List[Dict[str, Any]] = []
    for row in rows[1:]:
        if not any(cell not in (None, "") for cell in row):
            continue
        item: Dict[str, Any] = {}
        for col_index, field in field_by_col.items():
            value = row[col_index] if col_index < len(row) else None
            item[field] = str(value).strip() if value not in (None, "") else None
        parsed.append(item)
    return parsed


def import_members_from_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Upsert theo email (nếu có), else theo display_name. Không import "im lặng" —
    trả về chi tiết dòng nào bị bỏ qua và lý do vì dữ liệu nguồn (chụp lại từ ảnh)
    được chính file Excel cảnh báo là có thể sai/thiếu."""
    supabase = get_supabase_client()
    created = 0
    updated = 0
    skipped: List[Dict[str, Any]] = []

    for index, row in enumerate(rows, start=2):  # dòng 1 là header
        display_name = (row.get("display_name") or "").strip()
        full_name = (row.get("full_name") or "").strip() or display_name

        if not display_name:
            skipped.append({"row": index, "reason": "Thiếu Display Name"})
            continue
        if not full_name:
            skipped.append({"row": index, "reason": "Thiếu Họ tên"})
            continue

        email = (row.get("email") or "").strip() or None
        existing = None
        if email:
            existing = (
                supabase.table("members").select("id").eq("email", email).execute()
            ).data
        if not existing:
            existing = (
                supabase.table("members")
                .select("id")
                .eq("display_name", display_name)
                .execute()
            ).data

        payload = {
            "display_name": display_name,
            "full_name": full_name,
            "email": email,
            "team": (row.get("team") or "").strip() or None,
            "position": (row.get("position") or "").strip() or None,
            "department": (row.get("department") or "").strip() or None,
            "telegram_username": (row.get("telegram_username") or "").strip() or None,
        }

        try:
            if existing:
                update_member(existing[0]["id"], dict(payload))
                updated += 1
            else:
                create_member(dict(payload))
                created += 1
        except Exception as e:
            skipped.append({"row": index, "reason": str(e)})

    return {"created": created, "updated": updated, "skipped": skipped}


# ── Đồng bộ từ hệ thống tuyển dụng (cv.markeeai.com) ─────────────────────────

# Nhom vi tri ung tuyen -> team, port tu TEAM_POSITIONS cua pm-new (cung 1
# nguon tuyen dung) - doi ten nhom "Sales/Customer Care" -> "Sale" va
# "Dev/DevOps" -> "Dev" cho khop dung chu "Sale"/"Marketing" ma luat full CRM
# access + auto quote_business_role dang so sanh (xem crm_permission_service.
# has_full_crm_access). KHONG port logic phan cap Intern L1/L2 cua pm-new -
# do la he thong danh gia thuc tap sinh rieng cua pm-new, khong ap dung o day.
_RECRUITMENT_TEAM_POSITIONS: dict[str, tuple[str, ...]] = {
    "Infrastructure": (
        "Network Engineer", "System Administrator", "IT Support/Helpdesk",
        "Cybersecurity Specialist", "Network Team", "System Team", "Security Team",
        "Hội nghị & Tổng đài", "Cloud & Datacenter",
    ),
    "Dev": (
        "Product Manager", "UI/UX Designer", "Business Analyst",
        "Bridge Software Engineer (BrSE)", "Tester/QC",
        "Frontend Developer", "Backend Developer", "Mobile Developer",
        "Fullstack Developer", "DevOps Engineer", "BA", "Full-stack Developer",
        "DevOps / Platform", "DevOps", "Video Editor", "Graphic Designer",
        "Motion Designer", "Photographer",
    ),
    "AI": (
        "AI / ML Engineer", "Data Scientist", "Data Engineer",
        "Computer Vision Engineer", "NLP Engineer", "Data Analyst / Engineer",
        "AI Product / Research",
    ),
    "Marketing": (
        "Content Creator", "SEO Specialist", "Digital Marketer",
        "Media Designer", "Copywriter", "Content & Social",
        "Performance & Acquisition", "Marketing Ops",
    ),
    "Sale": (
        "Account Executive", "Sales Consultant",
        "Customer Support Representative", "Telemarketer", "B2B Sales",
        "Business Development", "Customer Success", "Sales/Customer Care",
    ),
}


def _recruitment_primary_team(positions: list[Any]) -> Optional[str]:
    for team, team_positions in _RECRUITMENT_TEAM_POSITIONS.items():
        if any(pos in team_positions for pos in positions):
            return team
    return None


_RECRUITMENT_META_RE = re.compile(r"\[RECRUITMENT_META\]([\s\S]*?)\[/RECRUITMENT_META\]")


def _recruitment_meta(notes: Optional[str]) -> Dict[str, Any]:
    raw = _RECRUITMENT_META_RE.search(notes or "")
    if not raw:
        return {}
    try:
        return json.loads(raw.group(1))
    except Exception:
        return {}


def _recruitment_display_name(full_name: str) -> str:
    """Rút gọn 'Nguyễn Văn A' -> 'N.V. A' (giống quy ước hiển thị của pm-new)."""
    words = [w for w in full_name.split() if w]
    if len(words) <= 2:
        return " ".join(words)[:50]
    abbr = ".".join(w[0].upper() for w in words[:-2])
    last_two = " ".join(words[-2:])
    return f"{abbr} {last_two}"[:50]


def sync_members_from_recruitment() -> Dict[str, Any]:
    """Đồng bộ ĐẦY ĐỦ như pm-new (https://kpi.markeeai.com/accounts, tab Quản
    lý thành viên): kéo CẢ 2 trạng thái status=accepted (ON) và
    status=resigned (OFF) từ hệ thống tuyển dụng, cộng thêm bảng
    `recruitment_leaders` để gán leader_name/leader_email. Upsert theo email
    (fallback display_name) — chỉ ghi đè field còn trống, không đụng
    team/department/vị trí admin đã tự điền tay.

    Hành vi ĐẶC BIỆT (khớp pm-new, khác hẳn "chỉ thêm dữ liệu" thông thường):
      - employment_status OFF (resigned) tự động KHOÁ tài khoản đăng nhập
        liên kết; quay lại ON (rehire) tự MỞ KHOÁ lại.
      - Member nào đã từng được CHÍNH đồng bộ này tạo ra
        (is_recruitment_synced=True) mà không còn ở CẢ 2 danh sách
        accepted/resigned nữa thì bị XOÁ — Member tạo tay không bao giờ bị
        đụng tới bởi cơ chế này."""
    if not settings.recruitment_supabase_url or not settings.recruitment_supabase_service_role_key:
        raise ValueError("Chưa cấu hình RECRUITMENT_SUPABASE_URL/RECRUITMENT_SUPABASE_SERVICE_ROLE_KEY.")

    headers = {
        "apikey": settings.recruitment_supabase_service_role_key,
        "Authorization": f"Bearer {settings.recruitment_supabase_service_role_key}",
    }
    base = settings.recruitment_supabase_url

    def _fetch_applications(status: str) -> List[Dict[str, Any]]:
        try:
            resp = requests.get(f"{base}/rest/v1/applications?status=eq.{status}", headers=headers, timeout=30)
            resp.raise_for_status()
            return resp.json() or []
        except Exception:
            logger.warning("sync_members_from_recruitment: khong tai duoc status=%s", status)
            return []

    accepted = _fetch_applications("accepted")
    resigned = _fetch_applications("resigned")

    try:
        leaders_resp = requests.get(f"{base}/rest/v1/recruitment_leaders", headers=headers, timeout=30)
        leaders_list = leaders_resp.json() if leaders_resp.status_code == 200 else []
    except Exception:
        leaders_list = []
    leaders_map = {str(row.get("id") or "").strip().lower(): row for row in leaders_list if row.get("id")}

    # resigned nhap truoc, accepted de sau -> accepted duoc uu tien neu trung
    # email (giong het thu tu cua pm-new).
    applications_by_email: Dict[str, Dict[str, Any]] = {}
    for candidate in resigned:
        email = str(candidate.get("email") or "").strip().lower()
        if email:
            applications_by_email[email] = {"data": candidate, "status": "resigned"}
    for candidate in accepted:
        email = str(candidate.get("email") or "").strip().lower()
        if email:
            applications_by_email[email] = {"data": candidate, "status": "accepted"}

    active_emails = set(applications_by_email.keys())
    active_display_names: set[str] = set()
    for info in applications_by_email.values():
        full_name = str(info["data"].get("full_name") or "").strip()
        if full_name:
            active_display_names.add(_recruitment_display_name(full_name).lower())

    supabase = get_supabase_client()

    # Xoa Member da tung duoc CHINH dong bo nay tao/cham nhung khong con o ca
    # 2 danh sach accepted/resigned nua.
    synced_rows = (
        supabase.table("members")
        .select("id, email, display_name")
        .eq("is_recruitment_synced", True)
        .execute()
    ).data or []
    to_delete = []
    for row in synced_rows:
        email = str(row.get("email") or "").strip().lower()
        display_name = str(row.get("display_name") or "").strip().lower()
        still_in_system = (email and email in active_emails) or (display_name and display_name in active_display_names)
        if not still_in_system:
            to_delete.append(row["id"])
    deleted = 0
    if to_delete:
        supabase.table("members").delete().in_("id", to_delete).execute()
        deleted = len(to_delete)

    created = 0
    updated = 0
    locked = 0
    unlocked = 0
    skipped: List[Dict[str, Any]] = []

    for email, info in applications_by_email.items():
        candidate = info["data"]
        employment_status = "ON" if info["status"] == "accepted" else "OFF"

        full_name = str(candidate.get("full_name") or "").strip()
        if not full_name:
            continue
        display_name = _recruitment_display_name(full_name)
        phone = str(candidate.get("phone") or "").strip() or None
        positions = candidate.get("career_journey") or []
        position = str(positions[0]).strip() if positions else None
        # Fallback y het pm-new: khong bat duoc bucket nao thi dung luon
        # position tho lam Team, thay vi de trong (xem members.py dong 1177
        # ben pm-new: `department = primary_team or position`).
        team = _recruitment_primary_team(positions) or position
        cv_link = str(candidate.get("cv") or "").strip() or None

        birth_date: Optional[str] = None
        dob_raw = candidate.get("dob")
        if dob_raw:
            birth_date = str(dob_raw).strip()[:10] or None

        meta = _recruitment_meta(candidate.get("admin_notes"))
        telegram_username = str(meta.get("telegram") or "").strip() or None

        leader_data = meta.get("leader")
        leader_id = ""
        if isinstance(leader_data, dict):
            leader_id = str(leader_data.get("id") or "").strip().lower()
        elif isinstance(leader_data, str):
            leader_id = leader_data.strip().lower()
        leader_name: Optional[str] = None
        leader_email: Optional[str] = None
        if leader_id and leader_id in leaders_map:
            leader_info = leaders_map[leader_id]
            leader_name = str(leader_info.get("name") or "").strip() or None
            leader_email = str(leader_info.get("email") or "").strip() or None
        elif isinstance(leader_data, dict) and leader_data.get("name"):
            leader_name = str(leader_data.get("name") or "").strip() or None
            leader_email = str(leader_data.get("email") or "").strip() or None

        try:
            existing = None
            if email:
                res = supabase.table("members").select(_MEMBER_FIELDS).eq("email", email).limit(1).execute()
                existing = (res.data or [None])[0]
            if not existing:
                res = supabase.table("members").select(_MEMBER_FIELDS).ilike("display_name", display_name).limit(1).execute()
                existing = (res.data or [None])[0]

            now_iso = datetime.now(timezone.utc).isoformat()

            if existing:
                update_data: Dict[str, Any] = {
                    "full_name": full_name,
                    "display_name": display_name,
                    "updated_at": "now()",
                }
                if email:
                    update_data["email"] = email
                if phone:
                    update_data["phone"] = phone
                if telegram_username:
                    update_data["telegram_username"] = telegram_username
                if team:
                    update_data["team"] = team
                if position:
                    update_data["position"] = position
                if birth_date:
                    update_data["birth_date"] = birth_date
                if cv_link:
                    update_data["cv_link"] = cv_link
                if leader_name:
                    update_data["leader_name"] = leader_name
                if leader_email:
                    update_data["leader_email"] = leader_email

                old_status = existing.get("employment_status") or "ON"
                update_data["employment_status"] = employment_status
                if employment_status == "OFF" and (old_status != "OFF" or not existing.get("off_effective_at")):
                    update_data["off_effective_at"] = now_iso
                elif employment_status == "ON" and old_status == "OFF":
                    update_data["off_effective_at"] = None

                supabase.table("members").update(update_data).eq("id", existing["id"]).execute()
                updated += 1

                # Tu khoa/mo tai khoan dang nhap lien ket theo thay doi trang thai.
                linked_user_id = existing.get("linked_user_id")
                if linked_user_id:
                    acct_res = (
                        supabase.table("app_users")
                        .select("id, is_active")
                        .eq("id", linked_user_id)
                        .limit(1)
                        .execute()
                    )
                    account = (acct_res.data or [None])[0]
                    if account:
                        if employment_status == "OFF" and account.get("is_active") is not False:
                            supabase.table("app_users").update(
                                {"is_active": False, "updated_at": "now()"}
                            ).eq("id", linked_user_id).execute()
                            locked += 1
                        elif employment_status == "ON" and old_status == "OFF" and account.get("is_active") is False:
                            supabase.table("app_users").update(
                                {"is_active": True, "updated_at": "now()"}
                            ).eq("id", linked_user_id).execute()
                            unlocked += 1
            else:
                insert_data = {
                    "display_name": display_name,
                    "full_name": full_name,
                    "email": email or None,
                    "phone": phone,
                    "telegram_username": telegram_username,
                    "team": team,
                    "position": position,
                    "birth_date": birth_date,
                    "cv_link": cv_link,
                    "leader_name": leader_name,
                    "leader_email": leader_email,
                    "is_recruitment_synced": True,
                    "employment_status": employment_status,
                    "off_effective_at": now_iso if employment_status == "OFF" else None,
                }
                insert_data = {k: v for k, v in insert_data.items() if v is not None}
                supabase.table("members").insert(insert_data).execute()
                created += 1
        except Exception as exc:
            skipped.append({"row": display_name or email, "reason": str(exc)})

    return {
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "locked": locked,
        "unlocked": unlocked,
        "skipped": skipped,
    }
