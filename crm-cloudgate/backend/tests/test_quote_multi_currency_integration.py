"""Test tich hop multi-currency Quote - chay tren Postgres+PostgREST CUC BO (throwaway).

KHONG chay mac dinh (can DB test rieng). Cach chay:
    MC_TEST_SUPABASE_URL=http://localhost:55433 python -m pytest tests/test_quote_multi_currency_integration.py -q
TEST NAY TU CHOI chay neu URL khong phai localhost/127.0.0.1 (khong bao gio cham DB that).

DB test: Postgres co migration 001..169 + cot `instance` (bootstrap multi-tenant ngoai migrations),
PostgREST dat sau nginx rewrite /rest/v1/ -> / de supabase-py dung duoc.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

URL = os.getenv("MC_TEST_SUPABASE_URL", "").strip()
pytestmark = pytest.mark.skipif(not URL, reason="Can MC_TEST_SUPABASE_URL tro toi DB test cuc bo")

if URL:
    assert URL.startswith(("http://localhost", "http://127.0.0.1")), "Chi duoc chay voi DB cuc bo!"
    os.environ["SUPABASE_URL"] = URL
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.getenv("MC_TEST_SUPABASE_KEY") or (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test-signature"
    )
    os.environ["CRM_INSTANCE"] = "test"

PSQL_CONTAINER = os.getenv("MC_TEST_PG_CONTAINER", "mc_pg")


def psql(sql: str) -> str:
    out = subprocess.run(
        ["docker", "exec", "-i", PSQL_CONTAINER, "psql", "-U", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def _force_local_supabase():
    """app.core.config nap .env + .env.local (override=True) KHI import -> ghi de SUPABASE_URL ve DB
    THAT. Phai dat lai env SAU khi import config va TRUOC khi tao client, roi kiem tra cung de chac
    chan moi request di toi DB cuc bo."""
    from app.core.config import settings
    from app.core import supabase_client as sc

    os.environ["SUPABASE_URL"] = URL
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.getenv("MC_TEST_SUPABASE_KEY") or (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test-signature"
    )
    try:
        settings.crm_instance = "test"
    except AttributeError:  # ban multi-tenant (crm-module): crm_instance la property theo Host header
        settings.default_crm_instance = "test"
    sc._supabase_client = None  # buoc tao lai client voi env vua dat
    base = str(sc.get_supabase_client().postgrest.base_url)
    assert base.startswith(("http://localhost", "http://127.0.0.1")), f"KHONG phai DB cuc bo: {base}"
    assert settings.crm_instance == "test"
    return settings


@pytest.fixture(scope="module")
def env():
    _force_local_supabase()
    from app.modules.all_platform.services import quote_exchange_rate_service as fx_service
    from app.modules.all_platform.services import supabase_quote_service as svc

    schema = '{"version":1,"layoutType":"cloudgate_standard_quote","sections":[]}'
    form_id = psql(
        "INSERT INTO public.quote_forms(code,name,layout_type,schema_json,status,instance) "
        f"VALUES ('mc-{uuid.uuid4().hex[:8]}','mc test','cloudgate_standard_quote','{schema}','active','test') RETURNING id;"
    ).splitlines()[0]
    deal_id = psql(
        "INSERT INTO public.customer_leads(customer_name,instance) VALUES ('MC Test KH','test') RETURNING id;"
    ).splitlines()[0]
    psql("DELETE FROM public.quote_exchange_rates WHERE instance='test';")
    yield {"svc": svc, "fx": fx_service, "form_id": form_id, "deal_id": deal_id}
    psql("DELETE FROM public.quote_exchange_rates WHERE instance='test';")


@pytest.fixture(autouse=True)
def _no_real_network_rate_sources(env):
    """KHONG BAO GIO goi nguon ty gia that trong test: mac dinh moi nguon deu loi; test nao can rate
    thi tu gan SOURCES gia lap hoac set_usd_vnd_rate (override thu cong)."""
    fx = env["fx"]
    original = list(fx.SOURCES)

    def down(client):
        raise fx.RateSourceError("test: nguon tat")

    fx.SOURCES[:] = [("down", down)]
    fx._MEM_LAST_ATTEMPT.clear()
    fx._MEM_LAST_ERROR.clear()
    yield
    fx.SOURCES[:] = original


def make_payload(env, items, **extra):
    return {
        "deal_id": env["deal_id"],
        "quote_form_id": env["form_id"],
        "data": {"quoteTitle": "MC test"},
        "items": items,
        **extra,
    }


def vnd_item(**kw):
    base = {
        "row_type": "item", "description": "Dich vu A", "quantity": 3, "unit_price": 1250000,
        "cost_price": 1000000, "markup_percent": 25, "vat_rate": 10, "discount_percent": 0,
    }
    base.update(kw)
    return base


def usd_item(**kw):
    base = {
        "row_type": "item", "description": "Dich vu A", "quantity": 3, "unit_price": 48.08,
        "cost_price": 38.46, "markup_percent": 25, "vat_rate": 10, "discount_percent": 0,
        "unit_price_vnd": 1250000, "cost_price_vnd": 1000000,
    }
    base.update(kw)
    return base


# ------------------------------------------------------------------ VND
def test_vnd_flow_unchanged_create_save_reload_approve_public(env):
    svc = env["svc"]
    q = svc.create_quote(make_payload(env, [vnd_item()]), None)
    assert q["currency"] == "VND" and q["exchangeRate"] is None and q["currencySnapshot"] is None
    assert (q["subtotalAmount"], q["vatAmount"], q["totalAmount"]) == (3750000, 375000, 4125000)
    assert q["items"][0]["unitPrice"] == 1250000

    # markup 20% tren gia von 1.000.000 -> gia khach 1.200.000
    q2 = svc.update_quote(q["id"], {"data": q["data"], "items": [vnd_item(unit_price=1200000.4, markup_percent=20)]}, None)
    assert q2["items"][0]["unitPrice"] == 1200000  # VND van lam tron dong nguyen
    assert q2["totalAmount"] == 3960000 and q2["items"][0]["markupPercent"] == 20
    assert svc.get_quote(q["id"])["totalAmount"] == 3960000  # reload

    approved = svc.update_and_approve_quote(q["id"], {"data": q2["data"], "items": [vnd_item(unit_price=1200000, markup_percent=20)]}, None)
    assert approved["status"] == "approved" and approved["currency"] == "VND"
    assert svc.get_quote(q["id"])["totalAmount"] == 3960000  # reload sau approve
    published = svc.publish_quote(q["id"], None)
    psql(f"UPDATE public.quotes SET public_access_mode='none' WHERE id='{q['id']}';")  # bo cong xac minh SDT/email
    public = svc.get_public_quote(published["publicToken"])
    assert public["currency"] == "VND" and public["totalAmount"] == 3960000
    assert "costPrice" not in public["items"][0]


# ------------------------------------------------------------------ USD
def test_usd_requires_rate_when_none_configured(env):
    with pytest.raises(ValueError, match="tỷ giá"):
        env["svc"].create_quote(make_payload(env, [usd_item()], currency="USD"), None)


def test_usd_flow_snapshot_save_reload_approve_public_version(env):
    svc, fx = env["svc"], env["fx"]
    fx.set_usd_vnd_rate(26000, None, "test")
    q = svc.create_quote(make_payload(env, [usd_item()], currency="USD"), None)
    assert q["currency"] == "USD" and q["exchangeRate"] == 26000
    assert q["currencySnapshot"]["exchange_rate"] == 26000 and q["currencySnapshot"]["base_currency"] == "VND"
    assert q["data"]["currency"] == "USD"
    assert (q["subtotalAmount"], q["vatAmount"], q["totalAmount"]) == (144.24, 14.42, 158.66)
    item = q["items"][0]
    assert item["unitPrice"] == 48.08 and item["costPrice"] == 38.46
    assert item["unitPriceVnd"] == 1250000 and item["costPriceVnd"] == 1000000

    # ty gia he thong doi -> snapshot cua quote KHONG doi (reload / save / approve)
    fx.set_usd_vnd_rate(27000, None, "test")
    again = svc.get_quote(q["id"])
    assert again["exchangeRate"] == 26000
    saved = svc.update_quote(q["id"], {"data": again["data"], "items": [usd_item()], "currency": "USD", "exchange_rate": 27000}, None)
    assert saved["exchangeRate"] == 26000 and saved["totalAmount"] == 158.66  # gui ty gia moi van bi bo qua

    approved = svc.update_and_approve_quote(q["id"], {"data": saved["data"], "items": [usd_item()]}, None)
    assert approved["status"] == "approved" and approved["exchangeRate"] == 26000
    reloaded = svc.get_quote(q["id"])
    assert reloaded["currency"] == "USD" and reloaded["exchangeRate"] == 26000 and reloaded["totalAmount"] == 158.66

    published = svc.publish_quote(q["id"], None)
    psql(f"UPDATE public.quotes SET public_access_mode='none' WHERE id='{q['id']}';")  # bo cong xac minh SDT/email
    public = svc.get_public_quote(published["publicToken"])
    assert public["currency"] == "USD" and public["totalAmount"] == 158.66
    assert public["items"][0]["unitPrice"] == 48.08
    assert "costPrice" not in public["items"][0] and "costPriceVnd" not in public["items"][0]
    assert "exchangeRate" not in {k for k in public if k == "exchangeRate"}  # quote-level rate khong lo ra public

    # phien ban moi mang theo tien te + ty gia da chot + goc VND
    version = svc.create_quote_version(q["id"], None)["quote"]
    assert version["currency"] == "USD" and version["exchangeRate"] == 26000
    assert version["items"][0]["costPriceVnd"] == 1000000 and version["totalAmount"] == 158.66

    # quote da duyet khong doi tien te duoc
    with pytest.raises(Exception, match="duyệt|approved"):
        svc.update_quote(q["id"], {"data": {}, "items": [vnd_item()], "currency": "VND"}, None)


def test_currency_switch_vnd_to_usd_and_back_recalculates(env):
    svc, fx = env["svc"], env["fx"]
    fx.set_usd_vnd_rate(26000, None, "test")
    q = svc.create_quote(make_payload(env, [vnd_item()]), None)
    assert q["totalAmount"] == 4125000

    # Doi sang USD: gui kem hang muc da quy doi (FE lam), backend chot ty gia + lam tron 2 so le
    usd = svc.update_quote(q["id"], {"data": q["data"], "items": [usd_item()], "currency": "USD"}, None)
    assert usd["currency"] == "USD" and usd["exchangeRate"] == 26000
    assert usd["totalAmount"] == 158.66 and usd["data"]["currency"] == "USD"

    # Doi lai VND: gia tro ve dong nguyen, ty gia xoa
    back = svc.update_quote(q["id"], {"data": usd["data"], "items": [vnd_item()], "currency": "VND"}, None)
    assert back["currency"] == "VND" and back["exchangeRate"] is None and back["currencySnapshot"] is None
    assert back["totalAmount"] == 4125000

    # Doi tien te nhung KHONG gui hang muc -> tu choi (khong de DB lech tien te voi gia)
    with pytest.raises(ValueError, match="hạng mục"):
        svc.update_quote(q["id"], {"currency": "USD"}, None)


def test_currency_switch_rolls_back_when_rpc_fails(env):
    svc, fx = env["svc"], env["fx"]
    fx.set_usd_vnd_rate(26000, None, "test")
    q = svc.create_quote(make_payload(env, [vnd_item()]), None)
    bad = vnd_item(discount_percent=500)  # RPC: quote_item_invalid_percent
    with pytest.raises(Exception):
        svc.update_quote(q["id"], {"data": q["data"], "items": [bad], "currency": "USD"}, None)
    after = svc.get_quote(q["id"])
    assert after["currency"] == "VND" and after["exchangeRate"] is None  # da rollback
    assert after["totalAmount"] == 4125000


def test_unsupported_currency_and_free_text_currency(env):
    svc = env["svc"]
    with pytest.raises(ValueError, match="không được hỗ trợ"):
        svc.create_quote(make_payload(env, [vnd_item()], currency="EUR"), None)
    # data.currency go tay ("VNĐ") KHONG duoc coi la yeu cau doi tien te -> van tao duoc, VND
    q = svc.create_quote({**make_payload(env, [vnd_item()]), "data": {"currency": "VNĐ"}}, None)
    assert q["currency"] == "VND" and q["data"]["currency"] == "VND"
    saved = svc.update_quote(q["id"], {"data": {"currency": "đồng"}, "items": [vnd_item()]}, None)
    assert saved["currency"] == "VND"


def test_deal_budget_uses_vnd_equivalent_of_usd_quote(env):
    svc, fx = env["svc"], env["fx"]
    fx.set_usd_vnd_rate(26000, None, "test")
    fresh_deal = psql("INSERT INTO public.customer_leads(customer_name,instance) VALUES ('MC Budget KH','test') RETURNING id;").splitlines()[0]
    q = svc.create_quote({**make_payload(env, [usd_item()], currency="USD"), "deal_id": fresh_deal}, None)
    svc.link_quote_to_deal(q["id"], fresh_deal, {"id": q["id"], "number": q["quoteNumber"], "url": "x", "totalAmount": q["totalAmount"]})
    budget = float(psql(f"SELECT COALESCE(estimated_budget,0) FROM public.customer_leads WHERE id='{fresh_deal}';"))
    assert budget == 4125160.0  # 158.66 USD x 26000 - estimated_budget cua Co hoi luon la VND


def test_system_rate_default_snapshot_and_validation(env):
    """Chon USD khong gui ty gia -> lay ty gia he thong va CHOT; doi ty gia he thong sau do khong doi quote cu."""
    svc, fx = env["svc"], env["fx"]
    with pytest.raises(ValueError, match="khoảng"):
        fx.set_usd_vnd_rate(26, None)  # go nham thieu 3 so 0
    with pytest.raises(ValueError, match="khoảng"):
        fx.set_usd_vnd_rate(26_000_000, None)
    fx.set_usd_vnd_rate(25_500, None, "mac dinh")
    assert fx.get_usd_vnd_rate()["rate"] == 25_500
    q1 = svc.create_quote(make_payload(env, [usd_item(unit_price_vnd=None, cost_price_vnd=None)], currency="USD"), None)  # khong gui exchange_rate
    assert q1["exchangeRate"] == 25_500 and q1["currencySnapshot"]["exchange_rate"] == 25_500
    fx.set_usd_vnd_rate(26_100, None, "doi")
    q2 = svc.create_quote(make_payload(env, [usd_item()], currency="USD"), None)
    assert q2["exchangeRate"] == 26_100  # quote moi lay ty gia moi
    assert svc.get_quote(q1["id"])["exchangeRate"] == 25_500  # quote cu giu snapshot
    saved = svc.update_quote(q1["id"], {"data": q1["data"], "items": [usd_item()], "currency": "USD"}, None)
    assert saved["exchangeRate"] == 25_500


def test_per_quote_rate_override_is_range_checked(env):
    svc, fx = env["svc"], env["fx"]
    fx.set_usd_vnd_rate(26_000, None, "reset")
    with pytest.raises(ValueError, match="khoảng"):
        svc.create_quote(make_payload(env, [usd_item()], currency="USD", exchange_rate=2_800_025_000), None)
    ok = svc.create_quote(make_payload(env, [usd_item()], currency="USD", exchange_rate=25_000), None)
    assert ok["exchangeRate"] == 25_000  # ghi de tay trong khoang hop le, chi cho quote nay
    assert fx.get_usd_vnd_rate()["rate"] == 26_000


# ───────────────────────── Ty gia tu dong (nguon uy tin + override + fallback) ─────────────────────────
from decimal import Decimal as _D  # noqa: E402


def _fake_source(rate, label="Nguon gia lap"):
    def fetcher(client):
        return _D(str(rate)), label
    return fetcher


def _failing_source(client):
    from app.modules.all_platform.services.quote_exchange_rate_service import RateSourceError
    raise RateSourceError("gia lap: nguon loi")


def _reset_fx(env):
    psql("DELETE FROM public.quote_exchange_rates WHERE instance='test';")
    psql("DELETE FROM public.quote_exchange_rate_history WHERE instance='test';")
    env["fx"]._MEM_LAST_ATTEMPT.clear()
    env["fx"]._MEM_LAST_ERROR.clear()


def test_auto_refresh_stores_rate_source_updated_at_and_history(env):
    fx = env["fx"]
    _reset_fx(env)
    fx.SOURCES[:] = [("fake", _fake_source(26_350, "Vietcombank (bán ra)"))]
    data = fx.get_usd_vnd_rate()  # chua co → tu lay
    assert data["rate"] == 26_350 and data["source"] == "Vietcombank (bán ra)" and data["isManual"] is False
    assert data["updatedAt"] and data["refreshed"] is True and data["stale"] is False
    assert psql("SELECT count(*) FROM public.quote_exchange_rate_history WHERE instance='test';") == "1"


def test_source_failure_falls_back_to_last_rate_and_reports_error(env):
    fx = env["fx"]
    _reset_fx(env)
    fx.SOURCES[:] = [("fake", _fake_source(26_000))]
    fx.refresh_usd_vnd_rate(None, force=True)
    psql("UPDATE public.quote_exchange_rates SET last_attempt_at = now() - interval '10 minutes', updated_at = now() - interval '30 hours' WHERE instance='test';")
    fx.SOURCES[:] = [("a", _failing_source), ("b", _failing_source)]
    data = fx.refresh_usd_vnd_rate(None, force=True)
    assert data["rate"] == 26_000  # giu rate gan nhat
    assert data["refreshed"] is False and "Không lấy được" in (data["error"] or "") and data["stale"] is True
    assert "nguon loi" in env["fx"].get_usd_vnd_rate(auto_refresh=False)["lastError"]


def test_all_sources_down_and_no_rate_returns_none_not_invented(env):
    fx = env["fx"]
    _reset_fx(env)
    fx.SOURCES[:] = [("a", _failing_source)]
    data = fx.get_usd_vnd_rate()
    assert data["rate"] is None and data["error"]
    with pytest.raises(ValueError, match="tỷ giá"):
        env["svc"].create_quote(make_payload(env, [usd_item()], currency="USD"), None)


def test_second_source_used_when_first_fails(env):
    fx = env["fx"]
    _reset_fx(env)
    fx.SOURCES[:] = [("a", _failing_source), ("b", _fake_source(26_100, "ExchangeRate-API (thị trường, tham khảo)"))]
    data = fx.refresh_usd_vnd_rate(None, force=True)
    assert data["rate"] == 26_100 and data["source"].startswith("ExchangeRate-API")


def test_manual_override_sticks_until_force_refresh_and_has_cooldown(env):
    fx = env["fx"]
    _reset_fx(env)
    fx.SOURCES[:] = [("fake", _fake_source(26_000))]
    fx.refresh_usd_vnd_rate(None, force=True)
    manual = fx.set_usd_vnd_rate(27_000, None, "dam phan")
    assert manual["rate"] == 27_000 and manual["isManual"] is True and manual["source"] == "Nhập tay"
    psql("UPDATE public.quote_exchange_rates SET updated_at = now() - interval '48 hours', last_attempt_at = now() - interval '48 hours' WHERE instance='test';")
    fx.SOURCES[:] = [("fake", _fake_source(26_500))]
    assert fx.get_usd_vnd_rate()["rate"] == 27_000  # tu dong KHONG ghi de override thu cong
    psql("UPDATE public.quote_exchange_rates SET last_attempt_at = now() - interval '10 minutes';")
    back = fx.refresh_usd_vnd_rate(None, force=True)  # nut "Cap nhat ty gia"
    assert back["rate"] == 26_500 and back["isManual"] is False
    fx.SOURCES[:] = [("fake", _fake_source(26_900))]
    again = fx.refresh_usd_vnd_rate(None, force=True)  # vua goi < 60s → cooldown, khong goi nguon
    assert again["rate"] == 26_500 and again["refreshed"] is False


def test_new_quote_uses_latest_rate_old_quote_keeps_snapshot(env):
    fx, svc = env["fx"], env["svc"]
    _reset_fx(env)
    fx.SOURCES[:] = [("fake", _fake_source(26_000))]
    fx.refresh_usd_vnd_rate(None, force=True)
    old = svc.create_quote(make_payload(env, [usd_item()], currency="USD"), None)
    assert old["exchangeRate"] == 26_000
    psql("UPDATE public.quote_exchange_rates SET last_attempt_at = now() - interval '10 minutes' WHERE instance='test';")
    fx.SOURCES[:] = [("fake", _fake_source(26_800))]
    fx.refresh_usd_vnd_rate(None, force=True)
    new = svc.create_quote(make_payload(env, [usd_item()], currency="USD"), None)
    assert new["exchangeRate"] == 26_800
    assert svc.get_quote(old["id"])["exchangeRate"] == 26_000
    saved = svc.update_quote(old["id"], {"data": old["data"], "items": [usd_item()], "currency": "USD"}, None)
    assert saved["exchangeRate"] == 26_000
