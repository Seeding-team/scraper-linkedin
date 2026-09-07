"""Mock/pure unit test cho error mapping moi trong get_quote() - PGRST116
(zero rows) -> QuoteNotFoundError("Khong tim thay bao gia."), nhung KHONG
nuot loi ket noi/permission/DB khac. KHONG goi DB that (tu tao fake Supabase
client, monkeypatch get_supabase_client()).
Chay: python scratch/test_quote_not_found_mapping.py
"""
import sys, io
from pathlib import Path
from unittest.mock import patch

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from postgrest.exceptions import APIError

import app.modules.all_platform.services.supabase_quote_service as svc
from app.modules.all_platform.services.supabase_quote_service import QuoteNotFoundError

failed = 0
def check(label, fn):
    global failed
    try:
        fn()
        print(f"[PASS] {label}")
    except AssertionError as e:
        print(f"[FAIL] {label}: {e}")
        failed += 1


class _FakeExec:
    def __init__(self, result=None, exc=None):
        self._result = result
        self._exc = exc

    def execute(self):
        if self._exc:
            raise self._exc
        return self._result


class _FakeResultData:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Fake chi ho tro dung cac method .select/.eq/.is_/.single ma
    get_quote() dung, tra ve chinh no de chain, roi .execute() theo cau hinh."""
    def __init__(self, on_execute):
        self._on_execute = on_execute

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def is_(self, *a, **k): return self
    def single(self): return self

    def execute(self):
        return self._on_execute()


class _FakeTable:
    def __init__(self, on_execute):
        self._on_execute = on_execute

    def table(self, *_a, **_k):
        return _FakeQuery(self._on_execute)


def _patched_client(on_execute):
    return patch.object(svc, "get_supabase_client", return_value=_FakeTable(on_execute))


print("=== 1) Quote TON TAI - tra ve du lieu binh thuong, khong loi ===")
def case_exists():
    real_row = {
        "id": "q1", "quote_form_id": "f1", "quote_number": "Q-1", "status": "draft",
        "form_schema_version": 1, "form_snapshot": {}, "data": {}, "subtotal_amount": 0,
        "vat_amount": 0, "total_amount": 0, "deleted_at": None,
    }
    with _patched_client(lambda: _FakeResultData(real_row)):
        with patch.object(svc, "_quote_items", return_value=[]):
            result = svc.get_quote("q1")
            assert result["id"] == "q1", f"expected id q1, got {result.get('id')}"
check("Quote ton tai -> tra ve dict binh thuong", case_exists)

print()
print("=== 2) Quote KHONG TON TAI (zero rows / PGRST116) -> QuoteNotFoundError ===")
def case_not_found():
    zero_rows_exc = APIError({"message": "JSON object requested, multiple (or no) rows returned", "code": "PGRST116"})
    with _patched_client(lambda: (_ for _ in ()).throw(zero_rows_exc)):
        try:
            svc.get_quote("nonexistent")
            raise AssertionError("le ra phai raise QuoteNotFoundError")
        except QuoteNotFoundError as e:
            assert str(e) == "Không tìm thấy báo giá.", f"message sai: {e}"
        except Exception as e:
            raise AssertionError(f"raise sai loai exception: {type(e).__name__}: {e}")
check("Zero rows (PGRST116) -> QuoteNotFoundError voi message dung", case_not_found)

print()
print("=== 3) Loi KET NOI DB (khong phai APIError) -> KHONG duoc nuot, phai raise nguyen ===")
def case_connection_error():
    conn_exc = ConnectionError("Could not connect to database host")
    with _patched_client(lambda: (_ for _ in ()).throw(conn_exc)):
        try:
            svc.get_quote("q1")
            raise AssertionError("le ra phai raise loi ket noi")
        except QuoteNotFoundError:
            raise AssertionError("BUG: loi ket noi bi nuot nham thanh QuoteNotFoundError!")
        except ConnectionError as e:
            assert str(e) == "Could not connect to database host"
check("Loi ket noi -> KHONG bi map nham thanh QuoteNotFoundError", case_connection_error)

print()
print("=== 4) Loi PERMISSION tu Postgres (APIError code KHAC PGRST116) -> KHONG duoc nuot ===")
def case_permission_error():
    perm_exc = APIError({"message": "permission denied for table quotes", "code": "42501"})
    with _patched_client(lambda: (_ for _ in ()).throw(perm_exc)):
        try:
            svc.get_quote("q1")
            raise AssertionError("le ra phai raise loi permission")
        except QuoteNotFoundError:
            raise AssertionError("BUG: loi permission (code 42501) bi nuot nham thanh QuoteNotFoundError!")
        except APIError as e:
            assert e.code == "42501", f"code sai: {e.code}"
check("Loi permission (code khac PGRST116) -> KHONG bi map nham", case_permission_error)

print()
print("=== 5) Quote DA SOFT-DELETE -> get_quote() thuong (include_deleted=False, mac dinh) coi la not-found ===")
def case_deleted_quote_default():
    # is_('deleted_at','null') da duoc goi trong query - dong nghia voi that
    # PostgREST se KHONG tra dong nao cho quote da bi soft-delete, dan toi
    # dung PGRST116 y het truong hop khong ton tai. Mo phong dung hanh vi do.
    zero_rows_exc = APIError({"message": "0 rows", "code": "PGRST116"})
    with _patched_client(lambda: (_ for _ in ()).throw(zero_rows_exc)):
        try:
            svc.get_quote("soft-deleted-quote-id")  # include_deleted mac dinh False
            raise AssertionError("le ra phai raise QuoteNotFoundError cho quote da xoa mem")
        except QuoteNotFoundError:
            pass
check("Quote da soft-delete + include_deleted=False (mac dinh) -> coi la not-found", case_deleted_quote_default)

print()
if failed:
    print(f"{failed} case FAILED")
    sys.exit(1)
print("Tat ca case pass - KHONG goi DB that (toan bo Supabase client duoc mock).")
