import logging
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, date
from app.core.config import settings
from app.core.supabase_client import get_supabase_client, execute_supabase_query
from app.modules.all_platform.schemas.customer_lead import STAGE_REQUIRED_FIELDS, is_transition_allowed
from app.modules.all_platform.services.crm_position_service import apply_position_category
from app.modules.all_platform.services.crm_city_normalizer import normalize_vietnam_city
from app.modules.all_platform.services.supabase_user_service import get_member_option_by_id
from app.modules.all_platform.services.supabase_members_service import get_member_by_display_name
from app.modules.all_platform.services.crm_permission_service import get_scope_visible_user_ids

logger = logging.getLogger(__name__)

DEAL_STAGE_MAP = {
    "new_lead": "dealing",
    "contacted": "dealing",
    "qualified": "dealing",
    "requirement": "requirement",
    "contract_sent": "proposal_sent",
    "won": "post_sale_care",
}

DEAL_STAGE_FILTERS = {
    "dealing": ["dealing", "new_lead", "contacted", "qualified"],
    "requirement": ["requirement"],
    "proposal_sent": ["proposal_sent", "contract_sent"],
    "post_sale_care": ["post_sale_care", "won"],
}


def normalize_deal_stage(value: str | None) -> str:
    return str(value or "new_lead")


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
_NULLABLE_UUID_COLUMNS = ("leaded_by", "sdr_id", "quote_id", "team_id", "customer_id", "project_id", "primary_contact_id")


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
    "purchase_contract_links, sale_contract_links, "
    "position, position_category_id, position_label_snapshot, crm_package, zalo, facebook, telegram, pause_reason, next_step, closed_at, outcome_detail, quote_id, "
    "leaded_by_name_hint, sdr_name_hint, team_id, project_id, primary_contact_id, "
    "created_at, updated_at, leader:leaded_by(name), sdr:sdr_id(name), "
    "quote:quote_id(quote_number, total_amount, currency, public_token, status, version_number, version_chain_id), "
    "project:project_id(name), "
    "team:team_id(name_team, team_type)"
)


def _normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    if "city" in row:
        row["city"] = normalize_vietnam_city(row.get("city"))
    raw_stage = row.get("deal_stage")
    row["legacy_deal_stage"] = raw_stage
    row["deal_stage"] = normalize_deal_stage(raw_stage)
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
        row["quote_currency"] = row["quote"].get("currency") or "VND"
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
        offset = (page - 1) * page_size

        # BUG THAT DA GAP LAN 2 ("Cannot send a request, as the client has
        # been closed"): ban truoc XAY query 1 LAN duy nhat bang client lay
        # san (`supabase = get_supabase_client()` ngay dau ham), roi truyen
        # `query.execute` (da BOUND vao dung client/session luc do) cho
        # execute_supabase_query() retry. Khi 1 request khac (thread khac,
        # FastAPI chay sync handler tren threadpool) gap loi transient va
        # goi reset_supabase_client() giua chung - ham do dong LUON session
        # cua client dang cache, nhung query o day van con giu tham chieu
        # toi client/session CU do (khong bao gio tu lay lai client moi) nen
        # lan goi .execute() ke tiep (ca lan retry cua chinh no lan cac
        # request khac dang dung chung session) deu vo mot session da dong.
        # Sua dung quy uoc chung cua repo (xem comment trong
        # supabase_crawl_queue_service.py: "mọi lambda truyền vào
        # execute_supabase_query() đều tự gọi get_supabase_client()") - xay
        # LAI toan bo query TU DAU trong 1 ham noi bo, goi get_supabase_client()
        # MOI LAN thu (kem ca lan retry), khong bao gio tai su dung 1 client/
        # query object da xay san truoc do.
        def _run():
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
                query = query.in_("deal_stage", DEAL_STAGE_FILTERS.get(deal_stage, [deal_stage]))
            if exclude_terminal:
                # Loại bỏ won/lost để tab chính gọn
                query = query.not_.in_("deal_stage", ["post_sale_care", "won", "lost"])
            if city:
                query = query.eq("city", normalize_vietnam_city(city) or city)
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
            #
            # "Nhom quyen"/Team CRM (migration 155, OPT-IN theo tung user): CHI
            # ap dung khi user do da duoc admin gan Nhom quyen qua man hinh moi
            # (`get_scope_visible_user_ids` tra ve None cho toan bo user CHUA
            # duoc gan - universal nhu tren khong doi gi). Khi co, gioi han
            # them theo leaded_by/sdr_id thuoc dung tap user_id duoc phep xem
            # (ca nhan hoac ca Team CRM).
            scope_user_ids = get_scope_visible_user_ids(current_user)
            if scope_user_ids is not None:
                ids_list = list(scope_user_ids)
                if not ids_list:
                    query = query.eq("id", "00000000-0000-0000-0000-000000000000")
                else:
                    query = query.or_(
                        ",".join([f"leaded_by.eq.{o}" for o in ids_list] + [f"sdr_id.eq.{o}" for o in ids_list])
                    )

            # Sắp xếp theo stage_entered_at DESC — deal mới nhất lên đầu trong cột
            query = (
                query.order("stage_entered_at", desc=True, nullsfirst=False)
                .order("created_at", desc=True)
                .range(offset, offset + page_size - 1)
            )
            return query.execute()

        res = execute_supabase_query(_run)
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
            s = normalize_deal_stage(row.get("deal_stage"))
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


def validate_project_belongs_to_customer(project_id: Optional[str], customer_id: Optional[str]) -> None:
    """Chan 'Cross-customer Project' o tang service - Co hoi chi duoc gan 1
    Project THUOC DUNG Customer cua no (khong chi dua vao dropdown UI da
    loc dung). Import tre (lazy) de tranh vong lap module voi
    supabase_project_service.py."""
    if not project_id:
        return
    from app.modules.all_platform.services.supabase_project_service import get_project

    try:
        project = get_project(project_id)
    except ValueError:
        raise ValueError("Dự án đã chọn không tồn tại.")
    if str(project.get("customerId") or "") != str(customer_id or ""):
        raise ValueError("Dự án đã chọn không thuộc đúng khách hàng này.")


def validate_contact_belongs_to_customer(contact_id: Optional[str], customer_id: Optional[str]) -> None:
    """Chan 'Cross-customer Contact' o tang service - dung y het
    validate_project_belongs_to_customer() ben tren: Deal chi duoc gan
    primary_contact_id THUOC DUNG Customer cua no, khong chi dua vao dropdown
    UI da loc dung (defense-in-depth, task yeu cau ro "Contact dropdown must
    not show Contacts from another Customer" - server phai tu kiem tra lai,
    khong tin FE). Import tre de tranh vong lap module voi crm_contact_service.py."""
    if not contact_id:
        return
    from app.modules.all_platform.services.crm_contact_service import _get_contact

    try:
        contact = _get_contact(contact_id)
    except ValueError:
        raise ValueError("Người liên hệ đã chọn không tồn tại.")
    if str(contact.get("customer_id") or "") != str(customer_id or ""):
        raise ValueError("Người liên hệ đã chọn không thuộc đúng khách hàng này.")


_DEAL_ASSIGNMENT_FIELD_LABELS = {"leaded_by": "Người phụ trách", "sdr_id": "SDR"}


def _validate_one_deal_assignment_field(
    actor: Dict[str, Any] | None, field: str, hint_field: str,
    payload: Dict[str, Any], existing: Dict[str, Any] | None,
) -> None:
    """Phase 3.5 A5 hybrid rule cho leaded_by/sdr_id (Deal owner/SDR).

    Linked user (field co gia tri = FK toi app_users.id thuc su): phai active
    + quote_business_role in (sale, both) - presale thuan tuy KHONG duoc lam
    Deal owner/SDR du la ai gan.
    Unlinked staff (field rong, chi co *_name_hint - workflow "gan truoc khi
    lien ket tai khoan" co tu truoc, KHONG duoc bo): giu nguyen cho phep, chi
    doi chieu ten co that trong danh ba `members` (khong the check
    active/tenant vi bang members khong co cot do - danh ba HR dung chung).
    Quyen gan: he thong-role admin/leader duoc gan bat ky ai (linked hop le
    hoac unlinked); he thong-role member CHI duoc tu gan chinh minh (linked),
    khong duoc gan unlinked staff ho (vi ho khong the "la" 1 nhan su chua lien
    ket - member dang dang nhap luon la 1 linked user). Day la kiem tra
    STRICT theo system role (admin/leader/member), co tinh khac voi
    has_full_crm_access() (vi has_full_crm_access coi ca thanh vien team sale
    la "full access" - task nay yeu cau tach rieng quyen GAN NGUOI, khong
    dung chung tieu chi voi quyen xem Pipeline/Analytics).
    Existing khong doi (resend id/hint cu nguyen) = grandfather, KHONG
    re-validate - tranh 1 deal cu voi assignment da khong con hop le (vd
    quote_business_role bi doi sau do) bi chan luu chi vi sua field khac.
    """
    id_touched = field in payload
    hint_touched = hint_field in payload
    if not id_touched and not hint_touched:
        return
    existing = existing or {}
    new_id = payload.get(field) if id_touched else existing.get(field)
    new_hint = payload.get(hint_field) if hint_touched else existing.get(hint_field)
    current_id = existing.get(field)
    current_hint = existing.get(hint_field)
    changed = (str(new_id or "") != str(current_id or "")) or (str(new_hint or "") != str(current_hint or ""))
    if not changed:
        return

    label = _DEAL_ASSIGNMENT_FIELD_LABELS.get(field, field)
    actor_role = str((actor or {}).get("role") or "").strip().lower()
    actor_id = str((actor or {}).get("id") or "")
    is_admin_or_leader = actor_role in ("admin", "leader")

    if new_id:
        user = get_member_option_by_id(new_id)
        if not user:
            raise ValueError(f"{label} không hợp lệ hoặc không còn tồn tại.")
        if not user.get("isActive", True):
            raise ValueError(f"{label} đã ngừng hoạt động. Vui lòng chọn người khác.")
        # Sale phu trach (sdr_id) co the la Presale (vd Presale tu nhan Lead roi tu xu ly); Nguoi phu trach (leaded_by) van chi Sale/Both.
        allowed_roles = ("sale", "both", "presale") if field == "sdr_id" else ("sale", "both")
        if user.get("quoteBusinessRole") not in allowed_roles:
            raise ValueError(f"{label} phải có vai trò báo giá Sale hoặc Both — không thể là Presale." if field != "sdr_id" else f"{label} phải có vai trò báo giá Sale, Presale hoặc Both.")
        if not is_admin_or_leader and str(new_id) != actor_id:
            raise ValueError(f"Bạn không có quyền gán {label.lower()} cho người khác — chỉ tự gán cho chính mình.")
        return

    if new_hint:
        if not get_member_by_display_name(new_hint):
            raise ValueError(f"{label} '{new_hint}' không khớp với danh bạ nhân sự.")
        if not is_admin_or_leader:
            raise ValueError(f"Bạn không có quyền gán {label.lower()} cho nhân sự chưa liên kết tài khoản.")


def validate_deal_assignment_fields(actor: Dict[str, Any] | None, payload: Dict[str, Any], existing: Dict[str, Any] | None = None) -> None:
    _validate_one_deal_assignment_field(actor, "leaded_by", "leaded_by_name_hint", payload, existing)
    _validate_one_deal_assignment_field(actor, "sdr_id", "sdr_name_hint", payload, existing)


def create_customer_lead(data: Dict[str, Any], actor: Dict[str, Any] | None = None) -> Optional[Dict[str, Any]]:
    try:
        # Feedback 2026-09-25: "Cơ hội" khong con nhap ten rieng - lay theo Du
        # an da chon. FE gui project_name (khong kem project_id) khi nguoi tao
        # deal go ten Du an MOI chua co trong dropdown -> tu tao Du an that
        # ngay tai day (goi thang service, KHONG qua router/can_manage_project()
        # - da xac nhan voi nguoi dung: noi rong quyen tao Du an CHI trong
        # luong tao deal, khong mo POST /projects cho moi nguoi). Can co
        # customer_id THAT (Du an bat buoc thuoc 1 Customer) - neu chua co
        # customer_id thi bo qua, de validate_deal_relations ben duoi bao loi
        # binh thuong nhu cu.
        project_name = (data.pop("project_name", None) or "").strip()
        if project_name and not data.get("project_id") and data.get("customer_id"):
            from app.modules.all_platform.services.supabase_project_service import create_project
            new_project = create_project(
                {"name": project_name, "customer_id": data["customer_id"]},
                actor.get("id") if actor else None,
            )
            data["project_id"] = new_project["id"]
        from app.modules.all_platform.services.deal_relation_service import validate_deal_relations
        validate_deal_relations(data, actor)
        validate_deal_assignment_fields(actor, data, existing=None)
        supabase = get_supabase_client()
        if "city" in data:
            data["city"] = normalize_vietnam_city(data.get("city"))
        if "tags" not in data or data["tags"] is None:
            data["tags"] = []
        if "has_budget" not in data:
            data["has_budget"] = False
        if "source_platform" not in data or not data["source_platform"]:
            data["source_platform"] = "FB_Inbox"
        # Map deal_stage → status để tương thích code cũ
        ds = normalize_deal_stage(data.get("deal_stage") or "dealing")
        data["deal_stage"] = ds
        if ds in ("post_sale_care", "won"):
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
        logger.info(
            "tenant_write table=customer_leads operation=insert settings.crm_instance=%s resolved_instance=%s",
            settings.crm_instance,
            data["instance"],
        )
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


_DEAL_PHASE_LINK_FIELDS = {
    "purchase_contract_links": "purchase",
    "sale_contract_links": "sale",
}


def _sync_deal_phase_contracts(lead_id: str, data: Dict[str, Any], actor: Dict[str, Any] | None) -> None:
    """"Hợp đồng báo giá mua (Phase 1)" / "bán (Phase 2)" trong form Sửa Deal
    (CrmCustomerModal.tsx) — trước đây ghi thẳng vào 2 cột JSON
    purchase_contract_links/sale_contract_links trên customer_leads (shadow
    data, KHÔNG phải contracts canonical, nên tab Hợp đồng của Deal/Customer
    360 không bao giờ thấy, phải link/ghi nhận lại lần 2).

    Fix (2026-10-03, xác nhận với user: Phase 1/2 là hợp đồng với CÙNG 1
    khách hàng, không phải Vendor — không cần vendor_id, chỉ cần tag
    deal_phase để hiện lại đúng 2 khu vực trong form): mỗi dòng {name, url}
    gửi lên giờ tạo/đối chiếu THẲNG vào bảng contracts (deal_id=lead_id,
    deal_phase='purchase'|'sale', source='external' — đúng ngữ nghĩa "hợp
    đồng đã có sẵn bên ngoài" của luồng "Ghi nhận hợp đồng có sẵn").

    Dedup theo (deal_id, deal_phase, file_url) — lưu/sửa Deal nhiều lần với
    đúng các link cũ KHÔNG tạo contract trùng, chỉ link mới thật sự mới
    (url chưa từng thấy cho deal_phase này) mới được tạo thêm.

    Gọi hàm này THAY VÌ ghi `data[field]` vào customer_leads — caller phải
    tự pop 2 field này khỏi payload trước khi update() (xem update_customer_lead).
    """
    from app.modules.all_platform.services.supabase_contract_service import create_contract, list_contracts

    actor_id = (actor or {}).get("id")
    for field, phase in _DEAL_PHASE_LINK_FIELDS.items():
        if field not in data:
            continue
        links = data.get(field) or []
        rows = [
            {"name": (item.get("name") or "").strip() or None, "url": (item.get("url") or "").strip()}
            for item in links
            if isinstance(item, dict) and (item.get("url") or "").strip()
        ]
        if not rows:
            continue
        existing = [
            c for c in list_contracts(deal_id=lead_id) if c.get("dealPhase") == phase
        ]
        existing_urls = {c.get("fileUrl") for c in existing if c.get("fileUrl")}
        for row in rows:
            if row["url"] in existing_urls:
                continue
            create_contract(
                {
                    "deal_id": lead_id,
                    "title": row["name"] or ("Hợp đồng mua" if phase == "purchase" else "Hợp đồng bán"),
                    "source": "external",
                    "file_url": row["url"],
                    "deal_phase": phase,
                },
                created_by=actor_id,
            )
            existing_urls.add(row["url"])


def update_customer_lead(lead_id: str, data: Dict[str, Any], actor: Dict[str, Any] | None = None) -> Optional[Dict[str, Any]]:
    """
    Update thông thường (không phải stage change).
    KHÔNG ghi log ở đây — chỉ API /transition mới ghi log stage.
    """
    try:
        existing_for_assignment = get_customer_lead_by_id(lead_id) or {}
        validate_deal_assignment_fields(actor, data, existing=existing_for_assignment)
        supabase = get_supabase_client()
        safe_data = dict(data)
        # Phase 1/2 contract links (xem _sync_deal_phase_contracts) — tạo
        # thẳng contracts canonical, KHÔNG còn ghi vào 2 cột JSON cũ nữa (dù
        # schema DB vẫn giữ cột để đọc dữ liệu legacy cho action migrate).
        if any(f in safe_data for f in _DEAL_PHASE_LINK_FIELDS):
            _sync_deal_phase_contracts(lead_id, safe_data, actor)
            for f in _DEAL_PHASE_LINK_FIELDS:
                safe_data.pop(f, None)
        # Cung logic voi create_customer_lead(): go ten Du an moi (chua co
        # project_id) -> tu tao Du an that, gan project_id vao deal.
        project_name = (safe_data.pop("project_name", None) or "").strip()
        if project_name and not safe_data.get("project_id"):
            customer_id = safe_data.get("customer_id") or existing_for_assignment.get("customer_id")
            if customer_id:
                from app.modules.all_platform.services.supabase_project_service import create_project
                new_project = create_project(
                    {"name": project_name, "customer_id": customer_id},
                    actor.get("id") if actor else None,
                )
                safe_data["project_id"] = new_project["id"]
        if "city" in safe_data:
            safe_data["city"] = normalize_vietnam_city(safe_data.get("city"))
        from app.modules.all_platform.services.deal_relation_service import validate_deal_relations
        validate_deal_relations(safe_data, actor, existing_for_assignment)
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
            updated_row = _normalize_row(res.data[0])
            # Doi lien he chinh cua co hoi -> bao gia cua co hoi doi "Kinh gui"/SDT/Email theo.
            new_pc, old_pc = safe_data.get("primary_contact_id"), existing_for_assignment.get("primary_contact_id")
            if new_pc and str(new_pc) != str(old_pc or ""):
                try:
                    from app.modules.all_platform.services.supabase_quote_service import sync_deal_primary_contact_to_quotes
                    pc_new = (supabase.table("crm_contacts").select("*").eq("id", new_pc).limit(1).execute().data or [None])[0]
                    pc_old = (supabase.table("crm_contacts").select("*").eq("id", old_pc).limit(1).execute().data or [None])[0] if old_pc else None
                    sync_deal_primary_contact_to_quotes(lead_id, pc_new, pc_old)
                except Exception:
                    logger.warning("sync primary contact -> quotes failed for deal %s", lead_id, exc_info=True)
            # Sua ten cong ty/dia chi/MST cua khach hang tren co hoi -> dong bo snapshot cua cac bao gia thuoc co hoi do.
            if any(k in safe_data for k in ("company_name", "address", "tax_code")):
                from app.modules.all_platform.services.supabase_quote_service import sync_customer_snapshot_to_quotes
                sync_customer_snapshot_to_quotes(customer_row=res.data[0], deal_ids=[lead_id])
            return updated_row
        return None
    except Exception as e:
        logger.error(f"Error updating customer lead {lead_id}: {e}")
        raise e


def migrate_legacy_deal_phase_contracts(lead_id: str, actor: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Action thủ công (nút bấm, KHÔNG tự chạy ngầm) cho deal còn dữ liệu cũ ở
    purchase_contract_links/sale_contract_links (tạo trước khi có fix
    _sync_deal_phase_contracts) — chuyển nốt số link còn lại sang contracts
    canonical rồi xoá sạch 2 cột JSON cũ, dừng hẳn việc duy trì 2 nguồn.

    Dùng CHUNG logic dedup với _sync_deal_phase_contracts (không tạo trùng
    nếu đã có vài link được migrate từ trước / đã có contract cùng URL)."""
    lead = get_customer_lead_by_id(lead_id)
    if not lead:
        raise ValueError("Không tìm thấy deal này")
    legacy_payload = {
        field: lead.get(field) for field in _DEAL_PHASE_LINK_FIELDS if lead.get(field)
    }
    if not legacy_payload:
        return {"migrated": 0}
    _sync_deal_phase_contracts(lead_id, legacy_payload, actor)
    supabase = get_supabase_client()
    supabase.table("customer_leads").update(
        {field: [] for field in legacy_payload}
    ).eq("id", lead_id).eq("instance", settings.crm_instance).execute()
    return {"migrated": sum(len(v) for v in legacy_payload.values())}


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

        from_stage = normalize_deal_stage(current.get("deal_stage"))
        to_stage = normalize_deal_stage(payload.get("to_stage"))
        if not to_stage:
            raise TransitionError("Thiếu 'to_stage'")

        # Check terminal
        if from_stage in ("post_sale_care", "won", "lost"):
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
        if to_stage in ("post_sale_care", "won"):
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


def add_note(
    lead_id: str,
    note: str,
    actor: Optional[str] = None,
    actor_name: Optional[str] = None,
) -> None:
    """Them 1 ghi chu doc lap (khong gan voi doi stage) vao activity log cua
    deal - feedback leader ve man "Sua co hoi" (DealDetailDrawer.tsx, tab
    "Hoat dong"): truoc day note CHI duoc ghi kem theo luc transition_stage,
    khong co cach nao them ghi chu doc lap bat cu luc nao. Dung lai dung
    _write_activity_log() (action="note_added") - KHONG doi schema/logic
    stage_change hien co."""
    note = (note or "").strip()
    if not note:
        raise ValueError("Ghi chú không được để trống")
    _write_activity_log(
        customer_id=lead_id,
        action="note_added",
        actor=actor,
        actor_name=actor_name,
        note=note,
    )


def get_activity_log(
    lead_id: str,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    """Lấy audit trail cho 1 deal — sắp xếp DESC theo created_at."""
    try:
        supabase = get_supabase_client()
        # Count
        # CHU Y: mot Supabase project khac (dung tam thoi de test trong phien
        # nay) KHONG co cot `instance` tren bang nay, nhung DB THAT
        # (seeding.db.markeeai.com, dung chung 3 tenant markee/cloudgate/
        # securityzone) THI CO va da co du lieu nhieu tenant that su - phai
        # loc lai, khong duoc bo di.
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


def delete_customer_lead(lead_id: str, user: Dict[str, Any] | None = None, confirm_cascade: bool = False) -> bool:
    """Xoa 1 Co hoi. Feedback 2026-09-23: khong chan quyen/khong chan vi da co
    Bao gia/Hop dong - chi HOI XAC NHAN: confirm_cascade=False ma con du lieu
    lien quan -> raise CascadeConfirmRequired (kem so dem), KHONG xoa gi;
    confirm_cascade=True -> xoa Co hoi kem Bao gia (xoa mem) va Hop dong."""
    # Import tre de tranh vong import (cascade service -> supabase_quote_service).
    from app.modules.all_platform.services.crm_delete_cascade_service import delete_deal_cascade

    deal = get_customer_lead_by_id(lead_id)
    if not deal:
        raise ValueError("Không tìm thấy cơ hội này.")
    delete_deal_cascade(deal, (user or {}).get("id"), confirm_cascade)
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
    """Danh sach nguoi co the gan lam Quan ly (Nguoi lead) / Phu trach
    (Nguoi xu ly - SDR) cho 1 Deal CRM.

    Feedback (2026-10-03): dropdown truoc day CHI lay role admin/leader, bo
    sot het Sale/Presale (quote_business_role='sale'/'presale'/'both', KHAC
    cot `role` - 1 Sale/Presale thuong co role='member') - nguoi dang la
    Sale/Presale khong thay ten minh trong danh sach. Gop ca 2 nhom bang
    .or_() (admin/leader theo `role`, HOAC co quote_business_role) roi loai
    trung (1 admin/leader co the dong thoi co quote_business_role). Van loai
    tru acc test/dev/demo nhu cu.
    """
    try:
        # Xem giai thich trong get_all_customer_leads() o tren - xay LAI
        # query moi lan thu (khong tai su dung 1 client/query da xay san) de
        # tranh dung phai session da bi reset_supabase_client() dong giua chung.
        def _run():
            supabase = get_supabase_client()
            return (
                supabase.table("app_users")
                .select("id, name, email, role, quote_business_role")
                .or_("role.in.(admin,leader),quote_business_role.in.(sale,presale,both)")
                .execute()
            )

        res = execute_supabase_query(_run)
        users = [u for u in (res.data or []) if not _is_test_account(u.get("email"), u.get("name"))]
        result = []
        for u in users:
            role = u.get("role")
            biz_role = (u.get("quote_business_role") or "").strip().lower()
            # Nhan hien thi: giu nguyen "admin"/"leader" (quyen he thong cao
            # hon, uu tien hien thi); nguoi KHONG phai admin/leader (thuong
            # role='member') thi hien Sale/Presale/ca 2 thay vi "member" vo
            # nghia - day moi la thong tin nguoi dung can de nhan ra nhau.
            if role in ("admin", "leader"):
                label = role
            elif biz_role == "both":
                label = "sale/presale"
            elif biz_role in ("sale", "presale"):
                label = biz_role
            else:
                label = role
            result.append({"id": u["id"], "name": u["name"], "role": label})
        return result
    except Exception as e:
        logger.error(f"Error getting SDRs: {e}")
        return []
