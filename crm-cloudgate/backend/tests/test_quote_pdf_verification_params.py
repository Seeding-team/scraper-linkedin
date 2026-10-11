"""Bug thuc te (2026-10-11): PDF bao gia gui qua mail/Telegram chi chup duoc dung man
hinh "Xac nhan SDT/email" khi bao gia dang bat gioi han xem cong khai, vi Playwright
headless khong co cach nao tu xac thuc. _pdf_render_verification_params() phai tra dung
gia tri se khop voi logic xac thuc THAT cua get_public_quote() (supabase_quote_service.py)."""
from app.modules.all_platform.services.quote_telegram_service import _pdf_render_verification_params


def test_no_restriction_returns_empty():
    assert _pdf_render_verification_params({"publicAccessMode": "none", "data": {}}) == {}
    assert _pdf_render_verification_params({"data": {}}) == {}


def test_phone_mode_prefers_allowed_list():
    quote = {"publicAccessMode": "phone", "publicAllowedPhones": ["0901234567"], "data": {"customerPhone": "0909999999"}}
    assert _pdf_render_verification_params(quote) == {"phone": "0901234567"}


def test_phone_mode_falls_back_to_customer_phone_when_list_empty():
    quote = {"publicAccessMode": "phone", "publicAllowedPhones": [], "data": {"customerPhone": "0909999999"}}
    assert _pdf_render_verification_params(quote) == {"phone": "0909999999"}


def test_phone_mode_no_value_available_returns_empty():
    quote = {"publicAccessMode": "phone", "publicAllowedPhones": [], "data": {}}
    assert _pdf_render_verification_params(quote) == {}


def test_email_mode_prefers_allowed_list():
    quote = {"publicAccessMode": "email", "publicAllowedEmails": ["a@x.com"], "data": {"customerEmail": "b@y.com"}}
    assert _pdf_render_verification_params(quote) == {"email": "a@x.com"}


def test_email_mode_falls_back_to_customer_email_when_list_empty():
    quote = {"publicAccessMode": "email", "publicAllowedEmails": [], "data": {"customerEmail": "b@y.com"}}
    assert _pdf_render_verification_params(quote) == {"email": "b@y.com"}
