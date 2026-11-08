from fastapi import HTTPException
from app.core.logger import logger
from app.modules.all_platform.schemas.vendors import VendorCreateRequest, VendorUpdateRequest

class SupabaseVendorsService:
    def __init__(self, db_client):
        self.db = db_client

    async def create_vendor(self, req: VendorCreateRequest, created_by: str = None) -> dict:
        try:
            data = {
                "name": req.name,
                "status": req.status,
            }
            if req.code: data["code"] = req.code
            if req.short_name: data["short_name"] = req.short_name
            if req.tax_code: data["tax_code"] = req.tax_code
            if req.email: data["email"] = req.email
            if req.phone: data["phone"] = req.phone
            if req.address: data["address"] = req.address
            if req.note: data["note"] = req.note
            if created_by: data["created_by"] = created_by

            response = self.db.table("crm_vendors").insert(data).execute()
            if not response.data:
                raise HTTPException(status_code=400, detail="Failed to create vendor")
            return response.data[0]
        except Exception as e:
            logger.error(f"Error creating vendor: {e}")
            if "crm_vendors_code_idx" in str(e):
                raise HTTPException(status_code=400, detail="Vendor code already exists")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    async def update_vendor(self, vendor_id: str, req: VendorUpdateRequest, updated_by: str = None) -> dict:
        try:
            data = req.dict(exclude_unset=True)
            if not data:
                raise HTTPException(status_code=400, detail="No fields to update")

            if updated_by: data["updated_by"] = updated_by
            import datetime
            data["updated_at"] = datetime.datetime.utcnow().isoformat()

            response = self.db.table("crm_vendors").update(data).eq("id", vendor_id).execute()
            if not response.data:
                raise HTTPException(status_code=404, detail="Vendor not found")
            return response.data[0]
        except Exception as e:
            logger.error(f"Error updating vendor: {e}")
            if "crm_vendors_code_idx" in str(e):
                raise HTTPException(status_code=400, detail="Vendor code already exists")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    async def list_vendors(self, search: str = None, status: str = None, limit: int = 100) -> list:
        try:
            query = self.db.table("crm_vendors").select("*").order("name")
            if status:
                query = query.eq("status", status)
            if search:
                query = query.or_(f"name.ilike.%{search}%,code.ilike.%{search}%,short_name.ilike.%{search}%")

            response = query.limit(limit).execute()
            return response.data
        except Exception as e:
            logger.error(f"Error listing vendors: {e}")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    async def deactivate_vendor(self, vendor_id: str, updated_by: str = None) -> dict:
        return await self.update_vendor(vendor_id, VendorUpdateRequest(status="inactive"), updated_by)
