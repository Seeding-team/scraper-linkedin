"""Bug: panel pháp lý AI Contract Copilot trộn lẫn Customer (doanh nghiệp) và Contact (người liên hệ), và coi Người liên hệ
mặc nhiên là Người đại diện ký. Test ở đây xác nhận: tên/MST/địa chỉ luôn từ Customer; họ tên/chức vụ/SĐT/email từ Contact
đã chọn; Người đại diện ký là vai trò RIÊNG (gợi ý từ Contact phải được xác nhận, không tự nhận); "Bổ sung tại chỗ" phân
biệt rõ 'chỉ dùng cho hợp đồng này' và 'lưu vào CRM' (permission-checked, không chặn luồng khi thiếu quyền); gửi duyệt/ký
bị chặn khi người đại diện ký CHƯA được xác nhận (không dùng checkbox "Tôi đã hiểu" để vượt qua)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from app.modules.all_platform.services import contract_approval_service as approval
from app.modules.all_platform.services import contract_source_service as src
from app.modules.all_platform.services.contract_ai_service import build_parties, resolve_representative

ENTERPRISE_DEAL = {"customer_id": "C1", "customer_name": "Thảo", "company_name": "ABC", "tax_code": "031", "address": "HCM",
                    "contact_name": "Thảo", "position": "Trưởng phòng mua hàng", "phone": "090", "email": "thao@abc.vn"}
INDIVIDUAL_DEAL = {"customer_id": "C2", "customer_name": "Nguyễn Văn B", "company_name": "Nguyễn Văn B", "customer_kind": "individual"}


# ───────── resolve_representative(): vai trò RIÊNG, không mặc nhiên = Người liên hệ ─────────
def test_representative_suggested_from_contact_is_not_auto_confirmed():
    rep = resolve_representative(ENTERPRISE_DEAL)
    assert rep["name"] == "Thảo" and rep["source"] == "contact" and rep["confirmed"] is False


def test_representative_override_from_sale_wins_and_is_confirmed():
    override = {"name": "Nguyễn Văn Giám Đốc", "position": "Giám đốc", "contact_id": "CT-9"}
    rep = resolve_representative(ENTERPRISE_DEAL, override)
    assert rep["name"] == "Nguyễn Văn Giám Đốc" and rep["confirmed"] is True and rep["source"] == "override"


def test_individual_customer_with_no_contact_is_self_confirmed_representative():
    rep = resolve_representative(INDIVIDUAL_DEAL)
    assert rep["name"] == "Nguyễn Văn B" and rep["confirmed"] is True and rep["source"] == "individual_self"


def test_enterprise_with_no_contact_and_no_override_has_no_representative_guess():
    """Doanh nghiệp chưa gắn Contact nào + chưa xác nhận: KHÔNG được suy đoán đại diện từ tên khách hàng/công ty."""
    deal = {"customer_id": "C3", "customer_name": "Trần C", "company_name": "XYZ CORP", "tax_code": "099"}
    rep = resolve_representative(deal)
    assert rep["name"] == "" and rep["confirmed"] is False and rep["source"] is None


# ───────── build_parties(): tên công ty (Customer) KHÔNG bao giờ lẫn với tên người liên hệ/đại diện (Contact) ─────────
def test_contact_named_thao_but_company_named_abc_keeps_them_distinct():
    """Đúng kịch bản yêu cầu: Contact tên 'Thảo' nhưng công ty tên 'ABC' -> hợp đồng phải ghi đúng pháp nhân ABC, Thảo chỉ là rep."""
    parties = build_parties(ENTERPRISE_DEAL, None, None)
    assert parties["a"]["name"] == "ABC"           # tên pháp nhân = Customer, không phải Contact
    assert parties["a"]["rep"] == "Thảo"           # Thảo chỉ xuất hiện ở vai trò người liên hệ/đại diện, không phải tên công ty
    assert parties["a"]["position"] == "Trưởng phòng mua hàng"
    assert parties["a"]["phone"] == "090" and parties["a"]["email"] == "thao@abc.vn"


def test_representative_override_propagates_into_build_parties():
    rep = {"name": "Giám đốc Ký Thật", "position": "Tổng giám đốc", "phone": "", "email": ""}
    parties = build_parties(ENTERPRISE_DEAL, None, None, rep)
    assert parties["a"]["rep"] == "Giám đốc Ký Thật" and parties["a"]["position"] == "Tổng giám đốc"
    assert parties["a"]["name"] == "ABC"           # override người đại diện không đụng tới tên công ty


def test_issuer_representative_position_comes_from_issuer_company_position_label(monkeypatch):
    """Bug: "Chức vụ" của Người liên hệ Bên B (đơn vị phát hành) luôn để trống ("……") trên hợp đồng dù đã chọn Chức vụ
    cho công ty phát hành (migration 187, positionLabel trả từ _row_to_issuer_company) - build_parties() hard-code
    "position": "" cho Bên B, chưa bao giờ đọc field này."""
    issuer = {"legalName": "MARKEE", "taxCode": "0402336899", "address": "Đà Nẵng",
              "contactName": "Dương Đình Huấn", "positionLabel": "Giám đốc", "phone": "0765055708", "email": "admin@markee.vn"}
    parties = build_parties(ENTERPRISE_DEAL, None, issuer)
    assert parties["b"]["rep"] == "Dương Đình Huấn"
    assert parties["b"]["position"] == "Giám đốc"


def test_issuer_representative_position_blank_when_not_set():
    issuer = {"legalName": "MARKEE", "contactName": "Dương Đình Huấn"}
    parties = build_parties(ENTERPRISE_DEAL, None, issuer)
    assert parties["b"]["position"] == ""


# ───────── legal_gaps(): thiếu/chưa xác nhận người đại diện ký KHÔNG chặn tạo nháp (chỉ optional) ─────────
def test_missing_representative_is_optional_not_required_for_draft():
    deal = {"customer_id": "C3", "customer_name": "Trần C", "company_name": "XYZ CORP", "tax_code": "099", "address": "HN"}
    gaps = src.legal_gaps(deal, None, None)
    assert not any(g["side"] == "A" and g["field"] == "rep" for g in gaps["required"])
    assert any(g["side"] == "A" and g["field"] == "rep" for g in gaps["optional"])
    assert gaps["representative"]["confirmed"] is False


def test_unconfirmed_contact_suggestion_also_only_optional_with_confirm_wording():
    gaps = src.legal_gaps(ENTERPRISE_DEAL, None, None)
    rep_gap = next(g for g in gaps["optional"] if g["side"] == "A" and g["field"] == "rep")
    assert "xác nhận" in rep_gap["label"].lower()
    assert not gaps["blockers"] and not any(g["field"] == "rep" for g in gaps["required"])


def test_enforce_gaps_never_raises_only_for_missing_representative():
    """Không dùng checkbox 'Tôi đã hiểu' để vượt qua bắt buộc: representative không phải required nên ack=False vẫn tạo được nháp
    khi tên/MST/địa chỉ hai bên đã đủ (chỉ thiếu người đại diện ký)."""
    deal = {"customer_id": "C3", "customer_name": "Trần C", "company_name": "XYZ CORP", "tax_code": "099", "address": "HN"}
    issuer = {"legalName": "MARKEE", "taxCode": "040", "address": "Đà Nẵng"}
    gaps = src.legal_gaps(deal, None, issuer)
    assert gaps["required"] == []
    src.enforce_gaps(gaps, acknowledged=False)  # không raise


def test_legal_gaps_labels_are_plain_vietnamese_no_technical_path():
    deal = {"customer_id": "C4", "customer_name": "D", "company_name": ""}
    gaps = src.legal_gaps(deal, None, None)
    name_gap = next(g for g in gaps["required"] if g["side"] == "A" and g["field"] == "name")
    assert "Customer 360" not in name_gap["source"] and "->" not in name_gap["source"]


# ───────── "Bổ sung tại chỗ": phân biệt Customer vs Contact, chỉ dùng cho hợp đồng / lưu CRM ─────────
def test_apply_legal_overrides_session_only_does_not_touch_crm(monkeypatch):
    from app.modules.all_platform.routers import contract as cr

    called = []
    monkeypatch.setattr("app.modules.all_platform.services.crm_customer_service.update_customer", lambda *a, **k: called.append("customer"))
    monkeypatch.setattr("app.modules.all_platform.services.crm_contact_service.update_contact", lambda *a, **k: called.append("contact"))
    deal = {"customer_id": "C1", "company_name": "", "tax_code": ""}
    overrides = type("O", (), {"model_dump": lambda self, exclude_none=True: {"company_name": "ABC MỚI", "tax_code": "031"}})()
    out, contact_id, warnings = cr._apply_legal_overrides(deal, overrides, None, {"id": "u1"}, save_to_crm=False)
    assert out["company_name"] == "ABC MỚI" and out["tax_code"] == "031"
    assert called == [] and warnings == []       # KHÔNG ghi CRM khi save_to_crm=False


def test_apply_legal_overrides_save_to_crm_splits_company_and_contact_fields(monkeypatch):
    from app.modules.all_platform.routers import contract as cr

    customer_calls, contact_calls = [], []
    monkeypatch.setattr("app.modules.all_platform.services.crm_customer_service.update_customer",
                         lambda cid, patch, user: customer_calls.append((cid, patch)))
    monkeypatch.setattr("app.modules.all_platform.services.crm_contact_service.update_contact",
                         lambda cid, ctid, patch, user: contact_calls.append((cid, ctid, patch)))
    deal = {"customer_id": "C1"}
    overrides = type("O", (), {"model_dump": lambda self, exclude_none=True: {
        "company_name": "ABC MỚI", "tax_code": "031", "contact_name": "Thảo", "contact_phone": "090"}})()
    cr._apply_legal_overrides(deal, overrides, "CT-1", {"id": "u1"}, save_to_crm=True)
    assert customer_calls == [("C1", {"company_name": "ABC MỚI", "tax_code": "031"})]   # chỉ field công ty
    assert contact_calls == [("C1", "CT-1", {"name": "Thảo", "phone": "090"})]           # chỉ field người liên hệ


def test_apply_legal_overrides_permission_error_warns_but_does_not_block(monkeypatch):
    from app.modules.all_platform.routers import contract as cr

    def boom(*a, **k):
        raise PermissionError("no access")
    monkeypatch.setattr("app.modules.all_platform.services.crm_customer_service.update_customer", boom)
    deal = {"customer_id": "C1"}
    overrides = type("O", (), {"model_dump": lambda self, exclude_none=True: {"company_name": "ABC MỚI"}})()
    out, _cid, warnings = cr._apply_legal_overrides(deal, overrides, None, {"id": "u1", "role": "member"}, save_to_crm=True)
    assert out["company_name"] == "ABC MỚI"      # vẫn dùng được cho phiên hiện tại dù lưu CRM thất bại
    assert warnings and "quyền" in warnings[0]


# ───────── Gửi duyệt/ký: chặn khi người đại diện ký CHƯA xác nhận (không phải checkbox vượt qua) ─────────
def test_readiness_blocks_pending_legal_when_representative_not_confirmed(monkeypatch):
    contract = {"id": "C9", "dealId": "D1", "quoteId": None, "contractValue": 0, "clauses": [{"title": "x", "body": "y"}],
                "representativeConfirmed": False}
    lead = dict(ENTERPRISE_DEAL, id="D1")
    monkeypatch.setattr(approval.store, "list_versions", lambda cid: [])
    r = approval.compute_readiness(contract, lead, None)
    signer = next(c for c in r["checks"] if c["key"] == "signer")
    assert signer["ok"] is False


def test_readiness_signer_ok_when_representative_confirmed(monkeypatch):
    contract = {"id": "C9", "dealId": "D1", "quoteId": None, "contractValue": 0, "clauses": [{"title": "x", "body": "y"}],
                "representativeConfirmed": True}
    lead = dict(ENTERPRISE_DEAL, id="D1")
    monkeypatch.setattr(approval.store, "list_versions", lambda cid: [])
    r = approval.compute_readiness(contract, lead, None)
    signer = next(c for c in r["checks"] if c["key"] == "signer")
    assert signer["ok"] is True
