from __future__ import annotations

import asyncio
import json
from email.message import EmailMessage
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.email.api.routes.email_inbox import router
from app.modules.all_platform.email.schemas.email_inbox import EmailSendRequest
from app.modules.all_platform.email.services import email_inbox_service as service
from app.modules.all_platform.routers import fb as fb_router


def test_email_api_requires_authentication(monkeypatch):
    # Missing JWT must be rejected before the service is touched.
    monkeypatch.setattr(service, "list_email_accounts", lambda: pytest.fail("service called"))
    app = FastAPI()
    app.include_router(router, prefix="/email")
    response = TestClient(app).get("/email/accounts")
    assert response.status_code == 401


def test_optional_facebook_sessions_returns_empty_when_bridge_is_not_configured(monkeypatch):
    monkeypatch.setattr(fb_router, "MARKEE_ADMIN_API_KEY", "")
    monkeypatch.setattr(fb_router, "_current_user", lambda *_args, **_kwargs: {"id": "user-1"})
    response = asyncio.run(fb_router.fb_sessions(SimpleNamespace(), None))
    assert response.status_code == 200
    assert json.loads(response.body) == {
        "success": True,
        "configured": False,
        "sessions": [],
    }


def test_simulate_is_locked_by_default(monkeypatch):
    monkeypatch.delenv("EMAIL_ALLOW_SIMULATE_INCOMING", raising=False)
    with pytest.raises(PermissionError, match="bị khóa"):
        service.simulate_incoming_email(
            SimpleNamespace(
                sender_email="sender@example.com", sender_name="Người gửi",
                subject="Xin chào", text="Nội dung tiếng Việt",
            )
        )


def test_utf8_message_parser_and_attachment():
    msg = EmailMessage()
    msg["From"] = "Khách hàng <khach@example.com>"
    msg["To"] = "sale@example.com"
    msg["Subject"] = "Báo giá tiếng Việt"
    msg.set_content("Xin chào, vui lòng kiểm tra báo giá đính kèm.")
    msg.add_attachment(
        b"pdf-bytes", maintype="application", subtype="pdf",
        filename="Báo_giá.pdf",
    )
    text, body_html = service._message_bodies(msg)
    attachments = service._message_attachments(msg)
    assert "tiếng Việt" not in text  # body is preserved independently of subject
    assert "vui lòng kiểm tra" in text
    assert body_html is None
    assert attachments[0][0] == "Báo_giá.pdf"
    assert attachments[0][1] == "application/pdf"


def test_smtp_failure_does_not_create_fake_delivered_history(monkeypatch):
    responses = iter([
        SimpleNamespace(data=[{
            "id": "thread-1", "account_email": "sale@example.com",
            "customer_email": "customer@example.com", "subject": "Báo giá",
        }]),
        SimpleNamespace(data=[{
            "message_id": "<original@example.com>",
            "references_header": None, "subject": "Báo giá",
        }]),
    ])
    calls = []

    def fake_run(_operation):
        calls.append("db")
        return next(responses)

    class BrokenSMTP:
        def __init__(self, *_args, **_kwargs):
            raise OSError("network down")

    monkeypatch.setattr(service, "_run", fake_run)
    monkeypatch.setattr(service, "_get_account_for_email", lambda _email: {
        "id": "account-1", "email": "sale@example.com", "name": "Sales",
        "provider_type": "imap_smtp",
        "app_password": "secret", "smtp_host": "smtp.example.com",
        "smtp_port": 587, "smtp_security": "starttls",
    })
    monkeypatch.setattr(service.smtplib, "SMTP", BrokenSMTP)

    with pytest.raises(service.EmailSendError, match="Gửi email thất bại"):
        service.send_email_reply("thread-1", EmailSendRequest(text="Trả lời thật"))

    # Only the thread and previous-message reads happened. No INSERT/UPDATE is
    # performed after SMTP rejects the message.
    assert calls == ["db", "db"]


def test_reply_sets_in_reply_to_and_references(monkeypatch):
    captured_mail = []

    class MockSMTP:
        def __init__(self, *_args, **_kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def ehlo(self):
            pass
        def starttls(self, context=None):
            pass
        def login(self, user, pwd):
            pass
        def send_message(self, msg, from_addr, to_addrs):
            captured_mail.append((msg, from_addr, to_addrs))
            return {}

    responses = [
        # 1. thread_res for reply
        SimpleNamespace(data=[{
            "id": "thread-100", "account_email": "sale@example.com",
            "customer_email": "client@example.com", "subject": "Hợp đồng dịch vụ",
        }]),
        # 2. previous msg for reply
        SimpleNamespace(data=[{
            "id": "msg-1", "message_id": "<parent-123@client.com>",
            "references_header": "<root-000@client.com>", "subject": "Hợp đồng dịch vụ",
            "direction": "inbound", "sender_email": "client@example.com",
            "recipient_emails": ["sale@example.com"], "cc_emails": ["manager@client.com"],
        }]),
        # 3. insert message
        SimpleNamespace(data=[{"id": "new-msg-1"}]),
        # 4. update thread
        SimpleNamespace(data=[{"id": "thread-100"}]),
        # 5. thread_res for reply_all
        SimpleNamespace(data=[{
            "id": "thread-100", "account_email": "sale@example.com",
            "customer_email": "client@example.com", "subject": "Hợp đồng dịch vụ",
        }]),
        # 6. previous msg for reply_all
        SimpleNamespace(data=[{
            "id": "msg-1", "message_id": "<parent-123@client.com>",
            "references_header": "<root-000@client.com>", "subject": "Hợp đồng dịch vụ",
            "direction": "inbound", "sender_email": "client@example.com",
            "recipient_emails": ["sale@example.com"], "cc_emails": ["manager@client.com"],
        }]),
        # 7. insert message
        SimpleNamespace(data=[{"id": "new-msg-2"}]),
        # 8. update thread
        SimpleNamespace(data=[{"id": "thread-100"}]),
    ]
    resp_iter = iter(responses)

    def fake_run(_op):
        return next(resp_iter)

    monkeypatch.setattr(service, "_run", fake_run)
    monkeypatch.setattr(service, "_get_account_for_email", lambda _email: {
        "id": "account-1", "email": "sale@example.com", "name": "Sales",
        "provider_type": "imap_smtp",
        "app_password": "secret", "smtp_host": "smtp.example.com",
        "smtp_port": 587, "smtp_security": "starttls",
    })
    monkeypatch.setattr(service.smtplib, "SMTP", MockSMTP)
    monkeypatch.setattr(service, "get_email_messages", lambda cid: [
        SimpleNamespace(id="new-msg-id", conversation_id=cid)
    ])

    # 1. Test Reply
    service.send_email_reply("thread-100", service.EmailSendRequest(
        text="Tôi đã nhận được.", mode="reply",
    ))
    assert len(captured_mail) == 1
    mail, from_addr, to_addrs = captured_mail[0]
    assert mail["In-Reply-To"] == "<parent-123@client.com>"
    assert "<root-000@client.com>" in mail["References"]
    assert "<parent-123@client.com>" in mail["References"]
    assert mail["Subject"] == "Re: Hợp đồng dịch vụ"
    assert to_addrs == ["client@example.com"]

    # 2. Test Reply All
    service.send_email_reply("thread-100", service.EmailSendRequest(
        text="Phản hồi tất cả.", mode="reply_all",
    ))
    assert len(captured_mail) == 2
    mail2, from_addr2, to_addrs2 = captured_mail[1]
    assert mail2["In-Reply-To"] == "<parent-123@client.com>"
    assert mail2["Subject"] == "Re: Hợp đồng dịch vụ"
    assert "manager@client.com" in mail2["Cc"]
    assert "manager@client.com" in to_addrs2
    assert "client@example.com" in to_addrs2


def test_google_oauth_url_generation_uses_dedicated_client_and_least_privilege(monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "gmail-dev-client.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_ALLOWED_ORIGINS", "https://crm.markee.vn")
    url, client_id = service.get_google_auth_url("https://crm.markee.vn", "state123")
    assert "https://accounts.google.com/o/oauth2/v2/auth?" in url
    assert "client_id=" in url
    assert "redirect_uri=https%3A%2F%2Fcrm.markee.vn" in url
    assert "gmail.modify" in url
    assert "mail.google.com" not in url
    assert "state=state123" in url
    assert "prompt=select_account+consent" in url
    assert client_id == "gmail-dev-client.apps.googleusercontent.com"


def test_google_oauth_state_is_bound_to_user_workspace_origin_and_one_time(monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "server-only-test-secret")
    monkeypatch.setenv("GMAIL_OAUTH_STATE_SECRET", "independent-state-test-secret")
    monkeypatch.setenv("GMAIL_OAUTH_ALLOWED_ORIGINS", "https://crm.markee.vn")
    monkeypatch.setattr(service, "_workspace", lambda: "markee")
    responses = iter([
        SimpleNamespace(data=[{"state_hash": "stored"}]),  # insert state
        SimpleNamespace(data=[{"state_hash": "stored"}]),  # lookup unused state
        SimpleNamespace(data=[{"state_hash": "stored"}]),  # consume state
    ])
    monkeypatch.setattr(service, "_run", lambda _op: next(responses))

    state = service.create_google_oauth_state("https://crm.markee.vn", "user-1")
    assert service.validate_google_oauth_state(
        state, "https://crm.markee.vn", "user-1"
    ) == "https://crm.markee.vn"


def test_google_oauth_rejects_unapproved_origin(monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_ALLOWED_ORIGINS", "https://crm.markee.vn")
    with pytest.raises(PermissionError, match="danh sách Dev"):
        service.validate_google_oauth_origin("http://10.120.60.26:18090")


def test_gmail_reply_send_includes_provider_thread_id(monkeypatch):
    captured = {}

    class Response:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"id": "gmail-message-1", "threadId": "gmail-thread-1"}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs["json"]
        return Response()

    monkeypatch.setattr(service.httpx, "post", fake_post)
    mail = EmailMessage()
    mail["From"] = "sale@example.com"
    mail["To"] = "customer@example.com"
    mail["Subject"] = "Re: Báo giá"
    mail.set_content("Đã nhận được.")

    message_id, thread_id = service._send_gmail_api("access-token", mail, "gmail-thread-1")
    assert message_id == "gmail-message-1"
    assert thread_id == "gmail-thread-1"
    assert captured["json"]["threadId"] == "gmail-thread-1"


def test_duplicate_background_sync_is_skipped_by_database_lease(monkeypatch):
    monkeypatch.setattr(service, "list_email_accounts", lambda: [
        SimpleNamespace(id="account-1", email="sale@example.com")
    ])
    monkeypatch.setattr(service, "_claim_sync_lease", lambda *_args: False)
    monkeypatch.setattr(service, "_release_sync_lease", lambda *_args: None)
    monkeypatch.setattr(service, "_get_account_for_email", lambda _email: pytest.fail("sync should be skipped"))

    result = service.sync_mailbox()
    assert result == {"ok": True, "imported": 0, "skipped_locked": 1}


def test_idempotency_prevents_duplicate_reply(monkeypatch):
    """Sending a reply with the same idempotency_key returns the existing message without invoking SMTP."""
    smtp_called = []

    class MockSMTP:
        def __init__(self, *_args, **_kwargs):
            smtp_called.append(True)

    # Mock _run returning an existing message when queried for idempotency_key
    monkeypatch.setattr(service, "_run", lambda _op: SimpleNamespace(data=[{
        "id": "existing-msg-uuid", "message_id": "<existing@test.com>", "idempotency_key": "idemp-key-999",
    }]))
    monkeypatch.setattr(service.smtplib, "SMTP", MockSMTP)
    monkeypatch.setattr(service, "get_email_messages", lambda cid: [
        SimpleNamespace(id="existing-msg-uuid", conversation_id=cid, idempotency_key="idemp-key-999")
    ])

    result = service.send_email_reply("thread-100", service.EmailSendRequest(
        text="Gửi lại", idempotency_key="idemp-key-999"
    ))
    assert result.id == "existing-msg-uuid"
    assert len(smtp_called) == 0  # SMTP was NOT called!


