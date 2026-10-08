"""Email bao gia cho khach: HTML/plain-text, escape, link theo domain workspace (khong dev/localhost)."""
from unittest import mock

import pytest

from app.modules.all_platform.services import quote_email_delivery_service as svc

QUOTE = {
    "id": "q1", "quoteNumber": "202610090058", "publicUrl": "/baogia/TOKEN123", "currency": "VND", "totalAmount": 177000,
    "issuerCompanyId": "i1", "data": {"customerCompanyName": "Công ty TNHH Minh Phát", "quoteTitle": "test"}, "quoteOwnerName": "Nguyễn Văn Thương",
}
USER = {"id": "u1", "name": "Ngọc Thảo Vũ"}
ISSUER = {"legal_name": "Công ty Cổ phần Markee", "brand_name": "Markee", "phone": "076 5055 708", "email": "admin@markee.vn", "website": "markee.vn", "address": None}


def _content(quote=None, message="Gửi anh bản báo giá", name="thảo", attached=True, issuer=ISSUER):
    with mock.patch.object(svc, "_issuer_company", return_value=issuer):
        return svc.build_quote_email_content({**QUOTE, **(quote or {})}, USER, name, message, "https://crm.markee.vn/baogia/TOKEN123", attached)


def test_content_has_cta_codes_signature_and_no_auto_anh_chi():
    html_body, text = _content()
    assert "Xem báo giá trực tuyến" in html_body and "Xem báo giá trực tuyến: https://crm.markee.vn/baogia/TOKEN123" in text
    assert "Kính gửi thảo," in text and "anh/chị" not in text.lower() and "anh/chị" not in html_body.lower()
    for needle in ("202610090058", "Công ty TNHH Minh Phát", "177.000 đ", "Ngọc Thảo Vũ", "Công ty Cổ phần Markee", "076 5055 708", "admin@markee.vn", "Gửi anh bản báo giá"):
        assert needle in html_body and needle in text, needle
    assert "đính kèm" in text
    assert html_body.count("<table") >= 4 and "role=\"presentation\"" in html_body
    assert "<" not in text and ">" not in text   # ban plain-text khong lan the HTML


def test_no_greeting_name_and_missing_data_not_invented():
    html_body, text = _content(name=None, issuer={}, quote={"issuerCompanyId": None, "totalAmount": 0, "data": {}}, attached=False)
    assert text.startswith("Kính gửi Quý khách,") and "đính kèm" not in text
    assert "Tổng thanh toán" not in text and "Điện thoại" not in text and "Khách hàng:" not in text
    assert "undefined" not in text and "None" not in text and "None" not in html_body


def test_dynamic_data_is_escaped():
    html_body, text = _content(message="<script>alert(1)</script>\nDòng 2", name="<img src=x onerror=1>")
    assert "<script>" not in html_body and "&lt;script&gt;" in html_body and "<img src=x" not in html_body
    assert "Dòng 2" in html_body and "<br>" in html_body


def test_public_link_uses_workspace_domain_never_dev(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://dev.seeding.markeeai.com")
    for k in ("EMAIL_LINK_WORKSPACE_DOMAINS", "WORKSPACE_DOMAINS"):
        monkeypatch.delenv(k, raising=False)
    for instance, host in (("markee", "crm.markee.vn"), ("cloudgate", "crm.getcloudgate.com"), ("securityzone", "crm.securityzone.vn")):
        url = svc._public_full_url({**QUOTE, "instance": instance})
        assert url == f"https://{host}/baogia/TOKEN123" and "dev.seeding" not in url


def test_unknown_workspace_without_config_is_a_clear_error(monkeypatch):
    monkeypatch.delenv("PUBLIC_APP_BASE_URL", raising=False)
    for k in ("EMAIL_LINK_WORKSPACE_DOMAINS", "WORKSPACE_DOMAINS"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(svc.QuoteSendValidationError):
        svc._public_full_url({**QUOTE, "instance": "brandx"})


def test_send_builds_multipart_with_pdf_and_workspace_link(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://dev.seeding.markeeai.com")
    for k in ("EMAIL_LINK_WORKSPACE_DOMAINS", "WORKSPACE_DOMAINS"):
        monkeypatch.delenv(k, raising=False)
    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def ehlo(self): pass
        def starttls(self): pass
        def login(self, *a): pass
        def sendmail(self, frm, to, raw): sent["raw"] = raw; sent["to"] = to

    sb = mock.MagicMock()
    sb.table.return_value.insert.return_value.execute.return_value.data = [{"id": "log1"}]
    render = mock.Mock(return_value=b"%PDF-1.4 fake")
    creds = {"sender_name": "Markee", "sender_address": "sys@gmail.com", "app_password": "x"}
    with mock.patch.object(svc, "_validate_before_send"), mock.patch.object(svc, "_find_existing_by_idempotency_key", return_value=None),             mock.patch.object(svc, "_count_recent_attempts", return_value=0), mock.patch.object(svc, "get_supabase_client", return_value=sb),             mock.patch.object(svc.email_provider_service, "get_active_email_channel_for_sending", return_value=creds),             mock.patch("app.modules.all_platform.services.quote_telegram_service._render_quote_pdf", render), mock.patch.object(svc, "_issuer_company", return_value=ISSUER),             mock.patch.object(svc, "_record_email_sent"), mock.patch.object(svc.smtplib, "SMTP", FakeSMTP), mock.patch.object(svc, "_row_to_delivery_log", side_effect=lambda r: r):
        svc.send_quote_email({**QUOTE, "instance": "markee", "versionNumber": 1}, None, USER, "thảo", "khach@example.com", "manual", "Lời nhắn", True, "idem-1")
    import email as email_lib
    msg = email_lib.message_from_string(sent["raw"])
    types = [part.get_content_type() for part in msg.walk()]
    assert "text/plain" in types and "text/html" in types and "application/pdf" in types
    body = "".join(part.get_payload(decode=True).decode("utf-8") for part in msg.walk() if part.get_content_type() in ("text/plain", "text/html"))
    assert "https://crm.markee.vn/baogia/TOKEN123" in body and "dev.seeding" not in body
    render.assert_called_once_with("/baogia/TOKEN123", base_url="https://crm.markee.vn")
