"""Unit test THUAN (khong DB that, khong SMTP that) cho
quote_email_delivery_service.py - mock get_supabase_client() va
smtplib.SMTP. Kiem tra dung cac yeu cau:
  - SMTP success/failure/auth error/timeout.
  - Recipient fallback (deal.email -> crm_customer.email -> rong).
  - Greeting khong bao gio 'undefined'/None.
  - Permission dung quote owner / tu choi technical owner / tu choi creator.
  - Idempotency (cung idempotency_key khong gui 2 lan).
  - Gui that bai KHONG set quotes.sent_at.
Chay: python scratch/test_quote_email_delivery_service.py
"""
import os
import sys
import smtplib
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


def make_quote(**overrides):
    base = {
        "id": "quote-1",
        "quoteNumber": "202609070001",
        "status": "approved",
        "processingStage": "published",
        "publicEnabled": True,
        "publicUrl": "/public/quotes/tok123",
        "versionNumber": 1,
        "quoteOwnerId": "u-owner",
        "technicalOwnerId": "u-tech",
        "data": {"quoteTitle": "Website công ty ABC"},
    }
    base.update(overrides)
    return base


class FakeQueryResult:
    def __init__(self, data=None, count=None):
        self.data = data
        self.count = count


class FakeTableBuilder:
    """Chain builder toi thieu du dung cho service nay:
    .select(...).eq(...).eq(...).execute() / .maybe_single().execute() /
    .insert(...).execute() / .update(...).eq(...).execute()."""
    def __init__(self, store, name, config):
        self.store = store
        self.name = name
        self.config = config
        self._insert_payload = None
        self._update_payload = None
        self._is_count_query = False
        self._is_maybe_single = False

    def select(self, *args, **kwargs):
        if kwargs.get("count") == "exact":
            self._is_count_query = True
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def maybe_single(self):
        self._is_maybe_single = True
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def execute(self):
        if self.name in self.config.get("fail_tables", ()) and (self._insert_payload is not None or self._update_payload is not None):
            raise Exception(f"fake DB error on table {self.name}")
        if self._insert_payload is not None:
            row = dict(self._insert_payload)
            row.setdefault("id", f"log-{len(self.store.setdefault(self.name, [])) + 1}")
            self.store.setdefault(self.name, []).append(row)
            return FakeQueryResult(data=[row])
        if self._update_payload is not None:
            self.store.setdefault(f"{self.name}__updates", []).append(dict(self._update_payload))
            return FakeQueryResult(data=None)
        if self._is_count_query:
            return FakeQueryResult(data=None, count=self.config.get("attempt_count", 0))
        if self._is_maybe_single:
            existing = self.config.get("existing_idempotent_row")
            if existing is None:
                # Mo phong DUNG hanh vi that cua postgrest-py:
                # .maybe_single().execute() tra ve None THANG khi khong co
                # dong nao khop (khong phai response object voi .data=None).
                return None
            return FakeQueryResult(data=existing)
        return FakeQueryResult(data=[])


class FakeRpcCallMarkSent:
    def __init__(self, store, params, mode):
        self.store = store
        self.params = params
        self.mode = mode  # 'ok' | 'missing' | 'other_error' | 'raise_after_call'

    def execute(self):
        if self.mode == "missing":
            raise Exception("Could not find the function public.quote_mark_email_sent in the schema cache")
        if self.mode == "other_error":
            raise Exception("some other real database error")
        self.store.setdefault("rpc_mark_sent_calls", []).append(dict(self.params))
        self.store["quotes__updates"] = self.store.get("quotes__updates", []) + [{
            "sent_at": self.params["p_sent_at"], "sent_by": self.params["p_actor_id"], "completed_at": self.params["p_sent_at"],
        }]
        return MagicMock(data=None)


class FakeSupabase:
    def __init__(self, config):
        self.config = config
        self.store = {}
        self.rpc_mode = config.get("rpc_mode", "ok")

    def table(self, name):
        return FakeTableBuilder(self.store, name, self.config)

    def rpc(self, name, params):
        assert name == "quote_mark_email_sent"
        return FakeRpcCallMarkSent(self.store, params, self.rpc_mode)


def run():
    from app.modules.all_platform.services import quote_email_delivery_service as svc
    from app.modules.all_platform.services import quote_email_provider_service as email_svc

    admin = {"id": "u-admin", "role": "admin"}
    owner = {"id": "u-owner", "role": "member"}
    tech_owner = {"id": "u-tech", "role": "member"}
    creator_only = {"id": "u-creator", "role": "member"}

    valid_channel = {"sender_address": "sale@congty.com", "sender_name": "Sale Markee", "app_password": "fake-app-pw"}

    # ── 1) SMTP success -> status='sent', sent_at duoc set tren quotes ─────
    quote = make_quote()
    deal = {"email": "khach@abc.com", "customer_name": "Chị Lan"}
    fake = FakeSupabase({"attempt_count": 0})
    with patch.object(svc, "get_supabase_client", return_value=fake), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.return_value = MagicMock()
        result = svc.send_quote_email(
            quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact",
            "Gửi anh/chị báo giá tham khảo.", attach_pdf=False, idempotency_key="idem-1",
        )
        record("SMTP success: status='sent'", result["status"] == "sent")
        # RPC quote_mark_email_sent (migration 098) la 1 "hop den" tu goc
        # nhin Python - that su ghi sent_at/sent_by/completed_at/activity_log
        # atomic trong 1 transaction SQL, o day chi kiem tra RPC duoc GOI
        # DUNG voi tham so dung (khong the "nhin thay" ben trong transaction
        # SQL that tu unit test Python).
        rpc_calls = fake.store.get("rpc_mark_sent_calls", [])
        record("SMTP success: RPC quote_mark_email_sent duoc goi dung 1 lan", len(rpc_calls) == 1)
        if rpc_calls:
            record("SMTP success: RPC nhan dung p_quote_id/p_actor_id", rpc_calls[0]["p_quote_id"] == quote["id"] and rpc_calls[0]["p_actor_id"] == admin["id"])
        quotes_updates = fake.store.get("quotes__updates", [])
        record("SMTP success: co update quotes.sent_at/sent_by (qua RPC)", len(quotes_updates) == 1 and quotes_updates[0].get("sent_at") is not None)
        record("SMTP success: co set completed_at (dung sent_at) cho SLA", quotes_updates[0].get("completed_at") == quotes_updates[0].get("sent_at"))

    # ── 1b) RPC quote_mark_email_sent CHUA apply (PGRST202) -> fallback 3
    # buoc van chay dung, tinh nang van hoat dong truoc khi migration 098
    # duoc ap dung that ──────────────────────────────────────────────────
    fake_missing_rpc = FakeSupabase({"attempt_count": 0, "rpc_mode": "missing"})
    with patch.object(svc, "get_supabase_client", return_value=fake_missing_rpc), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.return_value = MagicMock()
        result = svc.send_quote_email(
            quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact",
            "Gửi anh/chị báo giá tham khảo.", attach_pdf=False, idempotency_key="idem-1b-missing-rpc",
        )
        record("RPC chua ton tai (098 chua apply): van tra ve status='sent'", result["status"] == "sent")
        record("RPC chua ton tai: KHONG co ban ghi rpc_mark_sent_calls nao", len(fake_missing_rpc.store.get("rpc_mark_sent_calls", [])) == 0)
        dl_updates = fake_missing_rpc.store.get("quote_delivery_log__updates", [])
        record("RPC chua ton tai: fallback co update delivery_log status='sent'", any(u.get("status") == "sent" for u in dl_updates))
        q_updates = fake_missing_rpc.store.get("quotes__updates", [])
        record("RPC chua ton tai: fallback co update quotes.sent_at/completed_at", len(q_updates) == 1 and q_updates[0].get("sent_at") is not None and q_updates[0].get("completed_at") == q_updates[0].get("sent_at"))
        activity = fake_missing_rpc.store.get("quote_activity_log", [])
        record("RPC chua ton tai: fallback co ghi quote_activity_log action='sent_email'", len(activity) == 1 and activity[0]["action"] == "sent_email")

    # ── 1c) RPC VA fallback DEU that bai (loi DB that su o ca 2 duong) ->
    # BAT BUOC van phai tra ve status='sent', KHONG duoc bao "gui that bai"
    # vi SMTP da THAT SU gui roi - day la yeu cau cot loi cua atomicity fix ──
    fake_both_fail = FakeSupabase({"attempt_count": 0, "rpc_mode": "other_error", "fail_tables": ("quotes", "quote_activity_log")})
    with patch.object(svc, "get_supabase_client", return_value=fake_both_fail), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.return_value = MagicMock()
        try:
            result = svc.send_quote_email(
                quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact",
                "Gửi anh/chị báo giá tham khảo.", attach_pdf=False, idempotency_key="idem-1c-both-fail",
            )
            record("RPC + fallback DEU loi: KHONG raise, van tra ve status='sent' (SMTP da gui that)", result["status"] == "sent")
        except Exception as e:
            record("RPC + fallback DEU loi: KHONG raise, van tra ve status='sent' (SMTP da gui that)", False, str(e))
        record("RPC + fallback DEU loi: KHONG co update nao tren quotes (ca 2 duong deu that bai that)", "quotes__updates" not in fake_both_fail.store)

    # ── 2) SMTP auth error -> status='failed', KHONG set quotes.sent_at ────
    fake2 = FakeSupabase({"attempt_count": 0})
    with patch.object(svc, "get_supabase_client", return_value=fake2), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.side_effect = smtplib.SMTPAuthenticationError(535, b"bad creds")
        try:
            svc.send_quote_email(quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-2")
            record("SMTP auth error: phai raise ValueError", False)
        except ValueError as e:
            record("SMTP auth error: raise ValueError dung", "App Password" in str(e) or "SMTP" in str(e))
        log_rows = fake2.store.get("quote_delivery_log", [])
        updates = fake2.store.get("quote_delivery_log__updates", [])
        record("SMTP auth error: delivery log co status='failed'", any(u.get("status") == "failed" for u in updates))
        record("SMTP auth error: KHONG co update nao tren bang quotes (khong set sent_at/completed_at)", "quotes__updates" not in fake2.store)

    # ── 3) Timeout -> failed, khong crash ra ngoai (raise ValueError sach) ──
    fake3 = FakeSupabase({"attempt_count": 0})
    with patch.object(svc, "get_supabase_client", return_value=fake3), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.side_effect = TimeoutError("timed out")
        try:
            svc.send_quote_email(quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-3")
            record("Timeout: phai raise ValueError", False)
        except ValueError:
            record("Timeout: raise ValueError (khong crash he thong)", True)

    # ── 4) Greeting fallback ────────────────────────────────────────────────
    record("Greeting co ten: dung ten that", svc.build_greeting("Chị Lan") == "Chào anh/chị Chị Lan,")
    record("Greeting KHONG co ten (None): khong render 'None'/'undefined'", svc.build_greeting(None) == "Chào anh/chị,")
    record("Greeting rong ('' hoac khoang trang): khong render rong bat thuong", svc.build_greeting("   ") == "Chào anh/chị,")

    # ── 5) Recipient fallback: deal.email uu tien 1 ─────────────────────────
    r1 = svc.resolve_recipient(quote, {"email": "khach@abc.com", "customer_name": "Chị Lan", "customer_id": None}, admin)
    record("Recipient: uu tien 1 deal.email", r1["email"] == "khach@abc.com" and r1["source"] == "deal_contact")

    r2 = svc.resolve_recipient(quote, {"email": "", "customer_name": "Chị Lan", "customer_id": None}, admin)
    record("Recipient: deal khong co email, khong co customer_id -> rong (KHONG doan)", r2["email"] is None and r2["source"] is None)

    # ── 6) Permission: quote owner duoc, technical owner + creator bi tu choi ──
    fake_perm = FakeSupabase({"attempt_count": 0})
    with patch.object(svc, "get_supabase_client", return_value=fake_perm), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.return_value = MagicMock()
        try:
            svc.send_quote_email(quote, deal, owner, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-owner")
            record("Quote owner (member) gui duoc", True)
        except svc.QuoteSendValidationError:
            record("Quote owner (member) gui duoc", False)

        try:
            svc.send_quote_email(quote, deal, tech_owner, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-tech")
            record("Technical owner (KHONG phai quote owner) phai bi tu choi", False)
        except svc.QuoteSendValidationError:
            record("Technical owner (KHONG phai quote owner) phai bi tu choi", True)

        try:
            svc.send_quote_email(quote, deal, creator_only, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-creator")
            record("Creator (KHONG phai quote owner) phai bi tu choi", False)
        except svc.QuoteSendValidationError:
            record("Creator (KHONG phai quote owner) phai bi tu choi", True)

    # ── 7) Idempotency: idempotency_key da xu ly -> tra ve KET QUA CU, khong goi SMTP lai ──
    existing_row = {
        "id": "log-existing", "quote_id": "quote-1", "quote_version": 1, "channel": "email",
        "recipient_name": "Chị Lan", "recipient_email": "khach@abc.com", "recipient_source": "deal_contact",
        "subject": "x", "status": "sent", "attempt_count": 1, "requested_at": "2026-01-01T00:00:00Z", "sent_at": "2026-01-01T00:00:01Z",
    }
    fake_idem = FakeSupabase({"attempt_count": 0, "existing_idempotent_row": existing_row})
    with patch.object(svc, "get_supabase_client", return_value=fake_idem), \
         patch.object(email_svc, "get_active_email_channel_for_sending", return_value=valid_channel), \
         patch("smtplib.SMTP") as mock_smtp:
        result = svc.send_quote_email(quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-dup")
        record("Idempotency: tra ve dung row cu (status='sent')", result["status"] == "sent" and result["id"] == "log-existing")
        record("Idempotency: KHONG goi SMTP lan nao (tranh gui trung)", mock_smtp.call_count == 0)

    # ── 8) Validate truoc khi gui: chua duyet -> QuoteSendValidationError, KHONG tao delivery log ──
    draft_quote = make_quote(status="draft")
    fake_draft = FakeSupabase({"attempt_count": 0})
    with patch.object(svc, "get_supabase_client", return_value=fake_draft):
        try:
            svc.send_quote_email(draft_quote, deal, admin, "Chị Lan", "khach@abc.com", "deal_contact", "Xin chào", False, "idem-draft")
            record("Chua duyet: phai raise QuoteSendValidationError", False)
        except svc.QuoteSendValidationError:
            record("Chua duyet: raise QuoteSendValidationError dung", True)
        record("Chua duyet: KHONG tao delivery log nao (fail truoc khi insert)", "quote_delivery_log" not in fake_draft.store)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
