"""Rule engine THAT cho duyet bao gia (migration 091:
quote_approval_rule_sets/quote_approval_rules/quote_rule_evaluations) - thay
the nguong tinh "margin >= 20%" hard-code truoc day o frontend
(QuoteWorkspaceModal.tsx quickbar). Rule cau hinh o DB, danh gia THAT o
backend, KHONG BAO GIO chi hien dau check gia dua tren 1 con so client tinh
tay.

Thiet ke: 1 ham thuan `evaluate_quote_against_rule_set()` nhan vao du lieu
bao gia (dict, khong phu thuoc Supabase) + danh sach rule (dict) - de test
khong can DB that. Lop goi (evaluate_and_record) moi doc/ghi DB that.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.core.supabase_client import get_supabase_client

# Nhan hien thi + don vi cho tung rule_type - dung khi build evaluation_details.
_RULE_LABELS = {
    "gross_margin_percent": "Gross margin",
    "gross_profit_amount": "Lợi nhuận gộp",
    "discount_percent": "Chiết khấu thương mại",
    "payment_terms_days": "Điều khoản thanh toán",
}

_OPERATORS = {
    "gte": lambda actual, threshold: actual >= threshold,
    "lte": lambda actual, threshold: actual <= threshold,
    "gt": lambda actual, threshold: actual > threshold,
    "lt": lambda actual, threshold: actual < threshold,
    "eq": lambda actual, threshold: actual == threshold,
}

_OPERATOR_LABELS = {
    "gte": "≥",
    "lte": "≤",
    "gt": ">",
    "lt": "<",
    "eq": "=",
}


def _format_threshold(value: float, unit: str) -> str:
    if unit == "percent":
        return f"{value:g}%"
    if unit == "vnd":
        return f"{value:,.0f}đ".replace(",", ".")
    if unit == "days":
        return f"{value:g} ngày"
    return f"{value:g}"


def _extract_actual_value(rule_type: str, quote_metrics: dict[str, Any]) -> Optional[float]:
    """Lay gia tri THAT tu du lieu bao gia da tinh san (quote_metrics) - tra
    ve None neu thieu du lieu (vd chua co gia von -> khong tinh duoc margin),
    KHONG BAO GIO doan/gan gia tri mac dinh (0 la 1 gia tri THAT, khac None)."""
    if rule_type == "gross_margin_percent":
        return quote_metrics.get("gross_margin_percent")
    if rule_type == "gross_profit_amount":
        return quote_metrics.get("gross_profit")
    if rule_type == "discount_percent":
        return quote_metrics.get("discount_percent")
    if rule_type == "payment_terms_days":
        return quote_metrics.get("payment_terms_days")
    return None


def evaluate_quote_against_rule_set(quote_metrics: dict[str, Any], rules: list[dict[str, Any]]) -> dict[str, Any]:
    """Ham THUAN, khong goi DB - de unit test doc lap.

    quote_metrics: {
        "gross_margin_percent": float | None,
        "gross_profit": float | None,
        "discount_percent": float | None,
        "payment_terms_days": float | None,
    }
    rules: danh sach dict tu bang quote_approval_rules (da loc is_active=true,
    sap theo display_order).

    Tra ve: {"result": "pass"|"fail"|"insufficient_data", "details": [...]}
    - "insufficient_data" khi CO IT NHAT 1 rule required ma actual_value=None
      (chua du du lieu de danh gia - vd chua nhap gia von) - khac "fail" (co
      du lieu nhung khong dat nguong). Uu tien insufficient_data > fail vi
      "thieu du lieu" la trang thai an toan hon "sai roi nhung van cho la Fail
      dut khoat" (dung yeu cau "mac dinh an toan").
    """
    details: list[dict[str, Any]] = []
    has_fail = False
    has_insufficient = False

    for rule in rules:
        rule_type = rule["rule_type"]
        operator = rule["operator"]
        threshold = float(rule["threshold_value"])
        unit = rule.get("unit", "percent")
        is_required = rule.get("is_required", True)
        label = _RULE_LABELS.get(rule_type, rule_type)
        op_label = _OPERATOR_LABELS.get(operator, operator)

        actual = _extract_actual_value(rule_type, quote_metrics)
        if actual is None:
            entry = {
                "ruleType": rule_type,
                "label": label,
                "actualValue": None,
                "actualDisplay": "Chưa có dữ liệu",
                "threshold": threshold,
                "thresholdDisplay": _format_threshold(threshold, unit),
                "operator": operator,
                "isRequired": is_required,
                "status": "insufficient_data",
                "reason": f"{label}: chưa có dữ liệu để tính (yêu cầu {op_label} {_format_threshold(threshold, unit)}).",
            }
            details.append(entry)
            if is_required:
                has_insufficient = True
            continue

        comparator = _OPERATORS.get(operator)
        if comparator is None:
            entry = {
                "ruleType": rule_type,
                "label": label,
                "actualValue": actual,
                "actualDisplay": _format_threshold(actual, unit),
                "threshold": threshold,
                "thresholdDisplay": _format_threshold(threshold, unit),
                "operator": operator,
                "isRequired": is_required,
                "status": "insufficient_data",
                "reason": f"{label}: operator '{operator}' không hợp lệ.",
            }
            details.append(entry)
            if is_required:
                has_insufficient = True
            continue

        passed = comparator(actual, threshold)
        entry = {
            "ruleType": rule_type,
            "label": label,
            "actualValue": actual,
            "actualDisplay": _format_threshold(actual, unit),
            "threshold": threshold,
            "thresholdDisplay": _format_threshold(threshold, unit),
            "operator": operator,
            "isRequired": is_required,
            "status": "pass" if passed else "fail",
            "reason": (
                f"{label}: {_format_threshold(actual, unit)} / yêu cầu {op_label} {_format_threshold(threshold, unit)} → "
                f"{'Đạt' if passed else 'Không đạt'}."
            ),
        }
        details.append(entry)
        if not passed and is_required:
            has_fail = True

    if has_insufficient:
        result = "insufficient_data"
    elif has_fail:
        result = "fail"
    else:
        result = "pass"

    return {"result": result, "details": details}


def compute_quote_metrics(quote: dict[str, Any]) -> dict[str, Any]:
    """Chuyen tu du lieu bao gia THAT (dict tra ve boi get_quote() - da co
    grossMarginPercent/grossProfit tu _quote_cost_summary(), va custom block
    payment_terms) sang shape quote_metrics ma evaluate_quote_against_rule_set
    can. Discount % lay TRUNG BINH CO TRONG SO tren subtotal (khong phai
    trung binh cong don gian - 1 dong CK 50% nhung tien nho khong duoc coi
    nang bang 1 dong CK 5% tien lon)."""
    gross_margin_percent = quote.get("grossMarginPercent")
    gross_profit = quote.get("grossProfit")

    items = quote.get("items") or []
    subtotal = sum(float(i.get("subtotalAmount") or 0) for i in items)
    discount_amount = sum(float(i.get("discountAmount") or 0) for i in items)
    discount_percent = (discount_amount / subtotal * 100) if subtotal > 0 else (0.0 if items else None)

    payment_terms_days = _extract_payment_terms_days(quote)

    return {
        "gross_margin_percent": gross_margin_percent,
        "gross_profit": gross_profit,
        "discount_percent": discount_percent,
        "payment_terms_days": payment_terms_days,
    }


def _extract_payment_terms_days(quote: dict[str, Any]) -> Optional[float]:
    """Doc so ngay thanh toan tu custom block 'payment_terms' (dung noi
    dung format da dung o QuoteWorkspaceModal.tsx quickbar: "Thanh toan
    trong X ngay ke tu ngay xuat hoa don" - tim so dau tien trong noi dung).
    Tra ve None neu khong tim thay (khong doan 30 ngay mac dinh)."""
    import re
    blocks = ((quote.get("data") or {}).get("customBlocks")) or []
    for block in blocks:
        if block.get("kind") == "payment_terms" and (block.get("content") or "").strip():
            match = re.search(r"(\d+)\s*ng[aà]y", block["content"])
            if match:
                return float(match.group(1))
    return None


def get_active_rule_set() -> Optional[dict[str, Any]]:
    supabase = get_supabase_client()
    # .maybe_single().execute() tra ve None (khong phai response object) khi
    # khong co dong nao khop - PHAI kiem tra truoc khi doc .data.
    result = (
        supabase.table("quote_approval_rule_sets")
        .select("*")
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    rule_set = result.data if result else None
    if not rule_set:
        return None
    rules_result = (
        supabase.table("quote_approval_rules")
        .select("*")
        .eq("rule_set_id", rule_set["id"])
        .eq("is_active", True)
        .order("display_order")
        .execute()
    )
    rule_set["rules"] = rules_result.data or []
    return rule_set


def evaluate_and_record(quote: dict[str, Any], actor_id: Optional[str], is_system_actor: bool = False) -> Optional[dict[str, Any]]:
    """Danh gia 1 bao gia dua tren rule-set active, GHI LAI evaluation vao
    quote_rule_evaluations (audit trail that, khong chi tinh roi bo). Tra ve None
    neu CHUA co rule-set nao duoc cau hinh (khong loi, chi la "chua bat rule
    engine") - noi goi (vd endpoint duyet) tu quyet dinh xu ly the nao khi
    None (mac dinh: cho phep duyet thu cong nhu truoc, khong chan gi ca)."""
    rule_set = get_active_rule_set()
    if not rule_set:
        return None

    metrics = compute_quote_metrics(quote)
    evaluation = evaluate_quote_against_rule_set(metrics, rule_set["rules"])

    supabase = get_supabase_client()
    supabase.table("quote_rule_evaluations").insert({
        "quote_id": quote["id"],
        "quote_version": quote.get("versionNumber"),
        "rule_set_id": rule_set["id"],
        "rule_set_version": rule_set["version"],
        "result": evaluation["result"],
        "evaluation_details": evaluation["details"],
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "evaluated_by": actor_id,
        "is_system_actor": is_system_actor,
    }).execute()

    return {
        "ruleSetId": rule_set["id"],
        "ruleSetName": rule_set["name"],
        "ruleSetVersion": rule_set["version"],
        "autoApproveEnabled": bool(rule_set.get("auto_approve_enabled")),
        "result": evaluation["result"],
        "details": evaluation["details"],
    }


def get_latest_evaluation(quote_id: str) -> Optional[dict[str, Any]]:
    """Evaluation snapshot GAN NHAT da luu cho 1 bao gia (dung hien Rule card
    + popup duyet - luon doc lai DUNG snapshot da luu, khong tinh lai o day,
    tranh lech voi luc thuc su chuyen buoc/duyet)."""
    supabase = get_supabase_client()
    result = (
        supabase.table("quote_rule_evaluations")
        .select("*")
        .eq("quote_id", quote_id)
        .order("evaluated_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return None
    row = rows[0]
    rule_set_result = supabase.table("quote_approval_rule_sets").select("name").eq("id", row["rule_set_id"]).maybe_single().execute()
    rule_set_name = rule_set_result.data.get("name") if rule_set_result and rule_set_result.data else None
    return {
        "id": row["id"],
        "ruleSetId": row["rule_set_id"],
        "ruleSetName": rule_set_name,
        "ruleSetVersion": row["rule_set_version"],
        "result": row["result"],
        "details": row["evaluation_details"],
        "evaluatedAt": row["evaluated_at"],
        "isSystemActor": bool(row.get("is_system_actor")),
    }


def should_auto_approve(evaluation: Optional[dict[str, Any]]) -> bool:
    """Quyet dinh CO tu duyet hay khong tu 1 evaluation (co the None neu chua
    cau hinh rule engine). Tach thanh ham rieng de test doc lap voi router -
    chi True khi CA 2 dieu kien: rule-set dat 'pass' (het rule required) VA
    auto_approve_enabled=true tren chinh rule-set do."""
    if not evaluation:
        return False
    return evaluation.get("result") == "pass" and bool(evaluation.get("autoApproveEnabled"))


def record_auto_approve_activity(quote_id: str, actor_id: Optional[str], evaluation: dict[str, Any]) -> None:
    """Ghi 1 dong quote_activity_log RIENG cho lan tu dong duyet boi rule
    engine (tach biet voi dong 'approved' thuong do quote_approve RPC tu ghi)
    - de nguoi xem lich su biet ro day la QUYET DINH TU DONG, kem du
    rule-set/version/ket qua tung rule/thoi diem (dung yeu cau audit)."""
    supabase = get_supabase_client()
    supabase.table("quote_activity_log").insert({
        "quote_id": quote_id,
        "actor_id": actor_id,
        "action": "auto_approved_by_rule_engine",
        "changes": {
            "ruleSetId": evaluation.get("ruleSetId"),
            "ruleSetVersion": evaluation.get("ruleSetVersion"),
            "result": evaluation.get("result"),
            "details": evaluation.get("details"),
        },
    }).execute()


# ── Admin duyet ngoai le theo version (Section 5, migration 102) ───────────


def requires_exception_reason(evaluation: Optional[dict[str, Any]]) -> bool:
    """True neu quote nay CAN exception_reason moi duoc duyet - CHI khi DA co
    1 evaluation that (rule engine da cau hinh VA da tung chay danh gia cho
    quote nay) VA result != 'pass'. Chua tung cau hinh rule engine (evaluation
    None) -> duyet binh thuong nhu truoc, KHONG bat nhap ly do (khong the bat
    ly do cho 1 dieu kien chua he ton tai)."""
    if not evaluation:
        return False
    return evaluation.get("result") != "pass"


def record_exception_approval(
    quote_id: str,
    version_number: int,
    rule_evaluation_id: str,
    exception_reason: str,
    approved_by: Optional[str],
) -> None:
    """Ghi 1 dong quote_exception_approvals (migration 102) + 1 dong
    quote_activity_log rieng 'approved_with_exception' - CHI goi khi Admin
    THAT SU duyet 1 quote dang o trang thai rule fail/insufficient_data (xem
    requires_exception_reason). quote_id o day la id cua DUNG phien ban dang
    duyet - version moi (id khac) se khong bao gio co dong nao trong bang
    nay cho toi khi TU NO can duyet ngoai le rieng, dung yeu cau "version moi
    khong ke thua ngoai le version truoc"."""
    supabase = get_supabase_client()
    supabase.table("quote_exception_approvals").insert({
        "quote_id": quote_id,
        "version_number": version_number,
        "rule_evaluation_id": rule_evaluation_id,
        "exception_reason": exception_reason,
        "approved_by": approved_by,
    }).execute()
    supabase.table("quote_activity_log").insert({
        "quote_id": quote_id,
        "actor_id": approved_by,
        "action": "approved_with_exception",
        "changes": {
            "versionNumber": version_number,
            "ruleEvaluationId": rule_evaluation_id,
            "exceptionReason": exception_reason,
        },
    }).execute()


# ── Cau hinh rule-set (CRUD, Admin/Leader) ──────────────────────────────────

_RULE_TYPE_ORDER = ["gross_margin_percent", "gross_profit_amount", "discount_percent", "payment_terms_days"]

_RULE_VALIDATORS = {
    "gross_margin_percent": lambda v: 0 <= v <= 100,
    "gross_profit_amount": lambda v: v >= 0,
    "discount_percent": lambda v: 0 <= v <= 100,
    "payment_terms_days": lambda v: v > 0,
}

_RULE_UNITS = {
    "gross_margin_percent": "percent",
    "gross_profit_amount": "vnd",
    "discount_percent": "percent",
    "payment_terms_days": "days",
}

_RULE_OPERATORS = {
    "gross_margin_percent": "gte",
    "gross_profit_amount": "gte",
    "discount_percent": "lte",
    "payment_terms_days": "lte",
}


class RuleValidationError(ValueError):
    """Threshold/rule_type khong hop le - router map ve HTTP 422 (khac loi
    nghiep vu thuong tra 200 success=false, vi day la loi INPUT sai dinh
    dang/gia tri, khong phai loi trang thai bao gia)."""


def _rule_set_to_api(rule_set: dict[str, Any]) -> dict[str, Any]:
    rules_sorted = sorted(rule_set.get("rules", []), key=lambda r: r.get("display_order", 0))
    return {
        "id": rule_set["id"],
        "name": rule_set["name"],
        "version": rule_set["version"],
        "autoApproveEnabled": bool(rule_set.get("auto_approve_enabled")),
        "rules": [
            {
                "ruleType": r["rule_type"],
                "operator": r["operator"],
                "thresholdValue": float(r["threshold_value"]),
                "unit": r.get("unit"),
                "isRequired": bool(r.get("is_required", True)),
                "displayOrder": r.get("display_order", 0),
                "isActive": bool(r.get("is_active", True)),
            }
            for r in rules_sorted
        ],
    }


def get_active_rule_set_for_api() -> Optional[dict[str, Any]]:
    """GET /quote-approval-rules/active - ai dang nhap cung xem duoc (Member
    xem ket qua/nguong, chi khong sua duoc - xem can_manage_quote_approval_rules
    ap dung o router cho rieng PUT)."""
    rule_set = get_active_rule_set()
    if not rule_set:
        return None
    return _rule_set_to_api(rule_set)


def save_rule_set(
    rules_input: list[dict[str, Any]],
    auto_approve_enabled: bool,
    actor_id: Optional[str],
    idempotency_key: str,
) -> dict[str, Any]:
    """Luu bo rule MOI - goi RPC transactional quote_save_approval_rule_set
    (migration 094, CHUA apply) thay vi nhieu request PostgREST roi rac -
    tranh trang thai do dang (rule-set active nhung thieu rule, 2 active
    cung luc) neu crash giua chung. idempotency_key bat buoc - cung key goi
    lai (double-click/retry) tra ve DUNG ban da tao, khong tao them version.
    Validate THAT truoc khi goi RPC (het 4 rule hop le moi ghi)."""
    if not idempotency_key or not idempotency_key.strip():
        raise RuleValidationError("Thiếu idempotency_key.")

    normalized: list[dict[str, Any]] = []
    for idx, rule_type in enumerate(_RULE_TYPE_ORDER):
        match = next((r for r in rules_input if r.get("ruleType") == rule_type), None)
        if match is None:
            raise RuleValidationError(f"Thiếu cấu hình cho rule '{rule_type}'.")
        threshold = match.get("thresholdValue")
        if threshold is None or not isinstance(threshold, (int, float)):
            raise RuleValidationError(f"Ngưỡng của '{rule_type}' phải là số.")
        threshold = float(threshold)
        validator = _RULE_VALIDATORS[rule_type]
        if not validator(threshold):
            raise RuleValidationError(f"Ngưỡng của '{rule_type}' không hợp lệ ({threshold}).")
        normalized.append({
            "rule_type": rule_type,
            "operator": _RULE_OPERATORS[rule_type],
            "threshold_value": threshold,
            "unit": _RULE_UNITS[rule_type],
            "is_required": bool(match.get("isRequired", True)),
            "display_order": idx + 1,
            "is_active": bool(match.get("isActive", True)),
        })

    supabase = get_supabase_client()
    try:
        supabase.rpc("quote_save_approval_rule_set", {
            "p_actor_id": actor_id,
            "p_auto_approve_enabled": bool(auto_approve_enabled),
            "p_rules": normalized,
            "p_idempotency_key": idempotency_key.strip(),
        }).execute()
    except Exception as exc:
        message = str(exc)
        if "idempotency_key_required" in message:
            raise RuleValidationError("Thiếu idempotency_key.") from exc
        if "quote_approval_rules_must_have_exactly_4" in message:
            raise RuleValidationError("Phải có đúng 4 quy tắc.") from exc
        if "Could not find the function" in message or "PGRST202" in message:
            # Migration 094 (RPC transactional) CHUA duoc apply len DB nay -
            # fallback ve cach cu (nhieu request PostgREST roi rac, nhung DA
            # FIX bug maybe_single() nen khong con crash) de tinh nang van
            # dung duoc NGAY trong luc cho xac nhan apply migration 094.
            # Tu dong chuyen sang dung RPC (atomic that) ngay khi 094 duoc
            # apply, khong can sua code lan nua.
            return _save_rule_set_fallback_non_transactional(normalized, auto_approve_enabled, actor_id)
        if "quote_approval_rule_sets_one_active" in message or "23505" in message:
            # Race that (2 request "Luu" cung luc, hoac RPC cu (094) truoc
            # khi fix thu tu 099) - KHONG BAO GIO lo message raw Postgres
            # (duplicate key/constraint name/SQLSTATE) ra nguoi dung.
            raise ValueError("Không thể lưu quy tắc phê duyệt. Cấu hình đã được thay đổi ở một phiên khác, vui lòng tải lại và thử lại.") from exc
        # Loi khac KHONG nhan dien duoc - van KHONG duoc lo raw exception
        # message (co the chua chi tiet Postgres/PostgREST nhay cam).
        raise ValueError("Không thể lưu quy tắc phê duyệt. Đã xảy ra lỗi, vui lòng thử lại sau.") from exc

    # Doc lai TRANG THAI THAT sau khi RPC commit (khong tin shape tra ve cua
    # .rpc().execute().data cho ham RETURNS 1 dong - dung LAI get_active_rule_set()
    # da co, da fix bug maybe_single(), thay vi tu suy doan shape moi).
    current = get_active_rule_set()
    if not current:
        raise ValueError("Đã lưu nhưng không đọc lại được quy tắc vừa lưu.")
    return _rule_set_to_api(current)


def _save_rule_set_fallback_non_transactional(
    normalized_rules: list[dict[str, Any]], auto_approve_enabled: bool, actor_id: Optional[str]
) -> dict[str, Any]:
    """CHI dung khi migration 094 (RPC) chua ton tai tren DB - KHONG atomic
    (nhieu request PostgREST roi rac), nhung da fix bug maybe_single() nen
    it nhat khong con crash. Xoa ham nay khi da xac nhan 094 apply xong."""
    supabase = get_supabase_client()
    existing = get_active_rule_set()
    next_version = (existing["version"] + 1) if existing else 1

    if existing:
        supabase.table("quote_approval_rule_sets").update({"is_active": False}).eq("id", existing["id"]).execute()

    inserted = supabase.table("quote_approval_rule_sets").insert({
        "name": (existing["name"] if existing else "Bộ quy tắc duyệt báo giá mặc định"),
        "version": next_version,
        "is_active": True,
        "auto_approve_enabled": bool(auto_approve_enabled),
        "created_by": actor_id if not existing else existing.get("created_by"),
        "updated_by": actor_id,
    }).execute().data[0]

    rows = [{**rule, "rule_set_id": inserted["id"]} for rule in normalized_rules]
    supabase.table("quote_approval_rules").insert(rows).execute()

    inserted["rules"] = rows
    return _rule_set_to_api(inserted)
