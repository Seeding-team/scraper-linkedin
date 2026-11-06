"""Schemas cho Facebook Messenger API."""

from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, Field


class ConnectAccountRequest(BaseModel):
    """Yêu cầu kết nối tài khoản Facebook Messenger."""
    cookie: str = Field(..., description="Chuỗi Cookie Facebook (chứa ít nhất c_user và xs)")
    proxy_url: Optional[str] = Field(None, description="Proxy dân cư cố định gắn với nick (http://user:pass@ip:port)")
    user_agent: Optional[str] = Field(None, description="User-Agent của trình duyệt người dùng")
    name: Optional[str] = Field(None, description="Tên gợi nhớ của tài khoản")
    fb_user_id: Optional[str] = Field(None, description="Facebook UID (nếu đã trích xuất)")
    is_shared_with_all: Optional[bool] = Field(False, description="Chia sẻ tài khoản cho toàn bộ thành viên")


class SendMessageRequest(BaseModel):
    """Yêu cầu gửi tin nhắn Messenger."""
    account_id: str = Field(..., description="UUID của tài khoản gửi")
    recipient_id: str = Field(..., description="Facebook UID hoặc Thread ID của người nhận")
    recipient_name: Optional[str] = Field(None, description="Tên người nhận (để cập nhật vào thread)")
    recipient_avatar: Optional[str] = Field(None, description="Avatar người nhận")
    content: str = Field(..., min_length=1, description="Nội dung tin nhắn")
    simulate_human: Optional[bool] = Field(True, description="Bật chuỗi 5 bước mô phỏng nhịp sinh học người thật")


class UnfreezeAccountRequest(BaseModel):
    """Yêu cầu mở đóng băng tài khoản thủ công."""
    account_id: str


class MessengerBaseResponse(BaseModel):
    success: bool
    message: str = ""
    data: Optional[Any] = None
