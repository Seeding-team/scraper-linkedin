"""Ty gia USD->VND he thong DUNG CHUNG cho luong bao gia — tu dong lay tu nguon uy tin, co the
override thu cong, KHONG hard-code bat ky ty gia nao.

Nguon (theo thu tu uu tien, co the thay trong SOURCES khi test):
  1. Vietcombank — bang ty gia cong khai (muc "Bán ra" USD). Nguon cua ngan hang, sat gia tri thuc
     te Viet Nam. Ho yeu cau chi goi 1 lan / 5 phut → service co cooldown.
  2. ExchangeRate-API (open.er-api.com) — ty gia thi truong tham khao, chi dung khi Vietcombank loi.

Quy tac:
  * Bang quote_exchange_rates (1 dong / instance) luu rate + source + updated_at + is_manual.
  * Override thu cong (set_usd_vnd_rate) dat is_manual=true: tu dong KHONG ghi de cho toi khi Admin
    bam "Cap nhat ty gia" (refresh force) — luc do quay lai che do tu dong.
  * Nguon loi → GIU rate gan nhat (fallback), ghi last_error; neu chua tung co rate thi tra rate=None
    de FE cho nhap tay. Khong bao gio bia rate.
  * Bao gia chi COPY rate vao quotes.exchange_rate + currency_snapshot luc tao / chuyen sang USD;
    doi rate o day KHONG anh huong bao gia da tao (snapshot da chot).
"""

from __future__ import annotations

import logging
import threading
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

import httpx
from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.quote_currency import assert_plausible_usd_vnd_rate, to_rate

logger = logging.getLogger(__name__)

TABLE = "quote_exchange_rates"
HISTORY_TABLE = "quote_exchange_rate_history"

VCB_URL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx"
ER_API_URL = "https://open.er-api.com/v6/latest/USD"
HTTP_TIMEOUT = 5.0

# Rate tu dong cu hon muc nay duoc lam moi "luoi" khi co nguoi dung can (chon USD / tao quote USD).
AUTO_REFRESH_AFTER = timedelta(hours=6)
# Rate tu dong cu hon muc nay (hoac lan lam moi gan nhat loi) bi coi la "stale" → FE canh bao.
STALE_AFTER = timedelta(hours=24)
# Khong goi nguon ngoai thuong xuyen hon: Vietcombank yeu cau >= 5 phut / lan.
LAZY_COOLDOWN = timedelta(minutes=5)
FORCE_COOLDOWN = timedelta(seconds=60)

MANUAL_SOURCE = "Nhập tay"

# Chua co dong nao trong DB (chua tung lay duoc rate) → nho lan thu gan nhat o bo nho de khong spam nguon.
_REFRESH_LOCK = threading.Lock()  # nhieu request cung luc (React strict mode, nhieu tab) chi 1 lan goi nguon
_MEM_LAST_ATTEMPT: dict[str, datetime] = {}
_MEM_LAST_ERROR: dict[str, str] = {}


class RateSourceError(Exception):
    """Mot nguon ty gia khong dung duoc (mang/HTTP/parse/ngoai khoang hop ly)."""


def _parse_number(text: str) -> Decimal:
    try:
        return Decimal(str(text).replace(",", "").strip())
    except (InvalidOperation, ValueError) as exc:
        raise RateSourceError(f"Không đọc được số '{text}'") from exc


def _validated(rate: Decimal) -> Decimal:
    try:
        return assert_plausible_usd_vnd_rate(rate)
    except ValueError as exc:
        raise RateSourceError(str(exc)) from exc


def fetch_vietcombank(client: httpx.Client) -> tuple[Decimal, str]:
    """USD 'Bán ra' tu bang ty gia Vietcombank."""
    try:
        response = client.get(VCB_URL)
        response.raise_for_status()
        root = ET.fromstring(response.text)
    except (httpx.HTTPError, ET.ParseError) as exc:
        raise RateSourceError(f"Vietcombank: {exc}") from exc
    for node in root.iter("Exrate"):
        if (node.get("CurrencyCode") or "").strip().upper() == "USD":
            sell = (node.get("Sell") or "").strip()
            if not sell or sell == "-":
                raise RateSourceError("Vietcombank: không có giá bán ra USD")
            return _validated(_parse_number(sell)), "Vietcombank (bán ra)"
    raise RateSourceError("Vietcombank: không thấy dòng USD")


def fetch_exchangerate_api(client: httpx.Client) -> tuple[Decimal, str]:
    """Ty gia thi truong tham khao USD→VND (du phong)."""
    try:
        response = client.get(ER_API_URL)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RateSourceError(f"ExchangeRate-API: {exc}") from exc
    if payload.get("result") != "success":
        raise RateSourceError("ExchangeRate-API: phản hồi không thành công")
    vnd = (payload.get("rates") or {}).get("VND")
    if vnd is None:
        raise RateSourceError("ExchangeRate-API: không có VND")
    return _validated(_parse_number(str(vnd))), "ExchangeRate-API (thị trường, tham khảo)"


# (ten, ham) — thu tu uu tien. Test co the thay the.
SOURCES: list[tuple[str, Callable[[httpx.Client], tuple[Decimal, str]]]] = [
    ("vietcombank", fetch_vietcombank),
    ("exchangerate_api", fetch_exchangerate_api),
]


# ───────────────────────────── DB ─────────────────────────────

def _instance() -> str:
    instance = (settings.crm_instance or "").strip()
    if not instance:
        raise RuntimeError("CRM_INSTANCE is required for quote tenant scoping.")
    return instance


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _read_row() -> dict | None:
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(TABLE)
        .select("*")
        .eq("instance", _instance())
        .eq("base_currency", "USD")
        .eq("quote_currency", "VND")
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _to_payload(row: dict | None, *, refreshed: bool = False, error: str | None = None) -> dict[str, Any]:
    if not row:
        return {
            "rate": None, "source": None, "isManual": False, "updatedAt": None, "lastAttemptAt": None,
            "lastError": error, "stale": True, "note": None, "refreshed": refreshed, "error": error,
        }
    updated = _parse_dt(row.get("updated_at"))
    is_manual = bool(row.get("is_manual"))
    last_error = row.get("last_error")
    stale = bool(last_error) or (not is_manual and updated is not None and _now() - updated > STALE_AFTER)
    return {
        "rate": float(row["rate"]),
        "source": row.get("source") or row.get("note") or MANUAL_SOURCE,
        "isManual": is_manual,
        "updatedAt": row.get("updated_at"),
        "lastAttemptAt": row.get("last_attempt_at"),
        "lastError": last_error,
        "stale": stale,
        "note": row.get("note"),
        "refreshed": refreshed,
        "error": error or last_error,
    }


def _write_rate(rate: Decimal, source: str, *, is_manual: bool, actor_id: str | None, note: str | None) -> None:
    supabase: Client = get_supabase_client()
    now = _now().isoformat()
    payload: dict[str, Any] = {
        "instance": _instance(),
        "base_currency": "USD",
        "quote_currency": "VND",
        "rate": float(rate),
        "source": source,
        "is_manual": is_manual,
        "note": note,
        "updated_by": actor_id,
        "updated_at": now,
        "last_error": None,
    }
    if not is_manual:
        # Chi lan goi nguon NGOAI moi tinh la "attempt" (cooldown); nhap tay thi khong, de nut
        # "Cap nhat ty gia" ngay sau khi override van lay lai duoc che do tu dong.
        payload["last_attempt_at"] = now
    supabase.table(TABLE).upsert(payload, on_conflict="instance,base_currency,quote_currency").execute()
    try:
        supabase.table(HISTORY_TABLE).insert(
            {
                "instance": _instance(), "rate": float(rate), "source": source,
                "is_manual": is_manual, "note": note, "actor_id": actor_id,
            }
        ).execute()
    except Exception:  # lich su chi de audit — khong duoc lam hong viec luu rate
        logger.exception("quote_exchange_rate_history insert failed")


def _record_failure(row: dict | None, error: str) -> None:
    if not row:
        return
    supabase: Client = get_supabase_client()
    supabase.table(TABLE).update({"last_attempt_at": _now().isoformat(), "last_error": error[:500]}).eq(
        "instance", _instance()
    ).eq("base_currency", "USD").eq("quote_currency", "VND").execute()


# ───────────────────────────── API chinh ─────────────────────────────

def refresh_usd_vnd_rate(actor_id: str | None = None, *, force: bool = False) -> dict[str, Any]:
    """Lay ty gia tu nguon uy tin va luu. force=True (nut "Cap nhat ty gia"): ghi de ca override
    thu cong (quay lai che do tu dong), chi bi chan boi cooldown 60s. force=False (tu dong/luoi):
    khong dung toi rate nhap tay va ton trong cooldown 5 phut. Loi → giu rate cu (fallback)."""
    with _REFRESH_LOCK:
        row = _read_row()
        if row and row.get("is_manual") and not force:
            return _to_payload(row)
        last_attempt = _parse_dt(row.get("last_attempt_at")) if row else _MEM_LAST_ATTEMPT.get(_instance())
        cooldown = FORCE_COOLDOWN if force else LAZY_COOLDOWN
        if last_attempt and _now() - last_attempt < cooldown:
            # Vua goi gan day → dung ket qua da co (tranh spam nguon ngoai).
            payload = _to_payload(row, error=(row or {}).get("last_error") or _MEM_LAST_ERROR.get(_instance()))
            payload["cooldown"] = True
            return payload
        _MEM_LAST_ATTEMPT[_instance()] = _now()

        errors: list[str] = []
        with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True, headers={"User-Agent": "markee-crm/1.0"}) as client:
            for name, fetcher in SOURCES:
                try:
                    rate, source = fetcher(client)
                except RateSourceError as exc:
                    errors.append(str(exc))
                    logger.warning("exchange rate source %s failed: %s", name, exc)
                    continue
                except Exception as exc:  # nguon la: khong duoc lam sap luong bao gia
                    errors.append(f"{name}: {exc}")
                    logger.exception("exchange rate source %s crashed", name)
                    continue
                _write_rate(rate, source, is_manual=False, actor_id=actor_id, note=None)
                _MEM_LAST_ERROR.pop(_instance(), None)
                return _to_payload(_read_row(), refreshed=True)

        message = "Không lấy được tỷ giá tự động (" + "; ".join(errors) + ")."
        _MEM_LAST_ERROR[_instance()] = message
        _record_failure(row, message)
        return _to_payload(_read_row(), error=message)


def get_usd_vnd_rate(*, auto_refresh: bool = True) -> dict[str, Any]:
    """Ty gia he thong hien tai (+ nguon, thoi gian, trang thai). auto_refresh: neu rate tu dong da
    cu / chua co thi thu lam moi (loi → tra rate gan nhat, khong nem exception)."""
    row = _read_row()
    if auto_refresh:
        updated = _parse_dt(row.get("updated_at")) if row else None
        needs = row is None or (not row.get("is_manual") and (updated is None or _now() - updated > AUTO_REFRESH_AFTER))
        if needs:
            try:
                return refresh_usd_vnd_rate(None, force=False)
            except Exception:
                logger.exception("auto refresh of USD/VND rate failed")
    return _to_payload(row)


def default_usd_vnd_rate() -> float | None:
    """Rate mac dinh cho bao gia MOI (tu lam moi neu da cu). None = chua co → bat nhap tay."""
    return get_usd_vnd_rate().get("rate")


def set_usd_vnd_rate(rate: Any, actor_id: str | None, note: str | None = None) -> dict[str, Any]:
    """Override THU CONG cua Admin (source='Nhập tay', is_manual=true)."""
    fx = to_rate(rate)
    if fx is None:
        raise ValueError("Tỷ giá phải là số lớn hơn 0.")
    assert_plausible_usd_vnd_rate(fx)
    _write_rate(fx, MANUAL_SOURCE, is_manual=True, actor_id=actor_id, note=(note or None))
    return get_usd_vnd_rate(auto_refresh=False)
