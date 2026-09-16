
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class ZaloMentionOut(BaseModel):
    pos: int
    uid: str
    len: int


class ZaloMessageAsset(BaseModel):
    id: Optional[str] = None
    message_id: Optional[str] = None
    source_url: Optional[str] = None
    storage_path: Optional[str] = None
    storage_url: Optional[str] = None
    status: str = "pending"
    error: Optional[str] = None


class ZaloLibraryMessage(BaseModel):
    id: Optional[str] = None
    user_id: str = "default"
    job_id: Optional[str] = None
    group_id: Optional[str] = None
    group_name: Optional[str] = None
    source_message_id: Optional[str] = None
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    timestamp_text: Optional[str] = None
    time_text: Optional[str] = None
    type: str = "text"
    content: Optional[str] = None
    is_sent: bool = False
    is_deleted: bool = False
    assets: List[ZaloMessageAsset] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    # Zalo tập trung (Mục 7.1 guide) — recall/mentions/forward-engine watermark.
    ts: Optional[int] = None
    cli_msg_id: Optional[str] = None
    mentions: List[ZaloMentionOut] = Field(default_factory=list)
    msg_kind: Optional[str] = None
    raw_content: Optional[Dict[str, Any]] = None
    # Thả cảm xúc (migration 138) — map {uid_người_react: icon}. Field thiếu
    # hẳn (KHÔNG null) khi migration 138 chưa áp lên DB (RPC cũ không có key
    # này trong JSON) — default_factory xử lý đúng case đó. Vẫn thêm
    # validator coerce None -> {} để phòng hờ (giống bug "mentions" trước đây:
    # 1 giá trị NULL rõ ràng cũng làm validate fail toàn bộ nếu không coerce).
    reactions: Dict[str, str] = Field(default_factory=dict)

    @field_validator("mentions", mode="before")
    @classmethod
    def _coerce_null_mentions(cls, value: Any) -> Any:
        # Cot "mentions" (them o migration 127) la NULL cho moi tin nhan cu/khong
        # co @tag - RPC fn_get_zalo_conversation_messages tra thang gia tri cot
        # nen no la None chu khong phai "thieu key" (default_factory chi ap dung
        # khi thieu key). Khong coerce se lam validate fail 100% tin nhan cu,
        # khien API /messages luon 500 va UI khong hien duoc tin nhan nao.
        return [] if value is None else value

    @field_validator("reactions", mode="before")
    @classmethod
    def _coerce_null_reactions(cls, value: Any) -> Any:
        return {} if value is None else value


class ZaloLibraryMessageCreate(BaseModel):
    group_name: Optional[str] = None
    sender_name: Optional[str] = None
    time_text: Optional[str] = None
    type: str = "text"
    content: Optional[str] = None
    asset_urls: List[str] = Field(default_factory=list)


class ZaloLibraryMessageUpdate(BaseModel):
    group_name: Optional[str] = None
    sender_name: Optional[str] = None
    time_text: Optional[str] = None
    type: Optional[str] = None
    content: Optional[str] = None
    is_deleted: Optional[bool] = None


class ZaloLibraryBulkDeleteRequest(BaseModel):
    message_ids: List[str] = Field(default_factory=list)
    group_name: Optional[str] = None
    delete_all_matching: bool = False


class ZaloLibraryBulkDeleteResponse(BaseModel):
    deleted_count: int = 0


class ZaloLibraryGroupSummary(BaseModel):
    group_name: str
    sheet_tab: Optional[str] = None
    message_count: int = 0
    image_count: int = 0
    latest_message_at: Optional[str] = None


class ZaloLibraryListResponse(BaseModel):
    messages: List[ZaloLibraryMessage]
    groups: List[ZaloLibraryGroupSummary] = Field(default_factory=list)
    total: int = 0
    limit: int = 200
    offset: int = 0
    has_more: bool = False


class ZaloConversationSummary(BaseModel):
    conversation_id: str
    conversation_name: str
    account_id: str
    message_count: int = 0
    image_count: int = 0
    sent_count: int = 0
    received_count: int = 0
    latest_message_at: Optional[str] = None
    latest_content: Optional[str] = None
    latest_sender_name: Optional[str] = None
    has_messages: bool = True
    sync_status: str = "has_messages"
    avatar_url: Optional[str] = None
    unread_count: int = 0
    is_pinned: bool = False
    # Zalo tập trung (migration 129) — để FE lọc "chỉ hiện nhóm" cho các trang
    # bulk-send/broadcast-groups/scan-group-members/forward-rules.
    is_friend: bool = False
    thread_type: str = "group"


class ZaloConversationListResponse(BaseModel):
    account_id: str
    conversations: List[ZaloConversationSummary] = Field(default_factory=list)
    total: int = 0
