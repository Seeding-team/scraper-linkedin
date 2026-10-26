"""Test API msc-sync (auth + response shape) — khong cham DB that / MSC that.

Luu y: TestClient(app) se chay lifespan; các scheduler (kể cả msc-sync) được
gate bởi env/env-trống (MSC_API_BASE_URL trống trong env test → job không được
thêm), nên không có request nào bay ra ngoài trong lúc test.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

MSC_SYNC_RUN_PATH = "/api/all-platform/msc-sync/run"
MSC_SYNC_STATUS_PATH = "/api/all-platform/msc-sync/status"


def test_run_requires_authentication() -> None:
    """Endpoint KHONG duoc phep goi khong auth (task: khong exposure nhu
    unauthenticated endpoint)."""
    response = client.post(MSC_SYNC_RUN_PATH, json={"dry_run": False})
    assert response.status_code == 401


def test_status_requires_authentication() -> None:
    response = client.get(MSC_SYNC_STATUS_PATH)
    assert response.status_code == 401


def test_run_bad_trigger_shape_still_requires_auth() -> None:
    response = client.post(MSC_SYNC_RUN_PATH, json={})
    assert response.status_code == 401
