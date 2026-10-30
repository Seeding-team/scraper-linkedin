from app.modules.all_platform.services import supabase_quote_service as svc


def test_line_discount_percent_is_persisted_with_at_most_two_decimals():
    rows, *_ = svc._flatten_computed_items([
        {
            "row_type": "item",
            "description": "Dịch vụ",
            "quantity": 1,
            "unit_price": 100_000,
            "discount_percent": 14.578299120234602,
            "vat_rate": 0,
        }
    ])

    assert rows[0]["discount_percent"] == 14.58


def test_fixed_vnd_discount_amount_is_not_reverse_calculated_from_rounded_percent():
    """Khi nhập giảm giá tiền cố định 4.971.200 VNĐ trên tổng 34.971.200 VNĐ,
    discount_percent hiển thị là 14.22% nhưng tiền giảm thực tế và tổng sau giảm
    phải giữ đúng 4.971.200 VNĐ và 30.000.000 VNĐ (không bị nhân ngược thành 29.999.420 VNĐ)."""
    rows, subtotal, vat, total = svc._flatten_computed_items([
        {
            "row_type": "item",
            "description": "Gói dịch vụ CloudGate",
            "quantity": 1,
            "unit_price": 34_971_200,
            "discount_percent": 14.215125589056137,
            "discount_amount": 4_971_200,
            "vat_rate": 0,
        }
    ])

    assert rows[0]["discount_percent"] == 14.22
    assert rows[0]["discount"] == 4_971_200
    assert rows[0]["after_discount"] == 30_000_000
    assert rows[0]["total"] == 30_000_000
    assert subtotal == 34_971_200
    assert vat == 0
    assert total == 30_000_000


def test_multi_item_fixed_vnd_discount_preserves_exact_total_after_discount():
    """Phân bổ giảm giá tiền cố định 4.971.200 VNĐ xuống nhiều hạng mục:
    tổng giảm và tổng sau giảm phải khớp tròn 30.000.000 VNĐ."""
    rows, subtotal, vat, total = svc._flatten_computed_items([
        {
            "row_type": "item",
            "description": "Hạng mục 1",
            "quantity": 2,
            "unit_price": 550_000,
            "discount_percent": 14.22,
            "discount_amount": 156_369,
            "vat_rate": 0,
        },
        {
            "row_type": "item",
            "description": "Hạng mục 2",
            "quantity": 1,
            "unit_price": 33_871_200,
            "discount_percent": 14.22,
            "discount_amount": 4_814_831,
            "vat_rate": 0,
        },
    ])

    assert sum(r["discount"] for r in rows) == 4_971_200
    assert sum(r["after_discount"] for r in rows) == 30_000_000
    assert subtotal == 34_971_200
    assert vat == 0
    assert total == 30_000_000


def test_overall_discount_amount_resolves_mode_for_legacy_non_integer_percent():
    """Khi báo giá có overallDiscountAmount = 4.971.200 VNĐ nhưng overall_discount_percent
    bị quy đổi lẻ 12.95% và overallDiscountType là percent, _row_to_quote tự động nhận diện
    chế độ amount để không bị tính lệch thành 4.518.514 VNĐ."""
    quote = svc._row_to_quote({
        "id": "mock-quote-id",
        "deal_id": None,
        "quote_form_id": "mock-form-id",
        "quote_number": "202610291754",
        "status": "draft",
        "form_schema_version": 1,
        "form_snapshot": {},
        "overall_discount_percent": 12.95,
        "data": {
            "overallDiscountAmount": 4_971_200,
            "overallDiscountType": "percent",
        },
        "subtotal_amount": 34_892_000,
        "vat_amount": 79_200,
        "total_amount": 30_000_000,
    })

    assert quote["overallDiscountType"] == "amount"
    assert quote["data"]["overallDiscountType"] == "amount"
    assert quote["data"]["overallDiscountAmount"] == 4_971_200


def test_fixed_vat_amount_preserves_exact_vat_and_total():
    """Khi một hạng mục có vat_amount cố định, tổng VAT và total giữ đúng."""
    rows, subtotal, vat, total = svc._flatten_computed_items([
        {
            "row_type": "item",
            "description": "Hạng mục 1",
            "quantity": 1,
            "unit_price": 29_920_800,
            "discount_percent": 0,
            "vat_rate": 0.26,
            "vat_amount": 79_200,
        }
    ])

    assert rows[0]["vat"] == 79_200
    assert vat == 79_200
    assert total == 30_000_000


def test_unifarm_item_level_vat_and_overall_discount():
    """Báo giá Unifarm:
    - Các hạng mục khác: 34.100.000đ, VAT 0%
    - Riêng hạng mục VM: 12 × 66.000đ = 792.000đ, VAT 10% = 79.200đ, Thành tiền gồm VAT = 871.200đ
    - Tổng giá gốc (subtotal): 34.892.000đ
    - Giảm giá toàn báo giá: 4.971.200đ -> Sau giảm: 29.920.800đ
    - VAT: 79.200đ
    - Tổng thanh toán: 30.000.000đ"""
    items = [
        {
            "row_type": "item",
            "description": "Các dịch vụ website khác",
            "quantity": 1,
            "unit_price": 34_100_000,
            "vat_rate": 0,
            "discount_percent": 0,
        },
        {
            "row_type": "item",
            "description": "VM cơ bản cho website Nextjs (4vCPU-8GB RAM 100GB Disk)",
            "quantity": 12,
            "unit_price": 66_000,
            "vat_rate": 10,
            "discount_percent": 0,
        },
    ]

    rows, subtotal, vat, total = svc._flatten_computed_items(items, "VND")
    assert subtotal == 34_892_000
    assert vat == 79_200
    # Dòng VM
    vm_row = rows[1]
    assert vm_row["subtotal"] == 792_000
    assert vm_row["vat"] == 79_200
    assert vm_row["total"] == 871_200

    # Dòng khác
    assert rows[0]["vat"] == 0
    assert rows[0]["total"] == 34_100_000

    # Overall discount test qua _row_to_quote
    quote = svc._row_to_quote({
        "id": "mock-unifarm-quote-id",
        "deal_id": "1a7e8b32-e775-41ae-892a-e30d5441b518",
        "quote_form_id": "mock-form-id",
        "quote_number": "202610291754",
        "status": "draft",
        "form_schema_version": 1,
        "form_snapshot": {},
        "overall_discount_percent": 14.247,
        "data": {
            "overallDiscountAmount": 4_971_200,
            "overallDiscountType": "amount",
        },
        "subtotal_amount": 34_892_000,
        "vat_amount": 79_200,
        "total_amount": 30_000_000,
    })

    assert quote["subtotalAmount"] == 34_892_000
    assert quote["vatAmount"] == 79_200
    assert quote["totalAmount"] == 30_000_000
    assert quote["data"]["overallDiscountAmount"] == 4_971_200




