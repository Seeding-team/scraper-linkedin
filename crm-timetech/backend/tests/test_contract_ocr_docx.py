"""Doi chieu hop dong .docx (truoc day chi ho tro PDF/anh, tra extractable=False cho moi .docx)."""
import asyncio
from io import BytesIO

from docx import Document

from app.modules.all_platform.services import contract_ocr_service as svc


def _make_docx(lines: list[str]) -> bytes:
    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_docx_with_real_text_is_extractable_via_heuristic(monkeypatch):
    monkeypatch.setattr(svc.settings, "gemini_api_key", "")
    monkeypatch.setattr(svc.settings, "openai_api_key", "")
    file_bytes = _make_docx([
        "HỢP ĐỒNG KINH TẾ",
        "Số hợp đồng: 01/2026/HĐKT",
        "Ngày 05 tháng 01 năm 2026",
        "Tổng giá trị hợp đồng sau thuế: 120.000.000 đ",
    ])
    result = asyncio.run(svc.extract_contract_summary(file_bytes, "HDNT_01_2026.docx"))
    assert result["extractable"] is True
    assert result["extraction_method"] == "heuristic"
    assert result["contract_number"] == "01/2026/HĐKT"
    assert result["total_amount"] == 120000000


def test_docx_with_too_little_text_is_not_extractable(monkeypatch):
    monkeypatch.setattr(svc.settings, "gemini_api_key", "")
    monkeypatch.setattr(svc.settings, "openai_api_key", "")
    file_bytes = _make_docx(["OK"])
    result = asyncio.run(svc.extract_contract_summary(file_bytes, "trong.docx"))
    assert result["extractable"] is False
    assert result["contract_number"] is None


def test_corrupted_docx_falls_back_honestly(monkeypatch):
    monkeypatch.setattr(svc.settings, "gemini_api_key", "")
    monkeypatch.setattr(svc.settings, "openai_api_key", "")
    result = asyncio.run(svc.extract_contract_summary(b"not a real docx file", "broken.docx"))
    assert result["extractable"] is False
