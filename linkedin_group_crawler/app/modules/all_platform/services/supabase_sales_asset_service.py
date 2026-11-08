"""Supabase service for the shared sales asset library."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client

from app.core.supabase_client import get_supabase_client

SALES_ASSETS_TABLE = "sales_assets"
CUSTOMER_LEADS_TABLE = "customer_leads"
ACTIVITY_TABLE = "customer_lead_activity_log"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_tags(tags: list[str] | None) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in tags or []:
        tag = str(raw or "").strip()
        key = tag.lower()
        if tag and key not in seen:
            cleaned.append(tag)
            seen.add(key)
    return cleaned


def _share_link(row: dict[str, Any]) -> str:
    return str(row.get("source_url") or row.get("public_url") or row.get("file_url") or "").strip()


def _lead_display_name(row: dict[str, Any] | None) -> str:
    if not row:
        return ""
    return str(row.get("customer_name") or row.get("company_name") or "").strip()


def _row_to_asset(row: dict[str, Any]) -> dict[str, Any]:
    customer = row.get("_customer") or {}
    deal = row.get("_deal") or {}
    return {
        "id": row["id"],
        "type": row.get("type"),
        "title": row.get("title") or "",
        "version": row.get("version") or "",
        "sourceType": row.get("source_type") or "external",
        "sourceUrl": row.get("source_url") or "",
        "description": row.get("description") or "",
        "tags": row.get("tags") or [],
        "industry": row.get("industry") or "",
        "servicePackage": row.get("service_package") or "",
        "customerLeadId": row.get("customer_lead_id"),
        "customerName": _lead_display_name(customer),
        "customerCompanyName": customer.get("company_name") or "",
        "dealId": row.get("deal_id"),
        "dealName": _lead_display_name(deal),
        "projectName": row.get("project_name") or _lead_display_name(deal) or "",
        "fileUrl": row.get("file_url") or "",
        "publicUrl": row.get("public_url") or "",
        "thumbnailUrl": row.get("thumbnail_url") or "",
        "status": row.get("status") or "active",
        "createdBy": row.get("created_by"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "archivedAt": row.get("archived_at"),
        "shareUrl": _share_link(row),
    }


def _hydrate_asset_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = {
        value
        for row in rows
        for value in (row.get("customer_lead_id"), row.get("deal_id"))
        if value
    }
    if not ids:
        return rows

    supabase: Client = get_supabase_client()
    leads_res = (
        supabase.table(CUSTOMER_LEADS_TABLE)
        .select("id, customer_name, company_name, conv_id, service_package")
        .in_("id", list(ids))
        .execute()
    )
    lead_map = {row["id"]: row for row in (leads_res.data or [])}
    for row in rows:
        row["_customer"] = lead_map.get(row.get("customer_lead_id")) or {}
        row["_deal"] = lead_map.get(row.get("deal_id")) or {}
    return rows


def _matches_search(row: dict[str, Any], search: str | None) -> bool:
    if not search:
        return True
    needle = search.strip().lower()
    if not needle:
        return True
    fields = [
        _lead_display_name(row.get("_customer")),
        _lead_display_name(row.get("_deal")),
        row.get("title"),
        row.get("description"),
        row.get("project_name"),
        row.get("version"),
        row.get("source_url"),
        row.get("industry"),
        row.get("service_package"),
        " ".join(row.get("tags") or []),
    ]
    return any(needle in str(value or "").lower() for value in fields)


def list_sales_assets(
    *,
    search: str | None = None,
    asset_type: str | None = None,
    status: str | None = None,
    customer_lead_id: str | None = None,
    deal_id: str | None = None,
    project_name: str | None = None,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    supabase: Client = get_supabase_client()
    query = supabase.table(SALES_ASSETS_TABLE).select("*")
    if asset_type:
        query = query.eq("type", asset_type)
    if status:
        query = query.eq("status", status)
    elif not include_archived:
        query = query.neq("status", "archived")
    if customer_lead_id:
        query = query.eq("customer_lead_id", customer_lead_id)
    if deal_id:
        query = query.eq("deal_id", deal_id)
    if project_name:
        query = query.eq("project_name", project_name)

    result = query.order("updated_at", desc=True).execute()
    rows = _hydrate_asset_rows(result.data or [])
    rows = [row for row in rows if _matches_search(row, search)]
    return [_row_to_asset(row) for row in rows]


def get_sales_asset(asset_id: str) -> dict[str, Any]:
    # BUG THAT DA GAP: .single() nem APIError tho (PGRST116) khi 0 dong khop -
    # khien nhanh "if not result.data" ben duoi thanh dead code. Doi sang .maybe_single().
    supabase: Client = get_supabase_client()
    result = supabase.table(SALES_ASSETS_TABLE).select("*").eq("id", asset_id).maybe_single().execute()
    if not result or not result.data:
        raise ValueError("Tai lieu ban hang khong ton tai.")
    return _row_to_asset(_hydrate_asset_rows([result.data])[0])


def create_sales_asset(payload: dict[str, Any], created_by: str | None = None) -> dict[str, Any]:
    supabase: Client = get_supabase_client()
    insert_data = {
        "customer_lead_id": payload.get("customer_lead_id") or None,
        "deal_id": payload.get("deal_id") or None,
        "project_name": payload.get("project_name") or "",
        "type": payload["type"],
        "title": payload["title"].strip(),
        "version": payload.get("version") or "v1",
        "source_type": payload.get("source_type") or "external",
        "source_url": payload.get("source_url") or payload.get("public_url") or payload.get("file_url") or "",
        "description": payload.get("description") or "",
        "tags": _clean_tags(payload.get("tags")),
        "industry": payload.get("industry") or "",
        "service_package": payload.get("service_package") or "",
        "file_url": payload.get("file_url") or "",
        "public_url": payload.get("public_url") or "",
        "thumbnail_url": payload.get("thumbnail_url") or "",
        "status": payload.get("status") or "active",
        "created_by": created_by,
    }
    result = supabase.table(SALES_ASSETS_TABLE).insert(insert_data).execute()
    return _row_to_asset(_hydrate_asset_rows([result.data[0]])[0])


def update_sales_asset(asset_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    supabase: Client = get_supabase_client()
    update_data: dict[str, Any] = {}
    field_map = {
        "type": "type",
        "title": "title",
        "version": "version",
        "source_type": "source_type",
        "source_url": "source_url",
        "description": "description",
        "tags": "tags",
        "industry": "industry",
        "service_package": "service_package",
        "customer_lead_id": "customer_lead_id",
        "deal_id": "deal_id",
        "project_name": "project_name",
        "file_url": "file_url",
        "public_url": "public_url",
        "thumbnail_url": "thumbnail_url",
        "status": "status",
    }
    for api_key, db_key in field_map.items():
        if api_key in payload:
            value = payload[api_key]
            if api_key == "tags":
                value = _clean_tags(value)
            if api_key == "title" and isinstance(value, str):
                value = value.strip()
            update_data[db_key] = value if value is not None else (None if api_key in {"customer_lead_id", "deal_id"} else "")
    if not update_data:
        return get_sales_asset(asset_id)
    update_data["updated_at"] = _now_iso()
    if update_data.get("status") != "archived":
        update_data["archived_at"] = None
    result = supabase.table(SALES_ASSETS_TABLE).update(update_data).eq("id", asset_id).execute()
    if not result.data:
        raise ValueError("Tai lieu ban hang khong ton tai.")
    return _row_to_asset(_hydrate_asset_rows([result.data[0]])[0])


def archive_sales_asset(asset_id: str) -> dict[str, Any]:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(SALES_ASSETS_TABLE)
        .update({"status": "archived", "archived_at": _now_iso(), "updated_at": _now_iso()})
        .eq("id", asset_id)
        .execute()
    )
    if not result.data:
        raise ValueError("Tai lieu ban hang khong ton tai.")
    return _row_to_asset(_hydrate_asset_rows([result.data[0]])[0])


def delete_sales_asset(asset_id: str) -> bool:
    """Xoa han (hard delete) 1 tai lieu ban hang khoi sales_assets."""
    supabase: Client = get_supabase_client()
    result = supabase.table(SALES_ASSETS_TABLE).delete().eq("id", asset_id).execute()
    if not result.data:
        raise ValueError("Tai lieu ban hang khong ton tai.")
    return True


def _find_lead(payload: dict[str, Any]) -> dict[str, Any] | None:
    supabase: Client = get_supabase_client()
    deal_id = payload.get("deal_id")
    conversation_id = payload.get("conversation_id")
    if deal_id:
        result = supabase.table(CUSTOMER_LEADS_TABLE).select("*").eq("id", deal_id).limit(1).execute()
        return (result.data or [None])[0]
    if conversation_id:
        result = (
            supabase.table(CUSTOMER_LEADS_TABLE)
            .select("*")
            .eq("conv_id", conversation_id)
            .limit(1)
            .execute()
        )
        return (result.data or [None])[0]
    return None


def _write_selected_activity(asset: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any], link: str) -> str | None:
    lead = _find_lead(payload)
    if not lead:
        return None

    supabase: Client = get_supabase_client()
    actor_name = actor.get("name") or actor.get("email") or actor.get("id")
    note = payload.get("note") or f"Da chon tai lieu {asset['title']} de chen vao hoi thoai"
    log_entry = {
        "customer_id": lead["id"],
        "action": "sales_asset_selected",
        "actor_id": actor.get("id"),
        "actor_name": actor_name,
        "note": note,
        "attachment_url": link,
        "attachment_name": asset["title"],
        "field": f"sales_asset:{asset['type']}",
        "new_value": link,
    }
    log_entry = {key: value for key, value in log_entry.items() if value is not None}
    supabase.table(ACTIVITY_TABLE).insert(log_entry).execute()
    return lead["id"]


def send_sales_asset(asset_id: str, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    asset = get_sales_asset(asset_id)
    if asset["status"] == "archived":
        raise ValueError("Tai lieu nay da duoc luu tru.")
    link = asset.get("shareUrl") or asset.get("publicUrl") or asset.get("fileUrl")
    if not link:
        raise ValueError("Tai lieu chua co file URL hoac public URL de gui.")

    # This endpoint prepares/selects a document link. It must not log
    # sales_asset_sent because the actual chat message is sent by the inbox flow.
    logged_deal_id = _write_selected_activity(asset, payload, actor, link)
    meta = " - ".join(part for part in [asset.get("projectName"), asset.get("version")] if part)
    message_text = f"{asset['title']}{f' ({meta})' if meta else ''}\n{link}"
    return {
        "asset": asset,
        "link": link,
        "messageText": message_text,
        "logged": bool(logged_deal_id),
        "dealId": logged_deal_id,
        "platform": payload.get("platform") or "",
        "sendMode": payload.get("send_mode") or "link",
    }
