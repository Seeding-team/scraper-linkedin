from fastapi import HTTPException
from app.core.logger import logger
import uuid
import datetime

class SupabaseVendorImportsService:
    def __init__(self, db_client):
        self.db = db_client

    async def create_batch(self, instance: str, user_id: str, vendor_id: str, project_id: str, exchange_rate: float, target_scope: str, file_name: str, file_size: int, file_type: str, file_path: str, id: str = None, default_group_id: str = None):
        try:
            data = {
                "instance": instance,
                "vendor_id": vendor_id,
                "exchange_rate": exchange_rate,
                "target_scope": target_scope,
                "source_file_path": file_path,
                "source_file_name": file_name,
                "source_file_size": file_size,
                "source_file_type": file_type,
                "status": "uploaded",
                "created_by": user_id
            }
            if project_id: data["project_id"] = project_id
            if id: data["id"] = id
            if default_group_id: data["default_group_id"] = default_group_id
            response = self.db.table("vendor_import_batches").insert(data).execute()
            if not response.data:
                raise HTTPException(status_code=400, detail="Failed to create batch")
            return response.data[0]
        except Exception as e:
            logger.error(f"Error creating batch: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    async def update_batch_status(
        self,
        batch_id: str,
        instance: str,
        status: str,
        meta: dict = None,
        error: str = None,
        approved_by: str | None = None,
    ):
        try:
            data = {"status": status}
            if meta: data["extraction_meta"] = meta
            if error: data["error_message"] = error
            if status == "extracting": data["extraction_started_at"] = datetime.datetime.utcnow().isoformat()
            if status in ["review", "failed"]: data["extraction_completed_at"] = datetime.datetime.utcnow().isoformat()
            if status == "approved":
                data["approved_at"] = datetime.datetime.utcnow().isoformat()
                if approved_by:
                    data["approved_by"] = approved_by

            response = self.db.table("vendor_import_batches").update(data).eq("id", batch_id).eq("instance", instance).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error updating batch status: {e}")

    async def insert_items(self, items: list):
        if not items: return
        try:
            self.db.table("vendor_import_items").insert(items).execute()
        except Exception as e:
            logger.error(f"Error inserting items: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    async def list_batches(self, instance: str, limit: int = 50):
        try:
            res = self.db.table("vendor_import_batches").select("*, crm_vendors(*)").eq("instance", instance).order("created_at", desc=True).limit(limit).execute()
            return res.data
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def get_batch(self, batch_id: str, instance: str):
        try:
            res = self.db.table("vendor_import_batches").select("*, crm_vendors(*)").eq("id", batch_id).eq("instance", instance).execute()
            if not res.data: raise HTTPException(status_code=404, detail="Batch not found")
            return res.data[0]
        except HTTPException: raise
        except Exception as e: raise HTTPException(status_code=500, detail=str(e))

    async def get_batch_items(self, batch_id: str, instance: str):
        # Verify batch instance
        await self.get_batch(batch_id, instance)
        try:
            res = self.db.table("vendor_import_items").select("*").eq("batch_id", batch_id).order("created_at").execute()
            return res.data
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def reset_items_for_retry(self, batch_id: str, instance: str):
        await self.get_batch(batch_id, instance)
        try:
            self.db.table("vendor_import_items").delete().eq("batch_id", batch_id).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def update_item(self, item_id: str, batch_id: str, instance: str, data: dict, user_id: str):
        # Verify batch instance
        await self.get_batch(batch_id, instance)
        try:
            data["reviewed_by"] = user_id
            data["reviewed_at"] = datetime.datetime.utcnow().isoformat()
            if data.get("mapping_action") == "ignored":
                data["review_status"] = "ignored"
            elif data.get("mapping_action") == "existing":
                data["review_status"] = "mapped"
            elif data.get("mapping_action") == "new":
                data["review_status"] = "new"

            res = self.db.table("vendor_import_items").update(data).eq("id", item_id).eq("batch_id", batch_id).execute()
            if not res.data: raise HTTPException(status_code=404, detail="Item not found")
            return res.data[0]
        except HTTPException: raise
        except Exception as e: raise HTTPException(status_code=500, detail=str(e))
