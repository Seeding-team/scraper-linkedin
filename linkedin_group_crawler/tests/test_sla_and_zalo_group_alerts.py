"""Comprehensive Pytest suite for Omnichannel Inbox SLA Monitor & Zalo Group Alert Forward Engine.

Covers:
1. business_hours.py: zero-ZoneInfo check, parse_iso_dt, shift/lunch/overnight/Sunday/24x7/90-day-cap,
   and exact add_business_seconds <-> calculate_business_seconds roundtrip.
2. sla_tracker_service.py: config hierarchy & cache invalidation, on_inbound_message (open/burst/ignore
   system/group/bot/23505-race/42P01-fail-soft), on_staff_reply (met/breached/overnight/ignore-bot/no-waiting),
   dismiss_sla_turn, dashboard KPIs, list_sla_turns (waiting_breached & search), live badges,
   atomic mark_turn_notified, and 4-channel idempotent backfill (with real zalo_accounts.label schema).
3. zalo_group_alert_service.py & sla_alert_worker.py: Anti-Loop Guard, config_matches_event routing,
   epoch-ms received_at ISO normalization, _lookup_zalo_account_name schema check, dispatch_inbound_alert,
   dispatch_sla_alert, send_test_alert, and watchdog tick deduplication.
4. router.py: all 14 REST endpoints, RBAC enforcement (403 for member, 200 for admin/leader),
   and route ordering (/forward-configs/zalo-groups not shadowed by /{config_id}).
"""

from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.auth_deps import (
    get_authenticated_caller_email,
    get_current_user,
    require_admin_or_leader,
)
from app.modules.all_platform.sla_alerts import business_hours as bh
from app.modules.all_platform.sla_alerts import router as sla_router_mod
from app.modules.all_platform.sla_alerts import sla_alert_worker
from app.modules.all_platform.sla_alerts import sla_tracker_service as sla_svc
from app.modules.all_platform.sla_alerts import zalo_group_alert_service as alert_svc
from app.modules.all_platform.sla_alerts.schemas import (
    AlertForwardConfigCreate,
    AlertForwardConfigUpdate,
    SlaConfigPayload,
)

VN_TZ = bh.VN_TZ


# ── In-Memory Stateful Fake Supabase Client ──────────────────────────────────

class _FakeResponse:
    def __init__(self, data: Any, count: Optional[int] = None) -> None:
        self.data = data
        self.count = count


class _FakeTableQuery:
    def __init__(self, db: "_FakeSupabase", table_name: str) -> None:
        self._db = db
        self._table = table_name
        self._op = "select"
        self._select_cols = "*"
        self._count_mode: Optional[str] = None
        self._payload: Any = None
        self._on_conflict: Optional[str] = None
        self._filters: List[Any] = []
        self._orders: List[tuple[str, bool]] = []
        self._limit: Optional[int] = None
        self._range: Optional[tuple[int, int]] = None

    def select(self, cols: str = "*", count: Optional[str] = None):
        self._op = "select"
        self._select_cols = cols
        self._count_mode = count
        return self

    def insert(self, payload: Any):
        self._op = "insert"
        self._payload = payload
        return self

    def upsert(self, payload: Any, on_conflict: Optional[str] = None):
        self._op = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def update(self, payload: Dict[str, Any]):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col: str, val: Any):
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col: str, val: Any):
        self._filters.append(("neq", col, val))
        return self

    def gte(self, col: str, val: Any):
        self._filters.append(("gte", col, val))
        return self

    def lt(self, col: str, val: Any):
        self._filters.append(("lt", col, val))
        return self

    def in_(self, col: str, vals: List[Any]):
        self._filters.append(("in", col, list(vals)))
        return self

    def is_(self, col: str, val: Any):
        self._filters.append(("is", col, val))
        return self

    def ilike(self, col: str, pattern: str):
        self._filters.append(("ilike", col, pattern))
        return self

    def or_(self, expr: str):
        self._filters.append(("or", expr, None))
        return self

    def order(self, col: str, desc: bool = False):
        self._orders.append((col, desc))
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def range(self, start: int, end: int):
        self._range = (start, end)
        return self

    def _matches(self, row: Dict[str, Any]) -> bool:
        for op, col, val in self._filters:
            if op == "eq":
                if row.get(col) != val:
                    return False
            elif op == "neq":
                if row.get(col) == val:
                    return False
            elif op == "gte":
                rv = row.get(col)
                if rv is None or str(rv) < str(val):
                    return False
            elif op == "lt":
                rv = row.get(col)
                if rv is None or str(rv) >= str(val):
                    return False
            elif op == "in":
                if row.get(col) not in val:
                    return False
            elif op == "is":
                if str(val).lower() == "null":
                    if row.get(col) is not None:
                        return False
                elif str(val).lower() == "not.null":
                    if row.get(col) is None:
                        return False
            elif op == "ilike":
                needle = str(val).strip("%").lower()
                if needle not in str(row.get(col) or "").lower():
                    return False
            elif op == "or":
                clauses = [c.strip() for c in str(col).split(",") if c.strip()]
                matched_any = False
                for clause in clauses:
                    parts = clause.split(".")
                    if len(parts) >= 3 and parts[1] == "ilike":
                        field = parts[0]
                        needle = ".".join(parts[2:]).strip("%").lower()
                        if needle in str(row.get(field) or "").lower():
                            matched_any = True
                            break
                if not matched_any:
                    return False
        return True

    def execute(self) -> _FakeResponse:
        if self._table in self._db.missing_tables:
            raise RuntimeError(f'relation "public.{self._table}" does not exist (42P01)')

        # Enforce real column check when registered (catches 42703 column typos!)
        if self._op == "select" and self._table in self._db.strict_columns and self._select_cols != "*":
            allowed = self._db.strict_columns[self._table]
            requested = [c.strip() for c in self._select_cols.split(",") if c.strip()]
            for col in requested:
                if col not in allowed:
                    raise RuntimeError(f'42703: column {self._table}.{col} does not exist')

        rows = self._db.tables.setdefault(self._table, [])

        if self._op == "insert":
            if self._table == "inbox_sla_turns" and self._db.fail_next_turn_insert_23505:
                self._db.fail_next_turn_insert_23505 = False
                raise RuntimeError("23505 duplicate key value violates unique constraint uq_inbox_sla_turns_active")

            items = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for item in items:
                copy = dict(item)
                copy.setdefault("id", str(uuid.uuid4()))
                if self._table == "inbox_sla_turns" and copy.get("status") == "waiting":
                    # Enforce uq_inbox_sla_turns_active partial unique index
                    for existing in rows:
                        if (
                            existing.get("status") == "waiting"
                            and existing.get("channel") == copy.get("channel")
                            and existing.get("account_id") == copy.get("account_id")
                            and existing.get("conversation_id") == copy.get("conversation_id")
                        ):
                            raise RuntimeError("23505 duplicate key uq_inbox_sla_turns_active")
                rows.append(copy)
                inserted.append(dict(copy))
            return _FakeResponse(inserted)

        if self._op == "upsert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            conflict_col = self._on_conflict or "id"
            saved = []
            for item in items:
                copy = dict(item)
                match_idx = next(
                    (i for i, r in enumerate(rows) if r.get(conflict_col) == copy.get(conflict_col)),
                    None,
                )
                if match_idx is not None:
                    merged = {**rows[match_idx], **copy}
                    rows[match_idx] = merged
                    saved.append(dict(merged))
                else:
                    copy.setdefault("id", str(uuid.uuid4()))
                    rows.append(copy)
                    saved.append(dict(copy))
            return _FakeResponse(saved)

        if self._op == "update":
            updated = []
            for r in rows:
                if self._matches(r):
                    r.update(self._payload)
                    updated.append(dict(r))
            return _FakeResponse(updated)

        if self._op == "delete":
            kept = []
            deleted = []
            for r in rows:
                if self._matches(r):
                    deleted.append(dict(r))
                else:
                    kept.append(r)
            self._db.tables[self._table] = kept
            return _FakeResponse(deleted)

        # SELECT
        matched = [dict(r) for r in rows if self._matches(r)]
        for col, desc in reversed(self._orders):
            matched.sort(key=lambda r: (r.get(col) is None, str(r.get(col) or "")), reverse=desc)
        total_count = len(matched) if self._count_mode == "exact" else None
        if self._range is not None:
            start, end = self._range
            matched = matched[start : end + 1]
        if self._limit is not None:
            matched = matched[: self._limit]
        return _FakeResponse(matched, count=total_count)


class _FakeSupabase:
    def __init__(self) -> None:
        self.tables: Dict[str, List[Dict[str, Any]]] = {
            "inbox_sla_configs": [
                {
                    "id": str(uuid.uuid4()),
                    "scope_key": "global",
                    "target_minutes": 5,
                    "warning_pct": 70,
                    "business_hours_enabled": True,
                    "timezone": "Asia/Ho_Chi_Minh",
                    "work_days": [1, 2, 3, 4, 5, 6],
                    "shifts": [
                        {"start": "08:00", "end": "12:00"},
                        {"start": "13:30", "end": "17:30"},
                    ],
                    "include_group_chats": False,
                    "exclude_bot_replies": True,
                }
            ],
            "inbox_sla_turns": [],
            "inbox_alert_forward_configs": [],
            "inbox_alert_forward_logs": [],
            "app_users": [
                {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "email": "sale@markee.vn",
                    "name": "Trần Thu Hà",
                    "role": "member",
                },
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "email": "admin@markee.vn",
                    "name": "Admin Markee",
                    "role": "admin",
                },
            ],
            "zalo_accounts": [
                {
                    "account_id": "zl_acc_1",
                    "label": "Zalo Sale 01",
                    "phone": "0901112222",
                    "owner_name": "Hà",
                }
            ],
            "zalo_groups": [
                {
                    "user_id": "zl_acc_1",
                    "group_id": "grp_cskh_shared",
                    "group_name": "Nhóm CSKH Chung",
                    "avatar_url": None,
                    "thread_type": "group",
                    "is_friend": False,
                    "last_message_at": "2026-11-28T02:00:00+00:00",
                },
                {
                    "user_id": "zl_acc_1",
                    "group_id": "cust_dm_1",
                    "group_name": "Anh Minh",
                    "avatar_url": None,
                    "thread_type": "user",
                    "is_friend": True,
                    "last_message_at": "2026-11-28T02:10:00+00:00",
                },
            ],
        }
        self.missing_tables: set[str] = set()
        self.fail_next_turn_insert_23505: bool = False
        # Strict schema enforcement on zalo_accounts (catches nonexistent display_name / account_name / name!)
        self.strict_columns: Dict[str, set[str]] = {
            "zalo_accounts": {
                "account_id",
                "owner_id",
                "label",
                "phone",
                "zalo_id",
                "avatar_url",
                "status",
                "is_active",
                "id_member",
                "is_shared_with_all",
                "owner_name",
                "last_seen_at",
                "updated_at",
            },
        }

    def table(self, name: str) -> _FakeTableQuery:
        return _FakeTableQuery(self, name)


# ── 1. business_hours.py Tests ───────────────────────────────────────────────

class TestBusinessHours:
    def test_no_zoneinfo_dependency(self):
        src = inspect.getsource(bh)
        assert "ZoneInfo" not in src
        assert "zoneinfo" not in src
        assert bh.VN_TZ == timezone(timedelta(hours=7))

    def test_parse_iso_dt_variants(self):
        dt_z = bh.parse_iso_dt("2026-11-28T01:30:00Z")
        assert dt_z == datetime(2026, 11, 28, 1, 30, tzinfo=timezone.utc)

        dt_vn = bh.parse_iso_dt("2026-11-28T08:30:00+07:00")
        assert dt_vn == dt_z

        dt_epoch_ms = bh.parse_iso_dt(int(dt_z.timestamp() * 1000))
        assert dt_epoch_ms == dt_z

        dt_epoch_s = bh.parse_iso_dt(int(dt_z.timestamp()))
        assert dt_epoch_s == dt_z

        dt_num_str = bh.parse_iso_dt(str(int(dt_z.timestamp() * 1000)))
        assert dt_num_str == dt_z

        assert bh.parse_iso_dt("not-a-date") is None
        assert bh.parse_iso_dt(None) is None

    def test_is_within_business_hours_boundaries(self):
        cfg = {
            "business_hours_enabled": True,
            "timezone": "Asia/Ho_Chi_Minh",
            "work_days": [1, 2, 3, 4, 5, 6],
            "shifts": [{"start": "08:00", "end": "12:00"}, {"start": "13:30", "end": "17:30"}],
        }
        # Monday 2026-11-23
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 8, 0, tzinfo=VN_TZ), cfg) is True
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 11, 59, 59, tzinfo=VN_TZ), cfg) is True
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 12, 0, tzinfo=VN_TZ), cfg) is False
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 12, 45, tzinfo=VN_TZ), cfg) is False
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 13, 30, tzinfo=VN_TZ), cfg) is True
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 17, 30, tzinfo=VN_TZ), cfg) is False
        assert bh.is_within_business_hours(datetime(2026, 11, 23, 22, 0, tzinfo=VN_TZ), cfg) is False

        # Sunday 2026-11-29 (ISO weekday 7)
        assert bh.is_within_business_hours(datetime(2026, 11, 29, 10, 0, tzinfo=VN_TZ), cfg) is False

        # 24x7 mode
        cfg_247 = {**cfg, "business_hours_enabled": False}
        assert bh.is_within_business_hours(datetime(2026, 11, 29, 3, 0, tzinfo=VN_TZ), cfg_247) is True

    def test_calculate_business_seconds_all_edge_cases(self):
        cfg = {
            "business_hours_enabled": True,
            "timezone": "Asia/Ho_Chi_Minh",
            "work_days": [1, 2, 3, 4, 5, 6],
            "shifts": [{"start": "08:00", "end": "12:00"}, {"start": "13:30", "end": "17:30"}],
        }
        # 1. Within single shift: Mon 09:00 -> 09:04 = 240s
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 23, 9, 0, tzinfo=VN_TZ),
            datetime(2026, 11, 23, 9, 4, tzinfo=VN_TZ),
            cfg,
        ) == 240

        # 2. Across lunch break: Mon 11:55 -> 13:35 = 5m + 5m = 600s
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 23, 11, 55, tzinfo=VN_TZ),
            datetime(2026, 11, 23, 13, 35, tzinfo=VN_TZ),
            cfg,
        ) == 600

        # 3. Overnight: Mon 17:28 -> Tue 08:03 = 2m + 3m = 300s
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 23, 17, 28, tzinfo=VN_TZ),
            datetime(2026, 11, 24, 8, 3, tzinfo=VN_TZ),
            cfg,
        ) == 300

        # 4. Across Sunday: Sat 2026-11-28 17:25 -> Mon 2026-11-30 08:05 = 5m + 5m = 600s
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 28, 17, 25, tzinfo=VN_TZ),
            datetime(2026, 11, 30, 8, 5, tzinfo=VN_TZ),
            cfg,
        ) == 600

        # 5. Pure Sunday range -> 0s
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 29, 9, 0, tzinfo=VN_TZ),
            datetime(2026, 11, 29, 17, 0, tzinfo=VN_TZ),
            cfg,
        ) == 0

        # 6. 24x7 mode ignores shifts/Sunday
        cfg_247 = {**cfg, "business_hours_enabled": False}
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 28, 17, 25, tzinfo=VN_TZ),
            datetime(2026, 11, 30, 8, 5, tzinfo=VN_TZ),
            cfg_247,
        ) == int((datetime(2026, 11, 30, 8, 5, tzinfo=VN_TZ) - datetime(2026, 11, 28, 17, 25, tzinfo=VN_TZ)).total_seconds())

        # 7. Reverse range -> 0s
        assert bh.calculate_business_seconds(
            datetime(2026, 11, 23, 10, 0, tzinfo=VN_TZ),
            datetime(2026, 11, 23, 9, 0, tzinfo=VN_TZ),
            cfg,
        ) == 0

        # 8. 90-day safety cap prevents unbounded loop
        secs_1y = bh.calculate_business_seconds(
            datetime(2026, 1, 1, 8, 0, tzinfo=VN_TZ),
            datetime(2027, 1, 1, 8, 0, tzinfo=VN_TZ),
            cfg,
        )
        assert 0 < secs_1y <= 90 * 8 * 3600

    def test_add_business_seconds_and_roundtrip(self):
        cfg = {
            "business_hours_enabled": True,
            "timezone": "Asia/Ho_Chi_Minh",
            "work_days": [1, 2, 3, 4, 5, 6],
            "shifts": [{"start": "08:00", "end": "12:00"}, {"start": "13:30", "end": "17:30"}],
        }
        # Across lunch: Mon 11:58 + 300s -> Mon 13:33 VN
        d_lunch = bh.add_business_seconds(datetime(2026, 11, 23, 11, 58, tzinfo=VN_TZ), 300, cfg)
        assert d_lunch.astimezone(VN_TZ) == datetime(2026, 11, 23, 13, 33, tzinfo=VN_TZ)
        assert bh.calculate_business_seconds(datetime(2026, 11, 23, 11, 58, tzinfo=VN_TZ), d_lunch, cfg) == 300

        # Overnight: Mon 17:28 + 300s -> Tue 08:03 VN
        d_night = bh.add_business_seconds(datetime(2026, 11, 23, 17, 28, tzinfo=VN_TZ), 300, cfg)
        assert d_night.astimezone(VN_TZ) == datetime(2026, 11, 24, 8, 3, tzinfo=VN_TZ)
        assert bh.calculate_business_seconds(datetime(2026, 11, 23, 17, 28, tzinfo=VN_TZ), d_night, cfg) == 300

        # Sunday start: Sun 14:00 + 300s -> Mon 08:05 VN
        d_sun = bh.add_business_seconds(datetime(2026, 11, 29, 14, 0, tzinfo=VN_TZ), 300, cfg)
        assert d_sun.astimezone(VN_TZ) == datetime(2026, 11, 30, 8, 5, tzinfo=VN_TZ)
        assert bh.calculate_business_seconds(datetime(2026, 11, 29, 14, 0, tzinfo=VN_TZ), d_sun, cfg) == 300

        # 24x7 mode: Sun 14:00 + 300s -> Sun 14:05 VN
        d_247 = bh.add_business_seconds(
            datetime(2026, 11, 29, 14, 0, tzinfo=VN_TZ),
            300,
            {**cfg, "business_hours_enabled": False},
        )
        assert d_247.astimezone(VN_TZ) == datetime(2026, 11, 29, 14, 5, tzinfo=VN_TZ)


# ── 2. sla_tracker_service.py Tests ──────────────────────────────────────────

class TestSlaTrackerService:
    def test_config_hierarchy_and_upsert(self):
        db = _FakeSupabase()
        sla_svc.invalidate_sla_config_cache()

        # Global default = 5m
        assert sla_svc.resolve_effective_sla_config("zalo", "acc_vip", supabase=db)["target_minutes"] == 5

        # Add channel override = 10m
        sla_svc.upsert_sla_config(
            SlaConfigPayload(scope_key="channel:zalo", target_minutes=10, warning_pct=80),
            updated_by_email="admin@markee.vn",
            supabase=db,
        )
        assert sla_svc.resolve_effective_sla_config("zalo", "acc_vip", supabase=db)["target_minutes"] == 10
        assert sla_svc.resolve_effective_sla_config("telegram", "tg_1", supabase=db)["target_minutes"] == 5

        # Add account override = 2m
        sla_svc.upsert_sla_config(
            SlaConfigPayload(scope_key="account:zalo:acc_vip", target_minutes=2, warning_pct=50),
            updated_by_email="admin@markee.vn",
            supabase=db,
        )
        assert sla_svc.resolve_effective_sla_config("zalo", "acc_vip", supabase=db)["target_minutes"] == 2
        assert sla_svc.resolve_effective_sla_config("zalo", "acc_other", supabase=db)["target_minutes"] == 10

        bundle = sla_svc.get_sla_configs(supabase=db)
        assert bundle["global"]["scope_key"] == "global"
        assert len(bundle["overrides"]) == 2

    def test_turn_lifecycle_burst_met_breached_bot_and_dismiss(self):
        db = _FakeSupabase()

        # 1. Customer sends message at Mon 17:28 VN -> opens first turn (deadline Tue 08:03 VN)
        t1_dt = datetime(2026, 11, 23, 17, 28, tzinfo=VN_TZ)
        r1 = sla_svc.on_inbound_message(
            "zalo",
            "zl_acc_1",
            "cust_dm_1",
            account_name="Zalo Sale 01",
            customer_name="Anh Minh",
            customer_phone="0909888777",
            content="Shop ơi tư vấn gói doanh nghiệp",
            received_at=t1_dt,
            supabase=db,
        )
        assert r1["status"] == "opened"
        assert r1["opened_new_turn"] is True
        turn1 = r1["turn"]
        assert turn1["is_first_turn"] is True
        assert turn1["unanswered_msg_count"] == 1
        assert turn1["open_url"] == "/all-platform/zalo-inbox?account=zl_acc_1&conversation=cust_dm_1"
        assert bh.parse_iso_dt(turn1["deadline_at"]).astimezone(VN_TZ) == datetime(2026, 11, 24, 8, 3, tzinfo=VN_TZ)

        # 2. Customer sends burst follow-ups -> coalesced into same waiting turn, customer_msg_at unchanged
        r2 = sla_svc.on_inbound_message(
            "zalo",
            "zl_acc_1",
            "cust_dm_1",
            content="Cho mình bảng giá mới nhất nhé",
            received_at=datetime(2026, 11, 23, 17, 29, tzinfo=VN_TZ),
            supabase=db,
        )
        assert r2["status"] == "updated_waiting"
        assert r2["opened_new_turn"] is False
        assert r2["turn"]["unanswered_msg_count"] == 2
        assert r2["turn"]["first_msg_preview"] == "Shop ơi tư vấn gói doanh nghiệp"
        assert r2["turn"]["last_msg_preview"] == "Cho mình bảng giá mới nhất nhé"

        # 3. Ignored events: system_notice, group chat (include_group_chats=False), inbound bot
        assert sla_svc.on_inbound_message("zalo", "zl_acc_1", "c_sys", msg_kind="system_notice", supabase=db)["status"] == "ignored_msg_kind"
        assert sla_svc.on_inbound_message("zalo", "zl_acc_1", "grp_1", thread_type="group", supabase=db)["status"] == "ignored_group"
        assert sla_svc.on_inbound_message("zalo", "zl_acc_1", "c_bot", is_bot=True, supabase=db)["status"] == "ignored_bot"

        # 4. Bot auto-reply does NOT close waiting turn (exclude_bot_replies=True)
        bot_reply = sla_svc.on_staff_reply(
            "zalo",
            "zl_acc_1",
            "cust_dm_1",
            is_bot=True,
            replied_at=datetime(2026, 11, 23, 17, 29, 30, tzinfo=VN_TZ),
            supabase=db,
        )
        assert bot_reply["status"] == "ignored_bot"

        # 5. Human staff replies next morning at Tue 08:02 VN -> biz_secs = 2m + 2m = 240s <= 300s -> MET!
        met_reply = sla_svc.on_staff_reply(
            "zalo",
            "zl_acc_1",
            "cust_dm_1",
            caller_email="sale@markee.vn",
            replied_at=datetime(2026, 11, 24, 8, 2, tzinfo=VN_TZ),
            supabase=db,
        )
        assert met_reply["status"] == "met"
        assert met_reply["turn"]["business_response_seconds"] == 240
        assert met_reply["turn"]["responded_by_name"] == "Trần Thu Hà"
        assert met_reply["turn"]["responded_by_user_id"] == "11111111-1111-1111-1111-111111111111"

        # 6. Extra staff reply when no waiting turn -> no_waiting_turn
        assert sla_svc.on_staff_reply("zalo", "zl_acc_1", "cust_dm_1", supabase=db)["status"] == "no_waiting_turn"

        # 7. Customer asks 2nd question at Tue 09:00 -> is_first_turn=False; staff replies at 09:08 -> BREACHED (480s)
        r3 = sla_svc.on_inbound_message(
            "zalo",
            "zl_acc_1",
            "cust_dm_1",
            content="Câu hỏi thứ 2",
            received_at=datetime(2026, 11, 24, 9, 0, tzinfo=VN_TZ),
            supabase=db,
        )
        assert r3["opened_new_turn"] is True
        assert r3["turn"]["is_first_turn"] is False
        breach_reply = sla_svc.on_staff_reply(
            "zalo",
            "zl_acc_1",
            "cust_dm_1",
            caller_email="sale@markee.vn",
            replied_at=datetime(2026, 11, 24, 9, 8, tzinfo=VN_TZ),
            supabase=db,
        )
        assert breach_reply["status"] == "breached"
        assert breach_reply["turn"]["business_response_seconds"] == 480

        # 8. Open a 3rd turn (spam) and dismiss it
        r_spam = sla_svc.on_inbound_message(
            "messenger",
            "fb_1",
            "spam_thread",
            customer_name="Spam Bot",
            content="Quảng cáo vay vốn",
            received_at=datetime(2026, 11, 24, 10, 0, tzinfo=VN_TZ),
            supabase=db,
        )
        dismissed = sla_svc.dismiss_sla_turn(
            r_spam["turn"]["id"],
            reason="Tin spam",
            caller_email="admin@markee.vn",
            supabase=db,
        )
        assert dismissed is not None
        assert dismissed["status"] == "dismissed"
        assert dismissed["dismiss_reason"] == "Tin spam"

        # 9. Dashboard KPIs exclude dismissed turn: total=2, met=1, breached=1, compliance=50.0%
        dash = sla_svc.get_sla_dashboard("2026-11-23", "2026-11-24", channel="all", supabase=db)
        assert dash["kpis"]["total_turns"] == 2
        assert dash["kpis"]["met_count"] == 1
        assert dash["kpis"]["breached_count"] == 1
        assert dash["kpis"]["sla_compliance_pct"] == 50.0
        assert dash["kpis"]["avg_frt_seconds"] == 240
        assert dash["kpis"]["avg_response_seconds"] == 360
        assert len(dash["by_staff"]) == 1
        assert dash["by_staff"][0]["email"] == "sale@markee.vn"

    def test_23505_race_fallback_and_42p01_fail_soft(self):
        db = _FakeSupabase()
        # Pre-seed an active waiting turn, then simulate race where _find_waiting_turn missed it
        first = sla_svc.on_inbound_message(
            "telegram", "tg_1", "dlg_race", content="Tin 1", supabase=db
        )
        assert first["status"] == "opened"

        db.fail_next_turn_insert_23505 = True
        with patch.object(sla_svc, "_find_waiting_turn", side_effect=[None, first["turn"]]):
            raced = sla_svc.on_inbound_message(
                "telegram", "tg_1", "dlg_race", content="Tin 2 race", supabase=db
            )
        assert raced["status"] == "updated_waiting"
        assert raced["opened_new_turn"] is False

        # Missing table 42P01 fail-soft
        db.missing_tables.add("inbox_sla_turns")
        assert sla_svc.on_inbound_message("zalo", "a", "c", supabase=db)["status"] == "table_not_ready"
        assert sla_svc.on_staff_reply("zalo", "a", "c", supabase=db)["status"] == "table_not_ready"
        assert sla_svc.get_live_sla_badges(supabase=db) == []

    def test_mark_turn_notified_atomic_and_live_badges(self):
        db = _FakeSupabase()
        # Use 24x7 so wait_business_seconds is deterministic regardless of wall clock
        sla_svc.upsert_sla_config(
            SlaConfigPayload(scope_key="global", target_minutes=5, warning_pct=70, business_hours_enabled=False),
            supabase=db,
        )
        old_dt = datetime.now(timezone.utc) - timedelta(minutes=8)
        opened = sla_svc.on_inbound_message(
            "whatsapp",
            "wa_1",
            "84901234567@s.whatsapp.net",
            customer_name="Khách WA",
            content="Cần hỗ trợ gấp",
            received_at=old_dt,
            supabase=db,
        )
        tid = opened["turn"]["id"]

        badges = sla_svc.get_live_sla_badges("whatsapp", supabase=db)
        assert len(badges) == 1
        assert badges[0]["state"] == "breached"
        assert badges[0]["wait_business_seconds"] >= 470

        # list_sla_turns with status='waiting_breached' returns it!
        wb = sla_svc.list_sla_turns(status="waiting_breached", channel="whatsapp", supabase=db)
        assert wb["total"] == 1
        assert wb["items"][0]["id"] == tid

        # Atomic mark_turn_notified: first call succeeds, second returns False
        assert sla_svc.mark_turn_notified(tid, "breach", supabase=db) is True
        assert sla_svc.mark_turn_notified(tid, "breach", supabase=db) is False

    def test_backfill_4_channels_and_idempotency_with_strict_zalo_schema(self):
        db = _FakeSupabase()
        now = datetime.now(timezone.utc)
        t_in = (now - timedelta(hours=2)).isoformat()
        t_out = (now - timedelta(hours=2) + timedelta(minutes=2)).isoformat()

        db.tables["zalo_messages"] = [
            {
                "user_id": "zl_acc_1",
                "group_id": "cust_dm_1",
                "group_name": "Anh Minh",
                "is_sent": False,
                "ts": int((now - timedelta(hours=2)).timestamp() * 1000),
                "created_at": t_in,
                "sender_name": "Anh Minh",
                "content": "Xin chào Zalo",
                "msg_kind": "text",
                "type": "text",
                "is_deleted": False,
            },
            {
                "user_id": "zl_acc_1",
                "group_id": "cust_dm_1",
                "group_name": "Anh Minh",
                "is_sent": True,
                "ts": int((now - timedelta(hours=2) + timedelta(minutes=2)).timestamp() * 1000),
                "created_at": t_out,
                "sender_name": "Sale",
                "content": "Chào anh ạ",
                "msg_kind": "text",
                "type": "text",
                "is_deleted": False,
            },
        ]
        db.tables["fb_messenger_accounts"] = [{"id": "fb_1", "name": "Fanpage Markee"}]
        db.tables["fb_messenger_threads"] = [{"account_id": "fb_1", "thread_id": "th_1", "recipient_name": "Chị Hoa"}]
        db.tables["fb_messenger_messages"] = [
            {"account_id": "fb_1", "thread_id": "th_1", "is_self": False, "is_echo": False, "created_at": t_in, "sender_name": "Chị Hoa", "content": "Hi FB"},
            {"account_id": "fb_1", "thread_id": "th_1", "is_self": True, "is_echo": False, "created_at": t_out, "sender_name": "Page", "content": "Chào chị"},
        ]
        db.tables["telegram_accounts"] = [{"id": "tg_1", "display_name": "TG Support", "label": "TG", "username": "tgsup"}]
        db.tables["telegram_dialogs"] = [{"account_id": "tg_1", "dialog_id": "777", "dialog_type": "user", "title": "Alex"}]
        db.tables["telegram_messages"] = [
            {"account_id": "tg_1", "dialog_id": "777", "is_outgoing": False, "sent_at": t_in, "sender_name": "Alex", "text": "Hello TG", "is_deleted": False},
        ]
        db.tables["whatsapp_accounts"] = [{"id": "wa_1", "display_name": "WA Sales", "label": "WA", "phone_number": "84901112222"}]
        db.tables["whatsapp_conversations"] = [{"account_id": "wa_1", "chat_jid": "84909998888@s.whatsapp.net", "chat_type": "direct", "title": "Bob", "phone_number": "84909998888"}]
        db.tables["whatsapp_messages"] = [
            {"account_id": "wa_1", "chat_jid": "84909998888@s.whatsapp.net", "is_outgoing": False, "sent_at": t_in, "sender_name": "Bob", "sender_phone": "84909998888", "text": "Hello WA", "msg_type": "text", "is_deleted": False},
        ]

        res1 = sla_svc.backfill_sla_history(days=7, supabase=db)
        assert res1["turns_created"] == 4
        assert res1["by_channel"]["zalo"]["turns_created"] == 1
        assert res1["by_channel"]["messenger"]["turns_created"] == 1
        assert res1["by_channel"]["telegram"]["turns_created"] == 1
        assert res1["by_channel"]["whatsapp"]["turns_created"] == 1

        # Verify Zalo account_name was resolved from zalo_accounts.label (NOT silently dropped by 42703!)
        zalo_turn = next(t for t in db.tables["inbox_sla_turns"] if t["channel"] == "zalo")
        assert zalo_turn["account_name"] == "Zalo Sale 01"

        # 2nd backfill run is 100% idempotent -> 0 duplicate turns created
        res2 = sla_svc.backfill_sla_history(days=7, supabase=db)
        assert res2["turns_created"] == 0


# ── 3. zalo_group_alert_service.py & sla_alert_worker.py Tests ───────────────

class TestZaloGroupAlertServiceAndWatchdog:
    def test_anti_loop_and_config_routing(self):
        cfg = {
            "id": "cfg-1",
            "is_enabled": True,
            "notifier_zalo_account_id": "zl_acc_1",
            "target_zalo_group_id": "grp_cskh_shared",
            "channels": ["zalo", "messenger"],
            "source_account_ids": ["zl_acc_1", "fb_1"],
            "include_group_chats": False,
            "excluded_conversation_ids": ["conv_muted"],
            "notify_new_message": True,
            "notify_sla_warning": False,
            "notify_sla_breach": True,
        }

        # Anti-loop blocks same target Zalo group ID
        assert alert_svc.is_anti_loop_blocked(cfg, channel="zalo", conversation_id="grp_cskh_shared", content="hi") is True
        # Anti-loop blocks alert prefix markers on Zalo
        assert alert_svc.is_anti_loop_blocked(cfg, channel="zalo", conversation_id="other", content="📩 [TIN MỚI - ZALO]") is True
        assert alert_svc.is_anti_loop_blocked(cfg, channel="zalo", conversation_id="other", content="🚨 [QUÁ HẠN SLA - ZALO]") is True
        assert alert_svc.is_anti_loop_blocked(cfg, channel="zalo", conversation_id="other", content="⚠️ [SẮP QUÁ HẠN SLA - ZALO]") is True
        # Non-Zalo & test ping are NOT blocked
        assert alert_svc.is_anti_loop_blocked(cfg, channel="messenger", conversation_id="grp_cskh_shared", content="[TIN MỚI -") is False
        assert alert_svc.is_anti_loop_blocked(cfg, channel="zalo", conversation_id="grp_cskh_shared", content="[TEST THÔNG BÁO SLA", alert_type="test") is False

        # Routing checks
        assert alert_svc.config_matches_event(cfg, alert_type="new_message", channel="zalo", account_id="zl_acc_1", conversation_id="cust_dm_1") == (True, None)
        assert alert_svc.config_matches_event(cfg, alert_type="new_message", channel="zalo", account_id="zl_acc_1", conversation_id="grp_cskh_shared") == (False, "anti_loop_guard")
        assert alert_svc.config_matches_event(cfg, alert_type="new_message", channel="telegram", account_id="zl_acc_1", conversation_id="c1") == (False, "channel_mismatch")
        assert alert_svc.config_matches_event(cfg, alert_type="new_message", channel="zalo", account_id="zl_other", conversation_id="c1") == (False, "account_mismatch")
        assert alert_svc.config_matches_event(cfg, alert_type="new_message", channel="zalo", account_id="zl_acc_1", conversation_id="c1", thread_type="group") == (False, "group_chat_excluded")
        assert alert_svc.config_matches_event(cfg, alert_type="new_message", channel="zalo", account_id="zl_acc_1", conversation_id="conv_muted") == (False, "excluded_conversation")
        assert alert_svc.config_matches_event(cfg, alert_type="sla_warning", channel="zalo", account_id="zl_acc_1", conversation_id="cust_dm_1") == (False, "sla_warning_disabled")
        assert alert_svc.config_matches_event(cfg, alert_type="sla_breach", channel="zalo", account_id="zl_acc_1", conversation_id="cust_dm_1") == (True, None)

    def test_lookup_zalo_account_name_uses_real_schema(self):
        db = _FakeSupabase()
        with patch.object(alert_svc, "get_supabase_client", return_value=db):
            # Strict columns on zalo_accounts will raise 42703 if display_name/name is queried!
            assert alert_svc._lookup_zalo_account_name("zl_acc_1") == "Zalo Sale 01"
            groups = alert_svc.list_available_zalo_groups_for_account("zl_acc_1")
            assert len(groups) == 1
            assert groups[0]["group_id"] == "grp_cskh_shared"
            assert groups[0]["name"] == "Nhóm CSKH Chung"

    def test_dispatch_inbound_normalizes_epoch_ms_and_routes(self):
        db = _FakeSupabase()
        alert_svc.invalidate_forward_config_cache()
        db.tables["inbox_alert_forward_configs"].append({
            "id": "cfg-dry",
            "name": "Rule Dry",
            "is_enabled": True,
            "dry_run": True,
            "notifier_zalo_account_id": "zl_acc_1",
            "target_zalo_group_id": "grp_cskh_shared",
            "channels": ["zalo"],
            "source_account_ids": [],
            "include_group_chats": False,
            "excluded_conversation_ids": [],
            "notify_new_message": True,
            "notify_sla_warning": True,
            "notify_sla_breach": True,
        })

        captured_calls = []

        async def fake_enqueue(cfg, event, auth=None):
            captured_calls.append((cfg, event, auth))
            return {"ok": True, "action": "debounced"}

        epoch_ms = int(datetime(2026, 11, 28, 2, 0, tzinfo=timezone.utc).timestamp() * 1000)

        with (
            patch.object(alert_svc, "get_supabase_client", return_value=db),
            patch.object(alert_svc, "enqueue_alert", side_effect=fake_enqueue),
            patch.object(alert_svc, "load_zca_auth", new=AsyncMock(return_value={"imei": "should_not_be_called"})),
        ):
            res = asyncio.run(
                alert_svc.dispatch_inbound_alert(
                    "zalo",
                    "zl_acc_1",
                    "cust_dm_1",
                    customer_name="Anh Minh",
                    content="Chào shop",
                    received_at=epoch_ms,
                    turn={"id": "turn-99", "target_seconds": 300},
                    opened_new_turn=True,
                )
            )
            assert len(res) == 1
            assert len(captured_calls) == 1
            _, evt, auth = captured_calls[0]
            assert auth is None  # dry_run skips load_zca_auth
            assert evt["force_new_turn"] is True
            # Verify received_at was normalized into a valid ISO string (not bare digits "179...")
            assert "T" in evt["received_at"]
            assert evt["received_at"].startswith("2026-11-28T02:00:00")

    def test_watchdog_tick_dispatches_breach_and_warning_once(self):
        now = datetime.now(timezone.utc)
        cfg_247 = {
            "target_minutes": 5,
            "warning_pct": 70,
            "business_hours_enabled": False,
            "timezone": "Asia/Ho_Chi_Minh",
            "work_days": [1, 2, 3, 4, 5, 6],
            "shifts": [{"start": "08:00", "end": "17:30"}],
        }
        turns = [
            {
                "id": "t-breach",
                "channel": "zalo",
                "account_id": "zl_acc_1",
                "conversation_id": "c1",
                "customer_msg_at": (now - timedelta(minutes=6)).isoformat(),
                "target_seconds": 300,
                "warning_notified_at": None,
                "breach_notified_at": None,
            },
            {
                "id": "t-warn",
                "channel": "messenger",
                "account_id": "fb_1",
                "conversation_id": "c2",
                "customer_msg_at": (now - timedelta(seconds=230)).isoformat(),
                "target_seconds": 300,
                "warning_notified_at": None,
                "breach_notified_at": None,
            },
            {
                "id": "t-ok",
                "channel": "telegram",
                "account_id": "tg_1",
                "conversation_id": "c3",
                "customer_msg_at": (now - timedelta(seconds=60)).isoformat(),
                "target_seconds": 300,
                "warning_notified_at": None,
                "breach_notified_at": None,
            },
        ]

        notified: set[tuple[str, str]] = set()
        dispatched: List[tuple[str, str]] = []

        def fake_mark(turn_id: str, kind: str) -> bool:
            key = (turn_id, kind)
            if key in notified:
                return False
            notified.add(key)
            return True

        async def fake_dispatch(alert_type: str, turn: Dict[str, Any], wait_business_seconds: Optional[int] = None):
            dispatched.append((alert_type, turn["id"]))
            return [{"ok": True}]

        with (
            patch.object(sla_alert_worker, "list_waiting_turns_for_watchdog", return_value=turns),
            patch.object(sla_alert_worker, "resolve_effective_sla_config", return_value=cfg_247),
            patch.object(sla_alert_worker, "mark_turn_notified", side_effect=fake_mark),
            patch.object(sla_alert_worker, "dispatch_sla_alert", side_effect=fake_dispatch),
        ):
            summary1 = asyncio.run(sla_alert_worker.run_sla_alert_tick())
            assert summary1 == {"checked": 3, "warnings": 1, "breaches": 1, "errors": 0}
            assert ("sla_breach", "t-breach") in dispatched
            assert ("sla_warning", "t-warn") in dispatched

            # Repeat tick -> atomic mark returns False -> 0 duplicate alerts!
            summary2 = asyncio.run(sla_alert_worker.run_sla_alert_tick())
            assert summary2 == {"checked": 3, "warnings": 0, "breaches": 0, "errors": 0}
            assert len(dispatched) == 2


# ── 4. FastAPI Router (14 Endpoints & RBAC) Tests ────────────────────────────

class TestSlaAlertsRouter:
    def _build_client(self, *, role: str = "admin") -> TestClient:
        app = FastAPI()
        app.include_router(sla_router_mod.router, prefix="/api/all-platform")

        fake_user = {
            "id": "22222222-2222-2222-2222-222222222222",
            "email": "admin@markee.vn" if role == "admin" else "member@markee.vn",
            "name": "Test User",
            "role": role,
        }

        app.dependency_overrides[get_current_user] = lambda: fake_user
        app.dependency_overrides[get_authenticated_caller_email] = lambda: fake_user["email"]
        if role in ("admin", "leader"):
            app.dependency_overrides[require_admin_or_leader] = lambda: fake_user
        else:
            from fastapi import HTTPException

            def _deny():
                raise HTTPException(status_code=403, detail="Forbidden: Admin or leader role required")

            app.dependency_overrides[require_admin_or_leader] = _deny

        return TestClient(app)

    def test_all_14_endpoints_mounted_and_contract_aligned(self):
        db = _FakeSupabase()
        alert_svc.invalidate_forward_config_cache()
        sla_svc.invalidate_sla_config_cache()

        # Verify exactly 14 routes on router
        routes = [r for r in sla_router_mod.router.routes if getattr(r, "methods", None)]
        assert len(routes) == 14

        client = self._build_client(role="admin")
        fake_engine_status = {
            "alive": True,
            "pid": 4242,
            "uptime_ms": 12000,
            "mode": "js_engine",
            "restarts": 0,
            "error": None,
            "last_error": None,
            "stats": {"sent_total": 3, "coalesced_total": 1, "pending_debounce": 0},
        }
        fake_test_send = {
            "sent": True,
            "dry_run": True,
            "status": "dry_run",
            "via": "js_engine",
            "latency_ms": 1,
            "rendered_text": "✅ [TEST THÔNG BÁO SLA - ZALO]",
        }

        with (
            patch.object(sla_svc, "get_supabase_client", return_value=db),
            patch.object(alert_svc, "get_supabase_client", return_value=db),
            patch.object(sla_router_mod, "get_engine_status", new=AsyncMock(return_value=fake_engine_status)),
            patch.object(alert_svc, "send_immediate", new=AsyncMock(return_value=fake_test_send)),
        ):
            # 1. GET /config/sla
            r = client.get("/api/all-platform/sla-alerts/config/sla")
            assert r.status_code == 200 and r.json()["success"] is True
            assert "global" in r.json()["data"] and "overrides" in r.json()["data"]

            # 2. PUT /config/sla
            r = client.put(
                "/api/all-platform/sla-alerts/config/sla",
                json={
                    "scope_key": "channel:zalo",
                    "target_minutes": 8,
                    "warning_pct": 75,
                    "business_hours_enabled": True,
                    "timezone": "Asia/Ho_Chi_Minh",
                    "work_days": [1, 2, 3, 4, 5],
                    "shifts": [{"start": "08:00", "end": "17:00"}],
                    "include_group_chats": False,
                    "exclude_bot_replies": True,
                },
            )
            assert r.status_code == 200 and r.json()["data"]["target_minutes"] == 8

            # Seed 1 turn so turns / dismiss / dashboard have live data
            opened = sla_svc.on_inbound_message("zalo", "zl_acc_1", "cust_dm_1", customer_name="Anh Minh", content="Test", supabase=db)
            turn_id = opened["turn"]["id"]

            # 3. GET /dashboard
            r = client.get("/api/all-platform/sla-alerts/dashboard?channel=all")
            assert r.status_code == 200
            d = r.json()["data"]
            assert {"range", "kpis", "by_channel", "by_staff", "daily_trend"}.issubset(d.keys())

            # 4. GET /turns
            r = client.get("/api/all-platform/sla-alerts/turns?status=waiting&channel=zalo&search=Minh")
            assert r.status_code == 200
            assert r.json()["data"]["total"] == 1
            assert r.json()["data"]["items"][0]["open_url"].startswith("/all-platform/zalo-inbox")

            # 5. GET /live-badges
            r = client.get("/api/all-platform/sla-alerts/live-badges?channel=all")
            assert r.status_code == 200
            assert len(r.json()["data"]["items"]) == 1
            assert r.json()["data"]["engine_status"]["pid"] == 4242

            # 6. POST /turns/{turn_id}/dismiss
            r = client.post(f"/api/all-platform/sla-alerts/turns/{turn_id}/dismiss", json={"reason": "Spam"})
            assert r.status_code == 200 and r.json()["data"]["status"] == "dismissed"

            # 7. POST /backfill
            r = client.post("/api/all-platform/sla-alerts/backfill", json={"days": 7, "channels": ["zalo"]})
            assert r.status_code == 200
            assert {"processed_messages", "turns_created", "by_channel"}.issubset(r.json()["data"].keys())

            # 8. GET /forward-configs/zalo-groups (MUST NOT be shadowed by /{config_id})
            r = client.get("/api/all-platform/sla-alerts/forward-configs/zalo-groups?account_id=zl_acc_1")
            assert r.status_code == 200
            assert r.json()["data"]["groups"][0]["group_id"] == "grp_cskh_shared"

            # 9. POST /forward-configs
            r = client.post(
                "/api/all-platform/sla-alerts/forward-configs",
                json={
                    "name": "Alert CSKH",
                    "dry_run": True,
                    "notifier_zalo_account_id": "zl_acc_1",
                    "target_zalo_group_id": "grp_cskh_shared",
                    "channels": ["zalo", "messenger"],
                },
            )
            assert r.status_code == 200
            cfg_id = r.json()["data"]["id"]
            assert r.json()["data"]["notifier_zalo_account_name"] == "Zalo Sale 01"
            assert r.json()["data"]["target_zalo_group_name"] == "Nhóm CSKH Chung"

            # 10. GET /forward-configs
            r = client.get("/api/all-platform/sla-alerts/forward-configs")
            assert r.status_code == 200
            assert len(r.json()["data"]["items"]) == 1
            assert r.json()["data"]["engine_status"]["alive"] is True

            # 11. PATCH /forward-configs/{config_id}
            r = client.patch(f"/api/all-platform/sla-alerts/forward-configs/{cfg_id}", json={"debounce_seconds": 12})
            assert r.status_code == 200 and r.json()["data"]["debounce_seconds"] == 12

            # 12. POST /forward-configs/{config_id}/test
            r = client.post(f"/api/all-platform/sla-alerts/forward-configs/{cfg_id}/test")
            assert r.status_code == 200
            assert r.json()["data"]["sent"] is True
            assert r.json()["data"]["via"] == "js_engine"

            # 13. GET /forward-logs
            r = client.get(f"/api/all-platform/sla-alerts/forward-logs?config_id={cfg_id}&limit=20")
            assert r.status_code == 200
            assert len(r.json()["data"]["items"]) == 1
            assert r.json()["data"]["items"][0]["alert_type"] == "test"

            # 14. DELETE /forward-configs/{config_id}
            r = client.delete(f"/api/all-platform/sla-alerts/forward-configs/{cfg_id}")
            assert r.status_code == 200 and r.json()["data"]["deleted"] is True

    def test_member_role_blocked_on_admin_leader_mutations(self):
        client = self._build_client(role="member")

        # Write / admin endpoints must return 403 for member
        assert client.put("/api/all-platform/sla-alerts/config/sla", json={"scope_key": "global"}).status_code == 403
        assert client.post("/api/all-platform/sla-alerts/turns/t1/dismiss", json={"reason": "x"}).status_code == 403
        assert client.post("/api/all-platform/sla-alerts/backfill", json={"days": 7}).status_code == 403
        assert (
            client.post(
                "/api/all-platform/sla-alerts/forward-configs",
                json={
                    "notifier_zalo_account_id": "zl_1",
                    "target_zalo_group_id": "g1",
                    "channels": ["zalo"],
                },
            ).status_code
            == 403
        )
        assert client.patch("/api/all-platform/sla-alerts/forward-configs/c1", json={"is_enabled": False}).status_code == 403
        assert client.delete("/api/all-platform/sla-alerts/forward-configs/c1").status_code == 403
        assert client.post("/api/all-platform/sla-alerts/forward-configs/c1/test").status_code == 403
