"""Cách ly cấu hình email (SMTP/IMAP) theo workspace: markee / cloudgate / securityzone. Không gửi email thật, không chạm DB."""
import smtplib
import imaplib
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from app.modules.all_platform.services import quote_email_provider_service as P


class FakeDB:
    """Bảng quote_delivery_channels + audit trong bộ nhớ; has_instance mô phỏng trước/sau migration 183."""

    def __init__(self, has_instance: bool, rows=None):
        self.has_instance = has_instance
        self.t = {"quote_delivery_channels": [dict(r) for r in (rows or [])], "quote_delivery_channel_audit_log": []}

    def table(self, name):
        return Q(self, name)


class Q:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.payload, self.f, self.cols, self.single = db, name, "select", None, [], None, False

    def select(self, cols="*"):
        self.cols = cols
        return self

    def update(self, p): self.op, self.payload = "update", p; return self
    def insert(self, p): self.op, self.payload = "insert", p; return self
    def eq(self, c, v): self.f.append((c, v)); return self
    def limit(self, *_): return self
    def order(self, *_a, **_k): return self
    def maybe_single(self): self.single = True; return self

    def execute(self):
        db = self.db
        rows = db.t[self.name]
        if self.name == "quote_delivery_channels" and not db.has_instance:
            if self.cols == "instance" or any(c == "instance" for c, _ in self.f) or (self.payload and "instance" in self.payload):
                raise Exception("{'message': 'column quote_delivery_channels.instance does not exist', 'code': '42703'}")
        if self.op == "insert":
            row = {"id": f"id{len(rows)}", "encrypted_app_password": None, "is_enabled": False, **self.payload}
            if self.name == "quote_delivery_channels":
                dup = [r for r in rows if r["channel_type"] == row["channel_type"] and (not db.has_instance or r.get("instance") == row.get("instance"))]
                assert not dup, "unique violation"
            rows.append(row)
            return SimpleNamespace(data=[row])
        hit = [r for r in rows if all(r.get(c) == v for c, v in self.f)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in hit])
        if self.single:
            return SimpleNamespace(data=dict(hit[0]) if hit else None) if hit else None
        return SimpleNamespace(data=[dict(r) for r in hit])


_tokens = []


def set_instance(monkeypatch, instance):
    """Backend 1-workspace: settings.crm_instance là thuộc tính thường. Backend đa-workspace (crm-module): suy ra từ Host qua ContextVar."""
    from app.core import config

    if hasattr(config, "set_current_instance"):
        _tokens.append(config.set_current_instance(instance))
    else:
        monkeypatch.setattr(P.settings, "crm_instance", instance, raising=False)


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    P._schema_cache.update(has_instance=None, at=0.0)
    yield
    P._schema_cache.update(has_instance=None, at=0.0)
    from app.core import config

    while _tokens:
        config.reset_current_instance(_tokens.pop())


def use(monkeypatch, db, instance):
    monkeypatch.setattr(P, "get_supabase_client", lambda: db)
    set_instance(monkeypatch, instance)
    P._schema_cache.update(has_instance=None, at=0.0)


def ok_connections(monkeypatch):
    """Giả lập SMTP/IMAP thành công và ghi lại tài khoản được dùng (không có kết nối mạng thật)."""
    used = []

    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def ehlo(self): pass
        def starttls(self): pass
        def login(self, user, pw): used.append(("smtp", user, pw))
        def sendmail(self, frm, to, msg): used.append(("send", frm, tuple(to)))

    class FakeIMAP:
        def __init__(self, *a, **k): pass
        def login(self, user, pw): used.append(("imap", user, pw))
        def select(self, *a, **k): pass
        def logout(self): pass
        def shutdown(self): pass

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(imaplib, "IMAP4_SSL", FakeIMAP)
    return used


def save(monkeypatch, db, instance, addr, name, pw):
    use(monkeypatch, db, instance)
    return P.save_email_provider_settings(addr, name, pw, "u1")


def test_three_workspaces_have_independent_configs_after_migration(monkeypatch):
    db = FakeDB(True)
    ok_connections(monkeypatch)
    save(monkeypatch, db, "markee", "admin@markee.vn", "MARKEE", "aaaa bbbb cccc dddd")
    save(monkeypatch, db, "cloudgate", "admin@cloudgate.vn", "CLOUDGATE", "eeee ffff gggg hhhh")
    save(monkeypatch, db, "SECURITYZONE", "admin@securityzone.vn", "SECURITYZONE", "iiii jjjj kkkk llll")
    assert {r["instance"] for r in db.t["quote_delivery_channels"]} == {"markee", "cloudgate", "SECURITYZONE"}
    for inst, addr in (("markee", "admin@markee.vn"), ("cloudgate", "admin@cloudgate.vn"), ("SECURITYZONE", "admin@securityzone.vn")):
        use(monkeypatch, db, inst)
        s = P.get_email_provider_settings()
        assert s["instance"] == inst and s["senderAddress"] == addr and s["connectionState"] == "ok"
        assert P.get_active_email_channel_for_sending()["sender_address"] == addr          # gửi báo giá/Lead dùng đúng cấu hình workspace
    # đổi cấu hình Cloudgate không đụng Markee
    use(monkeypatch, db, "cloudgate")
    P.clear_email_provider_credentials("u1")
    use(monkeypatch, db, "markee")
    assert P.get_email_provider_settings()["credentialConfigured"] is True and P.get_active_email_channel_for_sending()["sender_address"] == "admin@markee.vn"
    use(monkeypatch, db, "cloudgate")
    assert P.get_email_provider_settings()["connectionState"] == "not_configured"


def test_unconfigured_workspace_cannot_send_and_does_not_fall_back_to_markee(monkeypatch):
    db = FakeDB(True)
    ok_connections(monkeypatch)
    save(monkeypatch, db, "markee", "admin@markee.vn", "MARKEE", "aaaa bbbb cccc dddd")
    use(monkeypatch, db, "SECURITYZONE")
    s = P.get_email_provider_settings()
    assert s["connectionState"] == "not_configured" and s["senderAddress"] is None and s["credentialConfigured"] is False
    with pytest.raises(P.EmailProviderNotConfiguredError) as e:
        P.get_active_email_channel_for_sending()
    assert "SECURITYZONE" in str(e.value)
    with pytest.raises(P.EmailProviderNotConfiguredError):
        P.send_test_email("someone@example.com")
    with pytest.raises(P.EmailProviderNotConfiguredError):
        P.test_smtp_connection()                                                   # không có app password của workspace này -> không mượn của Markee


def test_before_migration_markee_keeps_legacy_row_others_are_not_connected(monkeypatch):
    legacy = {"id": "x", "channel_type": "email", "sender_address": "admin@markee.vn", "sender_name": "MARKEE", "is_enabled": True, "smtp_connection_status": "ok",
              "imap_connection_status": "ok", "encrypted_app_password": Fernet(__import__("os").environ["QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY"].encode()).encrypt(b"abcdabcdabcdabcd").decode()}
    db = FakeDB(False, [legacy])
    use(monkeypatch, db, "markee")
    assert P.get_email_provider_settings()["senderAddress"] == "admin@markee.vn" and P.get_email_provider_settings()["schemaReady"] is False
    assert P.get_active_email_channel_for_sending()["app_password"] == "abcdabcdabcdabcd"           # Markee đang chạy KHÔNG bị ảnh hưởng
    for other in ("cloudgate", "SECURITYZONE"):
        use(monkeypatch, db, other)
        assert P.get_email_provider_settings()["connectionState"] == "not_configured"
        with pytest.raises(P.EmailProviderNotConfiguredError):
            P.get_active_email_channel_for_sending()
        for write in (lambda: P.save_email_provider_settings("x@y.com", "X", "aaaa bbbb cccc dddd", "u"), lambda: P.set_email_provider_enabled(True, "u"),
                      lambda: P.clear_email_provider_credentials("u")):
            with pytest.raises(P.EmailInstanceSchemaPendingError):
                write()
    assert len(db.t["quote_delivery_channels"]) == 1 and db.t["quote_delivery_channels"][0]["sender_address"] == "admin@markee.vn"   # dòng cũ nguyên vẹn


def test_password_is_encrypted_and_never_returned(monkeypatch):
    db = FakeDB(True)
    ok_connections(monkeypatch)
    out = save(monkeypatch, db, "cloudgate", "admin@cloudgate.vn", "CG", "secret pass word 1234")
    row = db.t["quote_delivery_channels"][0]
    assert "secretpassword1234" not in str(row["encrypted_app_password"]) and "secretpassword1234" not in str(out)
    assert "app_password" not in " ".join(out.keys()).lower().replace("credentialconfigured", "")
    assert P._decrypt_password(row["encrypted_app_password"]) == "secretpassword1234"


def test_test_and_send_use_only_the_current_workspace_account_and_never_real_network(monkeypatch):
    db = FakeDB(True)
    used = ok_connections(monkeypatch)
    save(monkeypatch, db, "markee", "admin@markee.vn", "MARKEE", "aaaa bbbb cccc dddd")
    save(monkeypatch, db, "cloudgate", "admin@cloudgate.vn", "CLOUDGATE", "eeee ffff gggg hhhh")
    used.clear()
    use(monkeypatch, db, "cloudgate")
    assert P.test_imap_connection()["ok"] and P.test_smtp_connection()["ok"] and P.send_test_email("qa@example.com")["ok"]
    assert used and all(u[1] == "admin@cloudgate.vn" for u in used if u[0] in ("smtp", "imap")) and ("send", "admin@cloudgate.vn", ("qa@example.com",)) in used
    assert not any("markee" in str(u) for u in used)
    # trạng thái test ghi vào đúng dòng
    rows = {r["instance"]: r for r in db.t["quote_delivery_channels"]}
    assert rows["cloudgate"]["smtp_last_tested_at"] and True


def test_instance_comes_from_backend_settings_not_client(monkeypatch):
    from app.modules.all_platform.routers import quote as qr

    # Router không nhận tham số instance từ client: cấu trúc request không có trường instance
    for model in (qr.EmailProviderSaveRequest, qr.EmailProviderTestRequest, qr.EmailProviderSendTestRequest):
        assert "instance" not in model.model_fields


def test_admin_only_endpoints(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.all_platform.auth_deps import get_current_user
    from app.modules.all_platform.routers.quote import quote_email_provider_router

    app = FastAPI()
    app.include_router(quote_email_provider_router, prefix="/email")
    db = FakeDB(True)
    monkeypatch.setattr(P, "get_supabase_client", lambda: db)
    set_instance(monkeypatch, "cloudgate")
    for role, code in (("member", 403), ("admin", 200), ("leader", 200)):
        app.dependency_overrides[get_current_user] = lambda role=role: {"id": "u", "role": role}
        assert TestClient(app).get("/email").status_code == code
    r = TestClient(app).get("/email").json()["data"]
    assert r["instance"] == "cloudgate" and r["connectionState"] == "not_configured"


def test_handover_email_uses_workspace_account_and_blocks_when_unconfigured(monkeypatch):
    from app.modules.all_platform.services import crm_lead_handover_service as H

    db = FakeDB(True)
    used = ok_connections(monkeypatch)
    save(monkeypatch, db, "markee", "admin@markee.vn", "MARKEE", "aaaa bbbb cccc dddd")
    monkeypatch.setattr(H, "_dry_run", lambda: False)
    use(monkeypatch, db, "cloudgate")
    with pytest.raises(P.EmailProviderNotConfiguredError):
        H._send_email("lead@example.com", "s", "t", "<p>t</p>")                       # Cloudgate chưa cấu hình -> chặn, không dùng email Markee
    assert not [u for u in used if u[0] == "send"]
    use(monkeypatch, db, "markee")
    assert H._send_email("lead@example.com", "s", "t", "<p>t</p>") == "sent"
    assert ("send", "admin@markee.vn", ("lead@example.com",)) in used
