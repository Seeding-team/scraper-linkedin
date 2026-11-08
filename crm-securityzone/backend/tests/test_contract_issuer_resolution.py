"""Bug: AI Contract Copilot không lấy đúng thông tin Đơn vị phát hành từ Quote.

Audit xác nhận: quotes.issuer_company_id -> quote_issuer_companies (bảng KHÔNG liên quan Customer/Contact). `_issuer_of_quote()`
(routers/contract.py) là nơi DUY NHẤT giải quyết Bên B cho cả precheck/generate-draft/render/from-clauses (dùng chung 1 hàm
nên luôn nhất quán). Test ở đây: resolve đúng theo lựa chọn tường minh trên Quote, cách ly workspace cho trường hợp CHƯA chọn,
không tin issuer_id từ client, precheck trả đủ dữ liệu để FE hiển thị tóm tắt, và DOCX dùng đúng dữ liệu đó."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from contract_docx_fixture import build_sample_contract  # noqa: E402

from app.modules.all_platform.routers import contract as cr
from app.modules.all_platform.services import contract_source_service as src
from app.modules.all_platform.services.contract_ai_service import build_parties

MARKEE = {"id": "ISS-MK", "code": "MARKEE", "legalName": "MARKEE", "brandName": "Markee", "taxCode": "0402336899",
          "address": "Tầng 08, Số 122 Lý Thái Tông, Đà Nẵng", "contactName": "DƯƠNG ĐÌNH HUẤN", "phone": "076 5055 708",
          "email": "admin@markee.vn", "status": "active", "instance": "markee"}
CLOUDGATE = {"id": "ISS-CG", "code": "CG", "legalName": "CÔNG TY TNHH CLOUDGATE", "taxCode": "", "address": "",
             "status": "active", "instance": "cloudgate"}
SECURITYZONE = {"id": "ISS-SZ", "code": "SZ", "legalName": "SecurityZone", "taxCode": "1234", "address": "HN",
                "status": "active", "instance": "SECURITYZONE"}
ALL_COMPANIES = [MARKEE, CLOUDGATE, SECURITYZONE]
DEAL = {"customer_name": "An", "company_name": "ABC", "tax_code": "031", "address": "HCM", "contact_name": "An", "position": "Giám đốc"}


def use(monkeypatch, companies=ALL_COMPANIES, instance="markee"):
    monkeypatch.setattr(cr, "list_issuer_companies", lambda include_inactive=False: companies)
    monkeypatch.setattr(cr.settings, "crm_instance", instance, raising=False)


# ───────── đúng case báo giá 202610090150: quote đã chọn Markee -> phải lấy đủ ─────────
def test_quote_with_explicit_markee_issuer_resolves_full_profile(monkeypatch):
    use(monkeypatch, instance="markee")
    issuer = cr._issuer_of_quote({"issuerCompanyId": "ISS-MK"})
    assert issuer == MARKEE
    gaps = src.legal_gaps(DEAL, None, issuer)
    assert not any(g["side"] == "B" for g in gaps["required"]) and not any(g["side"] == "B" for g in gaps["blockers"])


def test_quote_with_explicit_issuer_resolves_regardless_of_current_workspace(monkeypatch):
    """Lựa chọn tường minh trên Quote luôn được tin, không bị workspace hiện tại ghi đè (dữ liệu thật có quote ở Cloudgate/SecurityZone
    dùng issuer Markee một cách hợp lệ - không phải lỗi cần chặn)."""
    use(monkeypatch, instance="cloudgate")
    assert cr._issuer_of_quote({"issuerCompanyId": "ISS-MK"}) == MARKEE


# ───────── cách ly workspace CHỈ áp dụng cho trường hợp CHƯA chọn issuer (fallback) ─────────
def test_quote_without_issuer_never_defaults_to_another_workspace_company(monkeypatch):
    # Catalog KHÔNG có công ty nào gắn đúng workspace cloudgate/securityzone (dữ liệu thật hiện tại: cả 3 record đều instance='markee')
    use(monkeypatch, companies=[MARKEE, SECURITYZONE], instance="cloudgate")
    assert cr._issuer_of_quote({"issuerCompanyId": None}) is None                 # KHÔNG tự lấy Markee
    use(monkeypatch, companies=[MARKEE, CLOUDGATE], instance="SECURITYZONE")
    assert cr._issuer_of_quote({"issuerCompanyId": None}) is None                 # KHÔNG tự lấy Cloudgate


def test_quote_without_issuer_can_default_when_exactly_one_company_in_same_workspace(monkeypatch):
    use(monkeypatch, companies=[CLOUDGATE], instance="cloudgate")
    assert cr._issuer_of_quote({"issuerCompanyId": None}) == CLOUDGATE
    second_cloudgate_company = {**CLOUDGATE, "id": "ISS-CG2", "code": "CG2"}
    use(monkeypatch, companies=[CLOUDGATE, second_cloudgate_company], instance="cloudgate")   # 2 công ty CÙNG workspace cloudgate -> vẫn không đoán
    assert cr._issuer_of_quote({"issuerCompanyId": None}) is None


def test_inactive_or_unknown_issuer_id_resolves_to_none_not_a_guess(monkeypatch):
    use(monkeypatch, companies=[{**MARKEE, "status": "inactive"}])
    assert cr._issuer_of_quote({"issuerCompanyId": "ISS-MK"})["status"] == "inactive"   # id tường minh: trả đúng record (kể cả inactive) để UI tự quyết định cảnh báo
    assert cr._issuer_of_quote({"issuerCompanyId": "khong-ton-tai"}) is None


# ───────── không lấy dữ liệu đơn vị phát hành từ Customer/Contact ─────────
def test_party_b_never_sourced_from_customer_or_contact(monkeypatch):
    deal_with_lots_of_data = {"customer_name": "Trùng tên MARKEE", "company_name": "CÔNG TY GIẢ MẠO", "tax_code": "999", "address": "Nơi khác", "phone": "0909", "email": "fake@fake.vn"}
    parties = build_parties(deal_with_lots_of_data, None, MARKEE)
    assert parties["b"]["name"] == "MARKEE" and parties["b"]["tax_code"] == "0402336899"
    assert parties["b"]["name"] != deal_with_lots_of_data["company_name"]
    parties_no_issuer = build_parties(deal_with_lots_of_data, None, None)
    assert parties_no_issuer["b"] == {"name": "", "tax_code": "", "address": "", "rep": "", "position": "", "phone": "", "email": ""}


# ───────── chỉ báo thiếu các trường THẬT thiếu ─────────
def test_only_genuinely_missing_issuer_fields_are_flagged():
    gaps = src.legal_gaps(DEAL, None, MARKEE)
    assert not [g for g in gaps["required"] + gaps["blockers"] if g["side"] == "B"]
    partial = {**MARKEE, "taxCode": "", "address": None}
    gaps2 = src.legal_gaps(DEAL, None, partial)
    assert {g["field"] for g in gaps2["required"] if g["side"] == "B"} == {"tax_code", "address"}
    assert not any(g["field"] == "name" for g in gaps2["required"] if g["side"] == "B")   # tên vẫn có -> không báo thiếu tên


# ───────── không tin issuer_id do client tự gửi ─────────
def test_no_endpoint_schema_accepts_a_client_supplied_issuer_id():
    from app.modules.all_platform.schemas.contract import ContractGenerateRequest, ContractPrecheckRequest
    from app.modules.all_platform.routers.contract_docx import FromClausesRequest

    for model in (ContractGenerateRequest, ContractPrecheckRequest, FromClausesRequest):
        fields = set(model.model_fields)
        assert not any("issuer" in f.lower() for f in fields), (model, fields)


# ───────── precheck: đủ dữ liệu cho FE hiển thị tóm tắt, cập nhật khi đổi issuer, không F5 ─────────
def _client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.all_platform.auth_deps import get_current_user

    app = FastAPI()
    app.include_router(cr.contracts_router, prefix="/contracts")
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "admin"}
    return TestClient(app)


def test_precheck_response_has_full_issuer_and_party_summary_for_frontend(monkeypatch):
    use(monkeypatch, instance="markee")
    monkeypatch.setattr(cr.source, "resolve_source", lambda *a, **k: (DEAL, {"issuerCompanyId": "ISS-MK", "dealId": "D1"}))
    r = _client(monkeypatch).post("/contracts/precheck", json={"deal_id": "D1", "quote_id": "Q1"}).json()["data"]
    assert r["issuer"]["legalName"] == "MARKEE" and r["issuer"]["taxCode"] == "0402336899" and r["issuer"]["address"].startswith("Tầng 08")
    assert r["parties"]["b"]["name"] == "MARKEE" and r["parties"]["a"]["name"] == "ABC"
    assert not any(g["side"] == "B" for g in r["required"])                       # trường đã có dữ liệu không xuất hiện trong danh sách cảnh báo


def test_precheck_reflects_issuer_change_on_the_quote_without_restart(monkeypatch):
    """Đổi đơn vị phát hành trên Quote -> lần precheck SAU PHẢI phản ánh đơn vị MỚI (không dùng kết quả/cache cũ)."""
    # 2 công ty cùng instance 'markee' -> bỏ chọn issuer tường minh thì KHÔNG có fallback mơ hồ nào được tự chọn
    use(monkeypatch, companies=[MARKEE, {**MARKEE, "id": "ISS-MK2", "code": "MARKEE2"}], instance="markee")
    quote_state = {"issuerCompanyId": "ISS-MK", "dealId": "D1"}
    monkeypatch.setattr(cr.source, "resolve_source", lambda *a, **k: (DEAL, dict(quote_state)))
    c = _client(monkeypatch)
    r1 = c.post("/contracts/precheck", json={"deal_id": "D1", "quote_id": "Q1"}).json()["data"]
    assert r1["issuer"]["code"] == "MARKEE"
    quote_state["issuerCompanyId"] = None                                          # Sale đổi báo giá sang chưa chọn issuer
    r2 = c.post("/contracts/precheck", json={"deal_id": "D1", "quote_id": "Q1"}).json()["data"]
    assert r2["issuer"] is None and any(g["side"] == "B" and g["field"] == "name" for g in r2["required"])


def test_precheck_missing_issuer_fields_point_to_issuer_settings_fix_action(monkeypatch):
    use(monkeypatch, companies=[{**MARKEE, "taxCode": ""}], instance="markee")
    monkeypatch.setattr(cr.source, "resolve_source", lambda *a, **k: (DEAL, {"issuerCompanyId": "ISS-MK", "dealId": "D1"}))
    r = _client(monkeypatch).post("/contracts/precheck", json={"deal_id": "D1", "quote_id": "Q1"}).json()["data"]
    g = next(x for x in r["required"] if x["side"] == "B" and x["field"] == "tax_code")
    assert g["fix"] == {"kind": "issuer", "issuerId": "ISS-MK"}


# ───────── khách nhiều Contact: không lấy nhầm người ─────────
def test_multiple_contacts_does_not_mix_up_representative(monkeypatch):
    from app.modules.all_platform.services import contract_source_service as srcmod

    monkeypatch.setattr(srcmod, "_fetch_customer_and_contact", lambda deal, contact_id=None: (
        {"customer_name": "ABC", "company_name": "ABC", "tax_code": "031", "address": "HCM", "position": ""},
        {"name": "Người liên hệ phụ (không phải primary)", "position": "Nhân viên"},
    ))
    out = srcmod.enrich_deal({"id": "D", "customer_id": "C", "primary_contact_id": "CT-wrong", "position": "Giám đốc"})
    assert out["position"] == "Giám đốc"                                            # Deal đã có sẵn chức vụ -> KHÔNG bị ghi đè bởi contact khác


# ───────── DOCX dùng đúng dữ liệu Bên B, nhất quán với precheck ─────────
def test_docx_article1_uses_real_issuer_data_not_placeholder_when_profile_complete():
    from app.modules.all_platform.services.contract_docx_builder import build_contract_docx
    from app.modules.all_platform.services.contract_docx_engine import load_document, describe_paragraphs

    parties = build_parties(DEAL, None, MARKEE)
    docx, warnings = build_contract_docx("HĐ", "HD-1", [{"title": "ĐIỀU 1. THÔNG TIN CÁC BÊN", "body": "Hai bên đủ năng lực."}], parties=parties, quote=None)
    texts = [p.text for p in describe_paragraphs(load_document(docx))]
    assert any(t.startswith("Mã số thuế: 0402336899") for t in texts)
    assert not any("………" in t for t in texts if "Bên B" not in t and "Chức vụ" not in t and "Điện thoại" not in t and "Email" not in t)
    assert not any("Bên B" in w for w in warnings)
