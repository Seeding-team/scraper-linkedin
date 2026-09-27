"""Rule cau hinh phan loai Lead (SQL / Nuoi duong / Khong dat chuan) bang
checkbox - migration 152 (`crm_lead_classification_rules`, 1 dong duy nhat).

Theo dung feedback WIP full-flow (markee_crm_v26_compact_opportunity_name.html,
man "Danh muc & cau hinh -> Dieu kien phan loai Lead"):
  - Nhom "Dat chuan (SQL)": AND - TAT CA dieu kien duoc tick phai thoa.
  - Nhom "Nuoi duong": OR - CHI CAN 1 dieu kien duoc tick la thoa, GATE that
    su ket qua (co the override ca khi da du dieu kien SQL) - da sua theo
    feedback leader (truoc day chi la ly do hien thi, khong co tac dung
    logic that - xem evaluate_lead_conditions() ben duoi).
  - Nhom "Khong dat chuan": OR - CHI CAN 1 dieu kien duoc tick la thoa.

Thiet ke giong dung `quote_rule_evaluation_service.py`: 1 ham thuan
`evaluate_lead_conditions()` khong dung DB (de test duoc), lop doc/ghi DB
that (`get_rule_set`/`save_rule_set`) tach rieng.
"""
from __future__ import annotations

from typing import Any, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client

# Danh sach dieu kien HOP LE + nhan hien thi (dung cho ca validate input luc
# save VA build cau "Rule dang ap dung"). Key phai khop CHINH XAC voi
# _ascii tick bên frontend (LeadClassificationRuleSettings.tsx).
SQL_AND_LABELS: dict[str, str] = {
    "sql_product": "Có sản phẩm / dịch vụ",
    "sql_interest": "Có mức độ quan tâm",
    "sql_value": "Có giá trị dự kiến",
    "sql_team": "Đã chọn Sale nhận bàn giao",
    "sql_next": "Có việc tiếp theo",
    "sql_follow": "Có hạn follow-up",
    "sql_fit": "Không ở trạng thái “Chưa phù hợp”",
}
NURTURE_LABELS: dict[str, str] = {
    "nur_missing_value": "Thiếu giá trị dự kiến",
    "nur_missing_handoff": "Thiếu thông tin bàn giao Sale",
    "nur_unknown_fit": "Chưa xác định nhóm khách hàng",
}
UNQUALIFIED_OR_LABELS: dict[str, str] = {
    "inv_fit": "Đúng nhóm khách hàng = “Chưa phù hợp”",
    "inv_no_contact": "Không có thông tin liên hệ hợp lệ",
}
ALL_CONDITION_KEYS = set(SQL_AND_LABELS) | set(NURTURE_LABELS) | set(UNQUALIFIED_OR_LABELS)

# PHAI khop CHINH XAC voi seed cua migration 152 (co assert luc import module
# de 2 noi khong bao gio lech nhau).
DEFAULT_CONDITIONS: dict[str, bool] = {
    "sql_product": True, "sql_interest": True, "sql_value": True,
    "sql_team": True, "sql_next": True, "sql_follow": True, "sql_fit": True,
    "nur_missing_value": True, "nur_missing_handoff": True, "nur_unknown_fit": False,
    "inv_fit": True, "inv_no_contact": False,
}
assert set(DEFAULT_CONDITIONS) == ALL_CONDITION_KEYS, "DEFAULT_CONDITIONS phai khop du ALL_CONDITION_KEYS"


class RuleValidationError(Exception):
    """Payload luu rule khong hop le (key la, thieu key)."""


def _normalize_conditions(raw: dict[str, Any] | None) -> dict[str, bool]:
    """Ep ve dung du 12 key, gia tri bool - dieu kien thieu trong payload
    duoc coi la False (tat) thay vi giu nguyen gia tri cu, tranh 1 checkbox
    an bi FE quen gui van "am tham" giu gia tri True cu."""
    raw = raw or {}
    return {key: bool(raw.get(key, False)) for key in ALL_CONDITION_KEYS}


def evaluate_lead_conditions(fields: dict[str, Any], conditions: dict[str, bool] | None = None) -> dict[str, Any]:
    """Ham THUAN, khong dung DB - nhan vao tin hieu thuc te cua 1 Lead va bo
    dieu kien dang bat, tra ve dict {outcome, reason, reasons, missing,
    sql_ok, sql_total}. Mirror 1-1 voi evaluateLeadConditions() (JS,
    LeadDetailDrawer.tsx) - noi SDR THUC SU dung ket qua nay, KHONG duoc tu
    chon/override (feedback leader). `reasons` la list ly do cu the (Nuoi
    duong/Khong dat, rong voi sql/pending); `missing` la list ten field SQL
    dang bat nhung chua thoa (dung cho card "pending"); sql_ok/sql_total la
    tien do dieu kien SQL dang bat (KHONG hard-code "X/Y").

    Thu tu uu tien: Khong dat chuan (OR) > Nuoi duong (OR, co the override
    ca khi da du SQL) > SQL (AND) > "pending" ("chua du du lieu") neu khong
    khop dieu kien nao trong 3 nhom tren - KHAC voi truoc day (mac dinh ket
    luan la "nurturing" du chi la fallback ngam dinh, khong phai Nuoi duong
    that theo dung 3 dieu kien rieng cua WIP).

    `fields` (tat ca la bool, tinh san o phia goi):
      has_product, has_interest_level, has_value, has_team, has_next,
      has_follow, has_contact, fit_unfit (True neu ICP = "Chưa phù hợp"),
      fit_known (True neu da xac dinh ICP, khac "Chưa xác định").
    """
    c = _normalize_conditions(conditions if conditions is not None else DEFAULT_CONDITIONS)

    invalid_reasons: list[str] = []
    if c["inv_fit"] and bool(fields.get("fit_unfit")):
        invalid_reasons.append("Không phù hợp ICP")
    if c["inv_no_contact"] and not bool(fields.get("has_contact")):
        invalid_reasons.append("Không có thông tin liên hệ hợp lệ")
    is_invalid = bool(invalid_reasons)

    sql_field_labels = {
        "sql_product": "Sản phẩm / dịch vụ",
        "sql_interest": "Mức độ quan tâm",
        "sql_value": "Giá trị dự kiến",
        "sql_team": "Sale nhận bàn giao",
        "sql_next": "Việc tiếp theo",
        "sql_follow": "Hạn follow-up",
        "sql_fit": "ICP phù hợp",
    }
    sql_field_values = {
        "sql_product": bool(fields.get("has_product")),
        "sql_interest": bool(fields.get("has_interest_level")),
        "sql_value": bool(fields.get("has_value")),
        "sql_team": bool(fields.get("has_team")),
        "sql_next": bool(fields.get("has_next")),
        "sql_follow": bool(fields.get("has_follow")),
        "sql_fit": not bool(fields.get("fit_unfit")),
    }
    sql_enabled_keys = [key for key in sql_field_labels if c[key]]
    sql_checks = [sql_field_values[key] for key in sql_enabled_keys]
    sql_total = len(sql_checks)
    sql_ok = sum(1 for ok in sql_checks if ok)
    is_sql = sql_total > 0 and sql_ok == sql_total
    missing = [label for key, label in sql_field_labels.items() if c[key] and not sql_field_values[key]]

    # "Near-miss": 1 dieu kien Nuoi duong CHI duoc tinh la khop khi TAT CA cac
    # dieu kien SQL dang bat KHAC (ngoai dung field ma dieu kien nay nham toi)
    # da thoa - tuc Lead gan nhu du SQL, chi vuong dung 1 cho. Neu Lead con
    # thieu nhieu thu khac nua thi van la "pending", KHONG phai Nuoi duong
    # (feedback leader, doi chieu vi du: Lead moi mo/dien mot phan KHONG duoc
    # tu dong ket luan la Nuoi duong chi vi 1 field dang trong).
    def others_ok(exclude_keys: set[str]) -> bool:
        return all(sql_field_values[key] for key in sql_enabled_keys if key not in exclude_keys)

    nurture_reasons = []
    if c["nur_missing_value"] and not fields.get("has_value") and others_ok({"sql_value"}):
        nurture_reasons.append("Thiếu giá trị dự kiến")
    if (
        c["nur_missing_handoff"]
        and not (fields.get("has_team") and fields.get("has_next") and fields.get("has_follow"))
        and others_ok({"sql_team", "sql_next", "sql_follow"})
    ):
        nurture_reasons.append("Thiếu thông tin bàn giao Sale")
    if c["nur_unknown_fit"] and not fields.get("fit_known") and others_ok({"sql_fit"}):
        nurture_reasons.append("Chưa xác định nhóm khách hàng")
    is_nurture_forced = bool(nurture_reasons)

    base = {"missing": missing, "sql_ok": sql_ok, "sql_total": sql_total}
    if is_invalid:
        return {**base, "outcome": "unqualified", "reason": f"Không đạt chuẩn: {', '.join(invalid_reasons)}.", "reasons": invalid_reasons}
    if is_nurture_forced:
        # Dieu kien Nuoi duong dang bat GATE that su - co the override ca khi
        # cac dieu kien SQL con lai da du (feedback leader: "sao chi la text
        # duoc?" - khong con la ly do hien thi don thuan nhu truoc).
        return {**base, "outcome": "nurturing", "reason": f"Nuôi dưỡng vì {', '.join(nurture_reasons).lower()}.", "reasons": nurture_reasons}
    if is_sql:
        return {**base, "outcome": "sql", "reason": "Đủ điều kiện SQL theo cấu hình hiện tại.", "reasons": []}
    return {**base, "outcome": "pending", "reason": "Chưa đủ dữ liệu để phân loại.", "reasons": []}


def rule_summary_text(conditions: dict[str, bool]) -> str:
    c = _normalize_conditions(conditions)
    labels = [label for key, label in SQL_AND_LABELS.items() if c[key]]
    if not labels:
        return "SQL: chưa bật điều kiện nào."
    return "SQL: yêu cầu đủ " + ", ".join(labels) + "."


def _row_to_api(row: dict[str, Any]) -> dict[str, Any]:
    conditions = _normalize_conditions(row.get("conditions"))
    return {
        "conditions": conditions,
        "summary": rule_summary_text(conditions),
        "updatedAt": row.get("updated_at"),
        "updatedBy": row.get("updated_by"),
    }


def get_rule_set() -> dict[str, Any]:
    """Doc dong singleton - tu tao dong mac dinh neu bang rong (vd DB chua
    chay migration seed, hoac dong bi xoa nham)."""
    result = execute_supabase_query(
        lambda: get_supabase_client().table("crm_lead_classification_rules").select("*").eq("singleton", True).limit(1).execute()
    )
    if result.data:
        return _row_to_api(result.data[0])
    insert_result = execute_supabase_query(
        lambda: get_supabase_client().table("crm_lead_classification_rules")
        .insert({"singleton": True, "conditions": DEFAULT_CONDITIONS})
        .execute()
    )
    row = insert_result.data[0] if insert_result.data else {"conditions": DEFAULT_CONDITIONS}
    return _row_to_api(row)


def save_rule_set(conditions: dict[str, Any], actor_id: Optional[str]) -> dict[str, Any]:
    unknown_keys = set(conditions or {}) - ALL_CONDITION_KEYS
    if unknown_keys:
        raise RuleValidationError(f"Điều kiện không hợp lệ: {', '.join(sorted(unknown_keys))}")
    normalized = _normalize_conditions(conditions)
    # Dam bao co dung 1 dong singleton truoc khi update (idempotent voi
    # get_rule_set() o tren - upsert bang insert-neu-chua-co).
    get_rule_set()
    result = execute_supabase_query(
        lambda: get_supabase_client().table("crm_lead_classification_rules")
        .update({"conditions": normalized, "updated_by": actor_id})
        .eq("singleton", True)
        .execute()
    )
    row = result.data[0] if result.data else {"conditions": normalized, "updated_by": actor_id}
    return _row_to_api(row)
