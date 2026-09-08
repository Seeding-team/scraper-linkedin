"""Test THAT NHUNG PURE UNIT (KHONG mutation DB that, KHONG can server chay) -
sua lai sau khi bi bac bo 2 lan: lan 1 vi ban cu tao/xoa quote that qua
TestClient(app) (goi thang toi SUPABASE_URL dang cau hinh, "finally cleanup"
KHONG lam no an toan tren shared DB); lan 2 vi permission mapping sai (mo qua
rong nhom "gia ban" cho ca technical_owner). Test nay CHI goi truc tiep cac
ham THUAN (khong I/O) trong supabase_quote_service.py/crm_permission_service.py
tren dict Python tu dung tay - KHONG import get_supabase_client, KHONG can
TEST_SUPABASE_URL/APP_ENV=test (khong co mutation nao de can guard).

Neu sau nay can them integration test THAT (goi qua API/DB test rieng), phai
dung `scratch/test_db_guard.py` (`require_test_db()`) truoc bat ky mutation
nao, va KHONG BAO GIO fallback ve SUPABASE_URL dang cau hinh that."""
import sys
sys.path.insert(0, '.')

from app.modules.all_platform.services.supabase_quote_service import (
    _quote_cost_summary,
    apply_quote_field_permissions,
)
from app.modules.all_platform.services.crm_permission_service import (
    can_view_quote_cost,
    can_edit_quote_cost,
    can_view_quote_pricing,
    can_edit_quote_pricing,
    can_view_quote_profitability,
)

ADMIN = {"id": "admin-1", "role": "admin"}
LEADER_NO_ASSIGN = {"id": "leader-1", "role": "leader"}
MEMBER_NO_ASSIGN = {"id": "member-1", "role": "member"}
PRESALE = {"id": "presale-1", "role": "member"}  # technical_owner cua quote test
SALE = {"id": "sale-1", "role": "member"}  # quote_owner cua quote test
BOTH_AS_PRESALE_ONLY = {"id": "both-1", "role": "member"}  # duoc gan technical_owner, KHONG phai quote_owner
PRESALE_AND_SALE_SAME_PERSON = {"id": "same-1", "role": "member"}  # dong thoi ca 2

failures: list[str] = []


def check(label: str, cond: bool) -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}")
    if not cond:
        failures.append(label)


# ── 1) _quote_cost_summary: partial-cost guard + cost_not_applicable + netRevenue doc lap ──

quote_row = {"total_amount": 319000.0, "vat_amount": 29000.0}

# 1/3 item co cost -> hasCostData=False (chua giai quyet HET)
items_partial = [
    {"cost_price": 100000, "quantity": 2, "cost_not_applicable": False},
    {"cost_price": None, "quantity": 1, "cost_not_applicable": False},
    {"cost_price": None, "quantity": 1, "cost_not_applicable": False},
]
summary = _quote_cost_summary(quote_row, items_partial)
check("1/3 item co cost -> hasCostData=False", summary["hasCostData"] is False)
check("hasCostData=False -> costTotal=None", summary["costTotal"] is None)
check(
    "Gia khach (netRevenue) van hien DU hasCostData=False (khong phu thuoc gia von)",
    summary["netRevenue"] == 290000.0,
)

# tat ca co cost -> True, cost=0 hop le duoc phan biet voi missing (None)
items_all_resolved = [
    {"cost_price": 0, "quantity": 5, "cost_not_applicable": False},  # cost=0 HOP LE (field da set ro, khong phai thieu)
    {"cost_price": 50000, "quantity": 1, "cost_not_applicable": False},
]
summary2 = _quote_cost_summary(quote_row, items_all_resolved)
check("Tat ca item co cost (ke ca cost=0 hop le) -> hasCostData=True", summary2["hasCostData"] is True)
check("cost=0 hop le duoc CONG dung (0*5=0), khong bi hieu la thieu", summary2["costTotal"] == 50000.0)

# item N/A duoc tinh la DA GIAI QUYET
items_with_na = [
    {"cost_price": 100000, "quantity": 1, "cost_not_applicable": False},
    {"cost_price": None, "quantity": 1, "cost_not_applicable": True},  # N/A -> resolved, dong gop 0
]
summary3 = _quote_cost_summary(quote_row, items_with_na)
check("Item cost_not_applicable=True duoc tinh la DA GIAI QUYET", summary3["hasCostData"] is True)
check("Item N/A dong gop 0 vao costTotal (khong lam sai lech)", summary3["costTotal"] == 100000.0)

# nested children: flat list (parent+child rieng dong) khong double-count - moi dong cong dung 1 lan
items_nested_flat = [
    {"cost_price": 10000, "quantity": 1, "cost_not_applicable": False},  # "parent" (that ra chi la 1 dong khac trong flat list)
    {"cost_price": 20000, "quantity": 1, "cost_not_applicable": False},  # "child"
]
summary4 = _quote_cost_summary(quote_row, items_nested_flat)
check("Flat list 2 dong doc lap -> costTotal cong DUNG 1 lan moi dong (khong double-count)", summary4["costTotal"] == 30000.0)

# empty quote (khong item nao)
summary5 = _quote_cost_summary(quote_row, [])
check("Quote rong (khong item) -> hasCostData=False", summary5["hasCostData"] is False)
check("Quote rong -> netRevenue van tinh duoc (chi phu thuoc total/vat)", summary5["netRevenue"] == 290000.0)


# ── 2) Permission matrix - can_view_quote_cost / pricing / profitability ──

quote_assigned = {"technicalOwnerId": "presale-1", "quoteOwnerId": "sale-1"}
quote_both_presale_only = {"technicalOwnerId": "both-1", "quoteOwnerId": "sale-1"}
quote_same_person = {"technicalOwnerId": "same-1", "quoteOwnerId": "same-1"}

check("Admin xem duoc Cost", can_view_quote_cost(ADMIN, quote_assigned) is True)
check("Admin xem duoc Pricing noi bo (markup)", can_view_quote_pricing(ADMIN, quote_assigned) is True)
check("Admin xem duoc Profitability", can_view_quote_profitability(ADMIN, quote_assigned) is True)

check("Presale (technical_owner) xem duoc Cost (read-only, de bao gia dung)", can_view_quote_cost(PRESALE, quote_assigned) is True)
check("Presale (technical_owner) KHONG xem duoc Pricing noi bo (markup) neu khong dong thoi la quote_owner", can_view_quote_pricing(PRESALE, quote_assigned) is False)
check("Presale (technical_owner) KHONG xem duoc Profitability neu khong dong thoi la quote_owner", can_view_quote_profitability(PRESALE, quote_assigned) is False)
check("Presale (technical_owner) duoc SUA Cost", can_edit_quote_cost(PRESALE, quote_assigned) is True)
check("Presale (technical_owner) KHONG duoc SUA Pricing", can_edit_quote_pricing(PRESALE, quote_assigned) is False)

check("Sale (quote_owner) xem duoc Cost o che do READ-ONLY (Presale da chot)", can_view_quote_cost(SALE, quote_assigned) is True)
check("Sale (quote_owner) KHONG duoc SUA Cost (chi xem)", can_edit_quote_cost(SALE, quote_assigned) is False)
check("Sale (quote_owner) xem duoc Pricing noi bo (markup)", can_view_quote_pricing(SALE, quote_assigned) is True)
check("Sale (quote_owner) duoc SUA Pricing", can_edit_quote_pricing(SALE, quote_assigned) is True)
check("Sale (quote_owner) xem duoc Profitability (can margin de hoan thien gia)", can_view_quote_profitability(SALE, quote_assigned) is True)

check(
    "Both nhung CHI duoc gan technical_owner (khong phai quote_owner cua quote nay) -> KHONG xem Pricing/Profitability",
    can_view_quote_pricing(BOTH_AS_PRESALE_ONLY, quote_both_presale_only) is False
    and can_view_quote_profitability(BOTH_AS_PRESALE_ONLY, quote_both_presale_only) is False,
)
check(
    "Both cung 1 nguoi vua la technical_owner vua la quote_owner -> xem duoc CA 3 nhom",
    can_view_quote_cost(PRESALE_AND_SALE_SAME_PERSON, quote_same_person) is True
    and can_view_quote_pricing(PRESALE_AND_SALE_SAME_PERSON, quote_same_person) is True
    and can_view_quote_profitability(PRESALE_AND_SALE_SAME_PERSON, quote_same_person) is True,
)

check(
    "Leader KHONG duoc phan cong quote nay -> KHONG tu dong xem Cost/Pricing/Profitability chi vi system role Leader",
    can_view_quote_cost(LEADER_NO_ASSIGN, quote_assigned) is False
    and can_view_quote_pricing(LEADER_NO_ASSIGN, quote_assigned) is False
    and can_view_quote_profitability(LEADER_NO_ASSIGN, quote_assigned) is False,
)
check(
    "Member khong duoc phan cong -> khong xem Cost/Pricing/Profitability noi bo",
    can_view_quote_cost(MEMBER_NO_ASSIGN, quote_assigned) is False
    and can_view_quote_pricing(MEMBER_NO_ASSIGN, quote_assigned) is False
    and can_view_quote_profitability(MEMBER_NO_ASSIGN, quote_assigned) is False,
)


# ── 3) apply_quote_field_permissions - sanitize dung tung nhom, KHONG dung chung 1 boolean ──

full_quote = {
    "technicalOwnerId": "presale-1",
    "quoteOwnerId": "sale-1",
    "hasCostData": True,
    "costTotal": 200000.0,
    "netRevenue": 290000.0,
    "customerPriceBeforeVat": 290000.0,
    "grossProfit": 90000.0,
    "grossMarginPercent": 31.03,
    "totalAmount": 319000.0,
    "vatAmount": 29000.0,
    "items": [
        {"id": "i1", "costPrice": 100000.0, "markupPercent": 20.0, "costTotal": 200000.0, "costNotApplicable": False, "unitPrice": 120000.0, "children": []},
    ],
}

as_admin = apply_quote_field_permissions(full_quote, ADMIN)
check("Admin: costViewAllowed=True, pricingViewAllowed=True, profitabilityViewAllowed=True", as_admin["costViewAllowed"] and as_admin["pricingViewAllowed"] and as_admin["profitabilityViewAllowed"])
check("Admin: nhan dung costTotal that", as_admin["costTotal"] == 200000.0)
check("Admin: nhan dung item.markupPercent that", as_admin["items"][0]["markupPercent"] == 20.0)
check("Admin: nhan dung grossMarginPercent that", as_admin["grossMarginPercent"] == 31.03)
check("Moi role: netRevenue/customerPriceBeforeVat/unitPrice (nhom Customer commercial) LUON hien, KHONG bi dong", as_admin["netRevenue"] == 290000.0 and as_admin["customerPriceBeforeVat"] == 290000.0)

as_presale = apply_quote_field_permissions(full_quote, PRESALE)
check("Presale: costViewAllowed=True (xem duoc cost)", as_presale["costViewAllowed"] is True)
check("Presale: van nhan dung costTotal (xem duoc, KHONG bi strip)", as_presale["costTotal"] == 200000.0)
check("Presale: pricingViewAllowed=False", as_presale["pricingViewAllowed"] is False)
check("Presale: item.markupPercent bi an (None), KHONG phai xoa key", "markupPercent" in as_presale["items"][0] and as_presale["items"][0]["markupPercent"] is None)
check("Presale: profitabilityViewAllowed=False", as_presale["profitabilityViewAllowed"] is False)
check("Presale: grossMarginPercent bi an (None)", as_presale["grossMarginPercent"] is None)
check(
    "Presale: van thay netRevenue/customerPriceBeforeVat/unitPrice (Customer commercial KHONG bi dong theo cost/pricing)",
    as_presale["netRevenue"] == 290000.0 and as_presale["items"][0]["unitPrice"] == 120000.0,
)

as_sale = apply_quote_field_permissions(full_quote, SALE)
check("Sale: costViewAllowed=True (read-only, thay gia von Presale da chot)", as_sale["costViewAllowed"] is True)
check("Sale: nhan dung costTotal that (khong bi an du chi duoc XEM, khong duoc SUA)", as_sale["costTotal"] == 200000.0)
check("Sale: pricingViewAllowed=True, nhan dung markupPercent that", as_sale["pricingViewAllowed"] is True and as_sale["items"][0]["markupPercent"] == 20.0)
check("Sale: profitabilityViewAllowed=True, nhan dung margin that", as_sale["profitabilityViewAllowed"] is True and as_sale["grossMarginPercent"] == 31.03)
check("Sale: item.costPrice van hien (chuoi Gia von da chot -> Markup -> Gia khach -> Gross profit -> Margin)", as_sale["items"][0]["costPrice"] == 100000.0)

as_member = apply_quote_field_permissions(full_quote, MEMBER_NO_ASSIGN)
check("Member khong duoc phan cong: costViewAllowed=False", as_member["costViewAllowed"] is False)
check("Member khong duoc phan cong: hasCostData bi ep False (khong phai gia tri that)", as_member["hasCostData"] is False)
check("Member khong duoc phan cong: costTotal=None", as_member["costTotal"] is None)
check("Member khong duoc phan cong: item.costPrice=None (giu key, khong xoa)", "costPrice" in as_member["items"][0] and as_member["items"][0]["costPrice"] is None)
check("Member khong duoc phan cong: item.markupPercent=None", as_member["items"][0]["markupPercent"] is None)
check("Member khong duoc phan cong: profitabilityViewAllowed=False, grossMarginPercent=None", as_member["profitabilityViewAllowed"] is False and as_member["grossMarginPercent"] is None)
check(
    "Member khong duoc phan cong: VAN thay du lieu Customer commercial (unitPrice/netRevenue) - day la so tren ban bao gia, khong phai bi mat quyen xem quote",
    as_member["netRevenue"] == 290000.0 and as_member["items"][0]["unitPrice"] == 120000.0,
)

as_leader = apply_quote_field_permissions(full_quote, LEADER_NO_ASSIGN)
check("Leader khong duoc phan cong: costViewAllowed=False (khong tu dong mo vi system role)", as_leader["costViewAllowed"] is False)
check("Leader khong duoc phan cong: pricingViewAllowed=False", as_leader["pricingViewAllowed"] is False)
check("Leader khong duoc phan cong: profitabilityViewAllowed=False", as_leader["profitabilityViewAllowed"] is False)


# ── 4) Public DTO khong duoc dua qua apply_quote_field_permissions/co field noi bo ──
# (kiem tra tinh (structural): _row_to_public_quote/_row_to_public_item dung
# allowlist rieng tu dau, khong ke thua _row_to_quote/_row_to_item - xem code,
# khong can goi lai o day vi khong nhan tham so user/quote dict noi bo).
from app.modules.all_platform.services.supabase_quote_service import _PUBLIC_ITEM_KEYS

check(
    "Public item allowlist KHONG chua costPrice/markupPercent/costTotal/costNotApplicable",
    not any(k in _PUBLIC_ITEM_KEYS for k in ("costPrice", "markupPercent", "costTotal", "costNotApplicable")),
)


print()
if failures:
    print(f"{len(failures)}/? CHECK FAILED:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
else:
    print("ALL CHECKS PASSED (pure unit, khong cham DB that).")
