"""Guard dung chung cho MOI integration/E2E test co mutation (tao/sua/xoa
quote that). CHUAN BI SAN, CHUA duoc goi/chay boi bat ky script nao trong
lan nay - script test that se `from scratch.test_db_guard import
require_test_db, make_test_marker, assert_marker, preview_and_cleanup`
truoc khi lam bat ky viec ghi nao.

Nguyen tac (dung theo dung yeu cau an toan sau su co xoa nham du lieu that):
  1. Bat buoc co bien moi truong TEST_SUPABASE_URL - KHONG BAO GIO fallback
     ve SUPABASE_URL (production/dev).
  2. Neu host cua TEST_SUPABASE_URL trung (substring, khong phan biet hoa/
     thuong) voi bat ky host nao trong FORBIDDEN_TEST_DB_HOSTS -> abort ngay,
     khong chay gi them.
  3. Host cua TEST_SUPABASE_URL cung KHONG duoc trung voi host cua bien
     SUPABASE_URL dang cau hinh that (du SUPABASE_URL do co nam trong
     FORBIDDEN_TEST_DB_HOSTS hay khong - phong truong hop mot host moi phat
     sinh sau nay chua kip liet ke thu cong vao danh sach cam).
  4. Bat buoc co bien moi truong APP_ENV=test (khong phan biet hoa/thuong) -
     day la "cong tac an toan thu hai" doc lap voi URL, tranh truong hop
     TEST_SUPABASE_URL bi set nham/copy nham gia tri that ma nguoi chay
     script khong de y (phai chu dong bat ca 2 dieu kien).
  5. Truoc khi tra ve, IN RO host (khong phai toan bo URL, khong bao gio in
     API key/service role key) de nguoi chay tu mat thay dang nham vao DB
     nao truoc khi bat ky mutation nao xay ra.
  6. Moi test run phai co 1 run_id rieng (uuid4 rut gon), moi record test
     tao ra phai gan marker "__TESTPHASE123_<run_id>__" vao dung 1 field
     hien thi duoc (vd quoteTitle/customer_name) de con nhan dien duoc sau
     nay du khong con bien nho trong bo nho.
  7. Cleanup CHI duoc xoa dung danh sach ID da tu tay track trong chinh
     lan chay (KHONG filter lai theo dealId/status/thoi gian nhu bug thuc te
     da gay xoa nham 797b20f6... o phien truoc) - truoc khi xoa PHAI in ra
     preview {id, quote_number/ten, marker} cho tung dong; neu bat ky dong
     nao THIEU marker dung run_id hien tai -> abort TOAN BO cleanup (khong
     xoa dong nao ca, kem ca cac dong hop le), bao loi ro rang.
  8. Bat ky dieu kien nao o tren khong dat -> raise TestDbGuardError (script
     goi guard nay phai de loi tu nhien lam exit code khac 0) TRUOC khi goi
     bat ky mutation nao.
"""
from __future__ import annotations

import os
import sys
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlparse


class TestDbGuardError(RuntimeError):
    pass


def _load_forbidden_hosts() -> list[str]:
    raw = os.environ.get("FORBIDDEN_TEST_DB_HOSTS", "seeding.db.markeeai.com,rtwpogvficadngtfrcci.supabase.co")
    return [h.strip().lower() for h in raw.split(",") if h.strip()]


def _host_of(url: str) -> str:
    return (urlparse(url).hostname or url).lower()


def require_test_db() -> str:
    """Tra ve TEST_SUPABASE_URL da xac minh an toan, hoac raise
    TestDbGuardError (KHONG bao gio tra ve SUPABASE_URL thay the). In ra
    (stdout) host dang dung - KHONG BAO GIO in key/secret - de nguoi chay
    script tu xac nhan bang mat truoc khi mutation xay ra."""
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    if app_env != "test":
        raise TestDbGuardError(
            "APP_ENV phai duoc set = 'test' (cong tac an toan thu hai, doc lap voi URL) "
            f"truoc khi chay integration/E2E test co mutation. Hien tai APP_ENV={app_env!r}."
        )

    test_url = os.environ.get("TEST_SUPABASE_URL", "").strip()
    if not test_url:
        raise TestDbGuardError(
            "TEST_SUPABASE_URL chua duoc cau hinh - KHONG chay integration/E2E test co mutation. "
            "Copy .env.test.example thanh .env.test va dien URL 1 project Supabase test rieng."
        )

    test_host = _host_of(test_url)
    forbidden = _load_forbidden_hosts()
    for bad_host in forbidden:
        if bad_host in test_host or bad_host in test_url.lower():
            raise TestDbGuardError(
                f"TEST_SUPABASE_URL ('{test_url}') trung/gan giong host bi cam ('{bad_host}') - "
                "day co the la DB production/dev dang dung chung. ABORT, khong chay gi them."
            )

    prod_url = os.environ.get("SUPABASE_URL", "").strip()
    if prod_url:
        prod_host = _host_of(prod_url)
        if prod_host and (prod_host == test_host or prod_host in test_url.lower()):
            raise TestDbGuardError(
                f"TEST_SUPABASE_URL trung host voi SUPABASE_URL dang cau hinh ('{prod_host}') - "
                "co the la DB production/dev that. ABORT, khong chay gi them."
            )

    print(f"[test_db_guard] APP_ENV=test xac nhan. Dang dung TEST_SUPABASE_URL voi host: {test_host}")
    return test_url


def make_run_id() -> str:
    return uuid.uuid4().hex[:8]


def make_test_marker(run_id: str) -> str:
    return f"__TESTPHASE123_{run_id}__"


def assert_marker(text: str | None, marker: str) -> bool:
    return bool(text) and marker in (text or "")


@dataclass
class TestRunTracker:
    """Theo doi CHINH XAC nhung ID test run nay da tao - cleanup CHI duoc
    phep xoa dung danh sach nay, khong duoc tu suy dien/filter lai theo
    field khac (bai hoc that tu vu xoa nham 797b20f6...)."""

    run_id: str
    marker: str
    created_quote_ids: list[str] = field(default_factory=list)
    created_lead_ids: list[str] = field(default_factory=list)

    def track_quote(self, quote_id: str) -> None:
        self.created_quote_ids.append(quote_id)

    def track_lead(self, lead_id: str) -> None:
        self.created_lead_ids.append(lead_id)


def preview_and_cleanup(tracker: TestRunTracker, fetch_records_fn, delete_fn) -> None:
    """fetch_records_fn(ids) -> list[dict] (moi dict co it nhat 'id' va 1
    field text de kiem tra marker, vd 'title'/'quote_number').
    delete_fn(id) -> None (goi API/DB delete THAT, chi duoc goi sau khi
    preview + kiem marker toan bo PASS).

    In preview truoc, abort TOAN BO neu bat ky record nao thieu marker."""
    all_ids = [*tracker.created_quote_ids, *tracker.created_lead_ids]
    if not all_ids:
        print("[cleanup] Khong co ID nao duoc track trong run nay - khong co gi de xoa.")
        return

    records = fetch_records_fn(all_ids)
    print(f"[cleanup] Preview {len(records)} record se bi xoa (run_id={tracker.run_id}):")
    bad = []
    for r in records:
        text_fields = " ".join(str(v) for v in r.values() if isinstance(v, str))
        ok = assert_marker(text_fields, tracker.marker)
        print(f"  - id={r.get('id')} marker_ok={ok} preview={text_fields[:80]!r}")
        if not ok:
            bad.append(r.get("id"))

    if bad:
        raise TestDbGuardError(
            f"ABORT TOAN BO cleanup: {len(bad)} record KHONG co marker '{tracker.marker}' "
            f"(ids: {bad}). Khong xoa bat ky dong nao, ke ca dong hop le, cho toi khi ra soat lai."
        )

    for record_id in all_ids:
        delete_fn(record_id)
        print(f"  deleted: {record_id}")
    print(f"[cleanup] Da xoa dung {len(all_ids)}/{len(all_ids)} ID do run {tracker.run_id} tao.")


if __name__ == "__main__":
    # Demo chay thu logic guard (KHONG ket noi DB that) - xac nhan abort dung
    # khi thieu bien hoac host bi cam, KHONG phai 1 bai test E2E that.
    os.environ.pop("APP_ENV", None)
    os.environ.pop("TEST_SUPABASE_URL", None)
    os.environ.pop("SUPABASE_URL", None)
    try:
        require_test_db()
        print("[FAIL] Le ra phai abort khi thieu APP_ENV=test")
        sys.exit(1)
    except TestDbGuardError as exc:
        print(f"[PASS] Abort dung khi thieu APP_ENV=test: {exc}")

    os.environ["APP_ENV"] = "test"
    try:
        require_test_db()
        print("[FAIL] Le ra phai abort khi thieu TEST_SUPABASE_URL")
        sys.exit(1)
    except TestDbGuardError as exc:
        print(f"[PASS] Abort dung khi thieu bien: {exc}")

    os.environ["TEST_SUPABASE_URL"] = "https://seeding.db.markeeai.com"
    try:
        require_test_db()
        print("[FAIL] Le ra phai abort khi trung host production")
        sys.exit(1)
    except TestDbGuardError as exc:
        print(f"[PASS] Abort dung khi trung host production: {exc}")

    # Gia lap SUPABASE_URL production dang cau hinh song song - dam bao guard
    # tu chan ngay ca khi host do CHUA nam trong FORBIDDEN_TEST_DB_HOSTS.
    os.environ["SUPABASE_URL"] = "https://some-other-shared-project.supabase.co"
    os.environ["TEST_SUPABASE_URL"] = "https://some-other-shared-project.supabase.co"
    try:
        require_test_db()
        print("[FAIL] Le ra phai abort khi trung host voi SUPABASE_URL dang cau hinh")
        sys.exit(1)
    except TestDbGuardError as exc:
        print(f"[PASS] Abort dung khi trung host voi SUPABASE_URL: {exc}")

    os.environ["SUPABASE_URL"] = "https://seeding.db.markeeai.com"
    os.environ["TEST_SUPABASE_URL"] = "https://my-real-test-project.supabase.co"
    try:
        url = require_test_db()
        print(f"[PASS] Chap nhan host test hop le: {url}")
    except TestDbGuardError as exc:
        print(f"[FAIL] Khong nen abort: {exc}")
        sys.exit(1)

    run_id = make_run_id()
    marker = make_test_marker(run_id)
    tracker = TestRunTracker(run_id=run_id, marker=marker)
    tracker.track_quote("fake-quote-1")

    def fetch_ok(ids):
        return [{"id": i, "title": f"{marker} demo"} for i in ids]

    def fetch_bad(ids):
        return [{"id": i, "title": "khong co marker gi ca"} for i in ids]

    def noop_delete(_id):
        pass

    preview_and_cleanup(tracker, fetch_ok, noop_delete)
    print("[PASS] cleanup thanh cong khi marker dung")

    try:
        preview_and_cleanup(tracker, fetch_bad, noop_delete)
        print("[FAIL] Le ra phai abort khi thieu marker")
        sys.exit(1)
    except TestDbGuardError as exc:
        print(f"[PASS] Abort dung khi thieu marker: {exc}")

    print()
    print("Tat ca self-check cua guard PASS (khong ket noi DB that o buoc nay).")
