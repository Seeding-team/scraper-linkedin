"""Module AI Contract Copilot v2: loại hợp đồng tự do + AI đề xuất, mã hợp đồng theo workspace, vai trò các bên, phiên bản + AI rủi ro theo phiên bản,
điều kiện gửi duyệt, phân quyền. Không cần mạng/DB."""
import asyncio
import base64
import hashlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from contract_docx_fixture import build_sample_contract  # noqa: E402

from app.modules.all_platform.services import contract_approval_service as approval
from app.modules.all_platform.services import contract_document_store as store
from app.modules.all_platform.services import contract_number_service as num
from app.modules.all_platform.services import contract_roles as roles
from app.modules.all_platform.services import contract_type_service as types


def run(c):
    return asyncio.run(c)


# ───────── loại hợp đồng ─────────
KIOSK_QUOTE = {"items": [{"description": "Q-Kiosk 27SMT U726-P80QRCA-CCA4S4", "serviceDescription": "Thiết bị kiosk màn hình cảm ứng, máy in nhiệt"}]}


def test_rule_suggestion_from_quote_items_prompt_and_template():
    s = types.rule_suggestion(KIOSK_QUOTE, "", None)
    assert s["label"] == "Hợp đồng cung cấp thiết bị" and s["confidence"] > 0
    m = types.rule_suggestion({"items": [{"description": "Quản trị fanpage", "serviceDescription": "Chiến dịch quảng cáo, content"}]}, "", None)
    assert m["label"] == "Hợp đồng dịch vụ Marketing"
    assert types.rule_suggestion(None, "Hợp đồng bảo trì hệ thống 12 tháng, SLA", None)["label"] == "Hợp đồng bảo trì hệ thống"
    assert types.rule_suggestion({"items": [{"description": "test"}, {"description": "t"}]}, "", None)["label"] is None      # không đủ dữ liệu -> không đoán


def test_ai_can_propose_new_free_type_and_user_input_is_not_restricted():
    async def ai(system, user):
        return {"label": "Hợp đồng thuê kho dữ liệu lạnh", "confidence": 0.9, "reason": "Báo giá cho thuê dung lượng lưu trữ"}

    out = run(types.suggest_type(KIOSK_QUOTE, "", None, ai_call=ai))
    assert out["label"] == "Hợp đồng thuê kho dữ liệu lạnh" and out["source"] == "ai" and out["needsConfirmation"] is False
    assert out["label"] not in [t["label"] for t in types.KNOWN_TYPES]                          # loại mới chưa tồn tại trong hệ thống
    assert types.normalize_label("  Hợp đồng   khác  ") == "Hợp đồng khác"
    assert types.display_label("service") == "Hợp đồng cung cấp dịch vụ CNTT" and types.display_label("Hợp đồng X") == "Hợp đồng X"


def test_low_confidence_or_ai_failure_requires_confirmation_never_confident_guess():
    async def unsure(system, user):
        return {"label": "", "confidence": 0.2, "reason": "?"}

    r = run(types.suggest_type({"items": [{"description": "test"}]}, "", None, ai_call=unsure))
    assert r["needsConfirmation"] is True and not r["label"]

    async def boom(system, user):
        raise RuntimeError("AI down")

    r2 = run(types.suggest_type(KIOSK_QUOTE, "", None, ai_call=boom))
    assert r2["source"] == "rules" and "AI down" in r2["aiError"] and r2["label"] == "Hợp đồng cung cấp thiết bị"       # lỗi AI hiện thật, vẫn có gợi ý từ luật
    # AI nói khác luật => lấy AI nhưng hạ độ tin cậy, kèm phương án của luật
    async def differs(system, user):
        return {"label": "Hợp đồng tư vấn", "confidence": 0.95, "reason": "x"}

    r3 = run(types.suggest_type(KIOSK_QUOTE, "", None, ai_call=differs))
    assert r3["confidence"] <= 0.75 and "Hợp đồng cung cấp thiết bị" in r3["alternatives"]


def test_legacy_key_mapping_keeps_business_classification_working():
    assert types.legacy_key("Hợp đồng dịch vụ Marketing") == "marketing" and types.legacy_key("Hợp đồng nguyên tắc") == "principle"
    assert types.legacy_key("Hợp đồng thuê kho dữ liệu lạnh") == "service" and types.legacy_key("principle") == "principle"


# ───────── mã hợp đồng ─────────
def test_default_numbering_unchanged_and_with_short_name():
    assert num.next_number([], year=2026) == "HD/2026/0001"
    assert num.next_number(["HD/2026/0006", "HD/2026/0007", "HD/2025/0099", "HD/MARKEE/2026/0100"], year=2026) == "HD/2026/0008"
    f = "HD/{SHORT}/{YYYY}/{SEQ}"
    assert num.next_number(["HD/MARKEE/2026/0006", "HD/CG/2026/0050"], f, "markee", 2026) == "HD/MARKEE/2026/0007"
    assert num.next_number([], f, None, 2026) == "HD/2026/0001"                              # thiếu tên viết tắt: bỏ token, không bịa
    assert num.sanitize_short(" Mar kee/1 ") == "MAR-KEE1"


def test_number_format_validation():
    assert num.validate_format("HD/{SHORT}/{YYYY}/{SEQ}") is None
    assert "SEQ" in num.validate_format("HD/{YYYY}") and "token" in num.validate_format("HD/{FOO}/{SEQ}")
    assert num.validate_format("")


def test_number_allocation_is_safe_under_concurrent_duplicates(monkeypatch):
    taken = {"HD/2026/0001"}
    calls = []

    def peek(short=None):
        # mô phỏng 2 request cùng tính ra 0002 trước khi 1 request kia kịp ghi
        return {"example": num.next_number(sorted(taken) if len(calls) > 0 else ["HD/2026/0001"], year=2026)}

    monkeypatch.setattr(num, "peek_next", peek)

    def insert(number):
        calls.append(number)
        if number in taken:
            raise Exception('duplicate key value violates unique constraint "contracts_contract_number_key"')
        taken.add(number)
        return number

    taken.add("HD/2026/0002")                                   # request khác vừa chiếm 0002
    assert num.create_with_retry(insert) == "HD/2026/0003" and calls == ["HD/2026/0002", "HD/2026/0003"]
    with pytest.raises(Exception):
        num.create_with_retry(lambda n: (_ for _ in ()).throw(RuntimeError("db down")))               # lỗi khác không bị nuốt


def test_settings_table_missing_falls_back_to_default(monkeypatch):
    class Boom:
        def table(self, n): raise Exception("relation \"public.workspace_contract_settings\" does not exist 42P01")

    monkeypatch.setattr(num, "get_supabase_client", lambda: Boom())
    s = num.get_settings()
    assert s["format"] == num.DEFAULT_FORMAT and s["schemaReady"] is False
    with pytest.raises(ValueError) as e:
        num.save_settings("HD/{SHORT}/{YYYY}/{SEQ}", "MARKEE", "u")
    assert "184" in str(e.value)


# ───────── vai trò các bên ─────────
def test_roles_by_contract_type_and_direction():
    assert roles.role_labels("Hợp đồng cung cấp thiết bị") == ("Bên mua", "Bên bán")
    assert roles.role_labels("Hợp đồng thuê kho dữ liệu cho thuê") == ("Bên thuê", "Bên cho thuê")
    assert roles.role_labels("Hợp đồng tư vấn")[1] == "Bên tư vấn" and roles.role_labels(None) == roles.DEFAULT
    parties = {"a": {"name": "KHÁCH"}, "b": {"name": "CÔNG TY"}}
    assert roles.arrange_parties(parties, "sell")["a"]["name"] == "KHÁCH"
    buy = roles.arrange_parties(parties, "buy")
    assert buy["a"]["name"] == "CÔNG TY" and buy["b"]["name"] == "KHÁCH" and buy["swapped"] is True            # mua vào: không mặc định Bên A là khách hàng


# ───────── kho phiên bản + metadata ─────────
class FakeBucket:
    def __init__(self): self.files = {}
    def upload(self, key, content, file_options=None):
        if key in self.files and (file_options or {}).get("upsert") != "true":
            raise RuntimeError("exists")
        self.files[key] = content
    def download(self, key):
        if key not in self.files:
            raise KeyError(key)
        return self.files[key]
    def list(self, prefix):
        return [{"name": k.rsplit("/", 1)[1], "created_at": "t", "metadata": {"size": len(v)}} for k, v in self.files.items() if k.startswith(prefix + "/")]
    def remove(self, keys):
        for k in keys: self.files.pop(k, None)


@pytest.fixture
def bucket(monkeypatch):
    b = FakeBucket()
    monkeypatch.setattr(store, "_bucket", lambda: b)
    return b


def test_versions_are_immutable_with_metadata_and_risk_bound_to_version(bucket):
    d1, d2 = build_sample_contract(), build_sample_contract() + b"x"
    v1 = store.save_version("C1", d1, {"createdBy": "u1", "createdByName": "An", "source": "ai-new", "note": "n"})
    v2 = store.save_version("C1", d2, {"createdBy": "u2", "source": "manual-edit"})
    assert (v1, v2) == (1, 2)
    store.update_meta("C1", 1, {"risk": {"score": 55, "versionSha": hashlib.sha256(d1).hexdigest()}})
    vs = store.list_versions("C1")
    assert vs[0]["createdByName"] == "An" and vs[0]["risk"]["score"] == 55 and vs[1]["risk"] is None             # điểm của v1 KHÔNG gán sang v2
    assert vs[0]["sha256"] == hashlib.sha256(d1).hexdigest() and store.load_version("C1", 1) == d1               # file .docx không bị ghi đè
    with pytest.raises(RuntimeError):
        store._put("contracts/C1/v0001.docx", b"hack", store.DOCX_MIME)                                           # ghi đè bị từ chối


# ───────── điều kiện gửi duyệt ─────────
CONTRACT = {"id": "C1", "dealId": "D1", "quoteId": "Q1", "contractValue": 111375177, "clauses": [], "paymentTerms": None,
            "representativeConfirmed": True}  # không test signer ở đây (xem test_contract_issuer_resolution.py)
LEAD = {"id": "D1", "customer_id": "K1", "company_name": "ABC", "tax_code": "031", "address": "HCM", "customer_name": "An"}
QUOTE = {"quoteNumber": "202610090150", "dealId": "D1", "status": "approved", "totalAmount": 111375177, "currency": "VND", "items": []}
ISSUER = {"legalName": "MARKEE", "taxCode": "0402", "address": "ĐN", "contactName": "B"}


@pytest.fixture
def world(monkeypatch, bucket):
    import app.modules.all_platform.services as svc

    monkeypatch.setattr(svc, "get_quote", lambda qid: QUOTE)
    monkeypatch.setattr(approval.source, "_fetch_customer_and_contact", lambda deal, contact_id=None: (None, None))
    return bucket


def _ready(contract=CONTRACT, lead=LEAD):
    return approval.compute_readiness(contract, lead, ISSUER)


def test_readiness_all_conditions(world):
    r = _ready()
    assert r["gated"] is False and r["ready"] is True and r["hasDocument"] is False                                 # legacy/thủ công: không bị chặn
    d = build_sample_contract()
    store.save_version("C1", d, {})
    r = _ready()
    assert r["gated"] and not r["ready"] and [c["key"] for c in r["checks"] if not c["ok"]] == ["risk"]            # có tài liệu nhưng chưa phân tích rủi ro
    with pytest.raises(ValueError) as e:
        approval.enforce_status_change(CONTRACT, LEAD, "pending_legal", ISSUER)
    assert "rủi ro" in str(e.value)
    store.update_meta("C1", 1, {"risk": {"score": 80, "versionSha": hashlib.sha256(d).hexdigest()}})
    assert _ready()["ready"] is True
    approval.enforce_status_change(CONTRACT, LEAD, "pending_signature", ISSUER)                                      # đủ điều kiện -> không ném lỗi
    approval.enforce_status_change(CONTRACT, LEAD, "signed", ISSUER)                                                 # trạng thái không bị gate vẫn đi qua


def test_new_version_invalidates_previous_risk_result(world):
    d1 = build_sample_contract()
    store.save_version("C1", d1, {})
    store.update_meta("C1", 1, {"risk": {"score": 90, "versionSha": hashlib.sha256(d1).hexdigest()}})
    assert _ready()["ready"] is True
    store.save_version("C1", d1 + b"changed", {})                                                                   # sửa nội dung pháp lý -> phiên bản mới
    r = _ready()
    assert not r["ready"] and r["latestVersion"] == 2 and any(c["key"] == "risk" and not c["ok"] for c in r["checks"])


def test_readiness_flags_missing_legal_wrong_value_and_bad_quote(world, monkeypatch):
    import app.modules.all_platform.services as svc

    d = build_sample_contract()
    store.save_version("C1", d, {})
    store.update_meta("C1", 1, {"risk": {"score": 90, "versionSha": hashlib.sha256(d).hexdigest()}})
    r = _ready(lead={**LEAD, "tax_code": ""})
    legal = next(c for c in r["checks"] if c["key"] == "legal")
    assert not legal["ok"] and legal["action"]["kind"] == "fix_legal" and legal["action"]["customerId"] == "K1" and not r["ready"]
    r = _ready(contract={**CONTRACT, "contractValue": 1})
    assert not next(c for c in r["checks"] if c["key"] == "value")["ok"]
    monkeypatch.setattr(svc, "get_quote", lambda qid: {**QUOTE, "customerOutcome": "lost"})
    assert not next(c for c in _ready()["checks"] if c["key"] == "quote")["ok"]


# ───────── API: phân quyền + rủi ro theo phiên bản ─────────
def _client(monkeypatch, allowed=True, contract=CONTRACT):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.all_platform.auth_deps import get_current_user
    from app.modules.all_platform.routers import contract as cr
    from app.modules.all_platform.routers import contract_versions as vr

    app = FastAPI()
    app.include_router(vr.contract_versions_router, prefix="/contract-docs")
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    monkeypatch.setattr(cr, "_load_contract_and_lead", lambda cid: (contract, LEAD) if cid == contract["id"] else (_ for _ in ()).throw(LookupError("none")))
    monkeypatch.setattr(vr, "can_edit_contract", lambda u, c, l: allowed)
    monkeypatch.setattr(vr, "_issuer_for", lambda c: ISSUER)
    return TestClient(app)


def test_version_endpoints_require_contract_permission_and_workspace(monkeypatch, bucket):
    d = build_sample_contract()
    store.save_version("C1", d, {})
    c = _client(monkeypatch, allowed=False)
    for method, path in (("get", "/contract-docs/C1/versions"), ("get", "/contract-docs/C1/versions/1/docx"), ("get", "/contract-docs/C1/versions/1/paragraphs"),
                         ("get", "/contract-docs/C1/readiness"), ("post", "/contract-docs/C1/versions/1/risk")):
        r = getattr(c, method)(path)
        assert r.status_code == 200 and r.json()["success"] is False and "quyền" in r.json()["message"], path          # không rò file của hợp đồng người khác
    r = c.post("/contract-docs/C1/versions", json={"docx_base64": base64.b64encode(d).decode()})
    assert r.json()["success"] is False and len(store.list_versions("C1")) == 1                                       # không ghi được phiên bản
    ok = _client(monkeypatch, allowed=True)
    assert ok.get("/contract-docs/NOPE/versions").json()["success"] is False                                          # hợp đồng workspace khác/không tồn tại
    assert [v["version"] for v in ok.get("/contract-docs/C1/versions").json()["data"]] == [1]
    assert ok.get("/contract-docs/C1/versions/1/docx").content[:2] == b"PK"


def test_save_version_records_actor_and_fills_contract_number_only(monkeypatch, bucket):
    c = _client(monkeypatch)
    d = build_sample_contract()
    r = c.post("/contract-docs/C1/versions", json={"docx_base64": base64.b64encode(d).decode(), "contract_number": "HD/2026/0007", "source": "ai-new", "note": "bản đầu"}).json()
    assert r["success"] and r["data"]["version"] == 1
    v = store.list_versions("C1")[0]
    assert v["createdBy"] == "u1" and v["source"] == "ai-new" and v["note"] == "bản đầu"
    from app.modules.all_platform.services import contract_docx_engine as eng

    texts = [p.text for p in eng.describe_paragraphs(eng.load_document(store.load_version("C1", 1)))]
    assert any("HD/2026/0007" in t for t in texts)
    assert c.post("/contract-docs/C1/versions", json={"docx_base64": base64.b64encode(b"not a docx").decode()}).json()["success"] is False


def test_risk_runs_on_real_document_text_and_is_stored_with_that_version(monkeypatch, bucket):
    from app.modules.all_platform.services import contract_ai_service as ai
    import app.modules.all_platform.services as svc

    seen = {}

    async def fake_review(clauses, quote, value, terms):
        seen["clauses"], seen["value"] = clauses, value
        return {"score": 55, "findings": [{"severity": "warn", "title": "Thiếu thông tin Bên B", "detail": "x"}]}

    monkeypatch.setattr(ai, "review_contract_risk", fake_review)
    monkeypatch.setattr(svc, "get_quote", lambda qid: QUOTE)
    d = build_sample_contract()
    store.save_version("C1", d, {})
    c = _client(monkeypatch)
    out = c.post("/contract-docs/C1/versions/1/risk").json()
    assert out["success"] and out["data"]["score"] == 55 and out["data"]["versionSha"] == hashlib.sha256(d).hexdigest() and out["data"]["analyzedAt"]
    assert any("ĐIỀU 3" in cl["title"] for cl in seen["clauses"]) and any("thanh toán" in cl["body"].lower() for cl in seen["clauses"])   # phân tích đúng nội dung tài liệu
    assert seen["value"] == 111375177
    assert store.list_versions("C1")[0]["risk"]["score"] == 55
    assert c.get("/contract-docs/C1/versions/1/risk").json()["data"]["score"] == 55
    assert c.get("/contract-docs/C1/readiness").json()["data"]["ready"] is True


def test_ai_error_on_risk_is_reported_and_nothing_stored(monkeypatch, bucket):
    from app.modules.all_platform.services import contract_ai_service as ai
    import app.modules.all_platform.services as svc

    async def boom(*a, **k):
        raise RuntimeError("Tất cả model AI đều không khả dụng")

    monkeypatch.setattr(ai, "review_contract_risk", boom)
    monkeypatch.setattr(svc, "get_quote", lambda qid: QUOTE)
    store.save_version("C1", build_sample_contract(), {})
    r = _client(monkeypatch).post("/contract-docs/C1/versions/1/risk").json()
    assert r["success"] is False and "AI" in r["message"] and store.list_versions("C1")[0]["risk"] is None


def test_paragraphs_endpoint_returns_selected_version_content(monkeypatch, bucket):
    d = build_sample_contract()
    store.save_version("C1", d, {})
    r = _client(monkeypatch).get("/contract-docs/C1/versions/1/paragraphs").json()["data"]
    assert r["version"] == 1 and any(p["text"].startswith("3.1.") for p in r["paragraphs"]) and base64.b64decode(r["docxBase64"]) == d


def test_docx_to_clauses_splits_by_article_and_includes_tables():
    from app.modules.all_platform.services import contract_docx_engine as eng

    cl = eng.docx_to_clauses(build_sample_contract())
    titles = [c["title"] for c in cl]
    assert any(t.startswith("ĐIỀU 2") for t in titles) and any(t.startswith("ĐIỀU 7") for t in titles)
    assert "Hạng mục mẫu" in next(c for c in cl if c["title"].startswith("ĐIỀU 2"))["body"]                   # chữ trong bảng thuộc đúng điều khoản


# ───────── trạng thái: điều kiện + ghi phiên bản duyệt ─────────
def test_status_change_blocked_until_ready_and_logs_approved_version(monkeypatch, bucket):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.all_platform.auth_deps import get_current_user
    from app.modules.all_platform.routers import contract as cr
    import app.modules.all_platform.services as svc
    from app.modules.all_platform.services import supabase_contract_service as sc

    app = FastAPI()
    app.include_router(cr.contracts_router, prefix="/contracts")
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "admin"}
    monkeypatch.setattr(cr, "_load_contract_and_lead", lambda cid: (CONTRACT, LEAD))
    monkeypatch.setattr(cr, "can_edit_contract", lambda u, c, l: True)
    monkeypatch.setattr(cr, "_issuer_of_contract", lambda c: ISSUER)
    monkeypatch.setattr(svc, "get_quote", lambda qid: QUOTE)
    monkeypatch.setattr(approval.source, "_fetch_customer_and_contact", lambda deal, contact_id=None: (None, None))
    logged, updated = [], []
    monkeypatch.setattr(cr, "update_contract_status", lambda cid, status, signed, actor: updated.append(status) or {"id": cid, "status": status})
    monkeypatch.setattr(sc, "_log_activity", lambda cid, actor, action, changes=None: logged.append((action, changes)))
    c = TestClient(app)
    d = build_sample_contract()
    store.save_version("C1", d, {})
    r = c.post("/contracts/C1/status", json={"status": "pending_legal"}).json()
    assert r["success"] is False and "rủi ro" in r["message"] and updated == []                                       # chưa đủ điều kiện => chặn ở BACKEND
    store.update_meta("C1", 1, {"risk": {"score": 70, "versionSha": hashlib.sha256(d).hexdigest()}})
    assert c.post("/contracts/C1/status", json={"status": "pending_legal", "version": 9}).json()["success"] is False      # sai phiên bản
    ok = c.post("/contracts/C1/status", json={"status": "pending_legal", "version": 1}).json()
    assert ok["success"] and updated == ["pending_legal"] and logged[-1][0] == "approval:pending_legal" and logged[-1][1]["version"] == 1


# ───────── loại hợp đồng tự do được lưu nguyên vẹn ─────────
def test_free_text_contract_type_is_stored_as_label():
    from app.modules.all_platform.services.supabase_contract_service import _normalize_type

    assert _normalize_type("  Hợp đồng thuê   kho lạnh ") == "Hợp đồng thuê kho lạnh" and _normalize_type(None) == "service" and _normalize_type("principle") == "principle"


# ───────── số liệu hợp lệ từ nguồn không bị báo nhầm ─────────
def test_numbers_from_quote_and_parties_are_not_flagged_as_invented():
    from app.modules.all_platform.services import contract_ai_service as ai
    from app.modules.all_platform.services import contract_source_service as src

    quote = {"quoteNumber": "202610090150", "subtotalAmount": 103125177, "vatAmount": 8250000, "totalAmount": 111375177,
             "items": [{"description": "Q-Kiosk 27SMT", "quantity": 1, "unitPrice": 103125000, "vatRate": 8, "totalAmount": 111375000}]}
    deal = {"customer_name": "An", "company_name": "ABC", "tax_code": "0312345678", "phone": "0903555301", "address": "122 Lý Thái Tông"}
    allowed = src.money_tokens_text(quote, deal, {"legalName": "MARKEE", "taxCode": "0402336899", "address": "Tầng 08, 122 Lý Thái Tông", "phone": "076 5055 708"})
    written = "Giá trị 111.375.177 đồng (VAT 8%), MST 0402336899, SĐT 0903555301, địa chỉ số 122, đơn giá 103.125.000."
    assert ai.numeric_tokens(written) - ai.numeric_tokens(allowed) == set()
    assert ai.numeric_tokens("phạt 0,1%/ngày") == ai.numeric_tokens("phạt 0.1%/ngày")                        # 0,1% == 0.1%
    assert "25%" in (ai.numeric_tokens("phạt 25% giá trị") - ai.numeric_tokens(allowed))                      # số bịa vẫn bị bắt


# ───────── chống tạo trùng khi nhiều worker (mô phỏng, không ghi DB thật) ─────────
def test_second_worker_without_shared_memory_is_stopped_by_db_natural_key(monkeypatch):
    from app.modules.all_platform.services import idempotency_service as idem

    rows = []

    class Q:
        def __init__(self): self.f = []
        def select(self, *_): return self
        def eq(self, c, v): self.f.append((c, v)); return self
        def is_(self, c, v): self.f.append((c, None)); return self
        def gte(self, *_): return self
        def limit(self, *_): return self
        def execute(self): return SimpleNamespace(data=[r for r in rows if all(r.get(c) == v for c, v in self.f)][:1])

    class DB:
        def table(self, n): return Q()

    created = []

    def worker(key):                                   # mỗi worker có bộ nhớ riêng (cache trống) -> chỉ còn lớp bảo vệ ở DB
        idem._entries.clear()
        dup = idem.find_recent_duplicate_contract(DB(), "markee", "u1", "D1", "Q1", "HĐ A")
        if dup:
            return dup["id"]
        rows.append({"id": f"C{len(created) + 1}", "instance": "markee", "created_by": "u1", "deal_id": "D1", "quote_id": "Q1", "title": "HĐ A"})
        created.append(1)
        return rows[-1]["id"]

    assert worker("k1") == "C1" and worker("k2-other-worker") == "C1" and len(rows) == 1
