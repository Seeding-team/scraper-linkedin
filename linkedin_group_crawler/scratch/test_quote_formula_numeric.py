"""Pure unit test cho cong thuc gia von/markup/margin - KHONG ket noi DB,
goi truc tiep _calculate_item()/_quote_cost_summary() that trong
supabase_quote_service.py voi du lieu gia lap dung theo vi du user yeu cau:
quantity=2, cost/unit=1.000.000, markup=20%, VAT=10%.
Chay: python scratch/test_quote_formula_numeric.py
"""
import sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.modules.all_platform.services.supabase_quote_service import _calculate_item, _quote_cost_summary

failed = 0
def check(label, actual, expected, tol=0.5):
    global failed
    ok = abs(actual - expected) <= tol
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: {actual} (expected {expected})")
    if not ok:
        failed += 1

quantity = 2
cost_per_unit = 1_000_000
markup = 20
unit_price = cost_per_unit * (1 + markup / 100)
check("unit_price = cost*(1+markup/100)", unit_price, 1_200_000)

vat_rate = 10
subtotal, discount, after_discount, vat, total = _calculate_item(quantity, unit_price, vat_rate, discount_percent=0)
check("subtotal (truoc CK, chua VAT)", subtotal, 2_400_000)
check("discount (0%)", discount, 0)
check("after_discount = net_revenue", after_discount, 2_400_000)
check("VAT 10%", vat, 240_000)
check("customer_payment (total)", total, 2_640_000)

cost_total = quantity * cost_per_unit
check("cost_total = quantity*cost_per_unit", cost_total, 2_000_000)

fake_row = {"total_amount": total, "vat_amount": vat}
fake_items = [{"cost_price": cost_per_unit, "quantity": quantity}]
summary = _quote_cost_summary(fake_row, fake_items)
check("netRevenue (tu _quote_cost_summary that)", summary["netRevenue"], 2_400_000)
check("grossProfit", summary["grossProfit"], 400_000)
check("grossMarginPercent", summary["grossMarginPercent"], 16.67, tol=0.05)

print()
print("=== Sau chiet khau 10% ===")
subtotal2, discount2, after_discount2, vat2, total2 = _calculate_item(quantity, unit_price, vat_rate, discount_percent=10)
check("net_revenue sau CK 10%", after_discount2, 2_160_000)
check("VAT sau CK", vat2, 216_000)
check("customer_payment sau CK", total2, 2_376_000)

fake_row2 = {"total_amount": total2, "vat_amount": vat2}
summary2 = _quote_cost_summary(fake_row2, fake_items)
check("grossProfit sau CK", summary2["grossProfit"], 160_000)
check("grossMarginPercent sau CK", summary2["grossMarginPercent"], 7.41, tol=0.05)

# Xac nhan khong dung so tien GOM VAT de tinh loi nhuan - neu code sai dung
# `total` (gom VAT) thay vi `after_discount` (truoc VAT) lam net_revenue thi
# ket qua se lech han so voi 2.400.000 (truoc CK) / 2.160.000 (sau CK).
check("net_revenue KHONG duoc bang total (VAT-inclusive) truoc CK", after_discount, 2_400_000)
assert abs(total - 2_640_000) < 0.5 and abs(after_discount - 2_400_000) < 0.5 and total != after_discount, \
    "BUG: net_revenue dang bi tinh nham bang so tien da gom VAT!"
print("[PASS] Xac nhan net_revenue (2.400.000) != total gom VAT (2.640.000) - cong thuc dung, khong lay so gom VAT tinh loi nhuan.")

print()
if failed:
    print(f"{failed} case FAILED")
    sys.exit(1)
print("Tat ca case pass - dung 100% theo vi du user yeu cau.")
