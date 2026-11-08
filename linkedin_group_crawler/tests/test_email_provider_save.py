"""Luu cau hinh Gmail dung chung: doi ten giu mat khau; doi email/mat khau phai test OK truoc khi ghi; that bai -> giu cau hinh cu."""
from unittest import mock

import pytest

from app.modules.all_platform.services import quote_email_provider_service as P

OLD = {"channel_type": "email", "sender_address": "old@gmail.com", "sender_name": "Old", "encrypted_app_password": "ENC",
       "smtp_connection_status": "ok", "imap_connection_status": "ok", "is_enabled": True}


def _env(row, smtp_ok=True, imap_ok=True):
    sb = mock.MagicMock()
    stack = [
        mock.patch.object(P, "get_supabase_client", return_value=sb),
        mock.patch.object(P, "_get_row", return_value=row),
        mock.patch.object(P, "_encrypt_password", side_effect=lambda pw: b"X" + pw.encode()),
        mock.patch.object(P, "test_smtp_connection", return_value={"ok": smtp_ok, "message": "smtp msg"}),
        mock.patch.object(P, "test_imap_connection", return_value={"ok": imap_ok, "message": "imap msg"}),
        mock.patch.object(P, "get_email_provider_settings", return_value={}),
    ]
    return sb, stack


def _run(row, addr, name, pw, **kw):
    sb, stack = _env(row, **kw)
    for s in stack:
        s.start()
    try:
        P.save_email_provider_settings(addr, name, pw, "actor")
    finally:
        for s in stack:
            s.stop()
    return sb


def _update_payload(sb):
    return sb.table.return_value.update.call_args[0][0]


def test_rename_only_keeps_password_and_status():
    sb = _run(OLD, "old@gmail.com", "Moi", None)
    payload = _update_payload(sb)
    assert payload["sender_name"] == "Moi"
    assert "encrypted_app_password" not in payload and "smtp_connection_status" not in payload


def test_change_email_requires_password():
    with pytest.raises(ValueError, match="App Password"):
        _run(OLD, "new@gmail.com", "x", None)


def test_new_credentials_failed_smtp_keeps_old_config():
    sb, stack = _env(OLD, smtp_ok=False)
    for s in stack:
        s.start()
    try:
        with pytest.raises(ValueError, match="SMTP"):
            P.save_email_provider_settings("new@gmail.com", "x", "abcd efgh ijkl mnop", "a")
    finally:
        for s in stack:
            s.stop()
    sb.table.return_value.update.assert_not_called()


def test_new_credentials_ok_activates_and_normalizes_spaces():
    sb = _run(OLD, "new@gmail.com", "x", "abcd efgh ijkl mnop")
    payload = _update_payload(sb)
    assert payload["sender_address"] == "new@gmail.com"
    assert payload["encrypted_app_password"] == "Xabcdefghijklmnop"
    assert payload["smtp_connection_status"] == "ok" and payload["imap_connection_status"] == "ok"


def test_connection_state_distinguishes_four_cases():
    assert P.connection_state(None) == "not_configured"
    assert P.connection_state({"encrypted_app_password": "x", "smtp_connection_status": "unknown"}) == "saved_untested"
    assert P.connection_state({"encrypted_app_password": "x", "smtp_connection_status": "ok"}) == "ok"
    assert P.connection_state({"encrypted_app_password": "x", "smtp_connection_status": "error"}) == "error"
