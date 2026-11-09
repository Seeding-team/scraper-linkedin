"""Facebook Messenger Direct API Service.

Thực thi chuỗi 5 bước sinh học người thật (Human Behavioral Loop), tạo offline_threading_id,
gọi Direct API Meta và lưu vết đồng bộ vào Supabase.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import requests

from app.core.supabase_client import get_supabase_client
from app.modules.facebook.src.modules.messenger.constants import (
    FB_ERROR_TEMPORARILY_BLOCKED,
    FB_ERROR_CHECKPOINT,
    FB_ERROR_SESSION_EXPIRED,
    TYPING_CHAR_DELAY_MIN,
    TYPING_CHAR_DELAY_MAX,
    PUNCTUATION_PAUSE_MIN,
    PUNCTUATION_PAUSE_MAX,
    READ_LATENCY_MIN,
    READ_LATENCY_MAX,
    LINGER_LATENCY_MIN,
    LINGER_LATENCY_MAX,
)
from app.modules.facebook.src.modules.messenger.services.fb_circuit_breaker import FbCircuitBreaker

logger = logging.getLogger("fb_messenger.service")

# User-Agent mặc định chuẩn Chrome 128 Desktop trên Windows 11
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

# Headers chuẩn xác 100% mô phỏng Chrome Browser chống Bot-Detection (WAF/Shape Security)
CHROME_BROWSER_HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-CH-UA": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


class FbMessengerService:
    """Service điều phối gửi tin và quản lý tài khoản Messenger."""

    @staticmethod
    def parse_cookie_string(cookie_str: str) -> Dict[str, str]:
        """Tách chuỗi cookie thành dictionary key-value."""
        cookies: Dict[str, str] = {}
        if not cookie_str:
            return cookies
        for item in cookie_str.split(";"):
            item = item.strip()
            if not item or "=" not in item:
                continue
            k, v = item.split("=", 1)
            cookies[k.strip()] = v.strip()
        return cookies

    @staticmethod
    def extract_fb_user_id(cookies: Dict[str, str]) -> Optional[str]:
        """Trích xuất c_user từ cookie."""
        return cookies.get("c_user")

    @classmethod
    def extract_dtsg_tokens(
        cls, cookies: Dict[str, str], user_agent: str, proxy_url: Optional[str] = None
    ) -> Tuple[Optional[str], Optional[str]]:
        """Lấy token fb_dtsg và jazoest từ Facebook Web."""
        proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
        headers = {
            "User-Agent": user_agent or DEFAULT_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        }

        # Thử lấy từ mbasic trước (nhanh và nhẹ nhất)
        try:
            r = requests.get(
                "https://mbasic.facebook.com/messages/",
                cookies=cookies,
                headers=headers,
                proxies=proxies,
                timeout=12,
            )
            html = r.text

            # Regex tìm fb_dtsg
            dtsg_m = re.search(r'name="fb_dtsg"\s+value="([^"]+)"', html)
            jazoest_m = re.search(r'name="jazoest"\s+value="([^"]+)"', html)

            fb_dtsg = dtsg_m.group(1) if dtsg_m else None
            jazoest = jazoest_m.group(1) if jazoest_m else None

            if fb_dtsg:
                return fb_dtsg, jazoest
        except Exception as e:
            logger.warning(f"Failed to fetch dtsg from mbasic: {e}")

        # Thử fallback qua www.facebook.com
        try:
            r = requests.get(
                "https://www.facebook.com/messages/t/",
                cookies=cookies,
                headers=headers,
                proxies=proxies,
                timeout=15,
            )
            html = r.text

            dtsg_m = re.search(r'"DTSGInitialData",\[\],\{"token":"([^"]+)"\}', html)
            jazoest_m = re.search(r'jazoest=(\d+)', html)

            fb_dtsg = dtsg_m.group(1) if dtsg_m else None
            jazoest = jazoest_m.group(1) if jazoest_m else None

            return fb_dtsg, jazoest
        except Exception as e:
            logger.warning(f"Failed to fetch dtsg from www: {e}")

        return None, None

    @classmethod
    def connect_account(
        cls,
        cookie_str: str,
        name: Optional[str] = None,
        proxy_url: Optional[str] = None,
        user_agent: Optional[str] = None,
        fb_user_id: Optional[str] = None,
        is_shared_with_all: bool = False,
        id_member: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Xác thực và lưu tài khoản Messenger mới vào cơ sở dữ liệu."""
        sb = get_supabase_client()
        cookies = cls.parse_cookie_string(cookie_str)
        uid = fb_user_id or cls.extract_fb_user_id(cookies)

        if not uid:
            return {
                "success": False,
                "message": "Cookie không hợp lệ: Thiếu định danh c_user (Facebook UID).",
            }

        ua = user_agent or DEFAULT_USER_AGENT
        fb_dtsg, jazoest = cls.extract_dtsg_tokens(cookies, ua, proxy_url)

        account_name = name or f"Facebook User {uid}"
        now_iso = datetime.now(timezone.utc).isoformat()

        payload: Dict[str, Any] = {
            "fb_user_id": uid,
            "name": account_name,
            "cookie": cookie_str,
            "fb_dtsg": fb_dtsg,
            "jazoest": jazoest,
            "proxy_url": proxy_url,
            "user_agent": ua,
            "status": "connected",
            "is_active": True,
            "is_shared_with_all": is_shared_with_all,
            "id_member": id_member,
            "updated_at": now_iso,
        }

        try:
            # Upsert theo fb_user_id
            res = (
                sb.table("fb_messenger_accounts")
                .upsert(payload, on_conflict="fb_user_id")
                .execute()
            )
            saved = res.data[0] if res.data else payload
            return {
                "success": True,
                "message": "Kết nối tài khoản Facebook Messenger thành công!",
                "data": saved,
            }
        except Exception as e:
            logger.exception(f"Error saving fb_messenger_account: {e}")
            return {"success": False, "message": f"Lỗi lưu trữ tài khoản: {e}"}

    @classmethod
    def send_typing_ping(
        cls,
        account_id: str,
        thread_id: str,
        state: int,
        fb_dtsg: str,
        jazoest: str,
        cookies: Dict[str, str],
        ua: str,
        proxies: Optional[Dict[str, str]] = None,
    ) -> None:
        """Phát tín hiệu typing thật sự lên Facebook (state=1: Đang gõ, state=0: Dừng gõ)."""
        typ_url = "https://www.facebook.com/ajax/messaging/typ.php"
        headers = {
            "User-Agent": ua,
            "Referer": f"https://www.facebook.com/messages/t/{thread_id}",
            "Origin": "https://www.facebook.com",
            "Content-Type": "application/x-www-form-urlencoded",
            **CHROME_BROWSER_HEADERS,
        }
        form_data = {
            "typ": str(state),
            "to": thread_id,
            "source": "mercury-chat",
            "thread": thread_id,
            "fb_dtsg": fb_dtsg,
            "jazoest": jazoest,
        }
        try:
            requests.post(typ_url, data=form_data, cookies=cookies, headers=headers, proxies=proxies, timeout=5)
            logger.info(f"Fired typing indicator typ={state} to thread {thread_id}")
        except Exception as e:
            logger.warning(f"Typing indicator ping failed (non-critical): {e}")

    @classmethod
    async def simulate_human_typing_delay(cls, text: str) -> None:
        """Mô phỏng độ trễ gõ phím của con người dựa trên độ dài văn bản."""
        total_delay = 0.0
        for ch in text:
            char_delay = random.uniform(TYPING_CHAR_DELAY_MIN, TYPING_CHAR_DELAY_MAX)
            total_delay += char_delay
            if ch in (",", ".", "!", "?", "\n"):
                total_delay += random.uniform(PUNCTUATION_PAUSE_MIN, PUNCTUATION_PAUSE_MAX)

        # Giới hạn trễ an toàn tối đa 10s để không làm timeout kết nối HTTP của FE
        actual_delay = min(total_delay, 10.0)
        logger.info(f"Simulating human typing delay: {actual_delay:.2f}s for {len(text)} chars")
        await asyncio.sleep(actual_delay)

    @classmethod
    async def send_message_human_like(
        cls,
        account_id: str,
        recipient_id: str,
        content: str = "",
        recipient_name: Optional[str] = None,
        recipient_avatar: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        simulate_human: bool = True,
    ) -> Dict[str, Any]:
        """Gửi tin nhắn Messenger với chuỗi 5 bước sinh học chống quét bot."""
        sb = get_supabase_client()

        # ── BƯỚC 0: KIỂM TRA CẦU CHÌ AN TOÀN (CIRCUIT BREAKER) ───────────────────
        can_send, reason, account = FbCircuitBreaker.can_send_message(sb, account_id)
        if not can_send:
            return {"success": False, "message": reason, "is_circuit_breaker_block": True}

        assert account is not None
        cookies = cls.parse_cookie_string(account.get("cookie", ""))
        ua = account.get("user_agent") or DEFAULT_USER_AGENT
        proxy_url = account.get("proxy_url")
        proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

        fb_dtsg = account.get("fb_dtsg")
        jazoest = account.get("jazoest")

        # Nếu thiếu dtsg thì bóc tách lại ngay lập tức
        if not fb_dtsg:
            fb_dtsg, jazoest = cls.extract_dtsg_tokens(cookies, ua, proxy_url)
            if fb_dtsg:
                sb.table("fb_messenger_accounts").update(
                    {"fb_dtsg": fb_dtsg, "jazoest": jazoest}
                ).eq("id", account_id).execute()

        # Tạo offline_threading_id ngẫu nhiên 19 chữ số theo chuẩn Facebook Client
        offline_threading_id = str(random.randint(1000000000000000000, 9999999999999999999))

        now_utc = datetime.now(timezone.utc)
        thread_id = str(recipient_id).strip()

        # ── BƯỚC 1: TRỄ ĐỌC TIN CŨ (1.5s - 3.2s) ──────────────────────────────────
        if simulate_human:
            read_delay = random.uniform(READ_LATENCY_MIN, READ_LATENCY_MAX)
            await asyncio.sleep(read_delay)

        # ── BƯỚC 2: PHÁT SỰ KIỆN TYPING & TRỄ GÕ PHÍM WPM ────────────────────────
        if simulate_human and fb_dtsg and jazoest:
            # Phát tín hiệu typing thật sự lên Facebook
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None,
                lambda: cls.send_typing_ping(
                    account_id, thread_id, 1, fb_dtsg, jazoest, cookies, ua, proxies
                ),
            )
            # Gõ phím theo tốc độ tự nhiên WPM 35-50 từ/phút
            await cls.simulate_human_typing_delay(content)

        # ── BƯỚC 3: GỌI DIRECT API GỬI TIN NHẮN META ─────────────────────────────
        post_url = "https://www.facebook.com/messaging/send/"
        headers = {
            "User-Agent": ua,
            "Referer": f"https://www.facebook.com/messages/t/{thread_id}",
            "Origin": "https://www.facebook.com",
            "Content-Type": "application/x-www-form-urlencoded",
            **CHROME_BROWSER_HEADERS,
        }

        form_data = {
            "client": "mercury",
            "action_type": "ma-type:user-generated-message",
            "body": content,
            "ephemeral_ttl_mode": "0",
            "has_attachment": "false",
            "message_id": offline_threading_id,
            "offline_threading_id": offline_threading_id,
            "other_user_fbid": thread_id,
            "specific_to_list[0]": f"fbid:{thread_id}",
            "specific_to_list[1]": f"fbid:{account.get('fb_user_id')}",
            "source": "source:chat:web",
            "timestamp": str(int(time.time() * 1000)),
            "fb_dtsg": fb_dtsg or "",
            "jazoest": jazoest or "",
        }

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(
                None,
                lambda: requests.post(
                    post_url,
                    data=form_data,
                    cookies=cookies,
                    headers=headers,
                    proxies=proxies,
                    timeout=20,
                ),
            )
            raw_text = res.text
        except Exception as req_err:
            logger.exception(f"HTTP request error sending fb message: {req_err}")
            return {"success": False, "message": f"Lỗi kết nối tới Facebook Gateway: {req_err}"}

        # Tắt trạng thái typing sau khi gửi xong
        if simulate_human and fb_dtsg and jazoest:
            await loop.run_in_executor(
                None,
                lambda: cls.send_typing_ping(
                    account_id, thread_id, 0, fb_dtsg, jazoest, cookies, ua, proxies
                ),
            )

        # ── BƯỚC 4: BÓC TÁCH MÃ LỖI & PHẢN HỒI TỪ META ────────────────────────────
        is_blocked = False
        error_code = None
        error_msg = ""

        if res.status_code != 200:
            error_msg = f"HTTP {res.status_code} từ Facebook"
        elif "for (;;);" in raw_text:
            clean_json = raw_text.replace("for (;;);", "").strip()
            # Bắt mã lỗi 1357004 (Tạm thời chặn tính năng)
            if str(FB_ERROR_TEMPORARILY_BLOCKED) in clean_json or "temporarily blocked" in clean_json.lower():
                is_blocked = True
                error_code = FB_ERROR_TEMPORARILY_BLOCKED
                error_msg = "Bạn tạm thời bị chặn sử dụng tính năng nhắn tin trên Facebook."
            # Bắt mã lỗi 368 (Thao tác quá nhanh)
            elif '"error":368' in clean_json or "thao tác quá nhanh" in clean_json.lower():
                is_blocked = True
                error_code = 368
                error_msg = "Meta cảnh báo thao tác quá nhanh. Tự động đóng băng để bảo vệ nick."
            # Bắt mã lỗi 190 (Cookie / Token hết hạn)
            elif '"error":190' in clean_json or '"error_subcode":463' in clean_json:
                is_blocked = True
                error_code = FB_ERROR_SESSION_EXPIRED
                error_msg = "Phiên đăng nhập Cookie đã hết hạn, vui lòng cập nhật lại."
            # Bắt trang Checkpoint / Đăng nhập
            elif "checkpoint" in clean_json.lower() or "login.php" in clean_json.lower():
                is_blocked = True
                error_code = FB_ERROR_CHECKPOINT
                error_msg = "Tài khoản bị đẩy sang trang xác minh Checkpoint."

        if is_blocked or error_code:
            FbCircuitBreaker.trigger_circuit_breaker(sb, account_id, error_code, error_msg)
            # Lưu vết tin nhắn thất bại
            sb.table("fb_messenger_messages").insert({
                "thread_id": thread_id,
                "account_id": account_id,
                "sender_id": str(account.get("fb_user_id")),
                "recipient_id": thread_id,
                "content": content,
                "is_self": True,
                "status": "failed",
                "offline_threading_id": offline_threading_id,
                "created_at": now_utc.isoformat(),
            }).execute()
            return {"success": False, "message": f"Không thể gửi tin: {error_msg}"}

        # ── BƯỚC 5: NÁN LẠI NGẪU NHIÊN & LƯU TRỮ VĨNH VIỄN ────────────────────────
        if simulate_human:
            linger = random.uniform(LINGER_LATENCY_MIN, LINGER_LATENCY_MAX)
            await asyncio.sleep(linger)

        # Lưu tin nhắn vào bảng fb_messenger_messages
        msg_payload = {
            "thread_id": thread_id,
            "account_id": account_id,
            "sender_id": str(account.get("fb_user_id")),
            "sender_name": account.get("name"),
            "recipient_id": thread_id,
            "content": content or "",
            "attachments": attachments or [],
            "is_self": True,
            "is_echo": False,
            "status": "sent",
            "offline_threading_id": offline_threading_id,
            "created_at": now_utc.isoformat(),
        }
        msg_res = sb.table("fb_messenger_messages").insert(msg_payload).execute()
        created_msg = msg_res.data[0] if msg_res.data else msg_payload

        # Cập nhật thông tin Thread
        last_msg = content
        if not last_msg and attachments:
            att0 = attachments[0]
            kind_txt = "Hình ảnh" if att0.get("kind") == "image" else "Tệp đính kèm"
            last_msg = f"[{kind_txt}] {att0.get('name', '')}".strip()

        thread_payload = {
            "account_id": account_id,
            "thread_id": thread_id,
            "recipient_id": thread_id,
            "recipient_name": recipient_name or f"Người dùng {thread_id}",
            "recipient_avatar": recipient_avatar,
            "last_message": last_msg or "(Trống)",
            "last_message_at": now_utc.isoformat(),
            "updated_at": now_utc.isoformat(),
        }
        try:
            sb.table("fb_messenger_threads").upsert(
                thread_payload, on_conflict="account_id,thread_id"
            ).execute()
        except Exception as te:
            logger.warning(f"Error upserting fb_messenger_thread: {te}")

        # Phát sự kiện SSE Bus về Web App tức thời 0ms
        try:
            from app.modules.facebook.src.modules.messenger.services.fb_realtime_listener import messenger_event_bus
            await messenger_event_bus.publish({
                "type": "fb_message_new",
                "account_id": account_id,
                "thread_id": thread_id,
                "is_self": True,
                "is_echo": False,
                "message": created_msg,
                "timestamp": now_utc.isoformat(),
            })
        except Exception as sse_err:
            logger.warning(f"Error broadcasting outgoing message via SSE: {sse_err}")

        # Ghi nhận hạn ngạch gửi thành công
        FbCircuitBreaker.record_send_success(sb, account_id)

        return {
            "success": True,
            "message": "Gửi tin nhắn Messenger thành công!",
            "data": {
                "message": created_msg,
                "thread_id": thread_id,
                "offline_threading_id": offline_threading_id,
            },
        }
