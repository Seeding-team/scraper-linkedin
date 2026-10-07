"""Dong bo Hang hoa MSC → CRM (service_catalog_items).

Nguyen tac (xem prompts/project.md):
- MSC la nguon doc duy nhat: CHI GET {MSC_API_BASE_URL}/api/v1/goods, tuyet doi
  khong ghi vao MSC.
- Full snapshot (MSC khong co updated_since) + upsert idempotent theo danh tinh
  ngoai (external_source='msc', external_id=MSC id). Khong dung name+brand+model
  lam khoa vi MSC co the chua ban ghi trung.
- READ-BEFORE-WRITE: fetch → validate HTTP → validate response → normalize
  toan bo snapshot → SAU DO moi bat dau ghi CRM. MSC hong => KHONG ghi CRM.
- Khong bao gio DELETE CRM khi MSC mat ban ghi; khong dong vao cac field CRM
  tu quan ly (sku, gia, VAT, quota, supplier, status, ...).
- Manual (button) va scheduled (APScheduler 1 lan/ngay) deu goi dung ham nay.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from supabase import Client

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_service_catalog_service import (
    ITEMS_TABLE,
    create_service_catalog_item,
)

logger = get_logger(__name__)

MSC_SOURCE = "msc"
RUNS_TABLE = "msc_sync_runs"

# Nhom mac dinh cho hang hoa MSC khong co nhom hop le ("Chưa phân loại" /
# groupId rong / groupId khong khop bat ky nhom nao). external_id co dinh de
# reuse, khong bao gio tao ban sao moi moi lan dong bo.
DEFAULT_GROUP_NAME = "Hàng hóa MSC – Chưa phân loại"
DEFAULT_GROUP_EXTERNAL_ID = "__msc_unclassified__"

# Gia tri groupId/groupName ma MSC dung de danh dau "chua phan loai"
_UNCLASSIFIED_TOKENS = {"", "chưa phân loại", "chua phan loai", "unclassified"}

# Field CRM cho phep sync ghi de (name/brand/part_number/parent). Moi thu khac
# (sku, gia, VAT, quota, supplier, status, note, ...) la cua nguoi dung CRM.
# Rieng brand/part_number/parent_id ma nguoi dung da sua thu cong (danh dau
# sync_manual_fields, migration 176) cung KHONG duoc ghi de — xem
# _desired_fields_for_item().
_ITEM_SYNC_FIELDS = ("name", "brand", "part_number", "parent_id")

_sync_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any) -> str | None:
    """Chuoi hoa + trim; tra None neu rong."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_unclassified(value: str | None) -> bool:
    return value is None or value.strip().lower() in _UNCLASSIFIED_TOKENS


# ─────────────────────────────────────────────────────────────────────────────
# FETCH + VALIDATE (khong duoc co CRM write nao xay ra truoc khi qua het day)
# ─────────────────────────────────────────────────────────────────────────────


class MscSyncHttpError(ValueError):
    """Loi HTTP tu phia MSC (giu lai http_status de ghi vao msc_sync_runs)."""

    def __init__(self, message: str, http_status: int | None = None):
        super().__init__(message)
        self.http_status = http_status


def _fetch_msc_snapshot() -> tuple[int, dict]:
    """GET /api/v1/goods tu MSC. Raise ValueError/RuntimeException neu loi.

    Returns (http_status, parsed_json). Chi tra ve khi response hop le HOAN TOAN:
    success=true, data la dict, data.groups va data.items la list.
    """
    base_url = (settings.msc_api_base_url or "").strip().rstrip("/")
    if not base_url:
        raise ValueError("MSC_API_BASE_URL chua duoc cau hinh - khong the dong bo hang hoa tu MSC.")
    url = f"{base_url}/api/v1/goods"
    headers = {}
    token = (settings.msc_api_token or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    timeout = httpx.Timeout(settings.msc_sync_timeout_sec)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
    if response.status_code != 200:
        raise MscSyncHttpError(f"MSC API tra ve HTTP {response.status_code}", response.status_code)
    try:
        payload = response.json()
    except Exception as exc:  # invalid JSON
        raise ValueError(f"MSC API tra ve JSON khong hop le: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise ValueError("MSC API tra ve success != true")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("MSC API response thieu data")
    if not isinstance(data.get("groups"), list):
        raise ValueError("MSC API response thieu data.groups")
    if not isinstance(data.get("items"), list):
        raise ValueError("MSC API response thieu data.items")
    return response.status_code, payload


# ─────────────────────────────────────────────────────────────────────────────
# NORMALIZE (thuan tuy tinh toan tren snapshot, khong đụng DB)
# ─────────────────────────────────────────────────────────────────────────────


def _dedupe_by_id(rows: list[dict], id_key: str) -> tuple[dict[str, dict], int]:
    """Gom nhieu ban ghi trung MSC id: giu ban ghi MOI nhat (theo
    updatedAt/createdAt), dem so ban bi loai la duplicates."""
    best: dict[str, dict] = {}
    duplicates = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_id = _clean(row.get(id_key))
        if not row_id:
            continue
        if row_id in best:
            duplicates += 1
            prev = best[row_id]
            prev_ts = (prev.get("updatedAt") or prev.get("createdAt") or "")
            cur_ts = (row.get("updatedAt") or row.get("createdAt") or "")
            if str(cur_ts) > str(prev_ts):
                best[row_id] = row
        else:
            best[row_id] = row
    return best, duplicates


def _normalize_snapshot(payload: dict) -> dict:
    """Chuyen snapshot MSC th thanh cau truc sync don gian:
    groups: {external_id: {'name': str}}
    brands: {external_id: {'name': str}}
    items:  [{external_id, name, brand, model, group_external_id, group_name}]
    """
    data = payload["data"]

    groups, _dup_groups = _dedupe_by_id(data["groups"], "id")
    normalized_groups: dict[str, str] = {}
    for gid, group in groups.items():
        name = _clean(group.get("name"))
        if name:
            normalized_groups[gid] = name

    brands, _dup_brands = _dedupe_by_id(data.get("brands") or [], "id")
    normalized_brands: dict[str, str] = {}
    for bid, brand in brands.items():
        name = _clean(brand.get("name"))
        if name:
            normalized_brands[bid] = name

    items, dup_items = _dedupe_by_id(data["items"], "id")
    normalized_items: list[dict] = []
    errors: list[str] = []
    for item_id, item in items.items():
        name = _clean(item.get("itemName")) or _clean(item.get("tenHangHoa"))
        model = _clean(item.get("model")) or _clean(item.get("kyMaHieu"))
        if not name and model:
            # Hang hoa chi co ky ma hieu — dung model lam ten de khong mat du lieu.
            name = model
        if not name:
            errors.append(f"item {item_id}: thieu ten hang hoa (itemName) - bo qua")
            continue
        brand = (
            _clean(item.get("brand"))
            or _clean(item.get("hangSanXuat"))
            or _clean(item.get("brandName"))
        )
        if not brand:
            brand_id = _clean(item.get("brandId"))
            if brand_id:
                brand = normalized_brands.get(brand_id)
        if not brand:
            brand = _clean(item.get("nhanHieu"))
        group_raw = _clean(item.get("groupId"))
        group_name_raw = _clean(item.get("groupName"))
        normalized_items.append(
            {
                "external_id": item_id,
                "name": name,
                "brand": brand,
                "model": model,
                "group_raw": group_raw,
                "group_name_raw": group_name_raw,
                # Da quy doi san sang external_id cua nhom MSC (None = nhom mac dinh).
                "resolved_group_id": _resolve_group_external_id_local(
                    group_raw, group_name_raw, normalized_groups
                ),
            }
        )

    return {
        "groups": normalized_groups,
        "items": normalized_items,
        "duplicates": dup_items,
        "errors": errors,
        "fetched_groups": len(data["groups"]),
        "fetched_items": len(data["items"]),
    }


def _resolve_group_external_id_local(
    group_raw: str | None, group_name_raw: str | None, groups: dict[str, str]
) -> str | None:
    """Quy doi groupId/groupName cua 1 item MSC ve external_id cua nhom MSC.

    Thu tu: groupId la ID → groupId la ten nhom → groupName la ten nhom →
    None (nhom mac dinh). Trung khop khong phan biet hoa thuong.
    """
    if group_raw and not _is_unclassified(group_raw):
        if group_raw in groups:
            return group_raw
        lowered = group_raw.strip().lower()
        for gid, name in groups.items():
            if name.strip().lower() == lowered:
                return gid
    if group_name_raw and not _is_unclassified(group_name_raw):
        lowered = group_name_raw.strip().lower()
        for gid, name in groups.items():
            if name.strip().lower() == lowered:
                return gid
    return None


# ─────────────────────────────────────────────────────────────────────────────
# CRM READ + UPSERT
# ─────────────────────────────────────────────────────────────────────────────


def _load_crm_groups(supabase: Client) -> list[dict]:
    rows = (
        supabase.table(ITEMS_TABLE)
        .select("id, name, external_source, external_id, status")
        .eq("item_type", "group")
        .execute()
        .data
        or []
    )
    return rows


def _load_crm_msc_items(supabase: Client) -> dict[str, dict]:
    rows = (
        supabase.table(ITEMS_TABLE)
        .select("id, name, brand, part_number, parent_id, external_id, status, sync_manual_fields")
        .eq("external_source", MSC_SOURCE)
        .execute()
        .data
        or []
    )
    return {row["external_id"]: row for row in rows if row.get("external_id")}


def _desired_fields_for_item(item: dict, group_crm_id: str | None, existing: dict | None) -> dict:
    """Gia tri MSC mong muon cho 1 item — CHU dong bo field da bi nguoi dung
    CRM sua thu cong (sync_manual_fields, migration 176). Field chua danh dau
    van tiep tuc dong bo binh thuong tu MSC (task §7)."""
    desired = {
        "name": item["name"],
        "brand": item["brand"],
        "part_number": item["model"],
        "parent_id": group_crm_id,
    }
    if existing:
        for field in existing.get("sync_manual_fields") or []:
            if field in desired:
                desired.pop(field)
    return desired


def _ensure_group(
    supabase: Client,
    external_id: str,
    msc_name: str,
    crm_groups: list[dict],
    stats: dict,
    user_id: str | None,
) -> str | None:
    """Tra ve CRM group id tuong ung voi 1 nhom MSC; tao moi neu chua co.

    1) Match theo external identity (external_source='msc', external_id) — duoc
       uu tien tuyet doi.
    2) Neu chua co: neu da ton tai nhom CRM CUNG TEN nhung CHUA co external id
       (nhom tao thu cong) → "adopt": gan external identity vao nhom do de
       khong tao nhom trung ten. (Khong match theo ten khi external id da co.)
    3) Neu van chua co → tao nhom moi (item_type='group').
    """
    for row in crm_groups:
        if row.get("external_source") == MSC_SOURCE and row.get("external_id") == external_id:
            if _clean(row.get("name")) != msc_name:
                supabase.table(ITEMS_TABLE).update(
                    {"name": msc_name, "updated_at": _now_iso(), "updated_by": user_id}
                ).eq("id", row["id"]).execute()
                row["name"] = msc_name
                stats["groups_updated"] += 1
            return row["id"]

    lowered = msc_name.strip().lower()
    for row in crm_groups:
        if row.get("external_source") is None and _clean(row.get("name", "")).lower() == lowered:
            supabase.table(ITEMS_TABLE).update(
                {"external_source": MSC_SOURCE, "external_id": external_id}
            ).eq("id", row["id"]).execute()
            row["external_source"] = MSC_SOURCE
            row["external_id"] = external_id
            stats["groups_updated"] += 1
            return row["id"]

    created = create_service_catalog_item(
        {
            "item_type": "group",
            "name": msc_name,
            "external_source": MSC_SOURCE,
            "external_id": external_id,
            "status": "active",
            # default_vat_rate la NOT NULL trong DB (065) — create UI luon truyen
            # so; sync truyen 0 (= dung DEFAULT cua cot, nguoi dung sua sau).
            "default_vat_rate": 0,
        },
        user_id,
    )
    crm_groups.append(
        {
            "id": created["id"],
            "name": msc_name,
            "external_source": MSC_SOURCE,
            "external_id": external_id,
            "status": "active",
        }
    )
    stats["groups_created"] += 1
    return created["id"]


def _resolve_default_group(supabase: Client, crm_groups: list[dict], stats: dict, user_id: str | None) -> str:
    """Nhom mac dinh 'Hàng hóa MSC – Chưa phân loại' — tao/reuse deterministic."""
    group_id = _ensure_group(
        supabase, DEFAULT_GROUP_EXTERNAL_ID, DEFAULT_GROUP_NAME, crm_groups, stats, user_id
    )
    assert group_id is not None
    return group_id


def _upsert_items(
    supabase: Client,
    normalized: dict,
    group_id_map: dict[str | None, str],
    existing_items: dict[str, dict],
    stats: dict,
    user_id: str | None,
) -> None:
    for item in normalized["items"]:
        try:
            group_crm_id = group_id_map.get(item["resolved_group_id"])
            if group_crm_id is None:
                # Ten truong hop nay ve nhom mac dinh (resolved_group_id = None
                # tuc la chua phan loai / khong khop nhom nao trong snapshot).
                group_crm_id = group_id_map[None]
            existing = existing_items.get(item["external_id"])
            desired = _desired_fields_for_item(item, group_crm_id, existing)
            if existing is None:
                create_service_catalog_item(
                    {
                        "item_type": "component",
                        "parent_id": group_crm_id,
                        "name": item["name"],
                        "brand": item["brand"],
                        "part_number": item["model"],
                        "external_source": MSC_SOURCE,
                        "external_id": item["external_id"],
                        "status": "active",
                        # Xuong dong nhu nhom: NOT NULL + DEFAULT 0, khong dinh
                        # gia sau (gia/VAT nguoi dung CRM tu quan ly).
                        "default_vat_rate": 0,
                    },
                    user_id,
                )
                stats["inserted"] += 1
            else:
                changes = {
                    field: value
                    for field, value in desired.items()
                    if (value or None) != (existing.get(field) or None)
                }
                if changes:
                    changes["updated_at"] = _now_iso()
                    if user_id:
                        changes["updated_by"] = user_id
                    supabase.table(ITEMS_TABLE).update(changes).eq("id", existing["id"]).execute()
                    stats["updated"] += 1
                else:
                    stats["skipped"] += 1
        except Exception as exc:  # 1 item hong khong duoc lam dung ca run
            logger.exception("msc_sync: loi xu ly item %s", item.get("external_id"))
            stats["failed"] += 1
            if len(stats["errors"]) < 20:
                stats["errors"].append(f"item {item['external_id']}: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# AUDIT (msc_sync_runs)
# ─────────────────────────────────────────────────────────────────────────────


def _record_run(stats: dict) -> None:
    try:
        supabase = get_supabase_client()
        supabase.table(RUNS_TABLE).insert(
            {
                "trigger_type": stats["trigger"],
                "user_id": stats.get("user_id"),
                "dry_run": bool(stats.get("dry_run")),
                "status": stats["status"],
                "http_status": stats.get("http_status"),
                "started_at": stats.get("started_at"),
                "finished_at": stats.get("finished_at"),
                "duration_ms": stats.get("duration_ms"),
                "fetched_groups": stats.get("fetched_groups") or 0,
                "fetched_items": stats.get("fetched_items") or 0,
                "groups_created": stats.get("groups_created") or 0,
                "groups_updated": stats.get("groups_updated") or 0,
                "inserted": stats.get("inserted") or 0,
                "updated": stats.get("updated") or 0,
                "skipped": stats.get("skipped") or 0,
                "failed": stats.get("failed") or 0,
                "duplicates": stats.get("duplicates") or 0,
                "error_message": stats.get("error_message"),
            }
        ).execute()
    except Exception:
        # Audit khong duoc lam hong ket qua sync (va nguoc lai).
        logger.exception("msc_sync: khong ghi duoc msc_sync_runs")


def _empty_stats(trigger: str, user_id: str | None, dry_run: bool) -> dict:
    return {
        "trigger": trigger,
        "user_id": user_id,
        "dry_run": dry_run,
        "status": "failed",
        "http_status": None,
        "started_at": None,
        "finished_at": None,
        "duration_ms": None,
        "fetched_groups": 0,
        "fetched_items": 0,
        "groups_created": 0,
        "groups_updated": 0,
        "inserted": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "duplicates": 0,
        "error_message": None,
        "errors": [],
    }


def list_sync_runs(limit: int = 10) -> list[dict]:
    """Doc nhat ky sync moi nhat (cho GET /msc-sync/status)."""
    supabase = get_supabase_client()
    rows = (
        supabase.table(RUNS_TABLE)
        .select("*")
        .order("started_at", desc=True)
        .limit(max(1, min(int(limit), 50)))
        .execute()
        .data
        or []
    )
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT DUY NHAT (manual + scheduled deu goi ham nay)
# ─────────────────────────────────────────────────────────────────────────────


def run_sync(
    trigger: str = "manual",
    user_id: str | None = None,
    dry_run: bool | None = None,
) -> dict:
    """Chay 1 lan dong bo MSC → CRM. Idempotent; an toan retry.

    - trigger: 'manual' | 'scheduled'
    - user_id: nguoi bam button (None voi scheduled)
    - dry_run: True → tinh toan nhung KHONG ghi CRM (override env MSC_SYNC_DRY_RUN)
    """
    if trigger not in ("manual", "scheduled"):
        raise ValueError("trigger phai la 'manual' hoac 'scheduled'")
    effective_dry_run = settings.msc_sync_dry_run if dry_run is None else bool(dry_run)

    if not _sync_lock.acquire(blocking=False):
        return {
            "status": "failed",
            "trigger": trigger,
            "dry_run": effective_dry_run,
            "error_message": "Mot lan dong bo khac dang chay - vui long thu lai sau.",
            "errors": [],
        }

    stats = _empty_stats(trigger, user_id, effective_dry_run)
    started = time.monotonic()
    started_at = _now_iso()
    try:
        # BUOC 1-2: FETCH + HTTP/JSON VALIDATE (chua co CRM write nao)
        http_status, payload = _fetch_msc_snapshot()
        stats["http_status"] = http_status

        # BUOC 3-4: VALIDATE + NORMALIZE TOAN BO SNAPSHOT (van chua ghi)
        normalized = _normalize_snapshot(payload)
        stats["fetched_groups"] = normalized["fetched_groups"]
        stats["fetched_items"] = normalized["fetched_items"]
        stats["duplicates"] = normalized["duplicates"]
        stats["errors"].extend(normalized["errors"])
        stats["failed"] = len(normalized["errors"])

        if effective_dry_run:
            # DRY RUN: tinh them so luong se insert/update nhung KHONG ghi.
            supabase = get_supabase_client()
            existing_items = _load_crm_msc_items(supabase)
            crm_groups = _load_crm_groups(supabase)
            external_ids = {row["external_id"] for row in crm_groups if row.get("external_id")}
            would_insert = sum(1 for it in normalized["items"] if it["external_id"] not in existing_items)
            would_update = 0
            for it in normalized["items"]:
                existing = existing_items.get(it["external_id"])
                if existing:
                    desired = _desired_fields_for_item(it, existing.get("parent_id"), existing)
                    if any(
                        (value or None) != (existing.get(field) or None)
                        for field, value in desired.items()
                    ):
                        would_update += 1
            known_new_groups = [
                gid for gid in normalized["groups"] if gid not in external_ids
            ]
            has_default_group = DEFAULT_GROUP_EXTERNAL_ID in external_ids
            stats.update(
                {
                    "status": "success" if stats["failed"] == 0 else "partial",
                    "groups_created": len(known_new_groups) + (0 if has_default_group else 1),
                    "inserted": would_insert,
                    "updated": would_update,
                    "skipped": max(0, len(normalized["items"]) - would_insert - would_update),
                }
            )
            stats["error_message"] = "DRY RUN - khong ghi du lieu vao CRM"
            return stats

        # BUOC 5: BAT DAU GHI CRM (da qua toan bo validate)
        supabase = get_supabase_client()
        crm_groups = _load_crm_groups(supabase)
        existing_items = _load_crm_msc_items(supabase)

        # Nhom: external_id MSC → CRM group id. Nhom khong xac dinh → mac dinh.
        group_id_map: dict[str | None, str] = {None: _resolve_default_group(supabase, crm_groups, stats, user_id)}
        for gid, gname in normalized["groups"].items():
            group_id_map[gid] = _ensure_group(supabase, gid, gname, crm_groups, stats, user_id)

        _upsert_items(supabase, normalized, group_id_map, existing_items, stats, user_id)

        stats["status"] = "success" if stats["failed"] == 0 else "partial"
        return stats
    except Exception as exc:
        # FETCH/VALIDATE hong → CHUA co CRM write nao xay ra (read-before-write).
        logger.exception("msc_sync: dong bo that bai (%s)", trigger)
        stats["status"] = "failed"
        if isinstance(exc, MscSyncHttpError):
            stats["http_status"] = exc.http_status
        stats["error_message"] = str(exc)
        return stats
    finally:
        stats["started_at"] = started_at
        stats["finished_at"] = _now_iso()
        stats["duration_ms"] = int((time.monotonic() - started) * 1000)
        if stats["started_at"] is not None:
            _record_run(stats)
        _sync_lock.release()
