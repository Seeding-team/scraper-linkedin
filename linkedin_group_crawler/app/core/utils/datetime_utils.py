"""Date and time utility helpers."""

from __future__ import annotations

from datetime import date, datetime, timedelta
import re


def normalize_relative_time(raw: str, crawl_time: datetime) -> datetime | None:
    """Convert LinkedIn relative time like 5m, 2h, 1d into an absolute datetime."""

    if not raw:
        return None

    text = raw.strip().lower()
    match = re.search(r"(\d+)\s*([mhd])", text)
    if not match:
        return None

    value = int(match.group(1))
    unit = match.group(2)

    if unit == "m":
        return crawl_time - timedelta(minutes=value)
    if unit == "h":
        return crawl_time - timedelta(hours=value)
    if unit == "d":
        return crawl_time - timedelta(days=value)
    return None


def parse_target_date(target_date: str | None, crawl_time: datetime) -> date:
    """Parse target date or fallback to crawl date."""

    if not target_date:
        return crawl_time.date()
    return datetime.strptime(target_date, "%Y-%m-%d").date()


def is_same_day(dt: datetime, target_date: date) -> bool:
    """Check whether datetime belongs to the target date."""

    return dt.date() == target_date


def extract_linkedin_post_time(post_url: str | None) -> datetime | None:
    """Extract creation time from LinkedIn activity/share snowflake ID (activity_id >> 22)."""
    if not post_url:
        return None
    m = re.search(r'activity:(\d+)', post_url) or re.search(r'share:(\d+)', post_url) or re.search(r'-(\d{18,20})-', post_url)
    if not m:
        m = re.search(r'activity-(\d+)', post_url)
    if m:
        try:
            act_id = int(m.group(1))
            ts_ms = act_id >> 22
            # Sanity check: between 2005 and 2035
            if 1104537600000 <= ts_ms <= 2051222400000:
                from datetime import timezone
                return datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc)
        except Exception:
            pass
    return None
