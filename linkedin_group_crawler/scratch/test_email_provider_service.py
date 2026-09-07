"""Unit test THUAN (khong DB that, khong SMTP that) cho
quote_email_provider_service.py - mock get_supabase_client() bang 1 fake
table/query builder trong bo nho, dung Fernet key TEST (khong phai key that
tren production). Kiem tra dung 3 yeu cau bao mat cot loi:
  1) App Password luon duoc ma hoa truoc khi "ghi DB" (khong bao gio thay
     plaintext trong payload gui vao .update()/.insert()).
  2) get_email_provider_settings() KHONG BAO GIO tra ve app_password/
     encrypted_app_password - chi credentialConfigured.
  3) Luu voi app_password rong -> GIU credential cu (khong ghi de bang None).
Chay: python scratch/test_email_provider_service.py
"""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY"] = "rulNwdoNYoF61lc2y_mxl2KqEyKMCGFa6dwUuaW4SX8="

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


class FakeTable:
    """Mo phong toi thieu Supabase Python client `.table(...).select/insert/
    update/eq/maybe_single/execute()` - luu 1 dict duy nhat trong bo nho
    (dung y nghia voi UNIQUE INDEX tren channel_type trong migration 092)."""
    def __init__(self, store, name):
        self.store = store
        self.name = name
        self._pending_update = None
        self._pending_insert = None
        self._is_maybe_single_select = False

    def select(self, *_a, **_k):
        self._is_maybe_single_select = True
        return self

    def maybe_single(self):
        return self

    def eq(self, *_a, **_k):
        return self

    def insert(self, payload):
        self._pending_insert = payload
        return self

    def update(self, payload):
        self._pending_update = payload
        return self

    def execute(self):
        if self._pending_insert is not None:
            self.store["row"] = dict(self._pending_insert)
            self._pending_insert = None
        elif self._pending_update is not None:
            if self.store.get("row") is None:
                self.store["row"] = {}
            self.store["row"].update(self._pending_update)
            self._pending_update = None
        elif self._is_maybe_single_select and self.store.get("row") is None:
            # Mo phong DUNG hanh vi that cua postgrest-py:
            # .maybe_single().execute() tra ve None THANG (khong phai 1
            # response object voi .data=None) khi khong co dong nao khop -
            # day chinh la bug that da gap (_get_row() doc .data truc tiep
            # ma khong kiem tra None truoc).
            return None
        result = MagicMock()
        result.data = self.store.get("row")
        return result


class FakeSupabase:
    def __init__(self):
        self.store = {"row": None}

    def table(self, name):
        return FakeTable(self.store, name)


def run():
    from app.modules.all_platform.services import quote_email_provider_service as svc

    fake = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake):
        # ── 1) Chua cau hinh -> credentialConfigured=False, khong loi ──────
        settings = svc.get_email_provider_settings()
        record("Chua cau hinh: credentialConfigured=False", settings["credentialConfigured"] is False)
        record("Chua cau hinh: khong co key 'app_password'/'encrypted_app_password' nao trong response", "app_password" not in settings and "encrypted_app_password" not in settings)

        # ── 2) Luu lan dau voi app_password that ───────────────────────────
        saved = svc.save_email_provider_settings("sale@congty.com", "Sale Markee", "AppPassw0rdThatFake123", None)
        record("Sau khi luu: credentialConfigured=True", saved["credentialConfigured"] is True)
        record("Response KHONG chua app_password/encrypted_app_password", "app_password" not in saved and "encrypted_app_password" not in saved)
        raw_row = fake.store["row"]
        record("DB row: cot encrypted_app_password KHONG PHAI plaintext", raw_row["encrypted_app_password"] != "AppPassw0rdThatFake123" and isinstance(raw_row["encrypted_app_password"], str))
        # Truyen DUNG shape that Supabase tra ve (str, KHONG .encode() truoc)
        # - bug that da gap: bytes(str) khong encoding raise "string argument
        # without an encoding". Test truoc day vo tinh .encode() truoc nen
        # khong bat duoc bug nay.
        record(
            "DB row: giai ma lai dung dung app_password da nhap (round-trip, dung shape str tu Supabase)",
            svc._decrypt_password(raw_row["encrypted_app_password"]) == "AppPassw0rdThatFake123",
        )
        record(
            "DB row: encrypted_app_password THAT SU la str (khong phai bytes) - dung gia dinh shape that",
            isinstance(raw_row["encrypted_app_password"], str),
        )
        record("DB row: preset IMAP dung Gmail that (host/port/security)", raw_row["imap_host"] == "imap.gmail.com" and raw_row["imap_port"] == 993 and raw_row["imap_security"] == "ssl")
        record("DB row: preset SMTP dung Gmail that (host/port/security)", raw_row["smtp_host"] == "smtp.gmail.com" and raw_row["smtp_port"] == 587 and raw_row["smtp_security"] == "starttls")

        # ── 3) Sua From Name, BO TRONG app_password -> giu credential cu ───
        old_encrypted = raw_row["encrypted_app_password"]
        svc.save_email_provider_settings("sale@congty.com", "Sale Markee (sua ten)", None, None)
        record("Update password=None: encrypted_app_password KHONG doi (giu credential cu)", fake.store["row"]["encrypted_app_password"] == old_encrypted)
        record("Update password=None: sender_name doi dung nhu yeu cau", fake.store["row"]["sender_name"] == "Sale Markee (sua ten)")

        # ── 4) Xoa thong tin xac thuc ───────────────────────────────────────
        cleared = svc.clear_email_provider_credentials(None)
        record("Sau khi xoa credential: credentialConfigured=False", cleared["credentialConfigured"] is False)
        record("Sau khi xoa credential: is_enabled tu dong tat", fake.store["row"]["is_enabled"] is False)

        # ── 5) Bat kenh khi CHUA co credential -> tu choi dung ──────────────
        try:
            svc.set_email_provider_enabled(True, None)
            record("Bat kenh khi chua co credential -> phai raise loi", False)
        except svc.EmailProviderNotConfiguredError:
            record("Bat kenh khi chua co credential -> raise EmailProviderNotConfiguredError dung", True)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
