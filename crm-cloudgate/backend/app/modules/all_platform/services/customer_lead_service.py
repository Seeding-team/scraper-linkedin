import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, date
from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.schemas.customer_lead import STAGE_REQUIRED_FIELDS, is_transition_allowed
from app.modules.all_platform.services.crm_position_service import apply_position_category

logger = logging.getLogger(__name__)


def _serialize_datetimes(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Supabase-py (postgrest) không tự serialize `datetime` / `date` khi insert/update —
    nó chuyển thẳng sang `json.dumps` mà raise `TypeError: Object of type datetime is
    not JSON serializable`. Pydantic schema nhận `Optional[datetime]` cho các cột
    `follow_up_date`, `contract_signed_at`, `warranty_expires_at`, `customer_since`,
    `stage_entered_at`, `last_care_at` → `model_dump()` trả datetime object.

    Helper này đi qua mọi value, ép datetime/date thành ISO string trước khi gọi
    Supabase. Không đụng logic nghiệp vụ — chỉ chuẩn bị payload cho lớp IO.
    """
    out: Dict[str, Any] = {}
    for k, v in payload.items():
        if isinstance(v, datetime):
            # Giữ timezone-aware nếu có, fallback UTC
            if v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# Cột UUID nullable trên customer_leads — frontend (vd wizard "Thêm deal và báo giá"
# khi chưa chọn Leader/SDR) có thể gửi "" thay vì null, Postgres reject với
# "invalid input syntax for type uuid" nếu insert/update thẳng chuỗi rỗng.
_NULLABLE_UUID_COLUMNS = ("leaded_by", "sdr_id", "quote_id", "team_id", "customer_id")


def _normalize_uuid_fields(payload: Dict[str, Any]) -> Dict[str, Any]:
    for col in _NULLABLE_UUID_COLUMNS:
        if payload.get(col) == "":
            payload[col] = None
    return payload

# Cột lấy về — chỉ các cột có thật trên table customer_leads.
# `days_in_stage` KHÔNG có trên table — nó được tính ở `_normalize_row()`
# dựa vào `stage_entered_at`. Đừng select nó từ table.
BASE_COLUMNS = (
    "id, customer_id, customer_name, company_name, phone, email, address, city, website, industry, tax_code, "
    "leaded_by, conv_id, source_platform, is_assigned, sdr_id, status, activity_status, "
    "deal_stage, prev_stage, follow_up_date, decision_maker, estimated_budget, stage_entered_at, "
    "last_attachment_url, last_attachment_name, closed_reason, "
    "customer_since, service_package, lifetime_value, billing_type, contract_signed_at, contract_status, "
    "warranty_expires_at, care_note, last_care_at, "
    "payment_due_date, payment_status, "
    "tags, has_budget, note, reject_reason, reject_reason_type, review_result, "
    "position, position_category_id, position_label_snapshot, crm_package, zalo, facebook, telegram, pause_reason, next_step, closed_at, outcome_detail, quote_id, "
    "leaded_by_name_hint, sdr_name_hint, team_id, "
    "created_at, updated_at, leader:leaded_by(name), sdr:sdr_id(name), "
    "quote:quote_id(quote_number, total_amount, public_token, status, version_number, version_chain_id), "
    "team:team_id(name_team, team_type)"
)


def _normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    # leader_name/sdr_name resolve qua JOIN leaded_by(name)/sdr_id(name) — nếu
    # leaded_by/sdr_id là NULL (người được chọn chưa liên kết tài khoản đăng
    # nhập), fallback về *_name_hint (tên đã chọn tại thời điểm lưu, xem
    # migration 046) để không mất dấu vết đã gán ai.
    if row.get("leader"):
        row["leader_name"] = row["leader"].get("name")
        row.pop("leader", None)
    elif row.get("leaded_by_name_hint"):
        row["leader_name"] = f"{row['leaded_by_name_hint']} (chưa liên kết tài khoản)"
    if row.get("sdr"):
        row["sdr_name"] = row["sdr"].get("name")
        row.pop("sdr", None)
    elif row.get("sdr_name_hint"):
        row["sdr_name"] = f"{row['sdr_name_hint']} (chưa liên kết tài khoản)"
    if row.get("quote"):
        row["quote_number"] = row["quote"].get("quote_number")
        row["quote_total_amount"] = row["quote"].get("total_amount")
        public_token = row["quote"].get("public_token")
        row["quote_public_url"] = f"/public/quotes/{public_token}" if public_token else None
        # Trang thai LIVE lay thang tu bang quotes qua JOIN (khong denormalize
        # cot rieng tren customer_leads) - card CRM dung field nay de hien tag
        # Chua duyet/Da duyet + doi hanh vi nut "Mo bao gia"/"Chinh sua".
        row["quote_status"] = row["quote"].get("status")
        row["quote_version_number"] = row["quote"].get("version_number") or 1
        row["quote_version_chain_id"] = row["quote"].get("version_chain_id")
        row.pop("quote", None)
    if row.get("team"):
        row["team_name"] = row["team"].get("name_team")
        row["team_type"] = row["team"].get("team_type")
        row.pop("team", None)
    else:
        row["team_name"] = None
        row["team_type"] = None
    if row.get("tags") is None:
        row["tags"] = []
    if row.get("days_in_stage") is None and row.get("stage_entered_at"):
        try:
            entered = datetime.fromisoformat(row["stage_entered_at"].replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            row["days_in_stage"] = max(0, (now - entered).days)
        except Exception:
            row["days_in_stage"] = 0
    elif row.get("days_in_stage") is None:
        row["days_in_stage"] = 0
    return row


def get_all_customer_leads(
    current_user: Optional[Dict[str, Any]] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    deal_stage: Optional[str] = None,
    city: Optional[str] = None,
    industry: Optional[str] = None,
    source_platform: Optional[str] = None,
    exclude_terminal: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """
    Returns { items, total, page, page_size, by_stage: {...} }.
    `by_stage` thống kê số deal ở mỗi stage (cho UI Kanban / dashboard).
    Set `exclude_terminal=True` để loại bỏ won/lost ra khỏi kết quả (UI tab chính).
    """
    try:
        supabase = get_supabase_client()
        query = supabase.table("customer_leads").select(BASE_COLUMNS, count="exact").eq("instance", settings.crm_instance)

        if search:
            query = query.or_(
                f"customer_name.ilike.%{search}%,"
                f"company_name.ilike.%{search}%,"
                f"phone.ilike.%{search}%,"
                f"email.ilike.%{search}%"
            )
        if status:
            query = query.eq("status", status)
        if deal_stage:
            query = query.eq("deal_stage", deal_stage)
        if exclude_terminal:
            # Loại bỏ won/lost để tab chính gọn
            query = query.not_.in_("deal_stage", ["won", "lost"])
        if city:
            query = query.eq("city", city)
        if industry:
            query = query.eq("industry", industry)
        if source_platform:
            query = query.eq("source_platform", source_platform)

        # Doc Pipeline gio la UNIVERSAL cho moi user da dang nhap (admin/leader/
        # sale-team/member deu thay toan bo deal, ke ca cua nguoi khac/team
        # khac) - phan quyen chi con ap dung o buoc GHI (update/delete/
        # transition), xem can_write_deal() trong crm_permission_service.py.
        # (Truoc day co self-scope leaded_by/sdr_id==uid cho non-admin/leader,
        # da bo theo yeu cau "Member duoc xem Pipeline cua minh va team khac".)

        # Sắp xếp theo stage_entered_at DESC — deal mới nhất lên đầu trong cột
        offset = (page - 1) * page_size
        query = (
            query.order("stage_entered_at", desc=True, nullsfirst=False)
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
        )

        res = query.execute()
        items = [_normalize_row(row) for row in (res.data or [])]
        total = res.count or 0

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    except Exception as e:
        # KHONG nuot loi thanh ket qua rong "thanh cong" - truoc day lam vay khien
        # loi schema (vd thieu cot moi tren mot Supabase project khac) hien ra nhu
        # "khong co khach hang nao" thay vi bao loi that, rat kho debug.
        logger.error(f"Error getting customer leads: {e}")
        raise


def get_stage_counts(current_user: Optional[Dict[str, Any]] = None) -> Dict[str, int]:
    """
    Trả về số deal ở mỗi stage, dùng cho header KPI / Kanban column header.
    """
    try:
        supabase = get_supabase_client()
        q = supabase.table("customer_leads").select("deal_stage", count="exact").eq("instance", settings.crm_instance)
        # Universal read - xem get_all_customer_leads() ve ly do bo self-scope.
        res = q.execute()
        counts: Dict[str, int] = {}
        for row in res.data or []:
            s = row.get("deal_stage") or "new_lead"
            counts[s] = counts.get(s, 0) + 1
        return counts
    except Exception as e:
        logger.error(f"Error getting stage counts: {e}")
        raise


def get_customer_lead_by_id(lead_id: str) -> Optional[Dict[str, Any]]:
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table("customer_leads")
            .select(BASE_COLUMNS)
            .eq("id", lead_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
        if res.data:
            return _normalize_row(res.data[0])
        return None
    except Exception as e:
        logger.error(f"Error getting customer lead {lead_id}: {e}")
        return None


def get_customer_lead_by_conv_id(conv_id: str) -> Optional[Dict[str, Any]]:
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table("customer_leads")
            .select(BASE_COLUMNS)
            .eq("conv_id", conv_id)
            .eq("instance", settings.crm_instance)
            .maybe_single()
            .execute()
        )
        if res.data:
            return _normalize_row(res.data)
        return None
    except Exception as e:
        logger.error(f"Error getting customer by conv_id {conv_id}: {e}")
        return None


def create_customer_lead(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        supabase = get_supabase_client()
        if "tags" not in data or data["tags"] is None:
            data["tags"] = []
        if "has_budget" not in data:
            data["has_budget"] = False
        if "source_platform" not in data or not data["source_platform"]:
            data["source_platform"] = "FB_Inbox"
        # Map deal_stage → status để tương thích code cũ
        ds = data.get("deal_stage") or "new_lead"
        if ds == "won":
            data["status"] = "closed"
        elif ds == "lost":
            data["status"] = "rejected"
        elif "status" not in data:
            data["status"] = "pending"
        # Stamp lần đầu vào stage
        if not data.get("stage_entered_at"):
            data["stage_entered_at"] = datetime.now(timezone.utc).isoformat()
        # migration 079 — Chuc vu category-driven select (deal la ban ghi
        # moi nen luon require_active=True).
        apply_position_category(data)
        # Serialize datetime → ISO string trước khi INSERT (supabase-py không
        # tự handle datetime/date → JSON serialize error).
        data = _serialize_datetimes(data)
        data = _normalize_uuid_fields(data)
        data["instance"] = settings.crm_instance
        res = supabase.table("customer_leads").insert(data).execute()
        if res.data:
            new_row = _normalize_row(res.data[0])
            # Ghi log "created"
            _write_activity_log(
                customer_id=new_row["id"],
                action="created",
                to_stage=new_row.get("deal_stage"),
                actor=data.get("leaded_by") or None,
                actor_name=(data.get("leaded_by_name") if isinstance(data, dict) else None),
            )
            return new_row
        return None
    except Exception as e:
        logger.error(f"Error creating customer lead: {e}")
        raise e


def update_customer_lead(lead_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Update thông thường (không phải stage change).
    KHÔNG ghi log ở đây — chỉ API /transition mới ghi log stage.
    """
    try:
        supabase = get_supabase_client()
        safe_data = dict(data)
        if "position_category_id" in safe_data:
            current = get_customer_lead_by_id(lead_id) or {}
            apply_position_category(safe_data, current_position_category_id=current.get("position_category_id"))
        # Serialize datetime/date → ISO string (supabase-py không tự JSON hóa)
        safe_data = _serialize_datetimes(safe_data)
        safe_data = _normalize_uuid_fields(safe_data)
        res = (
            supabase.table("customer_leads")
            .update(safe_data)
            .eq("id", lead_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
        if res.data:
            return _normalize_row(res.data[0])
        return None
    except Exception as e:
        logger.error(f"Error updating customer lead {lead_id}: {e}")
        raise e


# ---------------------------------------------------------------------------
# State machine — Transition stage (entry point cho client kéo-thả)
# ---------------------------------------------------------------------------
class TransitionError(Exception):
    """Raised khi transition stage không hợp lệ. Caller trả về HTTPException."""
    def __init__(self, message: str, missing_fields: Optional[List[str]] = None):
        super().__init__(message)
        self.message = message
        self.missing_fields = missing_fields or []


def _validate_required_fields(to_stage: str, data: Dict[str, Any]) -> List[str]:
    """Trả về list field còn thiếu (rỗng = OK)."""
    rules = STAGE_REQUIRED_FIELDS.get(to_stage, {})
    required = rules.get("required", [])
    missing: List[str] = []
    for f in required:
        v = data.get(f)
        if v is None or v == "" or (isinstance(v, (int, float)) and v == 0 and f != "estimated_budget"):
            missing.append(f)
        if f == "estimated_budget" and (not v or v <= 0):
            missing.append(f)
    return missing


def transition_stage(
    lead_id: str,
    payload: Dict[str, Any],
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Chuyển deal sang stage mới với state-machine + audit log.

    Input `payload` chứa:
      - to_stage        (bắt buộc)
      - note, attachment_url, attachment_name, reject_reason_type, reject_reason_text,
        prev_stage, follow_up_date, decision_maker, estimated_budget, closed_reason

    Quy tắc:
      - from_stage = `customer_leads.deal_stage` hiện tại.
      - Nếu from_stage đã là terminal (won/lost) → không cho đổi.
      - To_stage phải nằm trong DEAL_STAGES (validate ở schema).
      - Required fields cho từng stage được check ở STAGE_REQUIRED_FIELDS — nếu thiếu
        raise TransitionError kèm missing_fields để client hiển thị highlight.
      - Mọi transition đều ghi 1 dòng vào customer_lead_activity_log.
      - Đồng thời cập nhật status (closed/rejected/pending) tương ứng để tương thích code cũ.
    """
    try:
        supabase = get_supabase_client()
        current = get_customer_lead_by_id(lead_id)
        if not current:
            raise TransitionError(f"Customer lead {lead_id} không tồn tại")

        from_stage = current.get("deal_stage") or "new_lead"
        to_stage = payload.get("to_stage")
        if not to_stage:
            raise TransitionError("Thiếu 'to_stage'")

        # Check terminal
        if from_stage in ("won", "lost"):
            raise TransitionError(
                f"Deal đã ở trạng thái terminal '{from_stage}' — không thể đổi sang stage khác. "
                "Muốn tiếp tục hãy tạo deal mới."
            )

        # Chặn nhảy stage bậy (VD new_lead -> won bỏ qua pipeline) — backend có API
        # riêng gọi trực tiếp được nên không thể chỉ dựa vào validate client-side.
        if not is_transition_allowed(from_stage, to_stage):
            raise TransitionError(
                f"Không thể chuyển trực tiếp từ '{from_stage}' sang '{to_stage}' — "
                "không đúng thứ tự pipeline."
            )

        # Check required fields
        missing = _validate_required_fields(to_stage, payload)
        if missing:
            raise TransitionError(
                f"Thiếu thông tin bắt buộc cho stage '{to_stage}': {', '.join(missing)}",
                missing_fields=missing,
            )

        # Build update payload
        now = datetime.now(timezone.utc).isoformat()
        update: Dict[str, Any] = {
            "deal_stage": to_stage,
            "stage_entered_at": now,
        }
        # Map ngược sang status cũ
        if to_stage == "won":
            update["status"] = "closed"
            if not current.get("customer_since"):
                update["customer_since"] = now
            if not current.get("closed_at"):
                update["closed_at"] = now
        elif to_stage == "lost":
            update["status"] = "rejected"
            if not current.get("closed_at"):
                update["closed_at"] = now
        else:
            update["status"] = "pending"

        # On hold: lưu lại prev_stage
        if to_stage == "on_hold":
            update["prev_stage"] = from_stage
        elif from_stage == "on_hold" and to_stage != "lost":
            # Resume: clear prev_stage
            update["prev_stage"] = None

        # Copy các field phụ
        for k in [
            "note",
            "follow_up_date",
            "decision_maker",
            "estimated_budget",
            "last_attachment_url",
            "last_attachment_name",
            "closed_reason",
            "reject_reason_type",
            "pause_reason",
            "closed_at",
            "outcome_detail",
        ]:
            if k in payload and payload[k] is not None:
                update[k] = payload[k]
        if payload.get("attachment_url"):
            update["last_attachment_url"] = payload["attachment_url"]
        if payload.get("attachment_name"):
            update["last_attachment_name"] = payload["attachment_name"]
        if payload.get("reject_reason_text") and to_stage == "lost":
            update["reject_reason"] = payload["reject_reason_text"]

        # Serialize datetime/date trong update dict trước khi gửi Supabase
        # (nếu payload từ client có `follow_up_date` datetime object).
        update = _serialize_datetimes(update)

        # Update
        res = (
            supabase.table("customer_leads")
            .update(update)
            .eq("id", lead_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
        if not res.data:
            raise TransitionError("Cập nhật thất bại")

        # Ghi audit log
        _write_activity_log(
            customer_id=lead_id,
            action="stage_change",
            from_stage=from_stage,
            to_stage=to_stage,
            actor=(actor.get("id") if actor else None),
            actor_name=(actor.get("name") if actor else None),
            note=payload.get("note"),
            attachment_url=payload.get("attachment_url"),
            attachment_name=payload.get("attachment_name"),
        )

        return _normalize_row(res.data[0])
    except TransitionError:
        raise
    except Exception as e:
        logger.error(f"Error transitioning stage for {lead_id}: {e}")
        raise e


def _write_activity_log(
    customer_id: str,
    action: str,
    from_stage: Optional[str] = None,
    to_stage: Optional[str] = None,
    actor: Optional[str] = None,
    actor_name: Optional[str] = None,
    note: Optional[str] = None,
    attachment_url: Optional[str] = None,
    attachment_name: Optional[str] = None,
    field: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
) -> None:
    """Ghi 1 dòng vào customer_lead_activity_log. Không raise — log best-effort."""
    try:
        supabase = get_supabase_client()
        log_entry = {
            "customer_id": customer_id,
            "action": action,
            "from_stage": from_stage,
            "to_stage": to_stage,
            "actor_id": actor,
            "actor_name": actor_name,
            "note": note,
            "attachment_url": attachment_url,
            "attachment_name": attachment_name,
            "field": field,
            "old_value": old_value,
            "new_value": new_value,
        }
        # Loại bỏ key None để insert gọn
        log_entry = {k: v for k, v in log_entry.items() if v is not None}
        log_entry["instance"] = settings.crm_instance
        supabase.table("customer_lead_activity_log").insert(log_entry).execute()
    except Exception as e:
        # Log không quyết định business; chỉ warn
        logger.warning(f"Failed to write activity log for {customer_id}: {e}")


def get_activity_log(
    lead_id: str,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    """Lấy audit trail cho 1 deal — sắp xếp DESC theo created_at."""
    try:
        supabase = get_supabase_client()
        # Count
        count_res = (
            supabase.table("customer_lead_activity_log")
            .select("id", count="exact")
            .eq("customer_id", lead_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
        total = count_res.count or 0

        # Items
        res = (
            supabase.table("customer_lead_activity_log")
            .select("*")
            .eq("customer_id", lead_id)
            .eq("instance", settings.crm_instance)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return {"items": res.data or [], "total": total}
    except Exception as e:
        logger.error(f"Error getting activity log for {lead_id}: {e}")
        return {"items": [], "total": 0}


def delete_customer_lead(lead_id: str) -> bool:
    supabase = get_supabase_client()
    supabase.table("customer_leads").delete().eq("id", lead_id).eq("instance", settings.crm_instance).execute()
    return True


_TEST_ACCOUNT_EMAIL_DOMAINS = {"markee.vn", "markee.test", "markeeai.com"}
_TEST_ACCOUNT_EMAILS = {"admin123@gmail.com"}


def _is_test_account(email: str, name: str) -> bool:
    email = (email or "").lower()
    name = (name or "").lower()
    if email in _TEST_ACCOUNT_EMAILS:
        return True
    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    if domain in _TEST_ACCOUNT_EMAIL_DOMAINS:
        return True
    return "test" in name or "demo" in name


def get_all_sdrs() -> List[Dict[str, Any]]:
    """Danh sach nguoi co the gan lam Quan ly / Phu trach deal CRM.

    Lay tat ca admin/leader that, loai tru cac acc test/dev/demo tao rieng
    de test local (vd devadmin@markee.vn, leader@markee.test, admin123@gmail.com).
    """
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table("app_users")
            .select("id, name, email, role")
            .in_("role", ["admin", "leader"])
            .execute()
        )
        users = [u for u in (res.data or []) if not _is_test_account(u.get("email"), u.get("name"))]
        return [{"id": u["id"], "name": u["name"], "role": u["role"]} for u in users]
    except Exception as e:
        logger.error(f"Error getting SDRs: {e}")
        return []
