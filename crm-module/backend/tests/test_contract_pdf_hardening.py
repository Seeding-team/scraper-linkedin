"""Engine PDF (LibreOffice): giới hạn tài nguyên, timeout + diệt tiến trình, dọn file tạm, health check. Không cần LibreOffice thật."""
import glob
import io
import os
import subprocess
import sys
import tempfile
import threading
import zipfile

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from app.modules.all_platform.services import contract_docx_engine as eng


def _tmp_dirs():
    return set(glob.glob(os.path.join(tempfile.gettempdir(), "contract_pdf_*")))


def _zip(entries: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for k, v in entries.items():
            z.writestr(k, v)
    return buf.getvalue()


def test_validate_rejects_non_docx_oversize_and_zip_bomb(monkeypatch):
    with pytest.raises(ValueError):
        eng.validate_docx_bytes(b"not a zip")
    with pytest.raises(ValueError):
        eng.validate_docx_bytes(_zip({"hello.txt": "x"}))                         # zip nhưng không phải DOCX
    ok = _zip({"word/document.xml": "<w:document/>"})
    eng.validate_docx_bytes(ok)
    monkeypatch.setattr(eng, "MAX_DOCX_BYTES", 10)
    with pytest.raises(ValueError):
        eng.validate_docx_bytes(ok)
    monkeypatch.setattr(eng, "MAX_DOCX_BYTES", 10 * 1024 * 1024)
    monkeypatch.setattr(eng, "MAX_DOCX_UNCOMPRESSED", 1000)                      # bomb: nén nhỏ, bung rất lớn
    with pytest.raises(ValueError):
        eng.validate_docx_bytes(_zip({"word/document.xml": "A" * 100000}))
    monkeypatch.setattr(eng, "MAX_DOCX_UNCOMPRESSED", 10**9)
    monkeypatch.setattr(eng, "MAX_DOCX_ENTRIES", 3)
    with pytest.raises(ValueError):
        eng.validate_docx_bytes(_zip({"word/document.xml": "x", "a": "1", "b": "2", "c": "3"}))


def test_convert_failure_cleans_temp_dir_and_does_not_leak_details(monkeypatch):
    from contract_docx_fixture import build_sample_contract

    monkeypatch.setattr(eng, "find_soffice", lambda: sys.executable)             # chạy `python <args soffice>` -> thất bại ngay
    before = _tmp_dirs()
    with pytest.raises(eng.PdfEngineUnavailable) as exc:
        eng.convert_docx_to_pdf(build_sample_contract(), timeout=20)
    assert "thất bại" in str(exc.value) and len(str(exc.value)) < 600
    assert _tmp_dirs() == before                                                 # thư mục tạm (gồm file hợp đồng) đã bị xoá


def test_timeout_kills_process_and_cleans_up(monkeypatch):
    from contract_docx_fixture import build_sample_contract

    spawned = []
    real_popen = subprocess.Popen

    def sleeper(cmd, **kw):
        p = real_popen([sys.executable, "-c", "import time; time.sleep(60)"], **kw)
        spawned.append(p)
        return p

    monkeypatch.setattr(eng, "find_soffice", lambda: "soffice")
    monkeypatch.setattr(eng.subprocess, "Popen", sleeper)
    before = _tmp_dirs()
    with pytest.raises(eng.PdfEngineUnavailable) as exc:
        eng.convert_docx_to_pdf(build_sample_contract(), timeout=1)
    assert "quá thời gian" in str(exc.value)
    assert spawned and spawned[0].poll() is not None                             # tiến trình đã bị diệt, không mồ côi
    assert _tmp_dirs() == before


def test_concurrency_limit_rejects_when_all_slots_busy(monkeypatch):
    from contract_docx_fixture import build_sample_contract

    sem = threading.BoundedSemaphore(1)
    sem.acquire()                                                               # 1 slot duy nhất đang bận
    monkeypatch.setattr(eng, "_slots", sem)
    monkeypatch.setattr(eng, "find_soffice", lambda: "soffice")
    with pytest.raises(eng.PdfEngineUnavailable) as exc:
        eng.convert_docx_to_pdf(build_sample_contract(), timeout=1)
    assert "quá nhiều" in str(exc.value)
    sem.release()


def test_convert_rejects_invalid_docx_before_starting_soffice(monkeypatch):
    monkeypatch.setattr(eng, "find_soffice", lambda: "soffice")
    monkeypatch.setattr(eng.subprocess, "Popen", lambda *a, **k: pytest.fail("không được chạy soffice với file không hợp lệ"))
    with pytest.raises(ValueError):
        eng.convert_docx_to_pdf(b"%PDF-1.4 not a docx")


def test_health_check_without_soffice_is_not_ok(monkeypatch):
    monkeypatch.setattr(eng, "find_soffice", lambda: None)
    h = eng.health_check()
    assert h["ok"] is False and "soffice" in h["error"]


def test_health_endpoint_returns_503_when_engine_missing(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.all_platform.routers.contract_docx import contract_docx_router

    monkeypatch.setattr(eng, "find_soffice", lambda: None)
    app = FastAPI()
    app.include_router(contract_docx_router, prefix="/contract-docs")
    r = TestClient(app).get("/contract-docs/health")                             # health không cần đăng nhập
    assert r.status_code == 503 and r.json()["ok"] is False


@pytest.mark.skipif(eng.find_soffice() is None, reason="cần LibreOffice (chạy trong Docker image backend)")
def test_real_libreoffice_health_deep_and_no_orphans():
    h = eng.health_check(deep=True, cache_seconds=0)
    assert h["ok"] and h["deep"]["ok"] and h["deep"]["vietnameseTextOk"] and h["version"]
    assert h["fontsVietnamese"] is True
