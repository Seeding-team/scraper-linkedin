"""Unit test helper tien te cap Quote (khong can DB)."""

from decimal import Decimal

import pytest

from app.modules.all_platform.services import quote_currency as qc
from app.modules.all_platform.services import supabase_quote_service as svc


def test_round_money_by_currency():
    assert qc.round_money(Decimal("1250000.4"), "VND") == 1250000
    assert qc.round_money(Decimal("48.077"), "USD") == 48.08
    assert qc.round_money(Decimal("1.005"), "USD") == 1.01  # ROUND_HALF_UP, khong banker's rounding


def test_calculate_item_matches_rpc_for_usd_and_vnd():
    # khop RPC quote_update (migration 169): 3 x $48.08, VAT 10%
    assert svc._calculate_item(3, 48.08, 10, 0, "USD") == (144.24, 0.0, 144.24, 14.42, 158.66)
    assert svc._calculate_item(3, 1250000, 10, 0) == (3750000.0, 0.0, 3750000.0, 375000.0, 4125000.0)


def test_conversion_uses_given_rate_never_hardcoded():
    assert qc.vnd_to_quote_currency(1250000, "USD", 26000) == 48.08
    assert qc.vnd_to_quote_currency(1250000, "USD", 25000) == 50.0
    assert qc.vnd_to_quote_currency(1250000, "VND", None) == 1250000
    with pytest.raises(ValueError):
        qc.vnd_to_quote_currency(1250000, "USD", None)
    assert qc.quote_amount_to_vnd(158.66, "USD", 26000) == 4125160
    assert qc.quote_amount_to_vnd(4125000, "VND", None) == 4125000


def test_normalize_and_lenient_currency():
    assert qc.normalize_currency(None) == "VND"
    assert qc.normalize_currency("usd") == "USD"
    with pytest.raises(ValueError):
        qc.normalize_currency("EUR")
    assert qc.lenient_currency("VNĐ") == "VND" and qc.lenient_currency(" usd ") == "USD"


def test_snapshot_shape():
    assert qc.build_snapshot("VND", None) is None
    snap = qc.build_snapshot("USD", 26000)
    assert snap["currency"] == "USD" and snap["exchange_rate"] == 26000 and snap["base_currency"] == "VND" and snap["captured_at"]
