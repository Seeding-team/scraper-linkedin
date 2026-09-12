"""Du an THAT (migration 097, DA APPLY - xac nhan qua
readonly_check_migration_095_097.py) - phan cap Khach hang -> Du an -> Co
hoi CRM -> Quote Case -> Version. Quan ly Project dung can_manage_project()
RIENG (crm_permission_service.py) - KHONG dung has_full_crm_access() vi ham
do gom ca thanh vien team_type='sale' (qua rong cho quan tri Project theo
yeu cau da chot: chi Admin/Leader tao moi, hoac nguoi tao/manager cua DUNG
Project do moi sua duoc)."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Optional

from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.crm_permission_service import is_sale_member
from app.modules.all_platform.services.supabase_quote_service import VN_TZ, _crm_instance
from app.modules.all_platform.services.supabase_user_service import get_member_option_by_id

TABLE = "projects"
_COLUMNS = "id, project_code, name, customer_id, description, status, manager_id, team_id, created_by, created_at, updated_at, instance"

# "Mã dự án tự sinh backend theo YYYY-MM-MÃKH-STT" - xem migration
# 119_crm_customers_customer_code.sql. MÃKH lấy từ crm_customers.customer_code
# THẬT nếu khách hàng đã có, nếu chưa thì chuẩn hóa từ customer_name và LƯU LẠI
# 1 lần (ổn định mãi về sau dù đổi tên khách hàng) - KHÔNG bao giờ nhận
# project_code từ payload frontend nữa (chỉ backend sinh, atomic qua retry
# quanh UNIQUE index có sẵn từ migration 097).
MAX_CUSTOMER_CODE_LEN = 20
# Dành 2 ký tự cuối cho hậu tố xung đột ("02".."19") - base phải ngắn hơn giới
# hạn tổng 2 ký tự để "{base}{suffix:02d}" không bao giờ vượt MAX_CUSTOMER_CODE_LEN
# dù base đã dài tối đa.
_BASE_MAX_LEN = MAX_CUSTOMER_CODE_LEN - 2


def _is_unique_violation(exc: Exception, column: str) -> bool:
    """Mirror đúng cách create_project() hiện có đang bắt lỗi trùng UNIQUE index
    (check chuỗi message, không có helper chung nào trong codebase để tái dùng -
    xem audit trước khi viết migration/code)."""
    message = str(exc).lower()
    return column.lower() in message and ("duplicate" in message or "unique" in message)


def _slugify_customer_name(name: str) -> str:
    """Viết hoa, bỏ dấu tiếng Việt, bỏ ký tự đặc biệt/khoảng trắng, giới hạn độ
    dài - đúng 4 yêu cầu chuẩn hóa MÃKH-từ-tên."""
    s = (name or "").strip().replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # bỏ dấu
    s = re.sub(r"[^A-Za-z0-9]", "", s).upper()
    return s[:_BASE_MAX_LEN] or "KH"


def _resolve_customer_code(customer_id: str) -> str:
    """Tra cứu hoặc sinh+LƯU customer_code (persist 1 lần duy nhất, ổn định mãi
    về sau dù đổi tên khách hàng). Atomic qua UNIQUE index (trên
    UPPER(customer_code)): thử UPDATE với điều kiện customer_code IS NULL, bắt
    lỗi trùng thì thử candidate kế tiếp - hậu tố "02","03"... (KHÔNG PHẢI
    "2","3" - candidate đầu tiên KHÔNG có hậu tố)."""
    supabase: Client = get_supabase_client()
    row = (
        supabase.table("crm_customers")
        .select("customer_code, customer_name")
        .eq("id", customer_id)
        .eq("instance", _crm_instance())
        .single()
        .execute()
        .data
    )
    if not row:
        raise ValueError("Không tìm thấy khách hàng.")
    if row.get("customer_code"):
        return row["customer_code"]
    base = _slugify_customer_name(row.get("customer_name") or "")
    for n in range(1, 20):
        candidate = base if n == 1 else f"{base}{n:02d}"
        try:
            updated = (
                supabase.table("crm_customers")
                .update({"customer_code": candidate})
                .eq("id", customer_id)
                .eq("instance", _crm_instance())
                .is_("customer_code", "null")
                .execute()
            )
            if updated.data:
                return candidate
            # Row da co gia tri (do 1 request khac vua gan xong giua luc nay) -
            # doc lai gia tri that thay vi tiep tuc thu candidate khac.
            row2 = (
                supabase.table("crm_customers")
                .select("customer_code")
                .eq("id", customer_id)
                .eq("instance", _crm_instance())
                .single()
                .execute()
                .data
            )
            if row2 and row2.get("customer_code"):
                return row2["customer_code"]
        except Exception as exc:
            if _is_unique_violation(exc, "customer_code"):
                continue
            raise
    raise ValueError("Không sinh được mã khách hàng, vui lòng thử lại.")


def _next_project_seq(prefix: str) -> int:
    """prefix vd '2026-09-LETHIANH-' - mirror _next_quote_number()
    (supabase_quote_service.py): select theo prefix + tính max hậu tố + 1,
    KHÔNG dùng Postgres sequence/RPC (không có sẵn trong codebase cho việc
    đánh số này, giữ đúng 1 kiểu cơ chế với quote_number)."""
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(TABLE)
        .select("project_code")
        .eq("instance", _crm_instance())
        .like("project_code", f"{prefix}%")
        .execute()
        .data
        or []
    )
    max_seq = 0
    for r in rows:
        suffix = (r.get("project_code") or "")[len(prefix):]
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return max_seq + 1


def preview_project_code(customer_id: str) -> dict:
    """Chỉ tính để hiển thị "Dự kiến" trên form - KHÔNG insert/persist gì (kể cả
    customer_code chưa có cũng KHÔNG lưu ở đây, chỉ tính hypothetical). Có thể
    lệch nhẹ với mã thật nếu có request khác chen giữa - chấp nhận được vì là
    preview, mã chính thức luôn do create_project() cấp lại lúc insert thật."""
    supabase: Client = get_supabase_client()
    row = (
        supabase.table("crm_customers")
        .select("customer_code, customer_name")
        .eq("id", customer_id)
        .eq("instance", _crm_instance())
        .single()
        .execute()
        .data
    )
    if not row:
        raise ValueError("Không tìm thấy khách hàng.")
    customer_code = row.get("customer_code") or _slugify_customer_name(row.get("customer_name") or "")
    prefix = f"{datetime.now(VN_TZ).strftime('%Y-%m')}-{customer_code}-"
    seq = _next_project_seq(prefix)
    return {
        "projectCode": f"{prefix}{seq:03d}",
        "isCustomerCodeNew": not bool(row.get("customer_code")),
    }


def _validate_manager_id(manager_id: Optional[str], current_manager_id: Optional[str] = None) -> None:
    """manager_id la FK toi app_users(id) - tu choi som bang thong bao tieng
    Viet sach thay vi de loi FK-violation tho cua Postgres roi ra ngoai
    (nguoi phu trach phai la 1 tai khoan dang nhap that su ton tai).

    `current_manager_id` (gia tri manager_id DANG luu trong DB, chi truyen o
    update_project) phan biet 2 truong hop: (1) nguoi dung KHONG doi nguoi
    phu trach (resend dung id cu) - PHAI cho qua du id do co the da bi vo
    hieu hoa tu luc form duoc load (khong duoc lam hong Project cu chi vi
    admin bam Luu 1 thay doi khac); (2) nguoi dung CHON MOI 1 nguoi phu trach
    (id khac id cu, hoac tao moi - current_manager_id=None) - nguoi MOI nay
    BAT BUOC dang active, tu choi neu khong."""
    if not manager_id:
        return
    user = get_member_option_by_id(manager_id)
    if not user:
        raise ValueError("Người phụ trách dự án không hợp lệ hoặc không còn tồn tại.")
    is_unchanged = current_manager_id is not None and str(manager_id) == str(current_manager_id)
    if not is_unchanged and not user.get("isActive", True):
        raise ValueError("Người phụ trách dự án này đã ngừng hoạt động. Vui lòng chọn người khác.")
    # "Người phụ trách dự án chỉ chọn Sale" - LUÔN kiểm tra, KHÔNG đặc cách bỏ
    # qua dù is_unchanged (khác nguyên tắc grandfather của check is_active ở
    # trên) - 1 manager không còn thuộc team_type='sale' thì luôn bị từ chối,
    # kể cả khi Sửa mà không đổi gì khác, buộc Sale phải chọn lại người khác.
    # Backend validate THẬT (không chỉ lọc ở frontend) - dùng đúng is_sale_member()
    # đã có sẵn (crm_permission_service.py, dựa trên teams.team_type='sale',
    # migration 049), không tự đoán bằng text hiển thị.
    if not is_sale_member(manager_id):
        raise ValueError("Người phụ trách dự án phải là nhân viên Sale.")


def _row_to_project(row: dict) -> dict:
    return {
        "id": row["id"],
        "projectCode": row["project_code"],
        "name": row["name"],
        "customerId": row.get("customer_id"),
        "description": row.get("description"),
        "status": row.get("status") or "active",
        "managerId": row.get("manager_id"),
        "teamId": row.get("team_id"),
        "createdById": row.get("created_by"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "instance": row.get("instance"),
    }


def list_projects(customer_id: Optional[str] = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(TABLE).select(_COLUMNS).eq("instance", _crm_instance())
    if customer_id:
        query = query.eq("customer_id", customer_id)
    result = query.order("created_at", desc=True).execute()
    return [_row_to_project(row) for row in (result.data or [])]


def get_project(project_id: str) -> dict:
    supabase: Client = get_supabase_client()
    result = supabase.table(TABLE).select(_COLUMNS).eq("id", project_id).eq("instance", _crm_instance()).maybe_single().execute()
    row = result.data if result else None
    if not row:
        raise ValueError("Không tìm thấy dự án.")
    return _row_to_project(row)


def create_project(payload: dict[str, Any], actor_id: Optional[str]) -> dict:
    # "Mã dự án tự sinh hoàn toàn ở backend" - KHÔNG bao giờ đọc project_code
    # từ payload nữa (dù frontend có lỡ gửi lên cũng bị bỏ qua hoàn toàn),
    # tránh Sale tự dựng mã ở client như luồng cũ.
    name = (payload.get("name") or "").strip()
    customer_id = payload.get("customer_id")
    if not name:
        raise ValueError("Vui lòng nhập tên dự án.")
    if not customer_id:
        raise ValueError("Dự án phải thuộc đúng 1 khách hàng.")

    status = payload.get("status") or "active"
    if status not in ("planning", "active", "completed", "cancelled"):
        raise ValueError(f"status không hợp lệ: {status!r}")
    _validate_manager_id(payload.get("manager_id"))

    supabase: Client = get_supabase_client()
    prefix, _customer_code = _generate_project_code_prefix(customer_id)
    row_base = {
        "name": name,
        "customer_id": customer_id,
        "description": payload.get("description"),
        "status": status,
        "manager_id": payload.get("manager_id"),
        "team_id": payload.get("team_id"),
        "created_by": actor_id,
        "instance": _crm_instance(),
    }
    # Atomic qua retry: tính STT tiếp theo, thử insert, nếu 2 người tạo cùng
    # lúc đụng đúng 1 STT (unique index projects_project_code_unique, migration
    # 097) thì tính lại STT mới và thử lại - tối đa 5 lần.
    last_exc: Exception | None = None
    for attempt in range(5):
        seq = _next_project_seq(f"{prefix}-")
        candidate = f"{prefix}-{seq:03d}"
        try:
            inserted = supabase.table(TABLE).insert({**row_base, "project_code": candidate}).execute().data[0]
            return _row_to_project(inserted)
        except Exception as exc:
            last_exc = exc
            if _is_unique_violation(exc, "project_code") and attempt < 4:
                continue
            raise
    raise last_exc or ValueError("Không tạo được mã dự án, vui lòng thử lại.")


def _generate_project_code_prefix(customer_id: str) -> tuple[str, str]:
    """Trả về (prefix, customer_code) - prefix là "YYYY-MM-MÃKH" (chưa có hậu
    tố STT), dùng làm tiền tố truyền vào _next_project_seq(). Gọi
    _resolve_customer_code() (CÓ persist, khác preview_project_code() ở trên
    chỉ tính hypothetical không lưu gì)."""
    year_month = datetime.now(VN_TZ).strftime("%Y-%m")
    customer_code = _resolve_customer_code(customer_id)
    return f"{year_month}-{customer_code}", customer_code


def update_project(project_id: str, payload: dict[str, Any], actor_id: Optional[str]) -> dict:
    supabase: Client = get_supabase_client()
    update_row: dict[str, Any] = {"updated_at": "now()"}
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("Tên dự án không được để trống.")
        update_row["name"] = name
    if "description" in payload:
        update_row["description"] = payload.get("description")
    if "status" in payload:
        status = payload.get("status")
        if status not in ("planning", "active", "completed", "cancelled"):
            raise ValueError(f"status không hợp lệ: {status!r}")
        update_row["status"] = status
    if "manager_id" in payload:
        current = (
            supabase.table(TABLE).select("manager_id").eq("id", project_id).eq("instance", _crm_instance()).maybe_single().execute()
        )
        current_manager_id = (current.data or {}).get("manager_id") if current and current.data else None
        _validate_manager_id(payload.get("manager_id"), current_manager_id=current_manager_id)
        update_row["manager_id"] = payload.get("manager_id")
    if "team_id" in payload:
        update_row["team_id"] = payload.get("team_id")
    # customer_id/project_code KHONG cho sua sau khi tao - doi khach hang cua
    # 1 du an da co Co hoi/Quote gan vao se lam sai toan bo du lieu da lien
    # ket (dung nguyen tac "Khong cho chon Project thuoc khach hang khac").

    result = supabase.table(TABLE).update(update_row).eq("id", project_id).eq("instance", _crm_instance()).execute()
    if not result.data:
        raise ValueError("Không tìm thấy dự án.")
    return _row_to_project(result.data[0])


# 5 phase bucket - TRUNG voi _derive_quote_phase o supabase_quote_service.py
# (khong import cheo module de tranh phu thuoc vong - logic ngan, chap nhan
# lap 1 lan o day thay vi tao dependency moi).
def _quote_processing_bucket(row: dict) -> Optional[str]:
    if row.get("deleted_at") or row.get("status") == "cancelled":
        return None
    if row.get("sent_at"):
        return "sent"
    if row.get("published_at") or row.get("processing_stage") == "published":
        return "ready_to_send"
    if row.get("status") == "approved" or row.get("approved_at"):
        return "ready_to_send"
    stage = row.get("processing_stage") or "request"
    if stage == "review":
        return "admin_review"
    if stage == "pricing":
        return "sale_markup"
    if stage == "ready_to_publish":
        return "ready_to_send"
    return "presale"


def get_customer_projects_summary(customer_id: str) -> dict:
    """Tong hop Project cho tab "Dự án" trong Ho so khach hang - KHONG N+1
    (chi 3 truy van: projects, deals cua khach hang, quotes cua CAC project
    do), tra ve summary tong + list Project card da tinh san so lieu. Quote
    Case = gom theo version_chain_id, CHI lay "current" (version_number lon
    nhat) - dung nguyen tac da chot toan module Quote Center."""
    supabase: Client = get_supabase_client()

    projects_result = (
        supabase.table(TABLE)
        .select(_COLUMNS)
        .eq("customer_id", customer_id)
        .eq("instance", _crm_instance())
        .order("created_at", desc=True)
        .execute()
    )
    projects = [_row_to_project(row) for row in (projects_result.data or [])]
    project_ids = [p["id"] for p in projects]

    deals_result = (
        supabase.table("customer_leads")
        .select("id, project_id, deal_stage")
        .eq("customer_id", customer_id)
        .eq("instance", _crm_instance())
        .execute()
    )
    deals = deals_result.data or []
    opportunity_count_by_project: dict[str, int] = {}
    for deal in deals:
        pid = deal.get("project_id")
        if pid:
            opportunity_count_by_project[pid] = opportunity_count_by_project.get(pid, 0) + 1

    quotes_by_project: dict[str, list[dict]] = {pid: [] for pid in project_ids}
    if project_ids:
        quotes_result = (
            supabase.table("quotes")
            .select("id, project_id, version_chain_id, version_number, processing_stage, status, sent_at, published_at, approved_at, total_amount")
            .eq("instance", _crm_instance())
            .in_("project_id", project_ids)
            .is_("deleted_at", "null")
            .execute()
        )
        for row in quotes_result.data or []:
            pid = row.get("project_id")
            if pid in quotes_by_project:
                quotes_by_project[pid].append(row)

    def _project_card(project: dict) -> dict:
        pid = project["id"]
        rows = quotes_by_project.get(pid, [])
        chains: dict[str, dict] = {}
        version_count = 0
        for row in rows:
            version_count += 1
            key = row.get("version_chain_id") or row["id"]
            existing = chains.get(key)
            if existing is None or (row.get("version_number") or 1) > (existing.get("version_number") or 1):
                chains[key] = row
        current_rows = list(chains.values())
        processing_count = 0
        sent_count = 0
        current_value = 0.0
        for row in current_rows:
            bucket = _quote_processing_bucket(row)
            if bucket in ("presale", "sale_markup", "admin_review"):
                processing_count += 1
            if bucket == "sent":
                sent_count += 1
            if bucket is not None:
                current_value += float(row.get("total_amount") or 0)
        return {
            **project,
            "opportunityCount": opportunity_count_by_project.get(pid, 0),
            "quoteCaseCount": len(current_rows),
            "versionCount": version_count,
            "processingCount": processing_count,
            "sentCount": sent_count,
            "currentQuoteValue": current_value,
        }

    cards = [_project_card(p) for p in projects]

    return {
        "projectCount": len(projects),
        "activeProjectCount": sum(1 for p in projects if p.get("status") == "active"),
        "opportunityCount": len(deals),
        "quoteCaseCount": sum(c["quoteCaseCount"] for c in cards),
        "currentQuoteValue": sum(c["currentQuoteValue"] for c in cards),
        "projects": cards,
    }
