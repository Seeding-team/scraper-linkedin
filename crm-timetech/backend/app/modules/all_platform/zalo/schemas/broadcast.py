
from typing import List, Literal, Optional
from pydantic import BaseModel, Field

BroadcastContentMode = Literal["text", "image", "both"]


class ZaloBroadcastTarget(BaseModel):
    group_id: Optional[str] = None
    group_name: str


class ZaloBroadcastRequest(BaseModel):
    user_id: Optional[str] = None
    # 2 cách cung cấp nội dung — dùng 1 trong 2:
    #   (a) message_ids: chọn tin đã lưu Library (luồng cũ, giữ tương thích ngược
    #       nếu Library còn được mount — hiện KHÔNG mount nữa, để trống cho luồng mới).
    #   (b) text/image_urls: gõ trực tiếp 1 tin để gửi ngay (Zalo tập trung, guide
    #       Mục 3.3.5 "broadcasts" — không cần khái niệm Library).
    message_ids: List[str] = Field(default_factory=list)
    text: Optional[str] = None
    image_urls: List[str] = Field(default_factory=list)
    targets: List[ZaloBroadcastTarget] = Field(default_factory=list)
    content_mode: BroadcastContentMode = "both"
    text_overrides: Optional[dict[str, str]] = None



class ZaloBroadcastPreviewItem(BaseModel):
    message_id: str
    content: Optional[str] = None
    image_count: int = 0
    image_urls: List[str] = Field(default_factory=list)
    send_text: bool = False
    send_images: bool = False
    warnings: List[str] = Field(default_factory=list)


class ZaloBroadcastPreviewResponse(BaseModel):
    target_count: int
    message_count: int
    items: List[ZaloBroadcastPreviewItem]
    warnings: List[str] = Field(default_factory=list)


class ZaloBroadcastResponse(BaseModel):
    campaign_id: str
    status: str


class ZaloBroadcastLog(BaseModel):
    id: Optional[str] = None
    campaign_id: str
    group_name: str
    message_id: Optional[str] = None
    status: str
    detail: Optional[str] = None


class ZaloBroadcastStatusResponse(BaseModel):
    campaign: dict
    targets: List[dict] = Field(default_factory=list)
    items: List[dict] = Field(default_factory=list)
    logs: List[dict] = Field(default_factory=list)
