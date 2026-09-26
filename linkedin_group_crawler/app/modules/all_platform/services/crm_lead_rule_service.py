"""Rule cau hinh phan loai Lead (SQL / Nuoi duong / Khong dat chuan) bang
checkbox - migration 152 (`crm_lead_classification_rules`, 1 dong duy nhat).

Theo dung feedback WIP full-flow (markee_crm_v26_compact_opportunity_name.html,
man "Danh muc & cau hinh -> Dieu kien phan loai Lead"):
  - Nhom "Dat chuan (SQL)": AND - TAT CA dieu kien duoc tick phai thoa.
  - Nhom "Nuoi duong": chi la ly do hien thi (khong gate ket qua that,
    giong dung logic JS `computeResult()` cua prototype - xem
    evaluate_lead_conditions() ben duoi).
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
    dieu kien dang bat, tra ve outcome + ly do. Dich 1-1 tu computeResult()
    (JS) trong prototype V26 - KHONG doi logic, chi doi ngon ngu.

    `fields` (tat ca la bool, tinh san o phia goi):
      has_product, has_interest_level, has_value, has_team, has_next,
      has_follow, has_contact, fit_unfit (True neu ICP = "Chưa phù hợp").
    """
    c = _normalize_conditions(conditions if conditions is not None else DEFAULT_CONDITIONS)

    invalid_checks: list[bool] = []
    if c["inv_fit"]:
        invalid_checks.append(bool(fields.get("fit_unfit")))
    if c["inv_no_contact"]:
        invalid_checks.append(not bool(fields.get("has_contact")))
    is_invalid = any(invalid_checks)

    sql_checks: list[bool] = []
    if c["sql_product"]:
        sql_checks.append(bool(fields.get("has_product")))
    if c["sql_interest"]:
        sql_checks.append(bool(fields.get("has_interest_level")))
    if c["sql_value"]:
        sql_checks.append(bool(fields.get("has_value")))
    if c["sql_team"]:
        sql_checks.append(bool(fields.get("has_team")))
    if c["sql_next"]:
        sql_checks.append(bool(fields.get("has_next")))
    if c["sql_follow"]:
        sql_checks.append(bool(fields.get("has_follow")))
    if c["sql_fit"]:
        sql_checks.append(not bool(fields.get("fit_unfit")))
    is_sql = all(sql_checks) if sql_checks else False

    if is_invalid:
        return {"outcome": "unqualified", "reason": "Lead thỏa điều kiện loại trong cấu hình."}
    if is_sql:
        return {"outcome": "sql", "reason": "Đủ điều kiện SQL theo cấu hình hiện tại."}

    reasons = []
    if c["nur_missing_value"] and not fields.get("has_value"):
        reasons.append("thiếu giá trị dự kiến")
    if c["nur_missing_handoff"] and not (fields.get("has_team") and fields.get("has_next") and fields.get("has_follow")):
        reasons.append("thiếu thông tin bàn giao")
    if c["nur_unknown_fit"] and not fields.get("fit_known"):
        reasons.append("chưa xác định nhóm khách hàng")
    reason = f"Nuôi dưỡng vì {', '.join(reasons)}." if reasons else "Chưa đủ điều kiện SQL."
    return {"outcome": "nurturing", "reason": reason}


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
