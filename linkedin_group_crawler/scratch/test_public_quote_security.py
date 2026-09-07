"""Test THAT: xac nhan get_public_quote() dung ALLOWLIST that su - bat ky
field la (secretFutureField) chen vao quote row / quote_items row / quotes.data
deu KHONG duoc xuat hien trong response cong khai, kiem tra DE QUY toan bo JSON
tra ve. 2 phan:
  1) Unit-level: goi thang _row_to_public_quote()/_row_to_public_item() voi
     dict rieng co them "secretFutureField" (mo phong 1 cot DB moi tinh khong
     ai nho whitelist) - chung minh allowlist THAT (khong phai deny-list) vi
     khong can biet truoc ten field la van tu dong bi loai.
  2) Round-trip that qua API: tao 1 quote throwaway that, chen secretFutureField
     vao quotes.data that su qua Supabase, duyet, lay public token, goi dung
     endpoint public that su, quet de quy JSON tra ve.
Don sach quote throwaway sau khi xong."""
import sys
sys.path.insert(0, '.')

from fastapi.testclient import TestClient
from app.main import app
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.services import supabase_quote_service as qsvc
from app.core.supabase_client import get_supabase_client

SECRET_MARKER = "SECRET_FUTURE_FIELD_MUST_NOT_LEAK_9f21"


def find_secret(obj, path="$"):
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if SECRET_MARKER.lower() in str(k).lower():
                hits.append(f"{path}.{k} (KEY chua marker)")
            hits.extend(find_secret(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(find_secret(v, f"{path}[{i}]"))
    else:
        if SECRET_MARKER.lower() in str(obj).lower():
            hits.append(f"{path} = {obj!r}")
    return hits


print("=== PHẦN 1: unit-level (dict giả lập, không qua DB) ===")
fake_quote_row = {
    "id": "fake-id", "quote_number": "TEST-001", "status": "approved",
    "quote_form_id": "fake-form", "form_schema_version": 1,
    "form_snapshot": {"sections": [{"fields": [{"key": "quoteTitle"}]}]},
    "data": {"quoteTitle": "hello", "secretFutureField": SECRET_MARKER, "internalRequestNote": "nope"},
    "subtotal_amount": 100, "vat_amount": 10, "total_amount": 110, "currency": "VND",
    "public_token": "tok123", "public_enabled": True,
    # cac cot noi bo That su co trong bang quotes (migration 085) - phai bi loai
    "processing_stage": "review", "technical_owner_id": "u1", "quote_owner_id": "u2",
    "secretFutureField": SECRET_MARKER,
}
fake_items = [{
    "id": "item-1", "parent_item_id": None, "description": "item A",
    "quantity": 1, "unit_price": 100, "vat_rate": 10,
    "subtotal_amount": 100, "vat_amount": 10, "total_amount": 110,
    "cost_price": 55, "markup_percent": 30,  # migration 086 field (co the chua chay tren DB nay, van test duoc o unit-level)
    "secretFutureField": SECRET_MARKER,
}]

public_quote_unit = qsvc._row_to_public_quote(fake_quote_row, fake_items)
hits_unit = find_secret(public_quote_unit)
print("public keys:", sorted(public_quote_unit.keys()))
print("public data keys:", sorted(public_quote_unit["data"].keys()))
print("public item[0] keys:", sorted(public_quote_unit["items"][0].keys()))
if hits_unit:
    print("UNIT TEST FAILED:")
    for h in hits_unit:
        print(" -", h)
    raise SystemExit(1)
print("UNIT TEST PASSED: secretFutureField không xuất hiện ở bất kỳ đâu trong output allowlist.\n")


print("=== PHẦN 2: round-trip thật qua API + DB thật ===")
TEST_USER = {"id": "a725c489-a3f9-425b-81dd-dbcb68e9b84b", "email": "admin@gmail.com", "role": "admin", "name": "Admin"}
app.dependency_overrides[get_current_user] = lambda: TEST_USER
client = TestClient(app)
BASE = "/api/all-platform"

forms = client.get(f"{BASE}/quote-forms?status=active").json()["data"]
form_id = forms[0]["id"]

create_res = client.post(f"{BASE}/quotes", json={
    "quote_form_id": form_id,
    "data": {"quoteTitle": "__TESTSECURITY__ allowlist check", "internalRequestNote": "SECRET_INTERNAL_NOTE"},
    "items": [{"description": "__TESTSECURITY__ item", "quantity": 1, "unit_price": 100000, "discount_percent": 0, "vat_rate": 10, "children": []}],
})
quote = create_res.json()["data"]
qid = quote["id"]
print("created:", qid)

try:
    client.post(f"{BASE}/quotes/{qid}/processing-stage", json={"stage": "technical"})
    client.post(f"{BASE}/quotes/{qid}/owners", json={"technical_owner_id": TEST_USER["id"], "quote_owner_id": TEST_USER["id"]})

    supabase = get_supabase_client()
    supabase.table("quotes").update({
        "data": {"quoteTitle": "__TESTSECURITY__ allowlist check", "internalRequestNote": "SECRET_INTERNAL_NOTE", "secretFutureField": SECRET_MARKER},
    }).eq("id", qid).execute()

    approve_res = client.post(f"{BASE}/quotes/{qid}/approve")
    approve_body = approve_res.json()
    print("approve:", approve_res.status_code, approve_body.get("success"), approve_body.get("message"))
    approved_quote = approve_body["data"]
    token = approved_quote["publicToken"]
    assert token, "no public token generated"

    public_res = client.get(f"{BASE}/quotes/public/{token}")
    public_body = public_res.json()
    public_quote = public_body["data"]

    print("public_quote top-level keys:", sorted(public_quote.keys()))
    print("public_quote.data keys:", sorted((public_quote.get("data") or {}).keys()))

    failures = []
    for key in ("processingStage", "technicalOwnerId", "quoteOwnerId"):
        if key in public_quote:
            failures.append(f"LEAK top-level: {key}")
    if "internalRequestNote" in (public_quote.get("data") or {}):
        failures.append("LEAK data.internalRequestNote")
    for item in public_quote.get("items", []):
        for key in ("costPrice", "markupPercent"):
            if key in item:
                failures.append(f"LEAK item.{key}")
    failures += [f"UNKNOWN FIELD LEAKED (recursive scan): {h}" for h in find_secret(public_quote)]

    if failures:
        print("ROUND-TRIP TEST FAILED:")
        for f in failures:
            print(" -", f)
        raise SystemExit(1)
    print("ROUND-TRIP TEST PASSED: no internal/unknown keys anywhere in real public JSON response.")
finally:
    client.delete(f"{BASE}/quotes/{qid}")
    print("cleanup done")
