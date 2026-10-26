from app.modules.all_platform.services.crm_customer_progress_service import (
    compute_customer_progress,
    attach_next_action,
)


def _deal(id="d1", stage="dealing", updated_at="2026-01-01T00:00:00Z"):
    return {"id": id, "deal_stage": stage, "updated_at": updated_at}


def test_no_quote_no_contract_falls_back_to_status_label():
    result = compute_customer_progress("new_lead", [_deal()], [], [])
    assert result["nextAction"] == "Xác minh nhu cầu"
    assert result["autoStatus"] is None


def test_draft_quote_sets_theo_doi_bao_gia_and_upgrades_to_following():
    quotes = [{"id": "q1", "deal_id": "d1", "status": "draft", "deleted_at": None}]
    result = compute_customer_progress("new_lead", [_deal()], quotes, [])
    assert result["nextAction"] == "Theo dõi báo giá"
    assert result["autoStatus"] == "following"


def test_approved_quote_sets_gui_chot_bao_gia():
    quotes = [{"id": "q1", "deal_id": "d1", "status": "approved", "deleted_at": None}]
    result = compute_customer_progress("following", [_deal()], quotes, [])
    assert result["nextAction"] == "Gửi/chốt báo giá"
    assert result["autoStatus"] is None  # da la 'following' roi, khong co gi de nang them


def test_contract_draft_sets_theo_doi_hop_dong():
    contracts = [{"id": "c1", "deal_id": "d1", "status": "draft"}]
    result = compute_customer_progress("following", [_deal()], [], contracts)
    assert result["nextAction"] == "Theo dõi hợp đồng"


def test_contract_pending_signature_sets_theo_doi_ky_ket():
    contracts = [{"id": "c1", "deal_id": "d1", "status": "pending_signature"}]
    result = compute_customer_progress("following", [_deal()], [], contracts)
    assert result["nextAction"] == "Theo dõi ký kết"


def test_contract_signed_sets_trien_khai_cham_soc_and_upgrades_to_current_customer():
    contracts = [{"id": "c1", "deal_id": "d1", "status": "signed"}]
    result = compute_customer_progress("following", [_deal()], [], contracts)
    assert result["nextAction"] == "Triển khai/chăm sóc"
    assert result["autoStatus"] == "current_customer"


def test_status_never_auto_downgrades():
    # Khach hang da la current_customer, nhung Deal nay chi co bao gia nhap -> KHONG duoc ha xuong.
    quotes = [{"id": "q1", "deal_id": "d1", "status": "draft", "deleted_at": None}]
    result = compute_customer_progress("current_customer", [_deal()], quotes, [])
    assert result["autoStatus"] is None


def test_not_fit_never_recomputed():
    contracts = [{"id": "c1", "deal_id": "d1", "status": "signed"}]
    result = compute_customer_progress("not_fit", [_deal()], [], contracts)
    assert result["nextAction"] == "Không còn theo dõi"
    assert result["autoStatus"] is None


def test_cancelled_quote_and_terminated_contract_are_ignored():
    quotes = [{"id": "q1", "deal_id": "d1", "status": "cancelled", "deleted_at": None}]
    contracts = [{"id": "c1", "deal_id": "d1", "status": "terminated"}]
    result = compute_customer_progress("new_lead", [_deal()], quotes, contracts)
    assert result["nextAction"] == "Xác minh nhu cầu"


def test_multiple_deals_prefers_active_non_terminal_deal_with_signal():
    # Deal 1 (cu, da 'lost') co hop dong signed - khong duoc uu tien vi la stage dong bang.
    # Deal 2 (dang 'dealing') co bao gia moi approve - day la Deal "dang hoat dong" phai duoc chon.
    deals = [
        _deal(id="d1", stage="lost"),
        _deal(id="d2", stage="dealing"),
    ]
    contracts = [{"id": "c1", "deal_id": "d1", "status": "signed"}]
    quotes = [{"id": "q1", "deal_id": "d2", "status": "approved", "deleted_at": None}]
    result = compute_customer_progress("following", deals, quotes, contracts)
    assert result["nextAction"] == "Gửi/chốt báo giá"
    assert result["activeDealId"] == "d2"


def test_multiple_open_deals_picks_highest_signal_not_just_latest():
    deals = [
        _deal(id="d1", stage="dealing", updated_at="2026-01-01T00:00:00Z"),
        _deal(id="d2", stage="dealing", updated_at="2026-02-01T00:00:00Z"),
    ]
    # d2 moi hon nhung chua co gi; d1 cu hon nhung da co hop dong cho ky - phai uu tien tin hieu cao hon.
    contracts = [{"id": "c1", "deal_id": "d1", "status": "pending_signature"}]
    result = compute_customer_progress("following", deals, [], contracts)
    assert result["nextAction"] == "Theo dõi ký kết"
    assert result["activeDealId"] == "d1"


def test_attach_next_action_mutates_customer_rows_in_place():
    customers = [{"id": "cust1", "status": "new_lead"}]
    deals_by_customer = {"cust1": [_deal()]}
    quotes_by_customer = {"cust1": [{"id": "q1", "deal_id": "d1", "status": "draft", "deleted_at": None}]}
    attach_next_action(customers, deals_by_customer, quotes_by_customer, {})
    assert customers[0]["next_action"] == "Theo dõi báo giá"
