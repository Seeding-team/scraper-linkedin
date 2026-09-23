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
