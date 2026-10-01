"""Quản lý tiến độ CRM — dashboard ĐỌC (không phải task management), tổng hợp
tiến độ Lead/Khách hàng/Cơ hội/Dự án/Báo giá/Hợp đồng theo Team/Thành viên từ
CHÍNH dữ liệu CRM hiện có (không tạo bảng/field mới, không bịa SLA cho entity
chưa có due-date thật).

Nguồn dữ liệu đã audit thật (không suy đoán) trước khi viết file này:
  - Lead (`crm_leads`, KHÁC `customer_leads`): status mql/sql/nurturing/
    unqualified (migration 122, DB trigger tự ghi `crm_lead_activity_log`
    mỗi lần đổi status — tin cậy hơn app-level log). status='sql' chỉ được
    set khi `converted_deal_id` có giá trị (DB-enforced).
  - Deal/Cơ hội (`customer_leads`): `deal_stage` + cột `stage_entered_at` có
    sẵn (không cần join activity log để biết "ở bước bao lâu").
  - Quote (`quotes`): `processing_stage` + `quote_activity_log.action=
    'stage_changed'` cho "ở bước hiện tại bao lâu"; `sla_started_at/
    sla_due_at/completed_at` (migration 097, ĐÃ xác nhận có data thật trên
    DB) cho SLA — tái dùng nguyên `_quote_sla_bucket()`/`_derive_quote_phase()`
    của supabase_quote_service.py, KHÔNG viết lại logic.
  - Contract (`contracts`): `contract_activity_log.action` dạng
    `status_changed:<status>` (đã verify thật trên DB) — tính "ở trạng thái
    này bao lâu" cùng pattern Quote, không cần thêm cột/bảng.
  - Project (`projects`): CHỈ có status hiện tại, KHÔNG có activity log/due-
    date nào — cố ý KHÔNG trả `sinceAt`/`sla` cho Project.

Permission (CHỈ áp dụng cho module Quản lý tiến độ — không đổi permission CRM
hiện tại ở nơi khác):
  - admin: toàn workspace (teamIds=None).
  - leader: chỉ team mà `teams.id_leader = user.id` (KHÔNG dùng
    `has_full_crm_access()` — hàm đó còn cho cả sale-team/quote_business_role
    full access, rộng hơn yêu cầu "leader chỉ xem team mình" ở đây).
  - member: bị chặn ở tầng router (`require_admin_or_leader`), file này giả
    định luôn được gọi với role admin/leader.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.schemas.customer_lead import TERMINAL_STAGES
from app.modules.all_platform.services.supabase_quote_service import (
    _crm_instance,
    _derive_quote_phase,
    _quote_sla_bucket,
)

# ── Label map (mirror ĐÚNG chữ VN đang hiển thị ở frontend — không bịa nhãn
# mới lệch với UI hiện có: crmConfig.ts DEAL_STAGE_META, LeadsDirectory.tsx
# STATUS_LABELS, contracts/constants/contractConfig.ts CONTRACT_STATUS_LABELS,
# ProjectFormModal.tsx STATUS_OPTIONS, QuoteCenterPage.tsx PHASE_TAB_LABELS).
_DEAL_STAGE_LABELS = {
    "dealing": "Đang deal", "proposal_sent": "Lên Proposal", "negotiation": "Chăm sóc/Đàm phán",
    "contract_signed": "Lên hợp đồng", "payment_1": "Thanh toán đợt 1", "implementation": "Triển khai",
    "acceptance": "Nghiệm thu", "payment_final": "Thanh toán còn lại", "post_sale_care": "Chăm sóc sau bán",
    "on_hold": "Tiếp tục chăm sóc", "lost": "Out",
    "new_lead": "Đang deal", "contacted": "Đang deal", "qualified": "Đang deal", "requirement": "Đang deal",
    "contract_sent": "Lên Proposal", "won": "Chăm sóc sau bán",
}
_TERMINAL_DEAL_STAGES = set(TERMINAL_STAGES) | {"won"}

_LEAD_STATUS_LABELS = {"mql": "MQL", "sql": "SQL", "nurturing": "Nuôi dưỡng", "unqualified": "Không đạt chuẩn"}
_LEAD_IN_PROGRESS_STATUSES = {"mql", "nurturing"}

_CONTRACT_STATUS_LABELS = {
    "draft": "Bản nháp", "pending_legal": "Chờ pháp chế duyệt", "pending_signature": "Chờ ký",
    "signed": "Đã ký", "active": "Đang thực hiện", "completed": "Đã hoàn thành",
    "expiring": "Sắp hết hạn", "expired": "Đã hết hạn", "terminated": "Đã chấm dứt",
}

_PROJECT_STATUS_LABELS = {"planning": "Lên kế hoạch", "active": "Đang triển khai", "completed": "Hoàn thành", "cancelled": "Đã huỷ"}

_QUOTE_PHASE_LABELS = {"presale": "Presale", "sale_markup": "Sale markup", "admin_review": "Admin review", "ready_to_send": "Sẵn sàng gửi", "sent": "Đã gửi"}


class ProgressPermissionError(PermissionError):
    """Leader gọi 1 team/thành viên ngoài phạm vi mình quản lý → router map 403.
    Tách riêng khỏi PermissionError chung để không vô tình bắt nhầm lỗi khác."""


# Bug that da gap tren production (workspace nhieu du lieu that, vd
# securityzone): .in_("col", ids) voi ids qua nhieu phan tu (vai tram+) lam
# URL gui len Supabase REST qua dai, vuot gioi han cho phep cua reverse proxy
# truoc Supabase (Kong/openresty) -> Supabase tu tra ve 502 Bad Gateway (KHONG
# phai loi backend cua chinh minh, backend van song binh thuong cho cac
# request khac). Fix: chia nho ids thanh nhieu lo <= _IN_BATCH_SIZE, goi
# nhieu lan roi gop ket qua - khong doi ket qua tra ve, chi tranh URL qua dai.
_IN_BATCH_SIZE = 150


def _query_in_batches(build_query, ids: list[str], batch_size: int = _IN_BATCH_SIZE) -> list[dict[str, Any]]:
    """`build_query(batch_ids)` phai tra ve 1 supabase query builder (CHUA goi
    .execute()) da co san .in_(cot, batch_ids) + moi filter/select khac can
    thiet. Ham nay tu chia `ids` thanh cac lo <= batch_size, thuc thi tung lo
    roi gop `.data` lai thanh 1 list duy nhat."""
    unique_ids = list(dict.fromkeys(ids))
    if not unique_ids:
        return []
    rows: list[dict[str, Any]] = []
    for i in range(0, len(unique_ids), batch_size):
        batch = unique_ids[i : i + batch_size]
        result = execute_supabase_query(lambda b=batch: build_query(b).execute())
        rows.extend(result.data or [])
    return rows


# ── Scope helpers ────────────────────────────────────────────────────────────

def progress_scope(user: dict[str, Any] | None) -> dict[str, Any]:
    """{"role": "admin", "teamIds": None} = toàn workspace; {"role": "leader",
    "teamIds": [...]} = chỉ (các) team mà user này là `teams.id_leader`.
    Cố ý KHÔNG dùng has_full_crm_access() — member có quote_business_role
    sale/presale hoặc thuộc team_type='sale' KHÔNG được coi là leader ở đây,
    đúng yêu cầu "Member chưa có quyền vào submenu Quản lý tiến độ"."""
    role = str((user or {}).get("role") or "").strip().lower()
    if role == "admin":
        return {"role": "admin", "teamIds": None}
    if role == "leader":
        return {"role": "leader", "teamIds": _leader_team_ids(str((user or {}).get("id") or ""))}
    raise ProgressPermissionError("progress_module_forbidden")


def _leader_team_ids(user_id: str) -> list[str]:
    if not user_id:
        return []
    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table("teams").select("id").eq("id_leader", user_id).execute()
    )
    return [r["id"] for r in (result.data or []) if r.get("id")]


def _team_member_ids(team_ids: list[str]) -> set[str]:
    if not team_ids:
        return set()
    supabase = get_supabase_client()
    rows = _query_in_batches(
        lambda batch: supabase.table("member_of_teams").select("id_member").in_("id_teams", batch),
        team_ids,
    )
    return {r["id_member"] for r in rows if r.get("id_member")}


def _assert_member_visible(scope: dict[str, Any], caller_id: str, member_id: str) -> None:
    if scope["role"] == "admin":
        return
    allowed = _team_member_ids(scope.get("teamIds") or []) | {caller_id}
    if member_id not in allowed:
        raise ProgressPermissionError("member_outside_progress_scope")


# ── "Team" hiển thị cho user = phòng ban THẬT trong `members` (HR roster:
# Sales/Technical/Marketing/Presales/Dev/Intern L1/Intern L1 Tech/Intern L2/
# Back-Office/Freelancer — ĐÚNG 10 giá trị user xác nhận, khác hẳn bảng
# `teams` CRM (tên dạng "5. Minh PN (Sale Team)") dùng để CHẤM QUYỀN. Quyết
# định đã chốt với user sau khi audit thật: `members.linked_user_id` chỉ nối
# được 43/139 dòng (31%) sang app_users — CHỈ tính người "được gán team +
# account app_users còn active" (đúng yêu cầu), người còn lại KHÔNG hiện ở
# đây (không suy diễn team=0 cho họ). Permission GIỮ NGUYÊN 100% dựa trên
# `teams.id_leader`/`member_of_teams` (progress_scope/_team_member_ids ở
# trên, đã test PASS) — chỉ đổi KHOÁ GOM NHÓM hiển thị, không đổi ai được xem
# gì.
def _user_department_map() -> dict[str, str]:
    # Cache TTL ngan (xem _FETCH_ALL_CACHE o duoi) - ham nay duoc goi RAT NHIEU
    # lan trong 1 request (list_progress_teams/_department_summary/
    # get_member_summary/list_progress_quotes...), khong cache se query lai
    # 2 bang nay hang chuc lan mot cach vo ich.
    now = time.monotonic()
    cached = _DEPARTMENT_MAP_CACHE.get("v")
    if cached and cached[0] > now:
        return cached[1]

    supabase = get_supabase_client()
    members_res = execute_supabase_query(
        lambda: supabase.table("members").select("linked_user_id, team").not_.is_("linked_user_id", "null").not_.is_("team", "null").execute()
    )
    candidate_ids = list({r["linked_user_id"] for r in (members_res.data or []) if r.get("linked_user_id")})
    active_rows = _query_in_batches(
        lambda batch: supabase.table("app_users").select("id").in_("id", batch).eq("is_active", True),
        candidate_ids,
    )
    active_ids = {r["id"] for r in active_rows}
    out: dict[str, str] = {}
    for row in members_res.data or []:
        uid = row.get("linked_user_id")
        dept = row.get("team")
        if uid in active_ids and dept and uid not in out:
            out[uid] = dept

    _DEPARTMENT_MAP_CACHE["v"] = (now + _FETCH_ALL_CACHE_TTL_SECONDS, out)
    return out


def _departments_in_scope(scope: dict[str, Any]) -> list[str]:
    dept_map = _user_department_map()
    if scope["role"] == "admin":
        return sorted(set(dept_map.values()))
    allowed = _team_member_ids(scope.get("teamIds") or [])
    return sorted({dept for uid, dept in dept_map.items() if uid in allowed})


def _assert_team_visible(scope: dict[str, Any], department: str) -> None:
    if scope["role"] == "admin":
        return
    if department not in _departments_in_scope(scope):
        raise ProgressPermissionError("team_outside_progress_scope")


# ── Batch "since" lookups (tránh N+1, đúng nguyên tắc audit: KHÔNG dùng
# updated_at — chỉ dùng bản ghi activity-log mới nhất khớp trạng thái hiện
# tại của chính record đó). ──────────────────────────────────────────────────

def _leads_since_map(leads: list[dict[str, Any]]) -> dict[str, str]:
    ids_with_status = {row["id"]: row.get("status") for row in leads}
    if not ids_with_status:
        return {}
    supabase = get_supabase_client()
    rows = _query_in_batches(
        lambda batch: supabase.table("crm_lead_activity_log")
        .select("lead_id, to_status, created_at")
        .in_("lead_id", batch)
        .order("created_at", desc=True),
        list(ids_with_status.keys()),
    )
    out: dict[str, str] = {}
    for row in rows:
        lid = row.get("lead_id")
        if lid in out or lid not in ids_with_status:
            continue
        if row.get("to_status") == ids_with_status[lid]:
            out[lid] = row.get("created_at")
    return out


def _quotes_since_map(quotes: list[dict[str, Any]]) -> dict[str, str]:
    ids_with_stage = {row["id"]: (row.get("processing_stage") or "request") for row in quotes}
    if not ids_with_stage:
        return {}
    supabase = get_supabase_client()
    rows = _query_in_batches(
        lambda batch: supabase.table("quote_activity_log")
        .select("quote_id, changes, created_at")
        .eq("action", "stage_changed")
        .in_("quote_id", batch)
        .order("created_at", desc=True),
        list(ids_with_stage.keys()),
    )
    out: dict[str, str] = {}
    for row in rows:
        qid = row.get("quote_id")
        if qid in out or qid not in ids_with_stage:
            continue
        changes = row.get("changes") or {}
        if changes.get("stage") == ids_with_stage[qid]:
            out[qid] = row.get("created_at")
    return out


def _contracts_since_map(contracts: list[dict[str, Any]]) -> dict[str, str]:
    ids_with_status = {row["id"]: row.get("status") for row in contracts}
    if not ids_with_status:
        return {}
    supabase = get_supabase_client()
    rows = _query_in_batches(
        lambda batch: supabase.table("contract_activity_log")
        .select("contract_id, action, created_at")
        .in_("contract_id", batch)
        .order("created_at", desc=True),
        list(ids_with_status.keys()),
    )
    out: dict[str, str] = {}
    for row in rows:
        cid = row.get("contract_id")
        if cid in out or cid not in ids_with_status:
            continue
        if row.get("action") == f"status_changed:{ids_with_status[cid]}":
            out[cid] = row.get("created_at")
    return out


def _quote_sla_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Tach BIET hoan toan voi timeInCurrentStage - day la dong ho SLA nguyen
    quy trinh noi bo (1 cai duy nhat/quote), khong reset theo tung buoc."""
    now = datetime.now(timezone.utc)
    sla_due_at = row.get("sla_due_at")
    completed_at = row.get("completed_at")
    status = "not_set"
    if sla_due_at:
        if completed_at:
            status = "completed_on_time"
            try:
                due_dt = datetime.fromisoformat(str(sla_due_at).replace("Z", "+00:00"))
                completed_dt = datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
                status = "completed_on_time" if completed_dt <= due_dt else "completed_late"
            except ValueError:
                status = "completed_on_time"
        else:
            bucket = _quote_sla_bucket(row, now)
            status = bucket if bucket in ("overdue", "due_soon") else "in_progress"
    return {
        "startedAt": row.get("sla_started_at"),
        "dueAt": sla_due_at,
        "completedAt": completed_at,
        "status": status,
    }


# ── Fetch toàn bộ (chỉ lọc theo instance) rồi lọc/gộp bằng Python theo scope —
# cùng pattern đã có sẵn (list_quotes_by_phase() cũng fetch toàn bảng theo
# instance rồi lọc/gom ở Python), không phải cách mới. Khối lượng CRM của 1
# tenant hiện ở mức trăm-nghìn dòng, chưa cần OR-filter phức tạp ở PostgREST. ─

# Cache TTL ngan (20s), cung pattern voi _TEAM_TYPES_CACHE (crm_permission_service.py)
# - KHONG phai vi du lieu can "tuoi tuyet doi" (day la dashboard THEO DOI, vai
# chuc giay cu la chap nhan duoc), ma vi _department_summary()/_member_summary_row()
# goi _fetch_all() cho CUNG 1 bang RAT NHIEU LAN trong 1 lan render (moi member
# 1 lan) - khong cache se fetch lai FULL TABLE qua Supabase REST hang chuc lan
# chi trong 1 request, gay cham/khong on dinh (da do thuc te: 1.3s-5s+ tuy tai).
_FETCH_ALL_CACHE_TTL_SECONDS = 20.0
_FETCH_ALL_CACHE: dict[tuple[str, str], tuple[float, list[dict[str, Any]]]] = {}


def _fetch_all(table: str, columns: str) -> list[dict[str, Any]]:
    key = (table, columns)
    now = time.monotonic()
    cached = _FETCH_ALL_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]

    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table(table).select(columns).eq("instance", _crm_instance()).execute()
    )
    data = result.data or []
    _FETCH_ALL_CACHE[key] = (now + _FETCH_ALL_CACHE_TTL_SECONDS, data)
    return data


_DEPARTMENT_MAP_CACHE: dict[str, tuple[float, dict[str, str]]] = {}


def _clear_progress_caches() -> None:
    """Test-only helper (khong goi tu request path) - dam bao test khong bi
    dinh cache cu giua cac lan chay."""
    _FETCH_ALL_CACHE.clear()
    _DEPARTMENT_MAP_CACHE.clear()


def _scoped(rows: list[dict[str, Any]], scope: dict[str, Any], *, team_field: str | None, owner_fields: list[str]) -> list[dict[str, Any]]:
    """Lọc `rows` theo scope: admin giữ nguyên; leader chỉ giữ row có
    `team_field` thuộc teamIds HOẶC bất kỳ field trong `owner_fields` thuộc
    thành viên của các team đó (đúng OR-logic đã chốt với user cho từng
    entity: Deal/Project dùng cả team_field+owner_fields, Lead/Quote/Contract
    chỉ có owner_fields vì không có cột team_id riêng)."""
    if scope["role"] == "admin":
        return rows
    team_ids = set(scope.get("teamIds") or [])
    member_ids = _team_member_ids(list(team_ids))
    out = []
    for row in rows:
        if team_field and str(row.get(team_field) or "") in team_ids:
            out.append(row)
            continue
        if any(str(row.get(f) or "") in member_ids for f in owner_fields):
            out.append(row)
    return out


# ── 1. GET /progress/overview ───────────────────────────────────────────────

def get_progress_overview(user: dict[str, Any]) -> dict[str, Any]:
    scope = progress_scope(user)

    leads = _scoped(_fetch_all("crm_leads", "id, sdr_id, status, created_at, sdr:sdr_id(name)"), scope, team_field=None, owner_fields=["sdr_id"])
    customers = _scoped(_fetch_all("crm_customers", "id, owner_id, status"), scope, team_field=None, owner_fields=["owner_id"])
    deals = _scoped(
        _fetch_all("customer_leads", "id, sdr_id, leaded_by, team_id, deal_stage, estimated_budget, customer_id"),
        scope, team_field="team_id", owner_fields=["sdr_id", "leaded_by"],
    )
    quotes = _scoped(
        _fetch_all(
            "quotes",
            "id, technical_owner_id, quote_owner_id, processing_stage, status, sent_at, published_at, "
            "approved_at, deleted_at, sla_due_at, completed_at",
        ),
        scope, team_field=None, owner_fields=["technical_owner_id", "quote_owner_id"],
    )
    contracts = _scoped(_fetch_all("contracts", "id, owner_id, status"), scope, team_field=None, owner_fields=["owner_id"])
    projects = _scoped(
        _fetch_all("projects", "id, team_id, manager_id, status"),
        scope, team_field="team_id", owner_fields=["manager_id"],
    )

    now = datetime.now(timezone.utc)
    leads_in_progress = [l for l in leads if l.get("status") in _LEAD_IN_PROGRESS_STATUSES]
    deals_open = [d for d in deals if d.get("deal_stage") not in _TERMINAL_DEAL_STAGES]
    pipeline_value = sum(float(d.get("estimated_budget") or 0) for d in deals_open)
    projects_active = [p for p in projects if p.get("status") in ("planning", "active")]

    quote_phases: dict[str, int] = {k: 0 for k in _QUOTE_PHASE_LABELS}
    quotes_in_progress = []
    quotes_over_sla = 0
    completed_on_time = 0
    completed_total = 0
    for q in quotes:
        phase = _derive_quote_phase(q)
        if phase is None:
            continue
        if phase != "sent":
            quotes_in_progress.append(q)
            quote_phases[phase] = quote_phases.get(phase, 0) + 1
        if _quote_sla_bucket(q, now) == "overdue":
            quotes_over_sla += 1
        if q.get("completed_at") and q.get("sla_due_at"):
            completed_total += 1
            try:
                due_dt = datetime.fromisoformat(str(q["sla_due_at"]).replace("Z", "+00:00"))
                completed_dt = datetime.fromisoformat(str(q["completed_at"]).replace("Z", "+00:00"))
                if completed_dt <= due_dt:
                    completed_on_time += 1
            except ValueError:
                pass

    customers_being_cared = [c for c in customers if c.get("status") in ("new_lead", "following")]

    return {
        "scope": {"role": scope["role"], "teamIds": scope.get("teamIds")},
        "kpis": {
            "leadsInProgress": {"count": len(leads_in_progress)},
            "customersBeingCared": {"count": len(customers_being_cared)},
            "dealsOpen": {"count": len(deals_open), "pipelineValueVnd": pipeline_value},
            "projectsActive": {"count": len(projects_active)},
            "quotesInProgress": {"count": len(quotes_in_progress), "byPhase": quote_phases},
            "quotesOverSla": {"count": quotes_over_sla},
            "contractsTracked": {"count": len(contracts)},
            "onTimeCompletionRate": {
                "percent": round((completed_on_time / completed_total) * 100, 1) if completed_total else None,
                "sampleSize": completed_total,
            },
        },
    }


# ── 2/3. GET /progress/teams, /progress/teams/{team_id} ────────────────────

def list_progress_teams(user: dict[str, Any]) -> dict[str, Any]:
    scope = progress_scope(user)
    dept_map = _user_department_map()
    departments = _departments_in_scope(scope)
    allowed = _team_member_ids(scope.get("teamIds") or []) if scope["role"] == "leader" else None

    items = []
    for dept in departments:
        member_ids = {uid for uid, d in dept_map.items() if d == dept}
        if allowed is not None:
            member_ids = member_ids & allowed
        items.append(_department_summary(dept, member_ids))
    return {"scope": {"role": scope["role"], "teamIds": scope.get("teamIds")}, "teams": items}


def _department_summary(department: str, member_ids: set[str]) -> dict[str, Any]:
    leads = [l for l in _fetch_all("crm_leads", "id, sdr_id, status") if str(l.get("sdr_id") or "") in member_ids]
    customers = [c for c in _fetch_all("crm_customers", "id, owner_id, status") if str(c.get("owner_id") or "") in member_ids]
    deals = [
        d for d in _fetch_all("customer_leads", "id, sdr_id, leaded_by, deal_stage, estimated_budget")
        if str(d.get("sdr_id") or "") in member_ids or str(d.get("leaded_by") or "") in member_ids
    ]
    quotes = [
        q for q in _fetch_all("quotes", "id, technical_owner_id, quote_owner_id, processing_stage, status, sent_at, published_at, approved_at, deleted_at, sla_due_at, completed_at")
        if str(q.get("technical_owner_id") or "") in member_ids or str(q.get("quote_owner_id") or "") in member_ids
    ]
    contracts = [c for c in _fetch_all("contracts", "id, owner_id, status") if str(c.get("owner_id") or "") in member_ids]
    projects = [p for p in _fetch_all("projects", "id, manager_id, status") if str(p.get("manager_id") or "") in member_ids]

    now = datetime.now(timezone.utc)
    deals_open = [d for d in deals if d.get("deal_stage") not in _TERMINAL_DEAL_STAGES]
    pipeline_value = sum(float(d.get("estimated_budget") or 0) for d in deals_open)
    quotes_over_sla = sum(1 for q in quotes if _derive_quote_phase(q) is not None and _quote_sla_bucket(q, now) == "overdue")
    quotes_in_progress = sum(1 for q in quotes if _derive_quote_phase(q) not in (None, "sent"))
    projects_active = [p for p in projects if p.get("status") in ("planning", "active")]

    return {
        # `teamId`/`teamName` giữ nguyên TÊN FIELD (tránh đổi contract FE) nhưng
        # GIÁ TRỊ giờ là tên phòng ban thật (members.team), không phải UUID
        # `teams.id` nữa - xem comment `_user_department_map()`.
        "teamId": department,
        "teamName": department,
        "teamType": None,
        "leaderId": None,
        "leaderName": None,
        "memberCount": len(member_ids),
        "leadCount": len(leads),
        "customerCount": len(customers),
        "dealCount": len(deals_open),
        "projectCount": len(projects_active),
        "quoteCount": quotes_in_progress,
        "contractCount": len(contracts),
        "quotesOverSlaCount": quotes_over_sla,
        "pipelineValueVnd": pipeline_value,
    }


def get_progress_team_detail(user: dict[str, Any], team_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    department = team_id
    _assert_team_visible(scope, department)

    dept_map = _user_department_map()
    member_ids = {uid for uid, d in dept_map.items() if d == department}
    if scope["role"] == "leader":
        member_ids = member_ids & _team_member_ids(scope.get("teamIds") or [])

    members = []
    if member_ids:
        member_rows = _query_in_batches(
            lambda batch: get_supabase_client().table("app_users").select("id, name, role, quote_business_role").in_("id", batch),
            list(member_ids),
        )
        for u in member_rows:
            members.append(_member_summary_row(u["id"], u.get("name"), u.get("role"), u.get("quote_business_role")))

    team_row = _department_summary(department, member_ids)
    return {
        "team": team_row,
        "members": members,
    }


def _member_summary_row(member_id: str, name: str | None, role: str | None, quote_business_role: str | None) -> dict[str, Any]:
    leads = [l for l in _fetch_all("crm_leads", "id, sdr_id, status") if str(l.get("sdr_id") or "") == member_id]
    customers = _member_customers_raw(member_id)
    deals = [
        d for d in _fetch_all("customer_leads", "id, sdr_id, leaded_by, deal_stage, estimated_budget")
        if str(d.get("sdr_id") or "") == member_id or str(d.get("leaded_by") or "") == member_id
    ]
    quotes = [
        q for q in _fetch_all("quotes", "id, technical_owner_id, quote_owner_id, processing_stage, status, sent_at, published_at, approved_at, deleted_at, sla_due_at, completed_at")
        if str(q.get("technical_owner_id") or "") == member_id or str(q.get("quote_owner_id") or "") == member_id
    ]
    contracts = [c for c in _fetch_all("contracts", "id, owner_id, status") if str(c.get("owner_id") or "") == member_id]
    projects = [p for p in _fetch_all("projects", "id, manager_id, status") if str(p.get("manager_id") or "") == member_id]

    now = datetime.now(timezone.utc)
    deals_open = [d for d in deals if d.get("deal_stage") not in _TERMINAL_DEAL_STAGES]
    pipeline_value = sum(float(d.get("estimated_budget") or 0) for d in deals_open)
    quotes_over_sla = sum(1 for q in quotes if _derive_quote_phase(q) is not None and _quote_sla_bucket(q, now) == "overdue")
    projects_active = [p for p in projects if p.get("status") in ("planning", "active")]

    return {
        "userId": member_id,
        "userName": name,
        "role": role,
        "quoteBusinessRole": quote_business_role,
        "leadCount": len(leads),
        "customerCount": len(customers),
        "dealCount": len(deals_open),
        "projectCount": len(projects_active),
        "quoteCount": sum(1 for q in quotes if _derive_quote_phase(q) not in (None, "sent")),
        "contractCount": len(contracts),
        "quotesOverSlaCount": quotes_over_sla,
        "pipelineValueVnd": pipeline_value,
    }


def _member_customers_raw(member_id: str) -> list[dict[str, Any]]:
    """Customer 'thuộc' 1 member — TÁI DÙNG đúng rule đã có
    `_customer_ids_visible_to()` (crm_customer_service.py), chỉ đổi tham số
    từ user-đang-gọi sang member-đang-xem, KHÔNG phát sinh rule mới:
    owner_id = member_id, HOẶC member là leaded_by/sdr_id trên 1 Deal có
    customer_id trỏ tới Customer đó."""
    owned = [c for c in _fetch_all("crm_customers", "id, owner_id, status, customer_name, company_name") if str(c.get("owner_id") or "") == member_id]
    owned_ids = {c["id"] for c in owned}
    deal_customer_ids = {
        d.get("customer_id")
        for d in _fetch_all("customer_leads", "customer_id, sdr_id, leaded_by")
        if d.get("customer_id") and (str(d.get("sdr_id") or "") == member_id or str(d.get("leaded_by") or "") == member_id)
    }
    extra_ids = deal_customer_ids - owned_ids
    extra = [c for c in _fetch_all("crm_customers", "id, owner_id, status, customer_name, company_name") if c["id"] in extra_ids] if extra_ids else []
    return owned + extra


# ── 4. GET /progress/members/{user_id} ──────────────────────────────────────

def get_member_summary(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    member_res = execute_supabase_query(
        lambda: get_supabase_client().table("app_users")
        .select("id, name, role, quote_business_role")
        .eq("id", member_id).maybe_single().execute()
    )
    member_row = member_res.data or {}
    # Team hien thi = phong ban THAT trong `members` (HR roster), khong phai
    # `member_of_teams`/`teams` nua - xem _user_department_map().
    department = _user_department_map().get(member_id)
    team_id = department
    team_name = department

    summary = _member_summary_row(member_id, member_row.get("name"), member_row.get("role"), member_row.get("quote_business_role"))
    summary.pop("userId", None)
    summary.pop("userName", None)
    summary.pop("role", None)
    summary.pop("quoteBusinessRole", None)

    return {
        "member": {
            "userId": member_id,
            "userName": member_row.get("name"),
            "role": member_row.get("role"),
            "quoteBusinessRole": member_row.get("quote_business_role"),
            "teamId": team_id,
            "teamName": team_name,
        },
        "summary": summary,
    }


# ── 5. GET /progress/members/{user_id}/leads ────────────────────────────────

_LEAD_SELECT = "id, lead_name, company_name, status, next_step, follow_up_date, created_at, sdr_id, sdr:sdr_id(name)"


def _lead_row_to_item(row: dict[str, Any], since_at: str | None) -> dict[str, Any]:
    sdr = row.get("sdr") or {}
    return {
        "leadId": row["id"],
        "leadName": row.get("lead_name"),
        "companyName": row.get("company_name"),
        "status": row.get("status"),
        "statusLabel": _LEAD_STATUS_LABELS.get(row.get("status") or "", row.get("status")),
        "sinceAt": since_at or row.get("created_at"),
        "sdrName": sdr.get("name"),
        "nextStep": row.get("next_step"),
        "followUpDate": row.get("follow_up_date"),
        "deepLink": "/all-platform/crm/leads",
    }


def list_member_leads(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table("crm_leads")
        .select(_LEAD_SELECT)
        .eq("instance", _crm_instance())
        .eq("sdr_id", member_id)
        .execute()
    )
    leads = result.data or []
    since_map = _leads_since_map(leads)
    items = [_lead_row_to_item(row, since_map.get(row["id"])) for row in leads]
    return {"total": len(items), "items": items}


# ── 6. GET /progress/members/{user_id}/customers ────────────────────────────

def list_member_customers(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    customers = _member_customers_raw(member_id)
    if not customers:
        return {"total": 0, "items": []}

    customer_ids = [c["id"] for c in customers]
    supabase = get_supabase_client()
    deal_rows = _query_in_batches(
        lambda batch: supabase.table("customer_leads")
        .select("customer_id, deal_stage, estimated_budget")
        .in_("customer_id", batch)
        .eq("instance", _crm_instance()),
        customer_ids,
    )
    deals_by_customer: dict[str, list[dict]] = {}
    for row in deal_rows:
        deals_by_customer.setdefault(row["customer_id"], []).append(row)

    items = []
    for c in customers:
        deals = deals_by_customer.get(c["id"], [])
        open_deals = [d for d in deals if d.get("deal_stage") not in _TERMINAL_DEAL_STAGES]
        items.append({
            "customerId": c["id"],
            "customerName": c.get("customer_name"),
            "companyName": c.get("company_name"),
            "status": c.get("status"),
            "dealCount": len(open_deals),
            "pipelineValueVnd": sum(float(d.get("estimated_budget") or 0) for d in open_deals),
            "deepLink": f"/all-platform/crm/customers/{c['id']}",
        })
    return {"total": len(items), "items": items}


# ── 7. GET /progress/members/{user_id}/deals ────────────────────────────────

_DEAL_SELECT = (
    "id, customer_name, company_name, deal_stage, estimated_budget, follow_up_date, "
    "stage_entered_at, quote_id, project_id, customer_id, sdr_id, leaded_by, "
    "sdr:sdr_id(name), leader:leaded_by(name)"
)


def _deal_row_to_item(row: dict[str, Any]) -> dict[str, Any]:
    sdr = row.get("sdr") or {}
    leader = row.get("leader") or {}
    return {
        "dealId": row["id"],
        "customerName": row.get("customer_name"),
        "companyName": row.get("company_name"),
        "dealStage": row.get("deal_stage"),
        "dealStageLabel": _DEAL_STAGE_LABELS.get(row.get("deal_stage") or "", row.get("deal_stage")),
        "sinceAt": row.get("stage_entered_at"),
        "estimatedBudgetVnd": float(row.get("estimated_budget") or 0),
        "followUpDate": row.get("follow_up_date"),
        "quoteId": row.get("quote_id"),
        "projectId": row.get("project_id"),
        "customerId": row.get("customer_id"),
        "sdrId": row.get("sdr_id"),
        "sdrName": sdr.get("name"),
        "leadedById": row.get("leaded_by"),
        "leadedByName": leader.get("name"),
        "deepLink": "/all-platform/crm",
    }


def list_member_deals(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select(_DEAL_SELECT)
        .eq("instance", _crm_instance())
        .or_(f"sdr_id.eq.{member_id},leaded_by.eq.{member_id}")
        .execute()
    )
    items = [_deal_row_to_item(row) for row in result.data or []]
    return {"total": len(items), "items": items}


# ── 8. GET /progress/members/{user_id}/projects ─────────────────────────────

_PROJECT_SELECT = "id, project_code, name, customer_id, status, manager_id, team_id, customer:customer_id(customer_name), manager:manager_id(name)"


def _project_row_to_item(row: dict[str, Any]) -> dict[str, Any]:
    customer = row.get("customer") or {}
    manager = row.get("manager") or {}
    return {
        "projectId": row["id"],
        "projectCode": row.get("project_code"),
        "projectName": row.get("name"),
        "customerId": row.get("customer_id"),
        "customerName": customer.get("customer_name"),
        "status": row.get("status"),
        "statusLabel": _PROJECT_STATUS_LABELS.get(row.get("status") or "", row.get("status")),
        "managerName": manager.get("name"),
        "deepLink": "/all-platform/crm",
    }


def list_member_projects(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    """CHỈ trả status hiện tại — projects KHÔNG có activity log/due-date nào
    (đã audit thật), nên KHÔNG có `sinceAt`/`sla` ở đây, khác hẳn Lead/Deal/
    Quote/Contract."""
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table("projects")
        .select(_PROJECT_SELECT)
        .eq("instance", _crm_instance())
        .eq("manager_id", member_id)
        .execute()
    )
    items = [_project_row_to_item(row) for row in result.data or []]
    return {"total": len(items), "items": items}


# ── 9. GET /progress/members/{user_id}/quotes ───────────────────────────────

_QUOTE_SELECT = (
    "id, quote_number, deal_id, project_id, processing_stage, status, sent_at, published_at, "
    "approved_at, deleted_at, sla_started_at, sla_due_at, completed_at, subtotal_amount, vat_amount, "
    "total_amount, currency, technical_owner_id, quote_owner_id, created_at, "
    "deal:deal_id(customer_name), project:project_id(name), "
    "technical_owner:technical_owner_id(name), quote_owner:quote_owner_id(name)"
)


def _quote_to_progress_item(row: dict[str, Any], since_map: dict[str, str]) -> dict[str, Any] | None:
    phase = _derive_quote_phase(row)
    if phase is None:
        return None
    deal = row.get("deal") or {}
    project = row.get("project") or {}
    technical_owner = row.get("technical_owner") or {}
    quote_owner = row.get("quote_owner") or {}
    return {
        "quoteId": row["id"],
        "quoteNumber": row.get("quote_number"),
        "dealId": row.get("deal_id"),
        "projectId": row.get("project_id"),
        "customerName": deal.get("customer_name"),
        "projectName": project.get("name"),
        "processingStage": phase,
        "processingStageLabel": _QUOTE_PHASE_LABELS.get(phase, phase),
        "technicalOwnerId": row.get("technical_owner_id"),
        "technicalOwnerName": technical_owner.get("name"),
        "quoteOwnerId": row.get("quote_owner_id"),
        "quoteOwnerName": quote_owner.get("name"),
        "timeInCurrentStage": {"sinceAt": since_map.get(row["id"]) or row.get("created_at")},
        "sla": _quote_sla_payload(row),
        "totalAmountVnd": float(row.get("total_amount") or 0),
        "currency": row.get("currency") or "VND",
        "deepLink": f"/all-platform/quotes/{row['id']}",
    }


def list_member_quotes(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table("quotes").select(_QUOTE_SELECT)
        .eq("instance", _crm_instance())
        .is_("deleted_at", "null")
        .or_(f"technical_owner_id.eq.{member_id},quote_owner_id.eq.{member_id}")
        .execute()
    )
    rows = result.data or []
    since_map = _quotes_since_map(rows)
    items = [item for row in rows if (item := _quote_to_progress_item(row, since_map)) is not None]
    return {"total": len(items), "items": items}


# ── 10. GET /progress/members/{user_id}/contracts ───────────────────────────

_CONTRACT_SELECT = "id, contract_number, title, status, contract_value, currency, deal_id, quote_id, owner_id, created_at, owner:owner_id(name)"


def _contract_row_to_item(row: dict[str, Any], since_at: str | None) -> dict[str, Any]:
    owner = row.get("owner") or {}
    return {
        "contractId": row["id"],
        "contractNumber": row.get("contract_number"),
        "title": row.get("title"),
        "status": row.get("status"),
        "statusLabel": _CONTRACT_STATUS_LABELS.get(row.get("status") or "", row.get("status")),
        "sinceAt": since_at or row.get("created_at"),
        "contractValueVnd": float(row.get("contract_value") or 0),
        "currency": row.get("currency") or "VND",
        "dealId": row.get("deal_id"),
        "quoteId": row.get("quote_id"),
        "ownerId": row.get("owner_id"),
        "ownerName": owner.get("name"),
        "deepLink": f"/all-platform/contracts/{row['id']}",
    }


def list_member_contracts(user: dict[str, Any], member_id: str) -> dict[str, Any]:
    scope = progress_scope(user)
    _assert_member_visible(scope, str(user.get("id") or ""), member_id)

    supabase = get_supabase_client()
    result = execute_supabase_query(
        lambda: supabase.table("contracts")
        .select(_CONTRACT_SELECT)
        .eq("instance", _crm_instance())
        .eq("owner_id", member_id)
        .execute()
    )
    rows = result.data or []
    since_map = _contracts_since_map(rows)
    items = [_contract_row_to_item(row, since_map.get(row["id"])) for row in rows]
    return {"total": len(items), "items": items}


# ── 11. GET /progress/quotes (toàn dashboard, không giới hạn 1 member) ──────

def list_progress_quotes(
    user: dict[str, Any],
    *,
    team_id: str | None = None,
    owner_id: str | None = None,
    sla_status: str | None = None,
) -> dict[str, Any]:
    scope = progress_scope(user)
    rows = _fetch_all("quotes", _QUOTE_SELECT)
    rows = _scoped(rows, scope, team_field=None, owner_fields=["technical_owner_id", "quote_owner_id"])

    if team_id:
        # `team_id` o day la ten phong ban THAT (members.team), khong phai
        # UUID cua bang `teams` nua - xem _user_department_map().
        dept_map = _user_department_map()
        member_ids = {uid for uid, dept in dept_map.items() if dept == team_id}
        rows = [r for r in rows if str(r.get("technical_owner_id") or "") in member_ids or str(r.get("quote_owner_id") or "") in member_ids]
    if owner_id:
        rows = [r for r in rows if str(r.get("technical_owner_id") or "") == owner_id or str(r.get("quote_owner_id") or "") == owner_id]

    since_map = _quotes_since_map(rows)
    items = [item for row in rows if (item := _quote_to_progress_item(row, since_map)) is not None]

    if sla_status:
        items = [i for i in items if i["sla"]["status"] == sla_status]

    return {"scope": {"role": scope["role"], "teamIds": scope.get("teamIds")}, "total": len(items), "items": items}


# ── 12. GET /progress/records (CRM Records, mở rộng related_records) ───────

def list_progress_records(user: dict[str, Any]) -> dict[str, Any]:
    scope = progress_scope(user)
    customers = _scoped(
        _fetch_all("crm_customers", "id, owner_id, status, customer_name, company_name, owner:owner_id(name)"),
        scope, team_field=None, owner_fields=["owner_id"],
    )
    items = []
    for c in customers:
        owner = c.get("owner") or {}
        items.append({
            "customerId": c["id"],
            "customerName": c.get("customer_name"),
            "companyName": c.get("company_name"),
            "status": c.get("status"),
            "ownerName": owner.get("name"),
            "deepLink": f"/all-platform/crm/customers/{c['id']}",
        })
    return {"scope": {"role": scope["role"], "teamIds": scope.get("teamIds")}, "total": len(items), "items": items}


# ── 13. GET /progress/alerts (Cảnh báo cấp quản lý) ─────────────────────────
#
# CHỈ gom vấn đề có nguồn dữ liệu THẬT, dùng lại đúng select/scope/since-map
# đã có ở trên (không viết logic permission mới, không bịa SLA):
#   - Quote: sla_due_at thật → quá SLA/sắp đến hạn/chưa thiết lập.
#   - Deal: follow_up_date thật → follow-up quá hạn (KHÔNG PHẢI SLA).
#   - Lead/Contract: KHÔNG có due-date thật → chỉ liệt kê "đứng lâu ở trạng
#     thái hiện tại" (sinceAt), không gắn nhãn "quá hạn"/"quá SLA".

def get_management_alerts(user: dict[str, Any]) -> dict[str, Any]:
    scope = progress_scope(user)
    now = datetime.now(timezone.utc)

    quote_rows = _scoped(_fetch_all("quotes", _QUOTE_SELECT), scope, team_field=None, owner_fields=["technical_owner_id", "quote_owner_id"])
    quote_since = _quotes_since_map(quote_rows)
    quote_items = [item for row in quote_rows if (item := _quote_to_progress_item(row, quote_since)) is not None]
    quotes_overdue = sorted(
        (q for q in quote_items if q["sla"]["status"] in ("overdue", "completed_late")),
        key=lambda q: q["sla"]["dueAt"] or "",
    )
    quotes_due_soon = sorted((q for q in quote_items if q["sla"]["status"] == "due_soon"), key=lambda q: q["sla"]["dueAt"] or "")
    quotes_not_set = [q for q in quote_items if q["sla"]["status"] == "not_set"]

    deal_rows = _scoped(_fetch_all("customer_leads", _DEAL_SELECT), scope, team_field=None, owner_fields=["sdr_id", "leaded_by"])
    overdue_followup_deals = []
    for row in deal_rows:
        if row.get("deal_stage") in _TERMINAL_DEAL_STAGES:
            continue
        fu = row.get("follow_up_date")
        if not fu:
            continue
        try:
            fu_dt = datetime.fromisoformat(str(fu).replace("Z", "+00:00"))
        except ValueError:
            continue
        if fu_dt >= now:
            continue
        overdue_followup_deals.append(_deal_row_to_item(row))
    overdue_followup_deals.sort(key=lambda d: d["followUpDate"] or "")

    lead_rows = [r for r in _scoped(_fetch_all("crm_leads", _LEAD_SELECT), scope, team_field=None, owner_fields=["sdr_id"]) if r.get("status") in _LEAD_IN_PROGRESS_STATUSES]
    lead_since = _leads_since_map(lead_rows)
    long_standing_leads = sorted((_lead_row_to_item(row, lead_since.get(row["id"])) for row in lead_rows), key=lambda l: l["sinceAt"] or "9999")

    contract_rows = [
        r for r in _scoped(_fetch_all("contracts", _CONTRACT_SELECT), scope, team_field=None, owner_fields=["owner_id"])
        if r.get("status") not in ("completed", "terminated", "expired")
    ]
    contract_since = _contracts_since_map(contract_rows)
    long_standing_contracts = sorted(
        (_contract_row_to_item(row, contract_since.get(row["id"])) for row in contract_rows), key=lambda c: c["sinceAt"] or "9999"
    )

    return {
        "scope": {"role": scope["role"], "teamIds": scope.get("teamIds")},
        "quotesOverdue": quotes_overdue[:20],
        "quotesDueSoon": quotes_due_soon[:20],
        "quotesNotSet": quotes_not_set[:20],
        "overdueFollowUpDeals": overdue_followup_deals[:20],
        "longStandingLeads": long_standing_leads[:10],
        "longStandingContracts": long_standing_contracts[:10],
    }


# ── 14. GET /progress/search (search toàn module, trong đúng phạm vi scope) ─
#
# Trả THẲNG full item shape (giống hệt list_member_*/list_progress_quotes)
# cho Lead/Deal/Project/Quote/Contract để FE mở Quick View tại chỗ KHÔNG cần
# gọi thêm API nào — chỉ Customer/Team/Member trả id+tên tối thiểu vì Quick
# View của chúng tự fetch riêng theo id (ProgressCustomerDrawer/ProgressTeamPanel/
# ProgressMemberPanel), không cần full object ở đây.

def search_progress(user: dict[str, Any], query: str) -> dict[str, Any]:
    scope = progress_scope(user)
    q = (query or "").strip().lower()
    if len(q) < 2:
        return {"teams": [], "members": [], "leads": [], "customers": [], "deals": [], "projects": [], "quotes": [], "contracts": []}

    def hit(*values: str | None) -> bool:
        return any(q in (v or "").lower() for v in values)

    LIMIT = 8

    teams = [{"teamId": t["teamId"], "teamName": t["teamName"]} for t in list_progress_teams(user)["teams"] if hit(t["teamName"])][:LIMIT]

    dept_map = _user_department_map()
    scoped_member_ids = set(dept_map.keys()) if scope["role"] == "admin" else set(dept_map.keys()) & _team_member_ids(scope.get("teamIds") or [])
    members: list[dict[str, Any]] = []
    if scoped_member_ids:
        scoped_user_rows = _query_in_batches(
            lambda batch: get_supabase_client().table("app_users").select("id, name").in_("id", batch),
            list(scoped_member_ids),
        )
        for u in scoped_user_rows:
            if hit(u.get("name")):
                members.append({"userId": u["id"], "userName": u.get("name"), "teamName": dept_map.get(u["id"])})
    members = members[:LIMIT]

    lead_rows = _scoped(_fetch_all("crm_leads", _LEAD_SELECT), scope, team_field=None, owner_fields=["sdr_id"])
    lead_rows = [r for r in lead_rows if hit(r.get("lead_name"), r.get("company_name"))][:LIMIT]
    lead_since = _leads_since_map(lead_rows)
    leads = [_lead_row_to_item(row, lead_since.get(row["id"])) for row in lead_rows]

    customer_rows = _scoped(
        _fetch_all("crm_customers", "id, owner_id, status, customer_name, company_name"), scope, team_field=None, owner_fields=["owner_id"],
    )
    customers = [
        {"customerId": c["id"], "customerName": c.get("customer_name"), "companyName": c.get("company_name")}
        for c in customer_rows if hit(c.get("customer_name"), c.get("company_name"))
    ][:LIMIT]

    deal_rows = _scoped(_fetch_all("customer_leads", _DEAL_SELECT), scope, team_field=None, owner_fields=["sdr_id", "leaded_by"])
    deals = [_deal_row_to_item(row) for row in deal_rows if hit(row.get("customer_name"), row.get("company_name"))][:LIMIT]

    project_rows = _scoped(_fetch_all("projects", _PROJECT_SELECT), scope, team_field="team_id", owner_fields=["manager_id"])
    projects = [_project_row_to_item(row) for row in project_rows if hit(row.get("name"), row.get("project_code"))][:LIMIT]

    quote_rows = _scoped(_fetch_all("quotes", _QUOTE_SELECT), scope, team_field=None, owner_fields=["technical_owner_id", "quote_owner_id"])
    quote_rows = [r for r in quote_rows if hit(r.get("quote_number"))][:LIMIT]
    quote_since = _quotes_since_map(quote_rows)
    quotes = [item for row in quote_rows if (item := _quote_to_progress_item(row, quote_since)) is not None]

    contract_rows = _scoped(_fetch_all("contracts", _CONTRACT_SELECT), scope, team_field=None, owner_fields=["owner_id"])
    contract_rows = [r for r in contract_rows if hit(r.get("contract_number"), r.get("title"))][:LIMIT]
    contract_since = _contracts_since_map(contract_rows)
    contracts = [_contract_row_to_item(row, contract_since.get(row["id"])) for row in contract_rows]

    return {
        "teams": teams,
        "members": members,
        "leads": leads,
        "customers": customers,
        "deals": deals,
        "projects": projects,
        "quotes": quotes,
        "contracts": contracts,
    }
