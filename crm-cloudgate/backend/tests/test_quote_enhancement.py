import pytest
from pydantic import ValidationError
from app.modules.all_platform.schemas.quote import QuoteCreateRequest, QuoteUpdateRequest, QuoteItemInput


@pytest.mark.parametrize("model", [QuoteCreateRequest, QuoteUpdateRequest])
def test_payment_snapshot_without_stored_amount(model):
    args = {"data": {"requestSummary": "keep", "paymentPlan": [
        {"id": "p1", "phase": "1", "percent": 33.33, "condition": "sign", "note": "", "amount": 999}
    ]}}
    if model is QuoteCreateRequest:
        args["quote_form_id"] = "test"
    data = model(**args).model_dump()["data"]
    assert data["requestSummary"] == "keep"
    assert data["paymentPlan"][0]["percent"] == 33.33
    assert "amount" not in data["paymentPlan"][0]


@pytest.mark.parametrize("percent", [-1, 101, float("nan"), float("inf")])
def test_invalid_payment_percent_rejected(percent):
    with pytest.raises(ValidationError):
        QuoteUpdateRequest(data={"paymentPlan": [{"id": "p1", "percent": percent}]})


def test_warranty_parent_child_and_null():
    item = QuoteItemInput(warranty_scope="12 months", children=[{"warranty_scope": "6 months"}])
    assert item.model_dump()["warranty_scope"] == "12 months"
    assert item.model_dump()["children"][0]["warranty_scope"] == "6 months"
    assert QuoteItemInput().warranty_scope is None


def test_legacy_villa_and_null_update_unchanged():
    villa = {"paymentPhaseOnePercent": 30, "paymentPhaseTwoPercent": 70}
    assert QuoteUpdateRequest(data=villa).data == villa
    assert QuoteUpdateRequest().data is None


def test_quote_update_quote_form_id_round_trips():
    """"Mẫu ăn theo Đơn vị phát hành" (feedback 2026-09-24) - quote_form_id
    phai co mat trong dump khi client THAT SU gui (khong dung exclude_none nhu
    cac field khac o day, vi doi mau la gia tri THAT SU chu khong phai "bo gan"),
    va PHAI vang mat khi client khong gui gi (khong lam quote_update() vo tinh
    doi mau ve None moi lan luu hang muc/gia)."""
    dump_with_form = QuoteUpdateRequest(quote_form_id="form-abc").model_dump(exclude_none=True)
    assert dump_with_form["quote_form_id"] == "form-abc"
    dump_without_form = QuoteUpdateRequest(data={"requestSummary": "x"}).model_dump(exclude_none=True)
    assert "quote_form_id" not in dump_without_form


@pytest.mark.parametrize("value", [None, {}, "invalid"])
def test_payment_plan_must_be_list(value):
    with pytest.raises(ValidationError):
        QuoteUpdateRequest(data={"paymentPlan": value})


def test_public_allowlist_keeps_payment_but_not_internal_data():
    import ast
    from pathlib import Path
    source = Path(__file__).parents[1] / "app/modules/all_platform/services/supabase_quote_service.py"
    node = next(n for n in ast.parse(source.read_text(encoding="utf-8")).body
                if isinstance(n, ast.FunctionDef) and n.name == "_public_data_allowlist")
    scope = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), scope)
    allowlist = scope["_public_data_allowlist"]
    data = {"paymentPlan": [{"id": "p1", "percent": 100}], "customBlocks": [], "internalRequestNote": "secret"}
    result = allowlist(data, {"enableDynamicPaymentPlan": True, "sections": []})
    assert "paymentPlan" in result
    assert "customBlocks" in result
    assert "internalRequestNote" not in result
    assert "paymentPlan" not in allowlist(data, {"sections": []})


class _FakeQuery:
    def __init__(self, row):
        self._row = row

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self

    def execute(self):
        return type("Result", (), {"data": self._row})()


def _public_quote_with(monkeypatch, row, access_logs=None):
    from app.modules.all_platform.services import supabase_quote_service as svc
    tables = {"quote_activity_log": access_logs or []}
    fake_client = type("Client", (), {"table": lambda _self, name: _FakeQuery(tables.get(name, row))})()
    monkeypatch.setattr(svc, "get_supabase_client", lambda: fake_client)
    monkeypatch.setattr(svc, "_crm_instance", lambda: "markee")
    monkeypatch.setattr(svc, "_quote_items", lambda _quote_id: [])
    monkeypatch.setattr(svc, "_row_to_public_quote", lambda r, _items: {"id": r["id"]})
    return svc


def _published_row(**overrides):
    row = {"id": "q1", "public_enabled": True, "status": "approved", "public_access_mode": "phone",
           "public_allowed_phones": [], "data": {"customerPhone": "0912 345 678"}}
    row.update(overrides)
    return row


def test_public_quote_phone_mode_falls_back_to_customer_phone(monkeypatch):
    """Mac dinh 'phone' (migration 149): danh sach SDT rong -> doi chieu voi
    data.customerPhone, khong khoa han link."""
    svc = _public_quote_with(monkeypatch, _published_row())
    assert svc.get_public_quote("tok", phone="+84912345678") == {"id": "q1"}
    with pytest.raises(svc.PublicQuoteVerificationRequiredError):
        svc.get_public_quote("tok", phone="0999999999")
    with pytest.raises(svc.PublicQuoteVerificationRequiredError):
        svc.get_public_quote("tok")


def test_public_quote_explicit_phone_list_overrides_customer_phone(monkeypatch):
    svc = _public_quote_with(monkeypatch, _published_row(public_allowed_phones=["+84900000001"]))
    assert svc.get_public_quote("tok", phone="0900000001") == {"id": "q1"}
    with pytest.raises(svc.PublicQuoteVerificationRequiredError):
        svc.get_public_quote("tok", phone="0912345678")


def test_public_quote_old_none_quote_defaults_to_customer_phone(monkeypatch):
    """Bao gia cu con 'none' (migration 149 chua chay) ma chua ai chu dong
    chon "Không giới hạn" -> van bi gioi han theo SDT khach hang."""
    svc = _public_quote_with(monkeypatch, _published_row(public_access_mode="none"))
    with pytest.raises(svc.PublicQuoteVerificationRequiredError):
        svc.get_public_quote("tok")
    assert svc.get_public_quote("tok", phone="0912345678") == {"id": "q1"}


def test_public_quote_explicit_none_stays_open(monkeypatch):
    logs = [{"changes": {"mode": "none"}}]
    svc = _public_quote_with(monkeypatch, _published_row(public_access_mode="none"), access_logs=logs)
    assert svc.get_public_quote("tok") == {"id": "q1"}


def test_public_quote_none_without_any_phone_stays_open(monkeypatch):
    svc = _public_quote_with(monkeypatch, _published_row(public_access_mode="none", data={}))
    assert svc.get_public_quote("tok") == {"id": "q1"}
