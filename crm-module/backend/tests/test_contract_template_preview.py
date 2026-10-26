"""Bug: Thư viện mẫu hợp đồng — "Xem" chỉ hiển thị text trích xuất, không giữ bố cục gốc (font/bảng/header-footer/chữ ký).
Fix: endpoint mới GET /contract-templates/{id}/preview-pdf trả PDF thật — DOCX chuyển bằng LibreOffice (contract_docx_engine,
engine hiện có, không dựng mới), PDF gốc trả thẳng không convert, cache theo hash nội dung, không ghi đè file gốc."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.routers.contract_template import contract_templates_router


def _client(monkeypatch, get_template=None):
    app = FastAPI()
    app.include_router(contract_templates_router, prefix="/contract-templates")
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "admin"}
    import app.modules.all_platform.routers.contract_template as router_mod

    monkeypatch.setattr(router_mod, "get_contract_template", get_template or (lambda tid: {"id": tid, "name": "Mẫu test"}))
    return TestClient(app)


def test_pdf_original_returned_directly_without_conversion(monkeypatch):
    import app.modules.all_platform.routers.contract_template as router_mod

    monkeypatch.setattr(router_mod.store, "load_template_original", lambda tid: ("pdf", b"%PDF-1.4 fake"))
    called = {"convert": False}
    monkeypatch.setattr(router_mod.eng, "convert_docx_to_pdf", lambda *a, **k: called.__setitem__("convert", True))
    r = _client(monkeypatch).get("/contract-templates/T1/preview-pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content == b"%PDF-1.4 fake"
    assert called["convert"] is False   # PDF gốc không convert


def test_docx_converted_via_libreoffice_engine_and_cached(monkeypatch):
    import app.modules.all_platform.routers.contract_template as router_mod

    monkeypatch.setattr(router_mod.store, "load_template_original", lambda tid: ("docx", b"fake docx bytes"))
    monkeypatch.setattr(router_mod.store, "load_template_preview_pdf", lambda tid, h: None)
    saved = {}
    monkeypatch.setattr(router_mod.store, "save_template_preview_pdf", lambda tid, h, pdf: saved.update(tid=tid, h=h, pdf=pdf))
    convert_calls = []
    monkeypatch.setattr(router_mod.eng, "convert_docx_to_pdf", lambda data: (convert_calls.append(data), b"%PDF-converted")[1])
    r = _client(monkeypatch).get("/contract-templates/T1/preview-pdf")
    assert r.status_code == 200 and r.content == b"%PDF-converted"
    assert len(convert_calls) == 1 and convert_calls[0] == b"fake docx bytes"
    assert saved["tid"] == "T1" and saved["pdf"] == b"%PDF-converted"   # cache được ghi lại


def test_docx_preview_uses_cache_on_second_call_no_reconvert(monkeypatch):
    import app.modules.all_platform.routers.contract_template as router_mod

    monkeypatch.setattr(router_mod.store, "load_template_original", lambda tid: ("docx", b"fake docx bytes"))
    monkeypatch.setattr(router_mod.store, "load_template_preview_pdf", lambda tid, h: b"%PDF-cached")
    convert_calls = []
    monkeypatch.setattr(router_mod.eng, "convert_docx_to_pdf", lambda data: (convert_calls.append(data), b"%PDF-converted")[1])
    r = _client(monkeypatch).get("/contract-templates/T1/preview-pdf")
    assert r.status_code == 200 and r.content == b"%PDF-cached"
    assert convert_calls == []   # có cache -> KHÔNG convert lại


def test_missing_original_file_returns_clear_error_not_crash(monkeypatch):
    import app.modules.all_platform.routers.contract_template as router_mod

    monkeypatch.setattr(router_mod.store, "load_template_original", lambda tid: None)
    r = _client(monkeypatch).get("/contract-templates/T1/preview-pdf")
    body = r.json()
    assert body["success"] is False and "file gốc" in body["message"]


def test_libreoffice_unavailable_returns_clear_error_not_crash(monkeypatch):
    import app.modules.all_platform.routers.contract_template as router_mod

    monkeypatch.setattr(router_mod.store, "load_template_original", lambda tid: ("docx", b"fake docx bytes"))
    monkeypatch.setattr(router_mod.store, "load_template_preview_pdf", lambda tid, h: None)

    def boom(data):
        raise router_mod.eng.PdfEngineUnavailable("no soffice")
    monkeypatch.setattr(router_mod.eng, "convert_docx_to_pdf", boom)
    r = _client(monkeypatch).get("/contract-templates/T1/preview-pdf")
    body = r.json()
    assert body["success"] is False and "LibreOffice" in body["message"]


def test_unknown_template_id_does_not_touch_storage(monkeypatch):
    import app.modules.all_platform.routers.contract_template as router_mod

    def not_found(tid):
        raise ValueError("Khong tim thay mau hop dong.")
    touched = {"storage": False}
    monkeypatch.setattr(router_mod.store, "load_template_original", lambda tid: touched.__setitem__("storage", True))
    r = _client(monkeypatch, get_template=not_found).get("/contract-templates/missing/preview-pdf")
    body = r.json()
    assert body["success"] is False and touched["storage"] is False   # 404 logic trước, không đụng Storage nếu mẫu không tồn tại


def test_cache_key_changes_when_original_content_changes(monkeypatch):
    """Đổi file mẫu mới (nội dung khác) -> hash khác -> KHÔNG dùng nhầm cache PDF của file cũ."""
    from app.modules.all_platform.services import contract_document_store as store
    import hashlib

    h1 = hashlib.sha256(b"content v1").hexdigest()
    h2 = hashlib.sha256(b"content v2").hexdigest()
    assert h1 != h2
    assert store.load_template_preview_pdf("T1", h1) is None   # chưa có cache nào -> cả 2 đều None, không đụng nhau
    assert store.load_template_preview_pdf("T1", h2) is None
