"""Tests cho endpoint read-only /api/all-platform/sync/products.

Khong cham DB that: stub list_service_catalog_items_scoped. Kiem tra auth
static key, payload shape, va viec luon lay TOAN BO danh muc (instances=None).
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.modules.all_platform.routers import product_sync

PATH = "/api/all-platform/sync/products"
KEY = "test-product-sync-key"


def _tree():
    return [
        {
            "id": "group-1",
            "itemType": "group",
            "name": "Thiết bị âm thanh",
            "description": "",
            "status": "active",
            "children": [
                {
                    "id": "item-1",
                    "itemType": "component",
                    "parentId": "group-1",
                    "name": "Micro không dây",
                    "brand": "Audio-Technica",
                    "partNumber": "ATW-2120",
                    "sku": None,
                    "description": "",
                    "status": "active",
                    "children": [],
                }
            ],
        }
    ]


def _client():
    return TestClient(app)


def test_missing_key_returns_401(monkeypatch):
    monkeypatch.setattr(settings, "product_sync_api_key", KEY)
    response = _client().get(PATH)
    assert response.status_code == 401
    assert "X-Sync-Api-Key" in response.json()["detail"]


def test_wrong_key_returns_401(monkeypatch):
    monkeypatch.setattr(settings, "product_sync_api_key", KEY)
    response = _client().get(PATH, headers={"X-Sync-Api-Key": "wrong"})
    assert response.status_code == 401


def test_unconfigured_key_returns_503(monkeypatch):
    monkeypatch.setattr(settings, "product_sync_api_key", "")
    response = _client().get(PATH, headers={"X-Sync-Api-Key": KEY})
    assert response.status_code == 503


def test_correct_key_returns_full_catalog(monkeypatch):
    monkeypatch.setattr(settings, "product_sync_api_key", KEY)
    calls = []

    def fake_list(instances):
        calls.append(instances)
        return _tree()

    monkeypatch.setattr(product_sync, "list_service_catalog_items_scoped", fake_list)

    response = _client().get(PATH, headers={"X-Sync-Api-Key": KEY})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"] == _tree()
    assert calls == [None]  # KHONG loc workspace: luon lay toan bo catalog


def test_service_error_returns_success_false(monkeypatch):
    monkeypatch.setattr(settings, "product_sync_api_key", KEY)
    monkeypatch.setattr(
        product_sync,
        "list_service_catalog_items_scoped",
        lambda instances: (_ for _ in ()).throw(RuntimeError("db down")),
    )

    response = _client().get(PATH, headers={"X-Sync-Api-Key": KEY})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert "db down" in body["message"]
