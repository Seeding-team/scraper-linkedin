"""Backend AI Contract Copilot: kiểm tra nguồn Deal/Quote, pháp lý, idempotency, chỉnh từng điều khoản, PDF tham chiếu. Không cần mạng/DB."""
import base64
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from contract_docx_fixture import SAMPLE_DEAL, SAMPLE_QUOTE, build_sample_contract  # noqa: E402

from app.modules.all_platform.services import contract_source_service as src
from app.modules.all_platform.services import idempotency_service as idem
from app.modules.all_platform.services import contract_docx_engine as eng


def Q(**kw):
    return {"id": "q1", "dealId": "D1", "status": "approved", "customerOutcome": None, "deletedAt": None, **kw}


# ── Deal / báo giá ──
@pytest.mark.parametrize("quote,msg", [
    (None, "Không tìm thấy"), (Q(deletedAt="2026-01-01"), "xoá"), (Q(customerOutcome="lost"), "OUT"),
    (Q(status="draft"), "chưa được duyệt"), (Q(status="cancelled"), "chưa được duyệt"), (Q(dealId="D2"), "không thuộc Deal"),
])
def test_quote_must_be_approved_live_and_belong_to_deal(quote, msg):
    with pytest.raises(src.SourceError) as e:
        src.check_quote_for_deal(quote, "D1")
    assert msg in str(e.value)


def test_quote_approved_or_confirmed_ok():
    src.check_quote_for_deal(Q(), "D1")
    src.check_quote_for_deal(Q(status="confirmed"), "D1")


def _patch_data(monkeypatch, deals, quote=None):
    from app.modules.all_platform.services import customer_lead_service as cls
    import app.modules.all_platform.services as svc

    monkeypatch.setattr(src, "list_customer_deals", lambda cid: [d for d in deals if d["customer_id"] == cid])
    monkeypatch.setattr(cls, "get_customer_lead_by_id", lambda i: next((d for d in deals if d["id"] == i), None))
    monkeypatch.setattr(svc, "get_quote", lambda qid: quote)


def test_customer_with_many_deals_must_choose_one_on_backend(monkeypatch):
    _patch_data(monkeypatch, [{"id": "D1", "customer_id": "C1"}, {"id": "D2", "customer_id": "C1"}])
    with pytest.raises(src.SourceError) as e:
        src.resolve_source(None, None, "C1", require_deal=True)
    assert "2 Deal" in str(e.value)
    with pytest.raises(src.SourceError):
        src.resolve_source(None, None, "C-no-deals", require_deal=True)
    deal, quote = src.resolve_source("D1", None, "C1")
    assert deal["id"] == "D1" and quote is None


def test_deal_of_other_customer_or_workspace_is_rejected(monkeypatch):
    _patch_data(monkeypatch, [{"id": "D1", "customer_id": "C1"}])
    with pytest.raises(src.SourceError):
        src.resolve_source("D1", None, "C-other")                # Deal không thuộc khách
    with pytest.raises(src.SourceError):
        src.resolve_source("D-from-other-workspace", None, "C1")  # get_customer_lead_by_id lọc theo instance -> None


def test_quote_needs_deal_and_must_match(monkeypatch):
    _patch_data(monkeypatch, [{"id": "D1", "customer_id": "C1"}], Q(dealId="D9"))
    with pytest.raises(src.SourceError):
        src.resolve_source(None, "q1", None)
    with pytest.raises(src.SourceError) as e:
        src.resolve_source("D1", "q1", "C1")
    assert "không thuộc Deal" in str(e.value)


# ── pháp lý ──
def test_legal_gaps_classification_and_acknowledgement():
    gaps = src.legal_gaps({"customer_name": "An"}, None, None)
    assert gaps["blockers"] == [] and ("A", "name") in {(g["side"], g["field"]) for g in gaps["required"]}   # thiếu tên pháp lý: phải bổ sung/xác nhận, KHÔNG chặn cứng
    full_a = {"customer_name": "An", "company_name": "ABC", "tax_code": "031", "address": "HCM", "position": "GĐ"}
    issuer = {"legalName": "MARKEE", "taxCode": "0100", "address": "HN", "contactName": "B"}
    g2 = src.legal_gaps(full_a, None, issuer)
    assert not g2["blockers"] and not g2["required"]
    assert {x["field"] for x in g2["optional"]} >= {"phone", "email"}          # chỉ cảnh báo, có thể để trống
    g3 = src.legal_gaps({"company_name": "ABC"}, None, None)
    assert {(x["side"], x["field"]) for x in g3["required"]} >= {("A", "tax_code"), ("A", "address"), ("B", "name")}
    with pytest.raises(src.SourceError):
        src.enforce_gaps(g3, acknowledged=False)
    src.enforce_gaps(g3, acknowledged=True)                                    # xác nhận để trống -> được tiếp tục
    src.enforce_gaps(gaps, acknowledged=True)                                  # xác nhận để trống -> được tạo nháp
    with pytest.raises(src.SourceError):
        src.enforce_gaps({"blockers": [{"label": "Deal không tồn tại"}], "required": [], "optional": []}, acknowledged=True)   # blockers (sai nguồn): xác nhận cũng không qua


# ── rủi ro khi sửa điều khoản ──
def test_edit_risk_flags_numbers_and_topics():
    ctx = "Thanh toán 50% khi ký, 40% khi bàn giao"
    ok = src.edit_risk_flags("3.1. Thanh toán 100% khi ký.", "3.1. Thanh toán 50% khi ký, 40% khi bàn giao.", ctx)
    assert not ok["blocked"] and ok["needsCareReview"] and "thanh toán" in " ".join(ok["flags"])
    bad = src.edit_risk_flags("6.1. Phạt chậm tiến độ.", "6.1. Phạt chậm tiến độ 25% giá trị hợp đồng.", ctx)
    assert bad["blocked"] and "25%" in bad["inventedNumbers"]
    plain = src.edit_risk_flags("Hai bên ký hợp đồng.", "Hai bên đã ký hợp đồng.", "")
    assert not plain["blocked"] and not plain["needsCareReview"]


# ── idempotency ──
def test_run_once_serialises_concurrent_requests_and_replays():
    calls = []
    results = []

    def fn():
        calls.append(1)
        time.sleep(0.3)
        return {"id": "C1"}

    def worker():
        results.append(idem.run_once("k1", "u1", fn))

    ts = [threading.Thread(target=worker) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1 and len(results) == 5 and sorted(r[1] for r in results).count(True) == 4
    assert idem.run_once("k1", "u2", lambda: {"id": "other-user"})[0]["id"] == "other-user"     # khóa theo người dùng
    assert idem.run_once(None, "u1", lambda: 1) == (1, False) and idem.run_once(None, "u1", lambda: 2) == (2, False)


def test_run_once_failure_allows_retry():
    n = {"c": 0}

    def flaky():
        n["c"] += 1
        if n["c"] == 1:
            raise RuntimeError("db down")
        return "ok"

    with pytest.raises(RuntimeError):
        idem.run_once("k-fail", "u", flaky)
    assert idem.run_once("k-fail", "u", flaky) == ("ok", False)


# ── HTTP ──
def _client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.all_platform.auth_deps import get_current_user
    from app.modules.all_platform.routers.contract import contracts_router
    from app.modules.all_platform.routers.contract_docx import contract_docx_router

    app = FastAPI()
    app.include_router(contracts_router, prefix="/contracts")
    app.include_router(contract_docx_router, prefix="/contract-docs")
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app)


def test_create_contract_double_click_creates_once(monkeypatch):
    from app.modules.all_platform.routers import contract as router

    created = []

    def fake_create(payload, user_id):
        created.append(payload)
        time.sleep(0.2)
        return {"id": f"C{len(created)}", "contractNumber": "HD-1"}

    monkeypatch.setattr(router, "create_contract", fake_create)
    monkeypatch.setattr(router.source, "resolve_source", lambda *a, **k: (None, None))
    monkeypatch.setattr(router.idempotency_service, "find_recent_duplicate_contract", lambda *a, **k: None)
    monkeypatch.setattr("app.core.supabase_client.get_supabase_client", lambda: object())
    c = _client(monkeypatch)
    body = {"title": "HĐ", "deal_id": "D1", "quote_id": "q1", "ai_generated": True}
    out = []
    ts = [threading.Thread(target=lambda: out.append(c.post("/contracts", json=body, headers={"Idempotency-Key": "abc"}).json())) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(created) == 1 and {o["data"]["id"] for o in out} == {"C1"} and all(o["success"] for o in out)
    again = c.post("/contracts", json=body, headers={"Idempotency-Key": "abc"}).json()
    assert again["data"]["id"] == "C1" and "đã được tạo trước đó" in again["message"] and len(created) == 1


def test_create_contract_blocked_when_source_invalid(monkeypatch):
    from app.modules.all_platform.routers import contract as router

    def deny(*a, **k):
        raise src.SourceError("Báo giá chưa được duyệt")

    monkeypatch.setattr(router.source, "resolve_source", deny)
    monkeypatch.setattr(router, "create_contract", lambda *a, **k: pytest.fail("không được tạo"))
    r = _client(monkeypatch).post("/contracts", json={"title": "HĐ", "deal_id": "D1", "quote_id": "q1", "ai_generated": True}).json()
    assert not r["success"] and "chưa được duyệt" in r["message"]


def test_generate_draft_requires_deal_when_customer_given(monkeypatch):
    from app.modules.all_platform.routers import contract as router

    def deny(*a, **k):
        raise src.SourceError("Khách hàng có 2 Deal - phải chọn đúng Deal trước khi tạo bản nháp.")

    monkeypatch.setattr(router.source, "resolve_source", deny)
    r = _client(monkeypatch).post("/contracts/generate-draft", json={"customer_id": "C1"}).json()
    assert not r["success"] and "phải chọn đúng Deal" in r["message"]


def test_precheck_reports_blockers_without_raising(monkeypatch):
    from app.modules.all_platform.routers import contract as router

    monkeypatch.setattr(router.source, "resolve_source", lambda *a, **k: (_ for _ in ()).throw(src.SourceError("Deal không tồn tại trong workspace này.")))
    d = _client(monkeypatch).post("/contracts/precheck", json={"customer_id": "C1", "deal_id": "X"}).json()["data"]
    assert d["ok"] is False and "không tồn tại" in d["blockers"][0]["label"]


def test_render_needs_deal_for_customer_and_blocks_missing_legal_data(monkeypatch):
    from app.modules.all_platform.routers import contract_docx as r

    c = _client(monkeypatch)
    files = {"file": ("mau.docx", build_sample_contract(), "application/octet-stream")}
    out = c.post("/contract-docs/render", files=files, data={"customer_id": "C1"}).json()
    assert not out["success"]                                                   # có customer nhưng thiếu Deal: backend chặn (DB không cần)


def test_propose_edit_blocks_invented_numbers_and_apply_changes_only_selected_paragraph(monkeypatch):
    from app.modules.all_platform.routers import contract_docx as r

    async def fake_ai(text, instruction, neighbors, deal, quote):
        return {"text": "6.1. Bên vi phạm chịu phạt 25% giá trị hợp đồng.", "reason": "x"}

    monkeypatch.setattr(r, "propose_clause_edit", fake_ai)
    c = _client(monkeypatch)
    out = c.post("/contract-docs/propose-edit", json={"text": "6.1. Bên vi phạm chịu phạt.", "instruction": "thêm phạt"}).json()["data"]
    assert out["blocked"] is True and "25%" in out["inventedNumbers"]
    ok = c.post("/contract-docs/propose-edit", json={"text": "6.1. Bên vi phạm chịu phạt.", "instruction": "thêm phạt 25%"}).json()["data"]
    assert ok["blocked"] is False and ok["needsCareReview"] is True
    assert not c.post("/contract-docs/propose-edit", json={"text": "x", "instruction": "  "}).json()["success"]

    sample = build_sample_contract()
    infos = eng.describe_paragraphs(eng.load_document(sample))
    target = next(p for p in infos if p.text.startswith("3.2."))
    resp = c.post("/contract-docs/apply-paragraph", json={"docx_base64": base64.b64encode(sample).decode(), "paragraph_id": target.id, "text": "3.2. Thanh toán bằng chuyển khoản hoặc tiền mặt."}).json()
    assert resp["success"] and resp["data"]["layoutPreserved"] is True
    new = eng.describe_paragraphs(eng.load_document(base64.b64decode(resp["data"]["docxBase64"])))
    changed = [(a.text, b.text) for a, b in zip(infos, new) if a.text != b.text]
    assert changed == [(target.text, "3.2. Thanh toán bằng chuyển khoản hoặc tiền mặt.")]      # chỉ đúng 1 đoạn được chọn thay đổi
    assert resp["data"]["pdfBase64"] is None or resp["data"]["pdfBase64"]                       # PDF tuỳ môi trường có LibreOffice
    assert not c.post("/contract-docs/apply-paragraph", json={"docx_base64": base64.b64encode(sample).decode(), "paragraph_id": target.id, "text": "  "}).json()["success"]


def test_extract_reference_pdf_kinds(monkeypatch):
    from test_contract_docx_engine import _mini_pdf

    c = _client(monkeypatch)
    text_pdf = _mini_pdf(b"BT /F1 12 Tf 50 750 Td (" + b"Hop dong dich vu bao mat thong tin. " * 10 + b") Tj ET")
    ok = c.post("/contract-docs/extract-reference", files={"file": ("mau.pdf", text_pdf, "application/pdf")}).json()
    assert ok["success"] and ok["data"]["kind"] == "text" and ok["data"]["layoutPreserved"] is False and "Hop dong" in ok["data"]["text"]
    scan = _mini_pdf(b"q 500 0 0 700 50 50 cm /Im1 Do Q", resources=b"<< /XObject << /Im1 6 0 R >> >>",
                     extra_objs=b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x00\nendstream")
    bad = c.post("/contract-docs/extract-reference", files={"file": ("scan.pdf", scan, "application/pdf")}).json()
    assert not bad["success"] and "scan" in bad["message"].lower() and "OCR" in bad["message"]
    assert not c.post("/contract-docs/extract-reference", files={"file": ("mau.docx", build_sample_contract(), "x")}).json()["success"]


def test_generate_draft_warns_about_numbers_from_reference_not_in_crm(monkeypatch):
    from app.modules.all_platform.routers import contract as router

    async def fake_gen(deal, quote, ttype, level, prompt, reference, issuer=None, representative=None):
        assert "99.999.999" in (reference or "")                                 # PDF tham chiếu có được truyền cho AI engine của team
        return [{"id": "", "title": "ĐIỀU 3", "body": "Giá trị hợp đồng 99.999.999 đồng, thanh toán 50% khi ký."}]

    monkeypatch.setattr(router, "generate_contract_draft", fake_gen)
    c = _client(monkeypatch)
    out = c.post("/contracts/generate-draft", json={"manual_customer_name": "ABC", "extra_prompt": "thanh toán 50% khi ký", "reference_text": "Giá 99.999.999 đồng"}).json()
    assert out["success"] and any("99.999.999" in w for w in out["data"]["warnings"]) and not any("50%" in w for w in out["data"]["warnings"])


def test_enrich_deal_fills_only_empty_fields_from_customer_and_contact(monkeypatch):
    monkeypatch.setattr(src, "_fetch_customer_and_contact", lambda deal, contact_id=None: (
        {"company_name": "ABC", "tax_code": "031", "address": "HCM", "phone": "090", "email": "c@x.vn", "position": "Giám đốc"},
        {"name": "An", "position": "Trưởng phòng", "phone": "1", "email": "a@x.vn"}))
    deal = {"id": "D", "customer_id": "C", "company_name": "ĐÃ CÓ", "tax_code": "", "address": None, "position": ""}
    out = src.enrich_deal(deal)
    assert out["company_name"] == "ĐÃ CÓ"                       # dữ liệu sẵn có của Deal không bị ghi đè
    assert out["tax_code"] == "031" and out["address"] == "HCM"  # chỉ điền ô trống từ Customer 360
    assert out["position"] == "Trưởng phòng"                    # chức vụ ưu tiên Contact đã chọn (người liên hệ)
    assert out["contact_name"] == "An"                          # tên người liên hệ tách riêng khỏi tên pháp nhân công ty
    assert deal["tax_code"] == ""                               # không sửa bản gốc

    def boom(deal, contact_id=None):
        raise RuntimeError("db")

    monkeypatch.setattr(src, "_fetch_customer_and_contact", boom)
    assert src.enrich_deal(deal) is deal                        # lỗi đọc thêm -> giữ nguyên, không làm hỏng luồng


def test_ai_edit_cannot_drop_unfilled_placeholder():
    from app.modules.all_platform.services import contract_ai_service as ai

    ok, bad = ai.validate_template_edits([{"id": "p1", "text": "Mã số thuế: (chưa có)"}], {"p1": "Mã số thuế: {{tax_code}}"}, "")
    assert not ok and "placeholder" in bad[0]["reason"]



def test_individual_customer_name_from_customer_360_is_party_a_name(monkeypatch):
    """Khách cá nhân: hồ sơ Customer 360 chỉ có customer_name -> dùng làm tên Bên A (không lấy tên người liên hệ của Deal)."""
    monkeypatch.setattr(src, "_fetch_customer_and_contact", lambda deal, contact_id=None: ({"customer_name": "thảo", "company_name": None}, {"name": "Người liên hệ X", "position": None}))
    out = src.enrich_deal({"id": "D", "customer_id": "C", "customer_name": "thảo", "company_name": None})
    assert out["company_name"] == "thảo"
    gaps = src.legal_gaps(out, None, None)
    assert gaps["blockers"] == [] and "name" not in {g["field"] for g in gaps["required"] if g["side"] == "A"}
    monkeypatch.setattr(src, "_fetch_customer_and_contact", lambda deal, contact_id=None: ({"customer_name": "CÔNG TY A", "company_name": "CÔNG TY CP A"}, None))
    assert src.enrich_deal({"id": "D", "customer_id": "C"})["company_name"] == "CÔNG TY CP A"      # có tên công ty -> ưu tiên tên công ty
