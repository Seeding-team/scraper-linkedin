from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class VendorCreateRequest(BaseModel):
    code: Optional[str] = None
    name: str
    short_name: Optional[str] = None
    tax_code: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    note: Optional[str] = None
    status: str = "active"

class VendorUpdateRequest(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    short_name: Optional[str] = None
    tax_code: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None
