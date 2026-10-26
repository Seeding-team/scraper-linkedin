"""Link bao gia cong khai cua KHACH (/quotes/public/{token}) KHONG duoc bat dang nhap; cac endpoint khac van phai 401."""
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.routers import quote as quote_router_module


def _client():
    app = FastAPI()
    app.include_router(quote_router_module.quotes_router, prefix="/quotes")
    return TestClient(app)


def test_public_quote_is_reachable_without_credentials():
    with mock.patch.object(quote_router_module, "get_public_quote", return_value={"id": "q1", "quoteNumber": "Q-1"}):
        res = _client().get("/quotes/public/sometoken")
    assert res.status_code == 200 and res.json()["success"] is True and res.json()["data"]["id"] == "q1"


def test_protected_quote_endpoint_still_requires_login():
    res = _client().get("/quotes/some-quote-id")
    assert res.status_code == 401
