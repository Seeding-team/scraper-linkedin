"""BƯỚC 2 KHÔNG ĂN YÊU CẦU: Sale gõ "Thêm Điều 9: ..." ở Bước 2 nhưng Bước 3 không có Điều 9.

Nguyên nhân thật (2 pipeline khác nhau, cả 2 đều nhận đúng extra_prompt tới AI - không phải lỗi
truyền dữ liệu frontend->backend->AI):
1. "Tạo hợp đồng bằng AI" (generate_contract_draft, mode='clauses'): _normalize_to_canonical() cắt
   CỨNG về đúng 7 phần tử theo VỊ TRÍ, nên dù AI đã soạn đúng Điều 9 theo yêu cầu, hàm này ÂM THẦM
   XOÁ nó trước khi trả về FE. Fix: giữ lại các điều khoản THÊM ngoài 7 mục chuẩn.
2. "Dùng mẫu DOCX" (render_from_template/propose_template_edits): pipeline này TRƯỚC ĐÂY chỉ có khả
   năng sửa nội dung đoạn CÓ SẴN (apply_edits thay text theo paragraph id), không có cơ chế CHÈN/XOÁ
   đoạn - không phải lỗi, là giới hạn thiết kế cố ý để giữ bố cục mẫu. Fix tận gốc (round 2, theo yêu
   cầu "AI phải thực hiện được thêm/xóa/sửa điều khoản kể cả khi dùng mẫu DOCX"): thêm khả năng CHÈN
   (eng.apply_structural_changes + eng.renumber_articles) và XOÁ đoạn thật sự vào pipeline mẫu DOCX,
   AI đề xuất qua "inserts"/"deletes" trong cùng JSON response (propose_template_edits), validate bằng
   validate_template_inserts/validate_template_deletes (chặn số liệu bịa, id không tồn tại) trước khi
   áp dụng - giữ nguyên định dạng/font bằng cách clone từ đoạn tiêu đề "ĐIỀU n." gần nhất (tiêu đề mới)
   và từ đoạn anchor (nội dung mới), đúng khuôn đã dùng cho replace_body_paragraphs() (Sửa tự do)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from contract_docx_fixture import build_sample_contract  # noqa: E402

from app.modules.all_platform.services import contract_ai_service as ai
from app.modules.all_platform.services import contract_docx_engine as eng
from app.modules.all_platform.services import contract_docx_pipeline as pipe


# ───────── 1. generate_contract_draft (mode='clauses'): điều khoản THÊM phải được giữ lại ─────────
def test_normalize_to_canonical_keeps_extra_clause_beyond_the_7_standard_ones():
    clauses = [{"title": t, "body": f"noi dung {t}"} for t in ai._CANONICAL_CLAUSE_TITLES]
    clauses.append({"title": "ĐIỀU 9. QUY ĐỊNH KIỂM THỬ HỆ THỐNG TRƯỚC NGHIỆM THU", "body": "Hai bên thống nhất kiểm thử..."})
    out = ai._normalize_to_canonical(clauses)
    assert len(out) == 8
    assert [c["title"] for c in out[:7]] == ai._CANONICAL_CLAUSE_TITLES
    assert out[7]["title"] == "ĐIỀU 9. QUY ĐỊNH KIỂM THỬ HỆ THỐNG TRƯỚC NGHIỆM THU"
    assert "kiểm thử" in out[7]["body"]


def test_normalize_to_canonical_still_works_when_ai_returns_exact_7_in_order():
    clauses = [{"title": t, "body": f"b{i}"} for i, t in enumerate(ai._CANONICAL_CLAUSE_TITLES)]
    out = ai._normalize_to_canonical(clauses)
    assert len(out) == 7
    assert [c["title"] for c in out] == ai._CANONICAL_CLAUSE_TITLES
    assert out[3]["body"] == "b3"


def test_normalize_to_canonical_matches_by_title_even_if_ai_shuffles_order():
    # AI tra dung 7 tieu de chuan nhung LECH THU TU - khop theo tieu de (khong phai vi tri) moi dung noi dung dung Dieu.
    shuffled = list(reversed([{"title": t, "body": f"body-of-{t}"} for t in ai._CANONICAL_CLAUSE_TITLES]))
    out = ai._normalize_to_canonical(shuffled)
    assert [c["title"] for c in out] == ai._CANONICAL_CLAUSE_TITLES
    for c in out:
        assert c["body"] == f"body-of-{c['title']}"


def test_generate_contract_draft_end_to_end_keeps_ai_added_clause(monkeypatch):
    async def fake_chat(system, user):
        assert "Thêm Điều 9" in user   # extra_prompt THẬT SỰ tới AI (không bị rơi dọc đường)
        clauses = [{"title": t, "body": "..."} for t in ai._CANONICAL_CLAUSE_TITLES]
        clauses.append({"title": "ĐIỀU 9. QUY ĐỊNH KIỂM THỬ HỆ THỐNG TRƯỚC NGHIỆM THU", "body": "Nội dung kiểm thử hệ thống trước nghiệm thu."})
        return {"clauses": clauses}

    monkeypatch.setattr(ai, "_call_chat_json", fake_chat)
    import asyncio
    result = asyncio.run(ai.generate_contract_draft(
        deal={"id": "D1", "company_name": "ABC"}, quote=None, template_type="service", detail_level="standard",
        extra_prompt="Thêm Điều 9: Quy định kiểm thử hệ thống trước nghiệm thu",
    ))
    titles = [c["title"] for c in result]
    assert "ĐIỀU 9. QUY ĐỊNH KIỂM THỬ HỆ THỐNG TRƯỚC NGHIỆM THU" in titles
    assert len(result) == 8


# ───────── 2. render_from_template (mode='template'): CHÈN/XOÁ điều khoản thật, không chỉ cảnh báo ─────────
def _find_id(doc, startswith):
    return next(p.id for p in eng.describe_paragraphs(doc) if p.text.startswith(startswith))


def test_insert_clause_at_end_keeps_requested_number_as_is():
    # Chen NGAY SAU dieu khoan CUOI CUNG (Dieu 7) - khong con dieu khoan nao phia sau de bi lech so, nen GIU NGUYEN
    # "Dieu 9" nhu Sale/AI da ghi (dung tinh than "tu cap nhat so thu tu KHI CAN", khong phai luc nao cung ep ve 8).
    doc = eng.load_document(build_sample_contract())
    after = _find_id(doc, "Hợp đồng được lập thành 02 bản")
    res = eng.apply_structural_changes(
        doc, inserts=[{"after_id": after, "title": "ĐIỀU 9. QUY ĐỊNH KIỂM THỬ HỆ THỐNG TRƯỚC NGHIỆM THU",
                        "body": "Hai bên thống nhất kiểm thử hệ thống trước khi nghiệm thu."}],
        deletes=[],
    )
    assert res["renumbered"] == 0
    texts = [p.text for p in eng.describe_paragraphs(doc)]
    assert any(t.startswith("ĐIỀU 9. QUY ĐỊNH KIỂM THỬ") for t in texts)
    assert any("kiểm thử hệ thống trước khi nghiệm thu" in t for t in texts)
    assert any(t.startswith("ĐIỀU 7.") for t in texts)   # dieu cu truoc do khong bi dung


def test_insert_clause_in_the_middle_renumbers_following_articles():
    # Chen VAO GIUA (ngay sau Dieu 3, truoc Dieu 4) -> cac dieu con lai phia sau (4,5,6,7) phai duoc danh so lai
    # thanh (5,6,7,8) de khong bi trung/lech voi dieu moi (se thanh "Dieu 4").
    doc = eng.load_document(build_sample_contract())
    after = _find_id(doc, "3.3. Thời gian triển khai")
    res = eng.apply_structural_changes(
        doc, inserts=[{"after_id": after, "title": "ĐIỀU 4. NGHIỆM THU TẠM THỜI", "body": "Nội dung nghiệm thu tạm thời."}],
        deletes=[],
    )
    assert res["renumbered"] > 0   # cac dieu CU 4,5,6,7 phia sau phai duoc day thanh 5,6,7,8
    titles = [p.text for p in eng.describe_paragraphs(doc) if eng._ARTICLE_HEADING_RE.match(p.text.strip())]
    numbers = [int(eng._ARTICLE_HEADING_RE.match(t).group(1)) for t in titles]
    assert numbers == list(range(1, len(numbers) + 1))   # tuan tu, khong trung/lech
    assert any("NGHIỆM THU TẠM THỜI" in t for t in titles)
    assert any(t.startswith("ĐIỀU 5. TRIỂN KHAI VÀ NGHIỆM THU") for t in titles)   # dieu 4 cu bi day xuong thanh dieu 5


def test_delete_clause_removes_all_its_paragraphs_and_renumbers():
    doc = eng.load_document(build_sample_contract())
    ids = [p.id for p in eng.describe_paragraphs(doc) if p.text.startswith(("ĐIỀU 5.", "5."))]
    assert len(ids) >= 2
    res = eng.apply_structural_changes(doc, inserts=[], deletes=[{"ids": ids}])
    assert res["deletedCount"] == len(ids)
    texts = [p.text for p in eng.describe_paragraphs(doc)]
    assert not any(t.startswith("ĐIỀU 5. BẢO MẬT") for t in texts)
    titles = [t for t in texts if eng._ARTICLE_HEADING_RE.match(t.strip())]
    numbers = [int(eng._ARTICLE_HEADING_RE.match(t).group(1)) for t in titles]
    assert numbers == list(range(1, len(numbers) + 1))


# ───────── 3. Validate: chặn số liệu bịa / id lạ cho inserts & deletes ─────────
def test_validate_template_inserts_blocks_invented_numbers_and_unknown_after_id():
    paras = {"p1": "ĐIỀU 7. ..."}
    ok, bad = ai.validate_template_inserts([
        {"after_id": "p1", "title": "ĐIỀU 9. PHẠT VI PHẠM", "body": "Phạt 25% giá trị hợp đồng nếu vi phạm."},
        {"after_id": "p99", "title": "ĐIỀU 10. X", "body": "..."},
        {"after_id": "p1", "title": "", "body": ""},
    ], paras, allowed_context="Thanh toán 50% khi ký.")
    assert ok == []
    reasons = " | ".join(b["reason"] for b in bad)
    assert "25%" in reasons and "không tồn tại" in reasons and "không có nội dung" in reasons


def test_validate_template_inserts_accepts_clean_request():
    paras = {"p1": "ĐIỀU 7. ..."}
    ok, bad = ai.validate_template_inserts(
        [{"after_id": "p1", "title": "ĐIỀU 9. KIỂM THỬ HỆ THỐNG", "body": "Hai bên thống nhất kiểm thử hệ thống trước khi nghiệm thu."}],
        paras, allowed_context="",
    )
    assert not bad and ok[0]["title"] == "ĐIỀU 9. KIỂM THỬ HỆ THỐNG"


def test_validate_template_deletes_blocks_unknown_ids():
    paras = {"p1": "ĐIỀU 5. ...", "p2": "5.1. ..."}
    ok, bad = ai.validate_template_deletes([{"ids": ["p1", "p2"]}, {"ids": ["p1", "p999"]}], paras)
    assert ok == [{"ids": ["p1", "p2"], "reason": ""}]
    assert bad and "p999" in bad[0]["reason"]


# ───────── 4. render_from_template end-to-end: AI đề xuất insert qua "inserts", pipeline áp dụng thật ─────────
def test_render_from_template_applies_ai_insert_end_to_end():
    sample = build_sample_contract()

    async def ai_fake(paragraphs, deal, quote, prompt):
        after = next(pid for pid, text in paragraphs if text.startswith("Hợp đồng được lập thành 02 bản"))
        return {
            "edits": [],
            "inserts": [{"after_id": after, "title": "ĐIỀU 9. QUY ĐỊNH KIỂM THỬ HỆ THỐNG TRƯỚC NGHIỆM THU",
                          "body": "Hai bên thống nhất kiểm thử hệ thống trước khi nghiệm thu."}],
            "deletes": [],
        }

    import asyncio
    res = asyncio.run(pipe.render_from_template(
        sample, None, None, "Thêm Điều 9: Quy định kiểm thử hệ thống trước nghiệm thu", propose=ai_fake,
    ))
    assert res["inserts"] and "kiểm thử hệ thống" in res["inserts"][-1]
    assert not res["rejectedInserts"]
    new_doc = eng.load_document(res["docx"])
    texts = [p.text for p in eng.describe_paragraphs(new_doc)]
    assert any(t.startswith("ĐIỀU 9. QUY ĐỊNH KIỂM THỬ") for t in texts)
    # dieu khoan cu van con nguyen, khong bi mat
    assert any(t.startswith("ĐIỀU 7.") for t in texts)
    assert any(t.startswith("ĐIỀU 1.") for t in texts)


def test_render_from_template_still_works_with_old_bare_list_propose_fake():
    # Tuong thich nguoc: 1 so test/propose cu tra ve list[dict] thuan (khong co inserts/deletes) - van phai chay binh
    # thuong, khong loi, khong bi coi la co inserts.
    sample = build_sample_contract()

    async def old_style_fake(paragraphs, deal, quote, prompt):
        return []

    import asyncio
    res = asyncio.run(pipe.render_from_template(sample, None, None, "x", propose=old_style_fake))
    assert res["inserts"] == [] and res["deletedCount"] == 0
