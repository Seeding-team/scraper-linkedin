from __future__ import annotations

import datetime
import os
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile

from app.core.config import settings
from app.core.logger import logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import create_service_catalog_item, update_service_catalog_item
from app.modules.all_platform.services.supabase_vendor_imports_service import SupabaseVendorImportsService
from app.modules.all_platform.services.vendor_ai_parse_service import VendorAIParsingService

router = APIRouter()


def get_imports_service():
    return SupabaseVendorImportsService(get_supabase_client())


def get_instance():
    return settings.crm_instance or "markee"


def _to_float(value, default=None):
    if value is None or value == "":
        return default
    return float(value)


def _base_converted_vnd(item: dict, exchange_rate: float) -> float | None:
    """Gia da quy doi ty gia (VND) - net_price * exchange_rate neu currency
    USD, giu nguyen neu VND. KHONG cong shipping_cost/other_cost - dung cho
    truong "quy doi ty gia thuan tuy" (supplier_converted_price), khac voi
    gia von cuoi cung (_final_cost_vnd)."""
    net_price = item.get("net_price")
    if net_price is None:
        return None
    if item.get("currency") == "USD":
        return float(net_price) * float(exchange_rate or 1)
    return float(net_price)


def _final_cost_vnd(item: dict, exchange_rate: float) -> float | None:
    """Gia von CUOI CUNG (VND) = gia da quy doi ty gia + phi van chuyen +
    chi phi khac. CUNG 1 cong thuc voi Step 3 preview o frontend
    (usePricingLogic.ts: costPriceVnd = supplierConvertedPrice + shippingCost
    + otherCost) - truoc day _approve_product_catalog()/_approve_cost_price_book()
    chi dung _base_converted_vnd() (thieu shipping/other_cost) de luu
    default_cost_price_vnd/unit_price_vnd_direct, gay lech voi so Step 3 da
    hien thi cho nguoi dung xem truoc khi Approve (bug that da audit). Day la
    ham DUY NHAT tinh "gia von" that su - dung lai o CA 2 scope thay vi tinh
    rieng."""
    base = _base_converted_vnd(item, exchange_rate)
    if base is None:
        return None
    shipping = float(item.get("shipping_cost") or 0)
    other = float(item.get("other_cost") or 0)
    return base + shipping + other


@router.post("/batches")
async def upload_batch(
    vendor_id: str = Form(...),
    project_id: Optional[str] = Form(None),
    exchange_rate: float = Form(1.0),
    target_scope: str = Form(...),
    default_group_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    try:
        content = await file.read()
        batch_id = str(uuid.uuid4())
        file_path = f"vendor_imports/{batch_id}/{file.filename}"
        user_id = "00000000-0000-0000-0000-000000000000"
        db = get_supabase_client()

        batch = await service.create_batch(
            instance=instance,
            user_id=user_id,
            vendor_id=vendor_id,
            project_id=project_id,
            exchange_rate=exchange_rate,
            target_scope=target_scope,
            file_name=file.filename,
            file_size=len(content),
            file_type=file.content_type,
            file_path=file_path,
            id=batch_id,
            default_group_id=default_group_id,
        )

        try:
            db.storage.from_("crm-attachments").upload(
                path=file_path,
                file=content,
                file_options={"content-type": file.content_type},
            )
        except Exception as e:
            await service.update_batch_status(batch["id"], instance, "failed", error=f"Upload failed: {e}")
            raise

        # Khong tu dong chay OCR ngay sau upload nua - batch dung o 'uploaded'
        # cho toi khi nguoi dung bam "Chay OCR + AI" (goi /retry, xem
        # VendorImportFlow.tsx). Truoc day auto-fire ngay o day khien FE
        # nhan lai batch con o status 'uploaded' (response nay tra ve TRUOC
        # khi background task chay xong) nhung khong co dieu kien nao poll
        # lai cho status 'uploaded', nen UI ket dung mai o trang thai cu.
        return batch
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in upload_batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def process_ocr_extraction(batch_id: str, instance: str, file_path: str, content_type: str, db):
    service = SupabaseVendorImportsService(db)
    await service.update_batch_status(batch_id, instance, "extracting")
    try:
        batch_row = await service.get_batch(batch_id, instance)
        default_group_id = batch_row.get("default_group_id")

        file_bytes = db.storage.from_("crm-attachments").download(file_path)
        file_name = os.path.basename(file_path)
        parsed_data, raw_text = await VendorAIParsingService.parse_file(file_bytes, content_type, file_name)

        # catalog_map luu ca parent_id (nhom That cua san pham da co) - SKU
        # khop voi 1 san pham co san PHAI giu nguyen nhom canonical cua no,
        # KHONG duoc doi sang "Nhom san pham mac dinh" cua lan import nay
        # (yeu cau that: "Import gia Vendor khong duoc tu doi nhom cua
        # existing SKU").
        catalog_res = db.table("service_catalog_items").select("id, sku, part_number, parent_id").execute()
        catalog_map: dict[str, dict] = {}
        for item in catalog_res.data or []:
            for key in (item.get("sku"), item.get("part_number")):
                if key and str(key).strip():
                    catalog_map[str(key).strip().lower()] = {"id": item["id"], "parent_id": item.get("parent_id")}

        items = []
        for row in parsed_data:
            if not row.get("name"):
                continue

            sku_val = row.get("sku")
            matched_id = None
            mapping_action = "new"
            # SKU moi (chua khop) -> tien dien Nhom san pham mac dinh da chon
            # o Step 1. SKU khop san pham co san -> giu dung nhom canonical
            # cua chinh no, khong dung default_group_id.
            resolved_group_id = default_group_id
            match = catalog_map.get(str(sku_val).strip().lower()) if sku_val else None
            if match:
                matched_id = match["id"]
                mapping_action = "existing"
                resolved_group_id = match.get("parent_id")

            items.append(
                {
                    "batch_id": batch_id,
                    "matched_catalog_item_id": matched_id,
                    "mapping_action": mapping_action,
                    "group_id": resolved_group_id,
                    "sku": sku_val,
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "quantity": _to_float(row.get("quantity"), 1.0),
                    "uom": row.get("uom"),
                    "brand": row.get("brand"),
                    "currency": "USD" if str(row.get("currency")).upper() == "USD" else "VND",
                    "list_price": _to_float(row.get("list_price")),
                    "discount_percent": _to_float(row.get("discount_percent")),
                    "net_price": _to_float(row.get("net_price")),
                    "vat_rate": _to_float(row.get("vat_rate")),
                    "confidence": 0.8,
                    "warnings": [],
                    "raw_extraction": {"source_row": row, "raw_text_excerpt": raw_text[:1000]},
                    "normalized_json": row,
                }
            )

        await service.insert_items(items)
        # extraction_meta la JSONB (khong can migration de them field) - dung
        # ai_configured de FE phan biet "0 dong vi file rong/khong doc duoc"
        # voi "0 dong vi chua cau hinh AI, dang dung fallback parser chi hieu
        # bang dang '|'" (xem vendor_ai_parse_service.normalize_text_with_llm).
        ai_configured = bool(settings.gemini_api_key or settings.openai_api_key)
        await service.update_batch_status(
            batch_id, instance, "review",
            meta={"rows": len(items), "confidence": 0.8, "ai_configured": ai_configured},
        )
    except Exception as e:
        logger.error(f"OCR Extraction failed: {e}")
        await service.update_batch_status(batch_id, instance, "failed", error=str(e))


@router.get("/batches")
async def list_batches(
    limit: int = Query(50),
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    return await service.list_batches(instance, limit)


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: str,
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    return await service.get_batch(batch_id, instance)


@router.get("/batches/{batch_id}/items")
async def get_batch_items(
    batch_id: str,
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    return await service.get_batch_items(batch_id, instance)


@router.patch("/batches/{batch_id}/items/{item_id}")
async def update_item(
    batch_id: str,
    item_id: str,
    data: dict,
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    user_id = "00000000-0000-0000-0000-000000000000"
    return await service.update_item(item_id, batch_id, instance, data, user_id)


@router.post("/batches/{batch_id}/retry")
async def retry_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    batch = await service.get_batch(batch_id, instance)
    if batch["status"] not in ["failed", "uploaded", "review"]:
        raise HTTPException(status_code=400, detail="Chi retry batch failed/uploaded/review.")

    await service.reset_items_for_retry(batch_id, instance)
    db = get_supabase_client()
    background_tasks.add_task(
        process_ocr_extraction,
        batch["id"],
        instance,
        batch["source_file_path"],
        batch.get("source_file_type") or "",
        db,
    )
    return {"status": "retrying"}


@router.post("/batches/{batch_id}/approve")
async def approve_batch(
    batch_id: str,
    service: SupabaseVendorImportsService = Depends(get_imports_service),
    instance: str = Depends(get_instance),
):
    db = get_supabase_client()
    batch = await service.get_batch(batch_id, instance)
    if batch["status"] == "approved":
        return {"status": "already_approved"}
    if batch["status"] != "review":
        raise HTTPException(status_code=400, detail="Chi approve batch o trang thai review.")

    items = await service.get_batch_items(batch_id, instance)
    if any(item.get("review_status") == "pending" for item in items):
        raise HTTPException(status_code=400, detail="Khong the approve khi con dong pending.")

    to_process = [it for it in items if it["review_status"] in ["mapped", "new"]]
    scope = batch["target_scope"]

    if scope == "cost_price_book":
        await _approve_cost_price_book(db, batch, to_process)
    elif scope == "product_catalog":
        await _approve_product_catalog(batch, to_process)
    elif scope != "project_only":
        raise HTTPException(status_code=400, detail="target_scope khong hop le.")

    await service.update_batch_status(batch_id, instance, "approved")
    return {"status": "approved", "processed": len(to_process)}


async def _approve_cost_price_book(db, batch: dict, items: list[dict]) -> None:
    code = f"VENDOR_{batch['vendor_id']}"
    res_pb = db.table("price_books").select("id").eq("code", code).execute()
    if res_pb.data:
        pb_id = res_pb.data[0]["id"]
    else:
        res_comp = db.table("quote_issuer_companies").select("id").limit(1).execute()
        if not res_comp.data:
            raise HTTPException(status_code=400, detail="Chua co don vi phat hanh de tao price book.")
        created = (
            db.table("price_books")
            .insert(
                {
                    "code": code,
                    "name": f"Vendor Price Book {batch['vendor_id']}",
                    "issuer_company_id": res_comp.data[0]["id"],
                }
            )
            .execute()
        )
        pb_id = created.data[0]["id"]

    last_version = (
        db.table("price_book_versions")
        .select("version")
        .eq("price_book_id", pb_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    next_version = int(last_version.data[0]["version"]) + 1 if last_version.data else 1
    now = datetime.datetime.utcnow().isoformat()
    db.table("price_book_versions").update({"status": "archived", "updated_at": now}).eq("price_book_id", pb_id).eq(
        "status", "published"
    ).execute()
    version = (
        db.table("price_book_versions")
        .insert(
            {
                "price_book_id": pb_id,
                "version": next_version,
                "status": "published",
                "effective_date": now,
                "published_at": now,
            }
        )
        .execute()
    )
    version_id = version.data[0]["id"]
    vendor = batch.get("crm_vendors") or {}

    rows = []
    for index, item in enumerate(items, start=1):
        # unit_price_vnd_direct la "gia von" that su - phai la final_cost_vnd
        # (co cong shipping/other_cost), khong phai chi gia quy doi ty gia
        # thuan tuy (bug that da audit: Step 3 hien 61.993.500 nhung truoc day
        # chi luu 61.992.000, thieu shipping+other). price_book_items KHONG co
        # cot shipping_cost/other_cost rieng (audit xac nhan schema that -
        # KHONG them cot moi o day, chi gap that duoc bao cao, khong tu bia) -
        # nen 2 khoan nay chi con the "an" trong tong cost, khong tach rieng
        # duoc. quote_received_date la cot that san co, dung de luu quote_date.
        final_cost = _final_cost_vnd(item, batch["exchange_rate"])
        rows.append(
            {
                "price_book_version_id": version_id,
                "source_sheet": f"IMPORT_{batch['id']}",
                "source_stt": str(index),
                "sku": item.get("sku") or f"IMPORT-{batch['id'][:8]}-{index}",
                "name": item["name"],
                "description": item.get("description"),
                "unit": item.get("uom"),
                "default_quantity": item.get("quantity") or 1,
                "cost_mode": "vnd",
                "vendor_name": vendor.get("name"),
                "unit_price_vnd_direct": final_cost,
                "exchange_rate": batch["exchange_rate"],
                "vat_in_percent": item.get("vat_rate") or 0,
                "vat_eu_percent": item.get("vat_rate") or 0,
                "quote_received_date": item.get("quote_date"),
            }
        )
    if rows:
        db.table("price_book_items").insert(rows).execute()


async def _approve_product_catalog(batch: dict, items: list[dict]) -> None:
    db = get_supabase_client()
    # Fallback CUOI CUNG - chi dung khi item khong co group_id nao ca (vd
    # batch tao truoc migration 132, hoac nguoi dung khong chon "Nhom san
    # pham mac dinh" o Step 1) - KHONG con dung lam gia tri CHINH cho moi
    # SKU moi nhu truoc day (bug that: moi SKU moi deu bi don vao 1 nhom
    # cung/tu dong tao, khong theo lua chon that cua nguoi dung).
    fallback_group_id = None
    for item in items:
        # supplier_converted_price = quy doi ty gia THUAN TUY (khong cong
        # shipping/other) - dung dung nghia cua truong nay (gia NCC da quy
        # doi, chua tinh chi phi logistics). default_cost_price_vnd = gia von
        # CUOI CUNG (final_cost_vnd, co cong shipping/other) - truoc day ca 2
        # truong nay dung CHUNG 1 gia tri thieu shipping/other (bug that da
        # audit + Step 3 UI da hien dung so nhung Approve luu sai).
        converted = _base_converted_vnd(item, batch["exchange_rate"])
        final_cost = _final_cost_vnd(item, batch["exchange_rate"])
        group_id = item.get("group_id")
        if not group_id and item["review_status"] == "new":
            if fallback_group_id is None:
                fallback_group_id = _resolve_vendor_import_group_id(db)
            group_id = fallback_group_id
        payload = {
            "item_type": "component",
            "parent_id": group_id,
            "name": item["name"],
            "sku": item.get("sku"),
            "description": item.get("description"),
            "unit": item.get("uom"),
            "brand": item.get("brand"),
            "default_vat_rate": item.get("vat_rate") or 0,
            "supplier_currency": item.get("currency"),
            "supplier_list_price": item.get("list_price"),
            "supplier_discount_percent": item.get("discount_percent"),
            "supplier_net_price": item.get("net_price"),
            "supplier_exchange_rate": batch["exchange_rate"],
            "supplier_converted_price": converted,
            "supplier_vendor_id": batch["vendor_id"],
            "supplier_quote_source": batch["source_file_name"],
            "supplier_quote_date": item.get("quote_date"),
            "shipping_cost": item.get("shipping_cost"),
            "other_cost": item.get("other_cost"),
            "default_cost_price_vnd": final_cost,
        }
        if item["review_status"] == "new":
            create_service_catalog_item(payload, None)
        elif item["review_status"] == "mapped" and item.get("matched_catalog_item_id"):
            update_service_catalog_item(item["matched_catalog_item_id"], payload, None)


def _resolve_vendor_import_group_id(db) -> str:
    groups = (
        db.table("service_catalog_items")
        .select("id")
        .eq("item_type", "group")
        .eq("status", "active")
        .order("sort_order")
        .limit(1)
        .execute()
        .data
        or []
    )
    if groups:
        return groups[0]["id"]
    created = (
        db.table("service_catalog_items")
        .insert(
            {
                "item_type": "group",
                "name": "Vendor Import",
                "status": "active",
                "sort_order": 0,
            }
        )
        .execute()
        .data
    )
    if not created:
        raise HTTPException(status_code=400, detail="Khong tao duoc nhom san pham cho Vendor Import.")
    return created[0]["id"]
