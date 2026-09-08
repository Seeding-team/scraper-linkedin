"""Unit test (mock, KHONG dung DB that - khong co TEST_SUPABASE_URL that trong
moi truong nay nen uu tien mock theo dung huong dan) cho
_validate_deal_project_consistency() trong supabase_quote_service.py - validate
quan he Du an <-> Co hoi (deal/customer_leads) <-> Khach hang dung SCHEMA THAT
(quotes KHONG co customer_id rieng), dung cho ca create_quote va update_quote
(qua _validate_project_matches_quote_customer).

Chay: python scratch/test_deal_project_consistency.py (tu thu muc
linkedin_group_crawler/, khong can server/DB that dang chay).
"""
import sys

sys.path.insert(0, ".")

from unittest.mock import MagicMock

from app.modules.all_platform.services import supabase_quote_service as svc


class FakeResult:
    def __init__(self, data):
        self.data = data


def make_fake_supabase(customer_leads_row=None, projects_row=None, quotes_row=None):
    """Gia lap dung chuoi .table(x).select(...).eq(...).maybe_single().execute()
    ma code that dang goi - moi bang tra ve 1 row co dinh theo tham so."""
    fake = MagicMock()

    def table_side_effect(name):
        table_mock = MagicMock()
        if name == "customer_leads":
            row = customer_leads_row
        elif name == "projects":
            row = projects_row
        elif name == svc.QUOTES_TABLE:
            row = quotes_row
        else:
            row = None
        table_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = FakeResult(row)
        return table_mock

    fake.table.side_effect = table_side_effect
    return fake


def run(name, fn):
    try:
        fn()
        print(f"[PASS] {name}")
    except AssertionError as exc:
        print(f"[FAIL] {name}: {exc}")
        sys.exit(1)


def test_skip_when_missing_ids():
    svc.get_supabase_client = lambda: (_ for _ in ()).throw(RuntimeError("khong duoc goi DB"))
    # Khong co deal_id hoac khong co project_id -> return som, KHONG goi DB.
    svc._validate_deal_project_consistency(None, "proj-1")
    svc._validate_deal_project_consistency("deal-1", None)
    svc._validate_deal_project_consistency(None, None)


def test_match_ok():
    fake = make_fake_supabase(customer_leads_row={"customer_id": "cust-1", "project_id": None}, projects_row={"customer_id": "cust-1"})
    svc.get_supabase_client = lambda: fake
    svc._validate_deal_project_consistency("deal-1", "proj-1")  # khong raise


def test_project_wrong_customer():
    fake = make_fake_supabase(customer_leads_row={"customer_id": "cust-1", "project_id": None}, projects_row={"customer_id": "cust-OTHER"})
    svc.get_supabase_client = lambda: fake
    try:
        svc._validate_deal_project_consistency("deal-1", "proj-1")
        raise AssertionError("le ra phai raise ValueError")
    except ValueError as exc:
        assert "không thuộc khách hàng" in str(exc), str(exc)


def test_deal_already_has_different_project():
    fake = make_fake_supabase(customer_leads_row={"customer_id": "cust-1", "project_id": "proj-OLD"}, projects_row={"customer_id": "cust-1"})
    svc.get_supabase_client = lambda: fake
    try:
        svc._validate_deal_project_consistency("deal-1", "proj-NEW")
        raise AssertionError("le ra phai raise ValueError")
    except ValueError as exc:
        assert "không thuộc dự án" in str(exc), str(exc)


def test_deal_same_project_ok():
    fake = make_fake_supabase(customer_leads_row={"customer_id": "cust-1", "project_id": "proj-1"}, projects_row={"customer_id": "cust-1"})
    svc.get_supabase_client = lambda: fake
    svc._validate_deal_project_consistency("deal-1", "proj-1")  # khong raise


def test_deal_not_found_skips():
    fake = make_fake_supabase(customer_leads_row=None)
    svc.get_supabase_client = lambda: fake
    svc._validate_deal_project_consistency("deal-1", "proj-1")  # khong raise (khong du du lieu de so sanh)


def test_no_customer_on_deal_skips_customer_check_but_still_checks_project_mismatch():
    fake = make_fake_supabase(customer_leads_row={"customer_id": None, "project_id": "proj-OLD"})
    svc.get_supabase_client = lambda: fake
    try:
        svc._validate_deal_project_consistency("deal-1", "proj-NEW")
        raise AssertionError("le ra phai raise ValueError (deal.project_id khac)")
    except ValueError as exc:
        assert "không thuộc dự án" in str(exc), str(exc)


def test_update_path_via_quote_id():
    fake = make_fake_supabase(
        quotes_row={"deal_id": "deal-1"},
        customer_leads_row={"customer_id": "cust-1", "project_id": None},
        projects_row={"customer_id": "cust-OTHER"},
    )
    svc.get_supabase_client = lambda: fake
    try:
        svc._validate_project_matches_quote_customer("quote-1", "proj-1")
        raise AssertionError("le ra phai raise ValueError")
    except ValueError as exc:
        assert "không thuộc khách hàng" in str(exc), str(exc)


if __name__ == "__main__":
    original = svc.get_supabase_client
    try:
        run("skip khi thieu deal_id/project_id (khong goi DB)", test_skip_when_missing_ids)
        run("khop dung khach hang -> khong loi", test_match_ok)
        run("du an sai khach hang -> loi tieng Viet ro rang", test_project_wrong_customer)
        run("co hoi da thuoc du an khac -> loi tieng Viet ro rang", test_deal_already_has_different_project)
        run("co hoi da thuoc DUNG du an dang chon -> khong loi", test_deal_same_project_ok)
        run("khong tim thay deal -> bo qua (an toan)", test_deal_not_found_skips)
        run("deal chua co customer_id nhung co project_id khac -> van chan", test_no_customer_on_deal_skips_customer_check_but_still_checks_project_mismatch)
        run("duong update_quote (qua quote_id) -> dung chung logic", test_update_path_via_quote_id)
        print("\nTat ca test PASS - khong ket noi DB that o buoc nao.")
    finally:
        svc.get_supabase_client = original
