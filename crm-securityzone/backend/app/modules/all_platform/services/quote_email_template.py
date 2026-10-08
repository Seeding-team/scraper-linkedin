"""Template email GUI BAO GIA cho khach (HTML responsive: table + inline CSS, Gmail/Outlook/mobile) + ban plain-text du phong.

Chi la lop trinh bay: nhan du lieu da chuan bi san (khong goi DB/SMTP) de test duoc. Moi du lieu dong deu duoc escape (chong HTML injection);
truong khong co du lieu thi KHONG hien (khong bia ten/SDT/dia chi).
"""
from __future__ import annotations

import html
from typing import Any

INK = "#07151D"
RED = "#EF2B2D"
MUTED = "#64748b"
LINE = "#e2e8f0"
FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;"


def _esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _multiline(value: str) -> str:
    return "<br>".join(_esc(line) for line in value.replace("\r\n", "\n").split("\n"))


def greeting(recipient_name: str | None) -> str:
    """Loi chao chuan tieng Viet, KHONG tu them 'anh/chi' truoc ten (ten co the la ten cong ty hoac da kem danh xung)."""
    name = (recipient_name or "").strip()
    return f"Kính gửi {name}," if name else "Kính gửi Quý khách,"


def render_quote_email(
    *,
    brand_name: str,
    seller_name: str | None,
    recipient_name: str | None,
    quote_number: str,
    customer_name: str | None,
    sent_date: str,
    total_text: str | None,
    message: str | None,
    public_url: str,
    public_url_short: str,
    attached_pdf: bool,
    sender_name: str | None,
    sender_company: str | None,
    contacts: list[tuple[str, str]],
) -> tuple[str, str]:
    """-> (html, text). `contacts`: [(nhan, gia tri)] chi gom truong CO du lieu (SDT/Email/Website/Dia chi)."""
    hello = greeting(recipient_name)
    seller_phrase = seller_name or "chúng tôi"
    intro1 = f"Cảm ơn Quý khách đã quan tâm đến các giải pháp và dịch vụ của {seller_phrase}."
    intro2 = f"Chúng tôi xin gửi đến Quý khách báo giá {quote_number} với thông tin chi tiết về sản phẩm, dịch vụ và chi phí dự kiến."
    intro3 = (
        "Quý khách có thể xem báo giá trực tuyến hoặc tải tài liệu PDF đính kèm trong email này."
        if attached_pdf else "Quý khách có thể xem báo giá trực tuyến bằng nút bên dưới."
    )
    closing = "Nếu cần điều chỉnh hoặc trao đổi thêm về báo giá, Quý khách vui lòng phản hồi trực tiếp email này. Chúng tôi rất sẵn lòng hỗ trợ."

    rows: list[tuple[str, str, bool]] = [("Mã báo giá", quote_number, True)]
    if customer_name:
        rows.append(("Khách hàng", customer_name, False))
    rows.append(("Ngày gửi", sent_date, False))
    if total_text:
        rows.append(("Tổng thanh toán", total_text, True))
    rows_html = "".join(
        f"<tr><td style=\"padding:7px 12px 7px 0;color:{MUTED};font-size:13px;{FONT}vertical-align:top;width:38%\">{_esc(label)}</td>"
        f"<td align=\"right\" style=\"padding:7px 0;color:{INK};font-size:14px;font-weight:{'800' if strong else '600'};{FONT}vertical-align:top\">{_esc(value)}</td></tr>"
        for label, value, strong in rows
    )

    message_html = ""
    if (message or "").strip():
        message_html = (
            f"<tr><td style=\"padding:14px 24px 0\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
            f"style=\"border-left:3px solid {RED};background:#fff7f7\"><tr><td style=\"padding:10px 14px;{FONT}font-size:14px;color:{INK};line-height:1.55\">"
            f"{_multiline(message.strip())}</td></tr></table></td></tr>"
        )

    sig_lines = []
    if sender_name:
        sig_lines.append(f"<div style=\"font-weight:800;color:{INK}\">{_esc(sender_name)}</div>")
    if sender_company:
        sig_lines.append(f"<div>{_esc(sender_company)}</div>")
    for label, value in contacts:
        sig_lines.append(f"<div style=\"color:{MUTED}\">{_esc(label)}: {_esc(value)}</div>")
    signature_html = (
        f"<tr><td style=\"padding:16px 24px 0;{FONT}font-size:14px;color:{INK};line-height:1.6\"><div>Trân trọng,</div>{''.join(sig_lines)}</td></tr>"
    )

    page = (
        "<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>Báo giá {_esc(quote_number)}</title></head>"
        "<body style=\"margin:0;padding:0;background:#f1f5f9\">"
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f1f5f9\"><tr><td align=\"center\" style=\"padding:20px 10px\">"
        f"<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:600px;background:#ffffff;border:1px solid {LINE};border-radius:12px;overflow:hidden\">"
        f"<tr><td style=\"background:{INK};padding:18px 24px;{FONT}color:#ffffff\"><div style=\"font-size:18px;font-weight:800;letter-spacing:.3px\">{_esc(brand_name.upper())}</div>"
        "<div style=\"font-size:11px;color:#9fb3c2;margin-top:3px;text-transform:uppercase\">Thư gửi báo giá</div></td></tr>"
        f"<tr><td style=\"padding:20px 24px 0;{FONT}font-size:15px;color:{INK};line-height:1.6\"><p style=\"margin:0 0 10px;font-weight:800\">{_esc(hello)}</p>"
        f"<p style=\"margin:0 0 10px\">{_esc(intro1)}</p><p style=\"margin:0 0 10px\">{_esc(intro2)}</p><p style=\"margin:0\">{_esc(intro3)}</p></td></tr>"
        f"{message_html}"
        f"<tr><td style=\"padding:16px 24px 0\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid {LINE};border-radius:10px;background:#fcfdfe\">"
        f"<tr><td style=\"padding:12px 16px 0;{FONT}font-size:11px;color:{MUTED};text-transform:uppercase;font-weight:700\">Thông tin báo giá</td></tr>"
        f"<tr><td style=\"padding:0 16px 8px\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">{rows_html}</table></td></tr></table></td></tr>"
        f"<tr><td align=\"center\" style=\"padding:22px 24px 6px\"><a href=\"{_esc(public_url)}\" style=\"display:block;background:{RED};color:#ffffff;{FONT}font-size:15px;font-weight:800;text-decoration:none;padding:14px 18px;border-radius:8px;text-align:center\">Xem báo giá trực tuyến &#8599;</a></td></tr>"
        f"<tr><td style=\"padding:6px 24px 0;{FONT}font-size:11px;color:#94a3b8;word-break:break-all\">Nút không bấm được? Mở: <a href=\"{_esc(public_url)}\" style=\"color:#94a3b8\">{_esc(public_url_short)}</a></td></tr>"
        f"<tr><td style=\"padding:16px 24px 0;{FONT}font-size:14px;color:{INK};line-height:1.6\">{_esc(closing)}</td></tr>"
        f"{signature_html}"
        "<tr><td style=\"padding:18px 24px 20px\">&nbsp;</td></tr>"
        "</table></td></tr></table></body></html>"
    )

    text = [hello, "", intro1, intro2, intro3, ""]
    if (message or "").strip():
        text += [message.strip(), ""]
    text += [f"- Mã báo giá: {quote_number}"]
    if customer_name:
        text.append(f"- Khách hàng: {customer_name}")
    text.append(f"- Ngày gửi: {sent_date}")
    if total_text:
        text.append(f"- Tổng thanh toán: {total_text}")
    text += ["", f"Xem báo giá trực tuyến: {public_url}", "", closing, "", "Trân trọng,"]
    if sender_name:
        text.append(sender_name)
    if sender_company:
        text.append(sender_company)
    text += [f"{label}: {value}" for label, value in contacts]
    return page, "\n".join(text)
