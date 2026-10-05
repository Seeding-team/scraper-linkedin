"""Unit test parser nguon ty gia (khong mang, khong DB) — dung httpx.MockTransport."""

from decimal import Decimal

import httpx
import pytest

from app.modules.all_platform.services import quote_exchange_rate_service as svc

VCB_XML = """<!--For reference only. Only one request every 5 minutes!-->
<ExrateList>
  <DateTime>10/5/2026 10:09:13 PM</DateTime>
  <Exrate CurrencyCode="EUR" CurrencyName="EURO" Buy="28,341.59" Transfer="28,627.87" Sell="29,836.29" />
  <Exrate CurrencyCode="USD" CurrencyName="US DOLLAR" Buy="25,900.00" Transfer="26,000.00" Sell="26,300.00" />
</ExrateList>"""


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_vietcombank_parses_usd_sell():
    rate, source = svc.fetch_vietcombank(client(lambda r: httpx.Response(200, text=VCB_XML)))
    assert rate == Decimal("26300.00") and "Vietcombank" in source


@pytest.mark.parametrize("body", [
    "<ExrateList><Exrate CurrencyCode='EUR' Sell='1,000'/></ExrateList>",        # khong co USD
    "<ExrateList><Exrate CurrencyCode='USD' Sell='-'/></ExrateList>",           # khong ban
    "<ExrateList><Exrate CurrencyCode='USD' Sell='26.30'/></ExrateList>",       # ngoai khoang hop ly
    "khong phai xml",
])
def test_vietcombank_rejects_bad_payloads(body):
    with pytest.raises(svc.RateSourceError):
        svc.fetch_vietcombank(client(lambda r: httpx.Response(200, text=body)))


def test_vietcombank_http_error():
    with pytest.raises(svc.RateSourceError):
        svc.fetch_vietcombank(client(lambda r: httpx.Response(503)))


def test_exchangerate_api_parses_and_validates():
    ok = lambda r: httpx.Response(200, json={"result": "success", "rates": {"VND": 26123.4}})
    rate, source = svc.fetch_exchangerate_api(client(ok))
    assert rate == Decimal("26123.4") and "ExchangeRate-API" in source
    with pytest.raises(svc.RateSourceError):
        svc.fetch_exchangerate_api(client(lambda r: httpx.Response(200, json={"result": "error"})))
    with pytest.raises(svc.RateSourceError):
        svc.fetch_exchangerate_api(client(lambda r: httpx.Response(200, json={"result": "success", "rates": {"VND": 3}})))


def test_no_hardcoded_rate_in_service_source():
    import inspect, re
    src = inspect.getsource(svc)
    # Khong co so nao giong ty gia USD/VND (5 chu so, vd 25400/26000) nam trong code nguon
    # (ngoai gioi han hop ly 1_000/100_000 duoc dinh nghia o quote_currency).
    assert not re.findall(r"\b2[3-9],?\d{3}\b", src)
