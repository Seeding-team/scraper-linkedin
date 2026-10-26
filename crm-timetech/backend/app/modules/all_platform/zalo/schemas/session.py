from typing import Optional
from typing import Any
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SessionData:
    """`browser`/`context`/`page` giữ nguyên tên field để tương thích với
    session_store.py/zca_auth_store.py, nhưng luôn `None` trong zalo-module
    (không có luồng QR/Playwright — mọi session tới từ Extension đã
    `confirmed` sẵn, xem api/routes/auth.py::import_session_from_extension)."""

    session_id: str
    user_id: str
    browser: Optional[Any]
    context: Optional[Any]
    page: Optional[Any]
    status: str  # "waiting_scan" | "confirmed" | "qr_expired" | "session_expired"
    qr_base64: Optional[str] = None
    qr_signature: Optional[str] = None
    qr_process: Optional[Any] = None
    zca_auth: Optional[dict] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_used: datetime = field(default_factory=datetime.utcnow)
