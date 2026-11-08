"""Bug: Bước 3 (Chỉnh sửa điều khoản) - Sale gõ sửa trực tiếp khối BÊN A/BÊN B trong textarea Điều 1 rồi Lưu, nhưng DOCX dựng
lại vẫn hiện dữ liệu CRM cũ (edit bị ÂM THẦM xoá) vì build_contract_docx() LUÔN tự dựng lại khối Bên A/B từ `parties` khi
clause 0. Fix: chỉ tự dựng lại khi Sale CHƯA sửa gì (khối hiện tại khớp đúng những gì hệ thống sẽ tự sinh); nếu khác thì GIỮ
NGUYÊN văn Sale đã viết, không tự ghi đè bằng CRM mới nhất."""
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from docx import Document
import io

from app.modules.all_platform.services import contract_docx_builder as B
from app.modules.all_platform.services.contract_ai_service import build_parties, format_parties_block

DEAL = {"customer_name": "An", "company_name": "CÔNG TY A", "tax_code": "031", "address": "HCM", "contact_name": "An", "position": "GĐ", "phone": "090", "email": "a@a.vn"}
ISSUER = {"legalName": "MARKEE", "taxCode": "040", "address": "Đà Nẵng", "contactName": "B", "phone": "076", "email": "b@m.vn"}


def doc_of(b): return Document(io.BytesIO(b))


def _texts(docx_bytes):
    return [p.text for p in doc_of(docx_bytes).paragraphs]


def test_auto_generated_block_still_rendered_from_live_parties_when_untouched():
    """Chưa sửa gì (body KHÔNG có khối BÊN A/B) -> vẫn tự dựng từ parties như cũ (hành vi mặc định không đổi)."""
    parties = build_parties(DEAL, None, ISSUER)
    clauses = [{"title": "ĐIỀU 1. THÔNG TIN CÁC BÊN", "body": "Hai bên đủ năng lực."}]
    docx, _ = B.build_contract_docx("HĐ", "HD-1", clauses, parties=parties)
    texts = _texts(docx)
    assert any(t.startswith("Mã số thuế: 031") for t in texts)   # Bên A - từ CRM
    assert any(t.startswith("Mã số thuế: 040") for t in texts)   # Bên B - từ đơn vị phát hành


def test_manually_edited_parties_block_is_preserved_verbatim():
    """Sale gõ sửa trực tiếp (tên/MST khác với CRM hiện tại) -> PHẢI giữ đúng chữ Sale viết, KHÔNG bị ghi đè bằng CRM mới nhất."""
    parties = build_parties(DEAL, None, ISSUER)
    edited_body = (
        "BÊN A (Bên sử dụng dịch vụ): CÔNG TY TNHH ABC MỚI\n- Mã số thuế: 9999999999\n- Địa chỉ: 123 Đường Mới\n"
        "- Đại diện/Người liên hệ: Nguyễn Văn Sửa\n- Điện thoại: 0999999999    Email: sua@abc.vn\n\n"
        "BÊN B (Bên cung cấp dịch vụ): MARKEE\n- Mã số thuế: 040\n- Địa chỉ: Đà Nẵng\n"
        "- Đại diện/Người liên hệ: B\n- Điện thoại: 076    Email: b@m.vn\n\n"
        "Hai bên đủ năng lực pháp lý ký kết hợp đồng (bản Sale đã tự chỉnh)."
    )
    clauses = [{"title": "ĐIỀU 1. THÔNG TIN CÁC BÊN", "body": edited_body}]
    docx, _ = B.build_contract_docx("HĐ", "HD-1", clauses, parties=parties)
    texts = _texts(docx)
    full_text = "\n".join(texts)
    assert "CÔNG TY TNHH ABC MỚI" in full_text and "9999999999" in full_text and "Nguyễn Văn Sửa" in full_text
    assert "bản Sale đã tự chỉnh" in full_text
    # KHÔNG bị thay bằng dữ liệu CRM (MST 031 của DEAL không xuất hiện thay cho bản Sale đã sửa)
    assert not any(t.startswith("Mã số thuế: 031") for t in texts)


def test_edit_in_rep_name_only_still_detected_and_preserved():
    """Chỉ sửa 1 trường nhỏ (vd người đại diện) cũng phải được coi là 'đã sửa' - không chỉ sửa toàn bộ mới được nhận diện."""
    parties = build_parties(DEAL, None, ISSUER)
    auto_block = format_parties_block(parties)
    edited_block = auto_block.replace("- Đại diện/Người liên hệ: An", "- Đại diện/Người liên hệ: Người Ký Khác")
    clauses = [{"title": "ĐIỀU 1. THÔNG TIN CÁC BÊN", "body": edited_block + "\n\nHai bên đồng ý."}]
    docx, _ = B.build_contract_docx("HĐ", "HD-1", clauses, parties=parties)
    full_text = "\n".join(_texts(docx))
    assert "Người Ký Khác" in full_text and "An" not in full_text.split("Đại diện")[1][:30] if "Đại diện" in full_text else True


def test_unedited_block_from_live_generation_round_trip_is_not_flagged_as_manual():
    """Điều 1 vừa được hệ thống tự sinh (generate xong, chưa ai sửa) -> round-trip qua build lại vẫn PHẢI coi là tự động (không bị 'đóng băng' nhầm)."""
    parties = build_parties(DEAL, None, ISSUER)
    auto_block = format_parties_block(parties)
    assert B._parties_edited_manually(auto_block + "\n\nHai bên đồng ý.", parties) is False


def test_parties_edited_manually_false_when_no_block_present():
    assert B._parties_edited_manually("Chỉ có văn bản thường, không có khối Bên A/B.", {"a": {}, "b": {}}) is False
