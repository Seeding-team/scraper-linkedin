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
