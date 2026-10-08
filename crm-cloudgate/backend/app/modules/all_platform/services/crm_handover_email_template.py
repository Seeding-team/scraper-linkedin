"""GD3 - Template email thong bao ban giao / re-assign / ban giao Customer (HTML email responsive + plain text).

Chi la lop trinh bay: nhan du lieu da chuan bi san (khong goi DB, khong biet SMTP) de test duoc.
Tuong thich Gmail/Outlook/mobile: table layout + inline CSS (khong <style> bat buoc, khong flex/grid), rong toi da 600px, co plain text du phong.
Thuong hieu Markee: trang, xanh den #07151D, do #EF2B2D.
"""
from __future__ import annotations

import html
from typing import Any

INK = "#07151D"
RED = "#EF2B2D"
MUTED = "#64748b"
LINE = "#e2e8f0"
FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;"

# loai tai lieu -> (icon, nhan). Icon la emoji de khong phu thuoc anh ngoai (Gmail/Outlook chan anh).
_DOC_ICONS = {"Google Sheet": "📊", "Google Doc": "📄", "Google Slides": "📽️", "Google Drive": "📁"}


def _esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _present(value: Any) -> bool:
    return value not in (None, "", [], {})


def _status_pill(text: str, tone: str) -> str:
    color = {"warn": ("#fff1e8", "#c2410c"), "ok": ("#e7f8ee", "#15803d"), "info": ("#e8eef5", "#0b3a5c")}[tone]
    return (
        f"<span style=\"display:inline-block;padding:3px 10px;border-radius:999px;background:{color[0]};color:{color[1]};"
        f"font-size:12px;font-weight:700;{FONT}\">{_esc(text)}</span>"
    )


def _info_rows(rows: list[tuple[str, str, bool]]) -> str:
    """rows: (label, value, highlight). Chi nhan hang co du lieu - nguoi goi da loc."""
    out = []
    for label, value, strong in rows:
        weight = "800" if strong else "600"
        out.append(
            f"<tr><td style=\"padding:7px 12px 7px 0;color:{MUTED};font-size:13px;{FONT}vertical-align:top;width:38%\">{_esc(label)}</td>"
            f"<td align=\"right\" style=\"padding:7px 0;color:{INK};font-size:14px;font-weight:{weight};{FONT}vertical-align:top\">{value}</td></tr>"
        )
    return "".join(out)


def render_handover_email(
    *,
    heading: str,
    badge: str,
    badge_tone: str,
    to_name: str,
    intro: str,
    info_title: str,
    title_line: str,
    rows: list[tuple[str, str, bool]],
    missing_title: str | None,
    missing_items: list[str],
    next_steps: list[str],
    links: list[dict[str, str]],
    note: str | None,
    cta_label: str,
    cta_url: str,
    cta_short: str | None = None,
) -> tuple[str, str]:
    """-> (html, text). `rows` value da la HTML an toan (nguoi goi escape) hoac chuoi thuan da escape."""
    docs_html = ""
    if links:
        items = []
        for link in links:
            icon = _DOC_ICONS.get(link.get("title", ""), "🔗")
            items.append(
                f"<tr><td style=\"padding:6px 0;{FONT}font-size:14px;color:{INK}\">{icon}&nbsp; "
                f"<a href=\"{_esc(link['url'])}\" style=\"color:{INK};font-weight:700;text-decoration:underline\">{_esc(link.get('title') or link['url'])}</a></td></tr>"
            )
        docs_html = (
            f"<tr><td style=\"padding:6px 24px 0\"><p style=\"margin:22px 0 4px;font-size:14px;font-weight:800;color:{INK};{FONT}\">Tài liệu phục vụ báo giá</p>"
            f"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">{''.join(items)}</table></td></tr>"
        )

    missing_html = ""
    if missing_items:
        lis = "".join(f"<li style=\"margin:3px 0\">{_esc(item)}</li>" for item in missing_items)
        missing_html = (
            f"<tr><td style=\"padding:22px 24px 0\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
            f"style=\"border:1px solid #f4c76b;background:#fffaf0;border-radius:10px\"><tr><td style=\"padding:12px 16px;{FONT}font-size:14px;color:{INK}\">"
            f"<p style=\"margin:0 0 6px;font-weight:800\">📋 {_esc(missing_title or 'Thông tin cần bổ sung')}</p>"
            f"<ul style=\"margin:0;padding-left:20px\">{lis}</ul></td></tr></table></td></tr>"
        )

    steps_html = ""
    if next_steps:
        lis = "".join(f"<li style=\"margin:3px 0\">{_esc(step)}</li>" for step in next_steps)
        steps_html = (
            f"<tr><td style=\"padding:22px 24px 0;{FONT}font-size:14px;color:{INK}\"><p style=\"margin:0 0 4px;font-weight:800\">Việc cần làm</p>"
            f"<ol style=\"margin:0;padding-left:20px\">{lis}</ol></td></tr>"
        )

    note_html = (
        f"<tr><td style=\"padding:12px 24px 0;{FONT}font-size:14px;color:{INK}\"><b>Ghi chú:</b> {_esc(note)}</td></tr>" if note else ""
    )

    page = (
        "<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>{_esc(heading)}</title></head>"
        f"<body style=\"margin:0;padding:0;background:#f1f5f9\">"
        f"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f1f5f9\"><tr><td align=\"center\" style=\"padding:20px 10px\">"
        f"<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:600px;background:#ffffff;border:1px solid {LINE};border-radius:12px;overflow:hidden\">"
        # header
        f"<tr><td style=\"background:{INK};padding:18px 24px\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>"
        f"<td style=\"{FONT}color:#ffffff\"><div style=\"font-size:18px;font-weight:800;letter-spacing:.3px\">MARKEE CRM</div>"
        f"<div style=\"font-size:11px;color:#9fb3c2;margin-top:3px;text-transform:uppercase\">{_esc(heading)}</div></td>"
        f"<td align=\"right\" style=\"vertical-align:top\">{_status_pill(badge, badge_tone)}</td></tr></table></td></tr>"
        # greeting
        f"<tr><td style=\"padding:20px 24px 0;{FONT}font-size:15px;color:{INK}\"><p style=\"margin:0 0 8px\">Chào <b>{_esc(to_name)}</b>,</p>"
        f"<p style=\"margin:0;line-height:1.5\">{intro}</p></td></tr>"
        # info card
        f"<tr><td style=\"padding:16px 24px 0\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid {LINE};border-radius:10px;background:#fcfdfe\">"
        f"<tr><td style=\"padding:12px 16px 4px;{FONT}\"><div style=\"font-size:11px;color:{MUTED};text-transform:uppercase;font-weight:700\">{_esc(info_title)}</div>"
        f"<div style=\"font-size:16px;font-weight:800;color:{INK};margin-top:4px\">{_esc(title_line)}</div></td></tr>"
        f"<tr><td style=\"padding:0 16px 10px\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">{_info_rows(rows)}</table></td></tr></table></td></tr>"
        f"{missing_html}{steps_html}{docs_html}{note_html}"
        # CTA
        f"<tr><td align=\"center\" style=\"padding:22px 24px 6px\"><a href=\"{_esc(cta_url)}\" "
        f"style=\"display:block;background:{RED};color:#ffffff;{FONT}font-size:15px;font-weight:800;text-decoration:none;padding:14px 18px;border-radius:8px;text-align:center\">{_esc(cta_label)} &#8599;</a></td></tr>"
        f"<tr><td style=\"padding:6px 24px 0;{FONT}font-size:11px;color:#94a3b8;word-break:break-all\">Nút không bấm được? Mở: <a href=\"{_esc(cta_url)}\" style=\"color:#94a3b8\">{_esc(cta_short or cta_url)}</a></td></tr>"
        # footer
        f"<tr><td style=\"padding:18px 24px 20px;{FONT}font-size:11px;color:#94a3b8;border-top:1px solid {LINE};margin-top:16px\">"
        f"Email tự động từ hệ thống Markee CRM — vui lòng không trả lời email này.</td></tr>"
        "</table></td></tr></table></body></html>"
    )

    text = [f"MARKEE CRM — {heading} [{badge}]", "", f"Chào {to_name},", "", _strip_tags(intro), "", f"{info_title}: {title_line}"]
    text += [f"- {label}: {_strip_tags(value)}" for label, value, _ in rows]
    if missing_items:
        text += ["", f"{missing_title or 'Thông tin cần bổ sung'}:"] + [f"- {item}" for item in missing_items]
    if next_steps:
        text += ["", "Việc cần làm:"] + [f"{i}. {step}" for i, step in enumerate(next_steps, 1)]
    if links:
        text += ["", "Tài liệu phục vụ báo giá:"] + [f"- {l.get('title') or 'Tài liệu'}: {l['url']}" for l in links]
    if note:
        text += ["", f"Ghi chú: {note}"]
    text += ["", f"{cta_label}: {cta_url}", "", "Email tự động từ hệ thống Markee CRM."]
    return page, "\n".join(text)


def _strip_tags(value: str) -> str:
    import re

    return html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", chr(10), value)))
