"""Unit test parser nguon ty gia (khong mang, khong DB) — dung httpx.MockTransport."""

from decimal import Decimal

import httpx
import pytest

from app.modules.all_platform.services import quote_exchange_rate_service as svc

TYGIAUSD_HTML = """<html><head><title>Tỷ giá USD chợ đen, giá đô hôm nay</title></head><body>
<table class="table"><tr class="bg-success"><th></th><th>Mua vào</th><th>Bán ra</th></tr>
<tr>
  <th title="giá usd chợ đen"><a href="https://tygiausd.org/"><h3>USD chợ đen</h3></a></th>
  <td class="text-right">26,000 <span class="u">80</span></td>
  <td class="text-right">26,030 <span class="u">70</span></td>
</tr></table>
<table><tr><td>USD</td><td>ĐÔ LA MỸ</td><td>25,780</td><td>25,810</td><td>26,190</td></tr></table></body></html>"""


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _html(body: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, content=body.encode("utf-8"), headers={"content-type": "text/html; charset=utf-8"})


def test_tygiausd_parses_free_market_sell_not_buy_not_bank_table():
    rate, source = svc.fetch_tygiausd(client(lambda r: _html(TYGIAUSD_HTML)))
    assert rate == Decimal("26030")  # Mua 26.000 / Bán 26.030 → lấy BÁN RA, không phải 26.190 của bảng ngân hàng
    assert source == "Tỷ giá USD thị trường tự do – tygiausd.org"


def test_tygiausd_is_the_primary_source_and_vietcombank_is_gone():
    assert svc.SOURCES[0][0] == "tygiausd" and svc.SOURCES[0][1] is svc.fetch_tygiausd
    assert [name for name, _ in svc.SOURCES] == ["tygiausd", "exchangerate_api"]
    assert not hasattr(svc, "fetch_vietcombank")


@pytest.mark.parametrize("body", [
    "<html>khong co bang gia</html>",                                                     # khong thay dong USD cho den
    TYGIAUSD_HTML.replace("26,030", "-"),                                                  # khong co gia ban
    TYGIAUSD_HTML.replace("26,030", "26.03"),                                              # ngoai khoang hop ly
    TYGIAUSD_HTML.replace("26,000", "27,000"),                                             # mua > ban: bo cuc trang doi
])
def test_tygiausd_rejects_bad_payloads(body):
    with pytest.raises(svc.RateSourceError):
        svc.fetch_tygiausd(client(lambda r: _html(body)))


def test_tygiausd_http_error():
    with pytest.raises(svc.RateSourceError):
        svc.fetch_tygiausd(client(lambda r: httpx.Response(503)))


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
