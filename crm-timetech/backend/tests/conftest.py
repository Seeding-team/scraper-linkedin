"""Test DB GUARD cho toan bo test suite cua backend nay
(isolation task 2026-10-14 — CRM Service Catalog Workspace isolation).

Van de dang cap: `app/core/config.py` chay `load_dotenv(.env)` ngay tai
import — moi import `app.*` trong test dap SUPABASE_URL/SUPABASE_SERVICE_
ROLE_KEY cua .env (DB chia se voi prod/dev, KHONG phai local-db) vao
os.environ. Truoc day isolation chi la "ky luat code" (fake-db
monkeypatch tung test); mot cho quen monkeypatch la ghi la DB that.
Guard nay:

1. pytest_configure — CHAY TRUOC collection:
   - fail nhanh neu ton tai `.env.local` (loading `override=True` lat ca
     URL, lam mat tinh deterministic cua recipe);
   - kiem tra phien ban starlette ma gia dinh "module-level
     TestClient(app) khong chay lifespan" dua vao (startup chi chay trong
     `with`, da verify tren starlette 1.7.0);
   - NEP SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ve local-db (gateway
     `http://127.0.0.1:15431` + demo key public ghi trong local-db/README)
     NEU bien hien co KHONG phai local. load_dotenv dung `override=False`
     nen bien da set tu truoc LUON thang (docs hien co xac nhan). Ket qua:
     ca suite khong the cham DB khac local-db khi co code that su build
     client — khong con phai dua vao recipe env thu cong.
2. autouse fixture — thay `create_client` trong `app.core.supabase_client`
   bang ban GUARD: URL khac `http://127.0.0.1` / `http://localhost` =>
   RuntimeError ngay tai khoi tao (fail-closed), khong den pha HTTP
   request. Test fake-db (monkeypatch get_supabase_client) khong anh
   huong; test thuc su can DB van chay duoc tren local-db.

Luu y: KHONG import `app.*` o module level cua conftest.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent.parent

LOCAL_DB_URL = "http://127.0.0.1:15431"
_LOCAL_URL_PREFIXES = ("http://127.0.0.1", "http://localhost")


def _local_db_demo_service_key() -> str | None:
    """Doc demo service key (PUBLIC, Supabase CLI demo, ghi trong
    local-db/README) de nap vao env khi bien chua duoc set. KHONG bao gio
    in gia tri ra stdout/report."""
    readme = REPO_ROOT / "local-db" / "README.md"
    try:
        text = readme.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"SUPABASE_SERVICE_ROLE_KEY[=:]\s*(\S+)", text)
    if not match:
        return None
    value = match.group(1).strip().strip("`").strip("'").strip('"')
    return value if value.startswith("eyJ") else None


def pytest_configure(config) -> None:
    env_local = BACKEND_DIR / ".env.local"
    if env_local.exists():
        raise RuntimeError(
            "TEST DB GUARD: .env.local ton tai trong backend — load_dotenv "
            "(override=True) se lat SUPABASE_URL va lam mat database "
            "isolation. Xoa ho di chuyen no truoc khi chay test."
        )

    import starlette

    parts: list[int] = []
    for piece in starlette.__version__.split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits or 0))
    starlette_ver = tuple(parts[:2] + [0] * (2 - len(parts[:2])))
    if tuple(starlette_ver) < (0, 21):
        raise RuntimeError(
            "TEST GUARD: starlette "
            + starlette.__version__
            + " cu hon 0.21 — gia dinh 'module-level TestClient(app) khong "
            "chay lifespan' khong con dung; re-verify truoc khi bo check."
        )

    # Nep env ve local-db khi bien hien co (tu .env/cach khac) khong local.
    url = (os.getenv("SUPABASE_URL") or "").strip()
    if not url.startswith(_LOCAL_URL_PREFIXES):
        os.environ["SUPABASE_URL"] = LOCAL_DB_URL
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not key:
        demo_key = _local_db_demo_service_key()
        if demo_key:
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = demo_key


def _host_is_local(url: str) -> bool:
    """So khop HOST CHINH XAC (khong startswith — 'localhost.evil.com' phai bi tu choi)."""
    from urllib.parse import urlparse

    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host in ("127.0.0.1", "localhost", "::1")


@pytest.fixture(autouse=True)
def _isolate_settings_and_db(monkeypatch):
    """(a) Neu enforcement flags tu .env may chay — TEST LUON chay flag OFF
    instance 'test-*' de suite deterministic giua cac may; cac test rieng
    tu monkeypatch flag/instance cua ho (fixture enforce_own...).
    (b) Fail-closed: moi build Supabase client cho HOST khac local (so khop
    chinh xac hostname) => RuntimeError ngay tai khoi tao client."""
    from app.core import supabase_client as sc

    # (a) deterministic test settings — phai set TRUOC bat ky test nao doc
    # settings (config vien da import trai: chi danh doi gia life-field).
    monkeypatch.setattr(
        __import__("app.core.config", fromlist=["settings"]).settings,
        "catalog_scope_enforced",
        False,
        raising=False,
    )

    real_create_client = sc.create_client

    def _guarded_create_client(url, key, *args, **kwargs):
        if not _host_is_local(str(url or "")):
            raise RuntimeError(
                "TEST DB GUARD: tu choi khoi tao Supabase client cho host "
                "khong phai local-db (127.0.0.1/localhost). Test phai fake DB "
                "(monkeypatch get_supabase_client) hoac dung local-db 15431."
            )
        return real_create_client(url, key, *args, **kwargs)

    monkeypatch.setattr(sc, "create_client", _guarded_create_client)
    yield
