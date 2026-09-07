"""Unit test THUAN (khong DB) cho evaluate_quote_against_rule_set() -
dung DUNG vi du so lieu nguoi dung dua ra:
  Gross margin: 23,1% / yeu cau >=20% -> Pass
  Loi nhuan: 7.200.000d / yeu cau >=5.000.000d -> Pass
  Chiet khau: 0% / yeu cau <=10% -> Pass
  Thanh toan: 30 ngay / yeu cau <=45 ngay -> Pass
Va cac truong hop Fail / insufficient_data.
Chay: python scratch/test_rule_evaluation_service.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


DEFAULT_RULES = [
    {"rule_type": "gross_margin_percent", "operator": "gte", "threshold_value": 20, "unit": "percent", "is_required": True, "display_order": 1},
    {"rule_type": "gross_profit_amount", "operator": "gte", "threshold_value": 5_000_000, "unit": "vnd", "is_required": True, "display_order": 2},
    {"rule_type": "discount_percent", "operator": "lte", "threshold_value": 10, "unit": "percent", "is_required": True, "display_order": 3},
    {"rule_type": "payment_terms_days", "operator": "lte", "threshold_value": 45, "unit": "days", "is_required": True, "display_order": 4},
]


def run():
    from app.modules.all_platform.services.quote_rule_evaluation_service import evaluate_quote_against_rule_set

    # ── Vi du dung HET tu yeu cau nguoi dung: dat du 4/4 ────────────────────
    metrics_pass = {
        "gross_margin_percent": 23.1,
        "gross_profit": 7_200_000,
        "discount_percent": 0,
        "payment_terms_days": 30,
    }
    ev = evaluate_quote_against_rule_set(metrics_pass, DEFAULT_RULES)
    record("Vi du 'dat 4/4': result='pass'", ev["result"] == "pass")
    record("Vi du: ca 4 rule deu status='pass'", all(d["status"] == "pass" for d in ev["details"]))
    margin_detail = next(d for d in ev["details"] if d["ruleType"] == "gross_margin_percent")
    record("Vi du: gross margin actualDisplay='23.1%'", margin_detail["actualDisplay"] == "23.1%", margin_detail["actualDisplay"])
    profit_detail = next(d for d in ev["details"] if d["ruleType"] == "gross_profit_amount")
    record("Vi du: reason co dung noi dung 'Đạt'", "Đạt" in profit_detail["reason"] and "Không đạt" not in profit_detail["reason"])

    # ── Fail: margin duoi nguong ─────────────────────────────────────────────
    metrics_fail = dict(metrics_pass, gross_margin_percent=15.0)
    ev_fail = evaluate_quote_against_rule_set(metrics_fail, DEFAULT_RULES)
    record("Margin 15% (< 20%): result='fail'", ev_fail["result"] == "fail")
    margin_fail = next(d for d in ev_fail["details"] if d["ruleType"] == "gross_margin_percent")
    record("Margin 15%: status='fail', reason co 'Không đạt'", margin_fail["status"] == "fail" and "Không đạt" in margin_fail["reason"])

    # ── Insufficient data: chua co gia von -> gross_margin_percent=None ─────
    metrics_missing = dict(metrics_pass, gross_margin_percent=None, gross_profit=None)
    ev_missing = evaluate_quote_against_rule_set(metrics_missing, DEFAULT_RULES)
    record("Thieu du lieu gia von: result='insufficient_data' (UU TIEN hon 'fail')", ev_missing["result"] == "insufficient_data")
    missing_detail = next(d for d in ev_missing["details"] if d["ruleType"] == "gross_margin_percent")
    record("Thieu du lieu: actualValue=None, actualDisplay='Chưa có dữ liệu'", missing_detail["actualValue"] is None and missing_detail["actualDisplay"] == "Chưa có dữ liệu")

    # ── Chiet khau vuot nguong (discount > 10%) -> fail ──────────────────────
    metrics_discount_fail = dict(metrics_pass, discount_percent=15.0)
    ev_discount = evaluate_quote_against_rule_set(metrics_discount_fail, DEFAULT_RULES)
    record("Chiet khau 15% (> 10%): result='fail'", ev_discount["result"] == "fail")

    # ── Thanh toan vuot 45 ngay -> fail ──────────────────────────────────────
    metrics_terms_fail = dict(metrics_pass, payment_terms_days=60.0)
    ev_terms = evaluate_quote_against_rule_set(metrics_terms_fail, DEFAULT_RULES)
    record("Thanh toan 60 ngay (> 45): result='fail'", ev_terms["result"] == "fail")

    # ── rule_type khong co evaluator -> insufficient_data, khong crash ──────
    unknown_rules = DEFAULT_RULES + [{"rule_type": "not_implemented_yet", "operator": "gte", "threshold_value": 1, "unit": "percent", "is_required": True, "display_order": 5}]
    ev_unknown = evaluate_quote_against_rule_set(metrics_pass, unknown_rules)
    record("Rule type chua implement: khong crash, result='insufficient_data'", ev_unknown["result"] == "insufficient_data")

    # ── compute_quote_metrics() - discount % trung binh co trong so ─────────
    from app.modules.all_platform.services.quote_rule_evaluation_service import compute_quote_metrics
    fake_quote = {
        "grossMarginPercent": 23.1,
        "grossProfit": 7_200_000,
        "items": [
            {"subtotalAmount": 8_000_000, "discountAmount": 0},
            {"subtotalAmount": 2_000_000, "discountAmount": 200_000},
        ],
        "data": {"customBlocks": [{"kind": "payment_terms", "content": "Thanh toán trong 30 ngày kể từ ngày xuất hoá đơn"}]},
    }
    computed = compute_quote_metrics(fake_quote)
    record("compute_quote_metrics: discount % tinh dung trung binh co trong so (200k/10tr=2%)", abs(computed["discount_percent"] - 2.0) < 0.001, computed["discount_percent"])
    record("compute_quote_metrics: doc dung so ngay tu custom block payment_terms", computed["payment_terms_days"] == 30.0)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
