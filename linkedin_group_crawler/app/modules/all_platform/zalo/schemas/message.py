from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class Mention(BaseModel):
    pos: int
    uid: str
    len: int


class Message(BaseModel):
    message_id: str
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    timestamp: Optional[str] = None
    time_text: Optional[str] = None
    type: str = "text"  # "text" | "image" | "sticker" | "file" | "system"
    content: Optional[str] = None
    image_urls: List[str] = []
    reply_to_id: Optional[str] = None
    is_deleted: bool = False
    is_sent: bool = False
    group_id: Optional[str] = None
    # Zalo tập trung (port ZALO_CENTRALIZED_MODULE_GUIDE.md) — Mục 7.1:
    ts: Optional[int] = None  # epoch ms, dùng cho watermark cursor forward engine
    cli_msg_id: Optional[str] = None  # bắt buộc (cùng message_id thật) để thu hồi tin
    mentions: List[Mention] = []
    msg_kind: Optional[str] = None  # text|image|gif|video|sticker|file|voice|link|system_notice
    raw_content: Optional[Dict[str, Any]] = None  # payload gốc (sticker id/cateId, system notice...)


