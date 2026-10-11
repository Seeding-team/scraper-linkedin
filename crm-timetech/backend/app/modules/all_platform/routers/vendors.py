from fastapi import APIRouter, Depends, HTTPException, Query
from app.modules.all_platform.schemas.vendors import VendorCreateRequest, VendorUpdateRequest
from app.modules.all_platform.services.supabase_vendors_service import SupabaseVendorsService
from app.core.supabase_client import get_supabase_client
from typing import List, Optional

router = APIRouter(prefix="", tags=["vendors"])

def get_vendors_service():
    db = get_supabase_client()
    return SupabaseVendorsService(db)

@router.post("")
async def create_vendor(
    req: VendorCreateRequest,
    service: SupabaseVendorsService = Depends(get_vendors_service)
):
    # In a real app we'd extract user_id from token
    # created_by = ...
    return await service.create_vendor(req)

@router.get("")
async def list_vendors(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100),
    service: SupabaseVendorsService = Depends(get_vendors_service)
):
    return await service.list_vendors(search, status, limit)

@router.patch("/{vendor_id}")
async def update_vendor(
    vendor_id: str,
    req: VendorUpdateRequest,
    service: SupabaseVendorsService = Depends(get_vendors_service)
):
    return await service.update_vendor(vendor_id, req)

@router.post("/{vendor_id}/deactivate")
async def deactivate_vendor(
    vendor_id: str,
    service: SupabaseVendorsService = Depends(get_vendors_service)
):
    return await service.deactivate_vendor(vendor_id)
