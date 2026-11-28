"""SLA Watchdog Background Worker — checks live waiting turns every 15 seconds.

Runs inside ``app/main.py`` lifespan via ``_tick_loop`` (gated by
``DISABLE_SLA_ALERT_WORKER``, default ``"0"`` = enabled).

For every waiting turn:
1. Calculates elapsed business seconds via ``business_hours.calculate_business_seconds``.
2. If ``biz_secs >= target_seconds`` and ``breach_notified_at IS NULL``:
   marks ``breach_notified_at`` first (idempotent guard) then dispatches
   ``sla_breach`` to the Node.js Persistent Alert Forward Engine.
3. Else if ``biz_secs >= target_seconds * warning_pct / 100`` and
   ``warning_notified_at IS NULL``:
   marks ``warning_notified_at`` first then dispatches ``sla_warning``.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict

from loguru import logger

from app.modules.all_platform.sla_alerts.business_hours import (
    calculate_business_seconds,
    parse_iso_dt,
)
from app.modules.all_platform.sla_alerts.js_alert_engine_bridge import (
    shutdown_js_alert_engine,
)
from app.modules.all_platform.sla_alerts.sla_tracker_service import (
    list_waiting_turns_for_watchdog,
    mark_turn_notified,
    resolve_effective_sla_config,
)
from app.modules.all_platform.sla_alerts.zalo_group_alert_service import (
    dispatch_sla_alert,
)


async def run_sla_alert_tick() -> Dict[str, int]:
    """Single watchdog sweep over all active ``waiting`` SLA turns."""
    summary = {"checked": 0, "warnings": 0, "breaches": 0, "errors": 0}
    try:
        turns = await asyncio.to_thread(list_waiting_turns_for_watchdog)
    except Exception as exc:
        logger.warning(f"[sla-alert-worker] failed loading waiting turns: {exc}")
        return summary

    if not turns:
        return summary

    now_utc = datetime.now(timezone.utc)

    for turn in turns:
        summary["checked"] += 1
        try:
            turn_id = str(turn.get("id") or "").strip()
            if not turn_id:
                continue

            cust_dt = parse_iso_dt(turn.get("customer_msg_at"))
            if cust_dt is None:
                continue

            channel = str(turn.get("channel") or "zalo").strip().lower()
            account_id = str(turn.get("account_id") or "").strip()
            cfg = await asyncio.to_thread(resolve_effective_sla_config, channel, account_id)

            biz_secs = calculate_business_seconds(cust_dt, now_utc, cfg)
            target_seconds = int(turn.get("target_seconds") or int(cfg.get("target_minutes") or 5) * 60)
            target_seconds = max(1, target_seconds)
            warning_pct = int(cfg.get("warning_pct") or 70)
            warning_threshold = (target_seconds * warning_pct) / 100.0

            if biz_secs >= target_seconds and not turn.get("breach_notified_at"):
                marked = await asyncio.to_thread(mark_turn_notified, turn_id, "breach")
                if marked is False:
                    continue
                await dispatch_sla_alert("sla_breach", turn, wait_business_seconds=biz_secs)
                summary["breaches"] += 1
            elif biz_secs >= warning_threshold and not turn.get("warning_notified_at"):
                marked = await asyncio.to_thread(mark_turn_notified, turn_id, "warning")
                if marked is False:
                    continue
                await dispatch_sla_alert("sla_warning", turn, wait_business_seconds=biz_secs)
                summary["warnings"] += 1
        except Exception as exc:
            summary["errors"] += 1
            logger.warning(
                f"[sla-alert-worker] error evaluating turn={turn.get('id')}: {exc}"
            )

    return summary


async def shutdown_sla_alert_worker() -> None:
    """Gracefully flush and shut down the persistent Node.js Alert Forward Engine."""
    try:
        await shutdown_js_alert_engine()
    except Exception as exc:
        logger.warning(f"[sla-alert-worker] shutdown error: {exc}")
