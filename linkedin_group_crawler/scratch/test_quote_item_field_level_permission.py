"""Unit test THUAN cho _check_item_field_level_permission() trong quote.py -
dung yeu cau audit: "Presale khong duoc sua markup neu khong dong thoi la
Sale phu trach, va nguoc lai" - kiem tra o cap do TUNG FIELD trong 1 lan
PUT /quotes/{id}, khong chi dua vao can_edit_quote() chung chung.
Chay: python scratch/test_quote_item_field_level_permission.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


def run():
    from app.modules.all_platform.routers.quote import _check_item_field_level_permission

    presale_only = {"id": "u-presale", "role": "member"}
    sale_only = {"id": "u-sale", "role": "member"}
    unrelated = {"id": "u-other", "role": "member"}

    base_item = {
        "description": "Máy chủ", "serviceDescription": "VPS 4 core", "unit": "cái",
        "quantity": 2, "costPrice": 1_000_000, "costNotApplicable": False,
        "unitPrice": 1_500_000, "discountPercent": 0, "markupPercent": 20, "vatRate": 10,
    }
    # quote.items = trang thai DA LUU (camelCase, dung shape _row_to_quote
    # tra ve) - PHAI khop voi base_item, neu khong so luong/gia tri se bi
    # tinh nham la "da thay doi" ngay ca khi thuc ra khong doi gi.
    quote = {"technicalOwnerId": "u-presale", "quoteOwnerId": "u-sale", "items": [dict(base_item)]}

    def item_payload(**overrides):
        mapping = {
            "description": "description", "serviceDescription": "service_description",
            "unit": "unit", "quantity": "quantity", "costPrice": "cost_price",
            "costNotApplicable": "cost_not_applicable", "unitPrice": "unit_price",
            "discountPercent": "discount_percent", "markupPercent": "markup_percent", "vatRate": "vat_rate",
        }
        payload = {mapping[k]: v for k, v in base_item.items()}
        for k, v in overrides.items():
            payload[mapping[k]] = v
        return payload

    # ── 1) Presale sua cost_price (dung viec) -> allowed ────────────────────
    result = _check_item_field_level_permission(presale_only, quote, [item_payload(costPrice=1_200_000)])
    record("Presale sua cost_price cua chinh minh phu trach -> allowed (None)", result is None, str(result))

    # ── 2) Presale co gang sua markup_percent -> denied ─────────────────────
    result = _check_item_field_level_permission(presale_only, quote, [item_payload(markupPercent=30)])
    record("Presale co gang sua markup_percent -> DENIED", result is not None and "giá bán" in result, str(result))

    # ── 3) Sale sua unit_price (dung viec) -> allowed ───────────────────────
    result = _check_item_field_level_permission(sale_only, quote, [item_payload(unitPrice=1_600_000)])
    record("Sale sua unit_price cua chinh minh phu trach -> allowed (None)", result is None, str(result))

    # ── 4) Sale co gang sua cost_price -> denied ────────────────────────────
    result = _check_item_field_level_permission(sale_only, quote, [item_payload(costPrice=900_000)])
    record("Sale co gang sua cost_price -> DENIED", result is not None and "kỹ thuật" in result, str(result))

    # ── 5) Nguoi khong lien quan sua bat ky field nao -> denied ─────────────
    result = _check_item_field_level_permission(unrelated, quote, [item_payload(quantity=5)])
    record("Nguoi khong lien quan sua quantity -> DENIED", result is not None, str(result))

    # ── 6) Khong sua item nao (items=None, vd chi sua data rieng) -> khong chan ──
    result = _check_item_field_level_permission(unrelated, quote, None)
    record("items=None (khong dong toi hang muc) -> khong chan (None)", result is None, str(result))

    # ── 7) Them/bot hang muc (so luong khac) -> tinh la thay doi ky thuat ───
    result = _check_item_field_level_permission(sale_only, quote, [item_payload(), item_payload(description="Thêm 1 dòng")])
    record("Them 1 hang muc moi (Sale, khong phai Presale) -> DENIED (tinh la thay doi ky thuat)", result is not None and "kỹ thuật" in result, str(result))

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
