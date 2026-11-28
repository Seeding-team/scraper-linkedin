"""Business-hours & SLA deadline calculator (UTC+7 without OS tzdata dependency).

CRITICAL:
- NEVER depend on IANA tzdata lookup — production Docker containers lack OS ``tzdata``.
- Always use ``VN_TZ = timezone(timedelta(hours=7))`` (or fixed-offset timezone helpers).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

# Fixed UTC+7 timezone (Vietnam Standard Time — no DST, zero OS tzdata dependency)
VN_TZ = timezone(timedelta(hours=7))

DEFAULT_WORK_DAYS: Tuple[int, ...] = (1, 2, 3, 4, 5, 6)  # ISO weekday: 1=Mon .. 7=Sun
DEFAULT_SHIFTS: List[Dict[str, str]] = [
    {"start": "08:00", "end": "12:00"},
    {"start": "13:30", "end": "17:30"},
]
MAX_BUSINESS_HOURS_SCAN_DAYS: int = 90

_UTC_OFFSET_RE = re.compile(r"^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$", re.IGNORECASE)
_HHMM_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def _resolve_timezone(tz_name: Optional[str]) -> timezone:
    """Resolve timezone string into a fixed-offset ``datetime.timezone`` (zero OS tzdata dependency)."""
    if not tz_name:
        return VN_TZ
    clean = str(tz_name).strip()
    lower = clean.lower()
    if lower in ("asia/ho_chi_minh", "asia/saigon", "ict", "vn", "vietnam", "utc+7", "+07:00", "+0700", "+7"):
        return VN_TZ
    if lower in ("utc", "gmt", "z", "utc+0", "+00:00", "0"):
        return timezone.utc
    match = _UTC_OFFSET_RE.match(clean)
    if match:
        sign = 1 if match.group(1) == "+" else -1
        hours = int(match.group(2))
        minutes = int(match.group(3) or 0)
        if 0 <= hours <= 14 and 0 <= minutes < 60:
            return timezone(timedelta(hours=sign * hours, minutes=sign * minutes))
    return VN_TZ


def parse_iso_dt(value: Any) -> Optional[datetime]:
    """Parse ISO-8601 string, ``datetime``, or epoch timestamp (s/ms) into aware UTC ``datetime``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        try:
            num = float(value)
            if num <= 0:
                return None
            # Epoch milliseconds vs seconds
            if num > 1e11:
                num = num / 1000.0
            return datetime.fromtimestamp(num, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None

    text = str(value).strip()
    if not text:
        return None

    # Numeric string epoch fallback
    if text.isdigit():
        try:
            num = float(text)
            if num > 1e11:
                num = num / 1000.0
            return datetime.fromtimestamp(num, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None

    try:
        if text.endswith("Z") or text.endswith("z"):
            text = text[:-1] + "+00:00"
        # Handle space separator and Postgres "+00" short offset
        if re.search(r"[+-]\d{2}$", text):
            text = text + ":00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _parse_hhmm_to_seconds(value: Any) -> Optional[int]:
    """Convert ``'HH:MM'`` (supports ``'00:00'`` through ``'24:00'``) into seconds since midnight."""
    if not value:
        return None
    match = _HHMM_RE.match(str(value).strip())
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour == 24 and minute == 0:
        return 86400
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour * 3600 + minute * 60
    return None


def _normalize_work_days(work_days: Any) -> Set[int]:
    """Normalize ISO work days (1=Mon..7=Sun) into a non-empty set."""
    result: Set[int] = set()
    if isinstance(work_days, Iterable) and not isinstance(work_days, (str, bytes)):
        for item in work_days:
            try:
                day_num = int(item)
                if 1 <= day_num <= 7:
                    result.add(day_num)
            except (TypeError, ValueError):
                continue
    return result or set(DEFAULT_WORK_DAYS)


def _normalize_shifts(shifts: Any) -> List[Tuple[int, int]]:
    """Parse, sort, and merge overlapping shift intervals into seconds-since-midnight tuples."""
    raw_intervals: List[Tuple[int, int]] = []
    if isinstance(shifts, list):
        for entry in shifts:
            if isinstance(entry, dict):
                s_val = entry.get("start")
                e_val = entry.get("end")
            else:
                s_val = getattr(entry, "start", None)
                e_val = getattr(entry, "end", None)
            s_sec = _parse_hhmm_to_seconds(s_val)
            e_sec = _parse_hhmm_to_seconds(e_val)
            if s_sec is not None and e_sec is not None and 0 <= s_sec < e_sec <= 86400:
                raw_intervals.append((s_sec, e_sec))

    if not raw_intervals:
        raw_intervals = [
            (_parse_hhmm_to_seconds(s["start"]) or 0, _parse_hhmm_to_seconds(s["end"]) or 0)
            for s in DEFAULT_SHIFTS
        ]

    raw_intervals.sort(key=lambda pair: (pair[0], pair[1]))
    merged: List[Tuple[int, int]] = []
    for s_sec, e_sec in raw_intervals:
        if not merged or s_sec > merged[-1][1]:
            merged.append((s_sec, e_sec))
        else:
            prev_s, prev_e = merged[-1]
            merged[-1] = (prev_s, max(prev_e, e_sec))
    return merged


def _ensure_utc_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return parse_iso_dt(value)


def is_within_business_hours(dt: datetime, config: Optional[Dict[str, Any]] = None) -> bool:
    """Return True if ``dt`` falls inside configured business hours (or if business hours disabled)."""
    utc_dt = _ensure_utc_dt(dt)
    if utc_dt is None:
        return False

    cfg = config or {}
    if not bool(cfg.get("business_hours_enabled", True)):
        return True

    tz = _resolve_timezone(cfg.get("timezone"))
    work_days = _normalize_work_days(cfg.get("work_days"))
    shifts = _normalize_shifts(cfg.get("shifts"))

    local_dt = utc_dt.astimezone(tz)
    if local_dt.isoweekday() not in work_days:
        return False

    sec_of_day = local_dt.hour * 3600 + local_dt.minute * 60 + local_dt.second + (local_dt.microsecond / 1_000_000.0)
    for start_sec, end_sec in shifts:
        if start_sec <= sec_of_day < end_sec:
            return True
    return False


def calculate_business_seconds(
    start_dt: datetime,
    end_dt: datetime,
    config: Optional[Dict[str, Any]] = None,
) -> int:
    """Calculate elapsed business seconds between ``start_dt`` and ``end_dt``.

    - If ``business_hours_enabled`` is ``False``, returns ``max(0, int((end_dt - start_dt).total_seconds()))``.
    - If ``business_hours_enabled`` is ``True``, sums exact intersection of ``[start_dt, end_dt]``
      with configured ISO ``work_days`` (1=Mon..7=Sun) and ``shifts``, capped at 90 calendar days.
    """
    s_utc = _ensure_utc_dt(start_dt)
    e_utc = _ensure_utc_dt(end_dt)
    if s_utc is None or e_utc is None or e_utc <= s_utc:
        return 0

    cfg = config or {}
    if not bool(cfg.get("business_hours_enabled", True)):
        return max(0, int((e_utc - s_utc).total_seconds()))

    tz = _resolve_timezone(cfg.get("timezone"))
    work_days = _normalize_work_days(cfg.get("work_days"))
    shifts = _normalize_shifts(cfg.get("shifts"))

    start_local = s_utc.astimezone(tz)
    end_local = e_utc.astimezone(tz)

    # Safety cap: never scan more than MAX_BUSINESS_HOURS_SCAN_DAYS (90) calendar days
    cap_end_date = start_local.date() + timedelta(days=MAX_BUSINESS_HOURS_SCAN_DAYS)
    cap_dt = datetime(cap_end_date.year, cap_end_date.month, cap_end_date.day, tzinfo=tz)
    effective_end = min(end_local, cap_dt)
    if effective_end <= start_local:
        return 0

    total_td = timedelta(0)
    current_date = start_local.date()
    last_date = effective_end.date()

    while current_date <= last_date:
        if current_date.isoweekday() in work_days:
            day_midnight = datetime(current_date.year, current_date.month, current_date.day, tzinfo=tz)
            for s_sec, e_sec in shifts:
                shift_start = day_midnight + timedelta(seconds=s_sec)
                shift_end = day_midnight + timedelta(seconds=e_sec)
                ov_start = max(start_local, shift_start)
                ov_end = min(effective_end, shift_end)
                if ov_end > ov_start:
                    total_td += ov_end - ov_start
        current_date += timedelta(days=1)

    return max(0, int(total_td.total_seconds()))


def add_business_seconds(
    start_dt: datetime,
    seconds: int,
    config: Optional[Dict[str, Any]] = None,
) -> datetime:
    """Compute exact SLA deadline UTC ``datetime`` by adding ``seconds`` of business time to ``start_dt``."""
    s_utc = _ensure_utc_dt(start_dt)
    if s_utc is None:
        s_utc = datetime.now(timezone.utc)

    secs = int(seconds or 0)
    if secs <= 0:
        return s_utc

    cfg = config or {}
    if not bool(cfg.get("business_hours_enabled", True)):
        return (s_utc + timedelta(seconds=secs)).astimezone(timezone.utc)

    tz = _resolve_timezone(cfg.get("timezone"))
    work_days = _normalize_work_days(cfg.get("work_days"))
    shifts = _normalize_shifts(cfg.get("shifts"))

    remaining = timedelta(seconds=secs)
    cursor = s_utc.astimezone(tz)
    base_date = cursor.date()

    # Safety bound: up to MAX_BUSINESS_HOURS_SCAN_DAYS (90) calendar days
    for day_offset in range(MAX_BUSINESS_HOURS_SCAN_DAYS + 1):
        current_date = base_date + timedelta(days=day_offset)
        if current_date.isoweekday() not in work_days:
            continue
        day_midnight = datetime(current_date.year, current_date.month, current_date.day, tzinfo=tz)
        for s_sec, e_sec in shifts:
            shift_start = day_midnight + timedelta(seconds=s_sec)
            shift_end = day_midnight + timedelta(seconds=e_sec)
            if shift_end <= cursor:
                continue
            effective_start = max(cursor, shift_start)
            available = shift_end - effective_start
            if remaining <= available:
                return (effective_start + remaining).astimezone(timezone.utc)
            remaining -= available
            cursor = shift_end

    # Safety fallback if target exceeds 90 calendar days of shifts
    return (cursor + remaining).astimezone(timezone.utc)
