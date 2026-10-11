"""Tien te cap QUOTE (multi-currency) - helper dung chung cho luong bao gia.

Quy uoc (xem migration 169_quote_multi_currency.sql):
  * Currency thuoc cap Quote, KHONG mix VND/USD giua cac dong.
  * Gia goc Service Catalog / Price Book luon la VND, KHONG bi sua.
  * Quote USD: gia USD = gia VND / exchange_rate (exchange_rate = so VND cho 1 USD),
    ty gia DONG BANG vao quotes.exchange_rate + quotes.currency_snapshot luc tao/chuyen
    currency -> reload / approve / PDF / public khong doi khi ty gia he thong thay doi.
  * Quote cu: currency='VND', exchange_rate=NULL, hanh vi giu nguyen.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

SUPPORTED_CURRENCIES = ("VND", "USD")
BASE_CURRENCY = "VND"


def normalize_currency(value: Any) -> str:
    code = str(value or BASE_CURRENCY).strip().upper() or BASE_CURRENCY
    if code not in SUPPORTED_CURRENCIES:
        raise ValueError(f"Tiền tệ báo giá không được hỗ trợ: {code}. Chỉ hỗ trợ {', '.join(SUPPORTED_CURRENCIES)}.")
    return code


def lenient_currency(value: Any) -> str:
    """Doc currency tu text TU DO (vd quotes.data.currency la field 'Đơn vị tiền tệ'
    go tay: "VNĐ", "đồng"...) - chi 'USD' moi la USD, con lai coi la VND, KHONG bao
    gio raise (khac normalize_currency dung cho gia tri he thong gui len)."""
    return "USD" if str(value or "").strip().upper() == "USD" else BASE_CURRENCY


def money_decimals(currency: Any) -> int:
    """VND = dong nguyen, cac currency khac (USD) = 2 chu so thap phan."""
    return 0 if str(currency or BASE_CURRENCY).upper() == BASE_CURRENCY else 2


def round_money(value: Decimal, currency: Any = BASE_CURRENCY) -> float:
    exp = Decimal(1).scaleb(-money_decimals(currency))
    return float(value.quantize(exp, rounding=ROUND_HALF_UP))


def to_rate(value: Any) -> Decimal | None:
    """Parse ty gia (so VND / 1 USD) -> Decimal > 0, hoac None."""
    if value is None or value == "":
        return None
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return rate if rate > 0 else None


def vnd_to_quote_currency(amount_vnd: Any, currency: Any, rate: Any) -> float | None:
    """Doi gia VND goc sang tien te cua quote theo ty gia da dong bang."""
    if amount_vnd is None or amount_vnd == "":
        return None
    amount = Decimal(str(amount_vnd))
    cur = str(currency or BASE_CURRENCY).upper()
    if cur == BASE_CURRENCY:
        return round_money(amount, cur)
    fx = to_rate(rate)
    if fx is None:
        raise ValueError("Thiếu tỷ giá để quy đổi sang " + cur + ".")
    return round_money(amount / fx, cur)


def quote_amount_to_vnd(amount: Any, currency: Any, rate: Any) -> float:
    """Tong tien quote -> VND (cho cac module tong hop doanh thu/ngan sach)."""
    value = Decimal(str(amount if amount is not None else 0))
    if str(currency or BASE_CURRENCY).upper() == BASE_CURRENCY:
        return float(value)
    fx = to_rate(rate)
    if fx is None:
        return float(value)
    return float((value * fx).quantize(Decimal(1), rounding=ROUND_HALF_UP))


MIN_USD_VND_RATE = Decimal(1_000)
MAX_USD_VND_RATE = Decimal(100_000)


def assert_plausible_usd_vnd_rate(rate: Decimal) -> Decimal:
    """Chan go nham (26 thay vi 26.000, them nhieu so 0...) cho MOI nguon ty gia: he thong lan
    ty gia nhap tay cua tung bao gia."""
    if not (MIN_USD_VND_RATE <= rate <= MAX_USD_VND_RATE):
        raise ValueError(
            f"Tỷ giá USD→VND phải nằm trong khoảng {int(MIN_USD_VND_RATE):,} – {int(MAX_USD_VND_RATE):,} VND (kiểm tra lại số 0)."
        )
    return rate


def build_snapshot(currency: str, rate: Any) -> dict | None:
    """currency_snapshot de luu vao quotes - NULL voi bao gia VND (khong co ty gia)."""
    if currency == BASE_CURRENCY:
        return None
    fx = to_rate(rate)
    return {
        "currency": currency,
        "exchange_rate": float(fx) if fx is not None else None,
        "base_currency": BASE_CURRENCY,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
