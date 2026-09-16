"""Gửi báo giá đã duyệt (approved) qua Telegram — group "Markee Team", topic
"Báo giá" cố định (KHÔNG phải bot Telegram dùng cho báo cáo crawl — xem
TELEGRAM_TOKEN/TELEGRAM_CHAT_ID trong app/modules/facebook, đó là bot khác,
group khác). Backend tự render PDF thật từ đúng trang public/print (Playwright
headless, dùng lại đúng UI khách hàng thấy) rồi gọi Telegram Bot API
sendDocument — không dùng window.print() phía frontend vì không đính kèm file
lên Telegram được.

Log lưu vào bảng quote_telegram_log (migration 070) — APPEND-ONLY, mỗi lần bấm
gửi (kể cả "Gửi lại" sau khi lỗi) tạo 1 dòng MỚI, không ghi đè dòng cũ.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx
from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_quote_service import get_quote
from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

TELEGRAM_LOG_TABLE = "quote_telegram_log"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _telegram_config() -> tuple[str, str, str]:
    token = os.environ.get("TELEGRAM_QUOTE_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_QUOTE_CHAT_ID")
    topic_id = os.environ.get("TELEGRAM_QUOTE_TOPIC_ID")
    if not token or not chat_id:
        raise ValueError(
            "Chưa cấu hình TELEGRAM_QUOTE_BOT_TOKEN/TELEGRAM_QUOTE_CHAT_ID trong .env — "
            "liên hệ admin để thiết lập trước khi gửi báo giá qua Telegram."
        )
    return token, chat_id, topic_id or ""


def _public_base_url() -> str:
    return os.environ.get("PUBLIC_APP_BASE_URL", "http://localhost:3001").rstrip("/")


def _row_to_log(row: dict) -> dict:
    return {
        "id": row["id"],
        "quoteId": row["quote_id"],
        "chatId": row["chat_id"],
        "messageThreadId": row.get("message_thread_id"),
        "telegramMessageId": row.get("telegram_message_id"),
        "status": row["status"],
        "errorMessage": row.get("error_message"),
        "sentById": row.get("sent_by"),
        "sentAt": row.get("sent_at"),
    }


def get_quote_telegram_log(quote_id: str) -> list[dict]:
    """Lịch sử gửi Telegram của 1 báo giá, mới nhất trước — hiển thị trạng thái
    lần gửi gần nhất + cho phép "Gửi lại" nếu lần cuối failed."""
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(TELEGRAM_LOG_TABLE)
        .select("*")
        .eq("quote_id", quote_id)
        .order("sent_at", desc=True)
        .execute()
    )
    return [_row_to_log(row) for row in (result.data or [])]


def _render_quote_pdf(public_url: str) -> bytes:
    """Render đúng trang public báo giá (chế độ in, ?print=true) thành PDF thật
    bằng Playwright headless — tái dùng nguyên UI/CSS khách hàng đang thấy,
    không tạo template PDF riêng."""
    from playwright.sync_api import sync_playwright

    target = f"{_public_base_url()}{public_url}?print=true"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(target, wait_until="networkidle", timeout=30000)
            page.emulate_media(media="print")
            try:
                page.evaluate("document.fonts && document.fonts.ready")
            except Exception:
                pass
            page.wait_for_timeout(500)
            # prefer_css_page_size=True: de trang tu chon A4 doc/ngang theo
            # @page CSS cua chinh no (quotes.css tu doi ngang khi bang nhieu
            # cot, xem quotes.css) - thieu co nay Playwright LUON ep A4 doc
            # (tham so format= o duoi) bat ke @page CSS noi gi, PDF gui qua
            # Telegram se khong bao gio ra ngang du trinh duyet nguoi dung in
            # tay dung. format="A4" giu lai lam fallback neu trang khong co
            # @page nao (khong xay ra trong thuc te - quotes.css luon co 1
            # @page mac dinh).
            pdf_bytes = page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
            return pdf_bytes
        finally:
            browser.close()


def _build_caption(quote: dict, lead: dict | None) -> str:
    data = quote.get("data") or {}
    seller_name = data.get("sellerCompanyName") or "(Chưa gán công ty phát hành)"
    customer_name = data.get("customerCompanyName") or data.get("customerRecipient") or "(Chưa rõ khách hàng)"
    total = quote.get("totalAmount") or 0
    total_text = f"{total:,.0f}".replace(",", ".") + " đ"
    sale_name = "Chưa gán"
    if lead:
        sale_name = lead.get("sdr_name") or lead.get("sdrName") or lead.get("lead_name") or lead.get("leadName") or "Chưa gán"
    public_full_url = f"{_public_base_url()}{quote.get('publicUrl') or ''}"

    return (
        "📄 BÁO GIÁ MỚI\n\n"
        f"Đơn vị phát hành: {seller_name}\n"
        f"Mã báo giá: {quote.get('quoteNumber')}\n"
        f"Khách hàng: {customer_name}\n"
        f"Tổng thanh toán: {total_text}\n"
        f"Sale phụ trách: {sale_name}\n\n"
        f"🔗 Xem báo giá: {public_full_url}"
    )


def send_quote_to_telegram(quote_id: str, actor_id: str | None) -> dict:
    supabase: Client = get_supabase_client()
    quote = get_quote(quote_id)
    if quote["status"] != "approved":
        raise ValueError("Chỉ gửi được báo giá đã duyệt (approved) qua Telegram.")
    if not quote.get("publicUrl"):
        raise ValueError("Báo giá chưa có link công khai, không thể gửi Telegram.")

    lead = get_customer_lead_by_id(quote["dealId"]) if quote.get("dealId") else None
    token, chat_id, topic_id = _telegram_config()

    log_row = {
        "quote_id": quote_id,
        "chat_id": chat_id,
        "message_thread_id": topic_id or None,
        "sent_by": actor_id,
        "sent_at": _now_iso(),
    }

    try:
        pdf_bytes = _render_quote_pdf(quote["publicUrl"])
        caption = _build_caption(quote, lead)
        filename = f"Bao-gia-{quote.get('quoteNumber') or quote_id}.pdf"

        payload: dict[str, Any] = {"chat_id": chat_id, "caption": caption}
        if topic_id:
            payload["message_thread_id"] = topic_id

        response = httpx.post(
            f"https://api.telegram.org/bot{token}/sendDocument",
            data=payload,
            files={"document": (filename, pdf_bytes, "application/pdf")},
            timeout=60,
        )
        body = response.json()
        if not response.is_success or not body.get("ok"):
            error_message = body.get("description") or f"Telegram API lỗi (HTTP {response.status_code})"
            log_row.update({"status": "failed", "error_message": error_message})
            supabase.table(TELEGRAM_LOG_TABLE).insert(log_row).execute()
            raise ValueError(f"Gửi Telegram thất bại: {error_message}")

        telegram_message_id = body["result"]["message_id"]
        log_row.update({"status": "success", "telegram_message_id": str(telegram_message_id)})
        inserted = supabase.table(TELEGRAM_LOG_TABLE).insert(log_row).execute().data[0]
        return _row_to_log(inserted)
    except ValueError:
        raise
    except Exception as exc:  # network error, PDF render error, timeout...
        log_row.update({"status": "failed", "error_message": str(exc)})
        supabase.table(TELEGRAM_LOG_TABLE).insert(log_row).execute()
        raise ValueError(f"Gửi Telegram thất bại: {exc}") from exc
