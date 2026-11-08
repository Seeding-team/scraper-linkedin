"""Bug thật: mẫu DOCX tái sử dụng từ 1 hợp đồng CŨ (khách hàng "Phan Văn Vũ") không dùng {{}} placeholder - MST/Địa chỉ/
Người đại diện/SĐT/Email của Bên A nằm trong bảng 2 cột với chữ THẬT của khách CŨ. Khi Sale chọn khách hàng KHÁC ("thảo")
để tạo hợp đồng mới từ mẫu này, dữ liệu của Phan Văn Vũ (MST 066090021470, SĐT 0988 852 759, email thật...) vẫn còn
nguyên trong bản tạo mới - lộ thông tin khách hàng khác. Test dựng lại ĐÚNG cấu trúc mẫu thật (tên ở đoạn văn thường,
MST/Địa chỉ/Người đại diện/SĐT/Email trong bảng) và xác nhận fill_party_info_tables() ghi đè đúng Bên, không lẫn Bên kia,
không tự đoán khi không xác định được Bên."""
import io
import sys
from pathlib import Path

import pytest
from docx import Document

sys.path.insert(0, str(Path(__file__).parent))

from app.modules.all_platform.services import contract_docx_engine as eng

OLD_CUSTOMER_A = {
    "name": "thảo", "tax_code": "066090021470", "address": "50/59/31 TX25, Khu phố 2, Phường Thới An, TP Hồ Chí Minh",
    "rep": "Ông PHAN VĂN VŨ", "position": "Chủ hộ kinh doanh", "phone": "0988 852 759", "email": "phanvueb@gmail.com",
}
NEW_PARTIES = {
    "a": {"name": "thảo", "tax_code": "", "address": "", "rep": "thảo", "position": "", "phone": "", "email": ""},
    "b": {"name": "MARKEE", "tax_code": "0402336899", "address": "Đà Nẵng", "rep": "DƯƠNG ĐÌNH HUẤN", "position": "Giám đốc",
          "phone": "076 5055 708", "email": "admin@markee.vn"},
}


def _build_template_like_real_bug():
    """Dựng lại cấu trúc giống hệt mẫu thật gây bug: đoạn 'BÊN A' + tên, rồi BẢNG MST/Địa chỉ/Người đại diện/SĐT/Email
    với dữ liệu khách hàng CŨ (Phan Văn Vũ) - không phải {{}} placeholder."""
    doc = Document()
    doc.add_paragraph("BÊN YÊU CẦU DỊCH VỤ (BÊN A):")
    doc.add_paragraph(OLD_CUSTOMER_A["name"])  # tên nằm ở đoạn văn thường - AI đã sửa đúng thành khách mới ở bug gốc
    t = doc.add_table(rows=5, cols=2)
    rows = [("Mã số thuế", f": {OLD_CUSTOMER_A['tax_code']}"), ("Địa chỉ", f": {OLD_CUSTOMER_A['address']}"),
            ("Người đại diện", f": {OLD_CUSTOMER_A['rep']}   Chức vụ: {OLD_CUSTOMER_A['position']}"),
            ("Điện thoại", f": {OLD_CUSTOMER_A['phone']}"), ("Email", f": {OLD_CUSTOMER_A['email']}")]
    for i, (label, value) in enumerate(rows):
        t.rows[i].cells[0].text = label
        t.rows[i].cells[1].text = value
    doc.add_paragraph("BÊN CUNG CẤP DỊCH VỤ (BÊN B):")
    doc.add_paragraph("CÔNG TY CỔ PHẦN MARKEE CŨ")
    t2 = doc.add_table(rows=2, cols=2)
    t2.rows[0].cells[0].text, t2.rows[0].cells[1].text = "Mã số thuế", ": 0000000000"
    t2.rows[1].cells[0].text, t2.rows[1].cells[1].text = "Email", ": cu@old.vn"
    buf = io.BytesIO()
    doc.save(buf)
    return eng.load_document(buf.getvalue())


def test_stale_customer_data_in_table_gets_overwritten_not_leaked():
    doc = _build_template_like_real_bug()
    res = eng.fill_party_info_tables(doc, NEW_PARTIES)
    full_text = "\n".join(p.text for p in doc.paragraphs) + "\n" + "\n".join(c.text for t in doc.tables for r in t.rows for c in r.cells)
    assert "066090021470" not in full_text      # MST của Phan Văn Vũ KHÔNG còn sót lại
    assert "0988 852 759" not in full_text
    assert "phanvueb@gmail.com" not in full_text
    assert "PHAN VĂN VŨ" not in full_text
    assert len(res["filled"]) >= 3               # đã ghi đè được tax_code/address/phone/email (rep bỏ qua vì NEW "a" rep rỗng... xem test dưới)


def test_each_side_filled_from_correct_party_not_mixed_up():
    doc = _build_template_like_real_bug()
    res = eng.fill_party_info_tables(doc, NEW_PARTIES)
    sides = {f["key"]: f["side"] for f in res["filled"]}
    assert sides.get("tax_code") == "b" or "tax_code" not in sides  # Bên A mới không có MST (rỗng, bỏ qua) -> chỉ Bên B có
    full_text = "\n".join(c.text for t in doc.tables for r in t.rows for c in r.cells)
    assert "0402336899" in full_text             # MST Bên B mới (MARKEE) được điền đúng vào bảng Bên B, không lẫn sang Bên A
    assert "admin@markee.vn" in full_text


def test_representative_cell_keeps_position_suffix_structure():
    doc = _build_template_like_real_bug()
    parties = {"a": {**NEW_PARTIES["a"], "rep": "Nguyễn Văn Mới", "position": "Giám đốc mới"}, "b": NEW_PARTIES["b"]}
    eng.fill_party_info_tables(doc, parties)
    full_text = "\n".join(c.text for t in doc.tables for r in t.rows for c in r.cells)
    assert "Nguyễn Văn Mới" in full_text
    assert "PHAN VĂN VŨ" not in full_text
    assert "Chức vụ:" in full_text               # cấu trúc "Chức vụ: ..." phía sau tên vẫn giữ nguyên (chỉ đổi tên)


def test_unresolved_table_counted_when_no_side_marker_before_it():
    doc = Document()
    t = doc.add_table(rows=2, cols=2)             # bảng nhãn/giá trị nhưng KHÔNG có đoạn "BÊN A"/"BÊN B" phía trước
    t.rows[0].cells[0].text, t.rows[0].cells[1].text = "Mã số thuế", ": 999"
    t.rows[1].cells[0].text, t.rows[1].cells[1].text = "Địa chỉ", ": XYZ"
    buf = io.BytesIO(); doc.save(buf)
    doc2 = eng.load_document(buf.getvalue())
    res = eng.fill_party_info_tables(doc2, NEW_PARTIES)
    assert res["filled"] == [] and res["unresolvedTables"] == 1   # KHÔNG tự đoán Bên nào - chỉ báo để Sale tự kiểm tra


def test_no_parties_given_does_nothing():
    doc = _build_template_like_real_bug()
    res = eng.fill_party_info_tables(doc, None)
    assert res == {"filled": [], "unresolvedTables": 0}


# ───────── bảng hạng mục "Phí dịch vụ" (không phải "Đơn giá"/"Thành tiền") giờ nhận diện được ─────────
def test_items_table_detects_phi_dich_vu_column_header():
    doc = Document()
    t = doc.add_table(rows=2, cols=4)
    hdr = t.rows[0].cells
    hdr[0].text, hdr[1].text, hdr[2].text, hdr[3].text = "STT", "Hạng mục", "Phí dịch vụ", "Đơn vị"
    row = t.rows[1].cells
    row[0].text, row[1].text, row[2].text, row[3].text = "1", "Dịch vụ A", "5.000.000", "Tháng"
    buf = io.BytesIO(); doc.save(buf)
    doc2 = eng.load_document(buf.getvalue())
    found = eng.find_items_table(doc2)
    assert found is not None
    _, _, cols = found
    assert "amount" in cols and "desc" in cols


# ───────── bug thật thứ 2 phát hiện khi verify lại trên chính file mẫu thật: tên đại diện MỚI bị "lây" in đậm từ run tên
# CŨ (mẫu thường in đậm riêng phần TÊN, không in đậm nhãn "Chức vụ:" theo sau trong CÙNG 1 ô) ─────────
def _build_rep_cell_with_bold_name_run():
    """Dựng đúng cấu trúc run thật: ': ' (thường) + 'Ông PHAN VĂN VŨ' (ĐẬM, run riêng) + '   Chức vụ: Chủ hộ kinh doanh'
    (thường) trong CÙNG 1 đoạn - giống hệt file PLHD thật đã audit."""
    doc = Document()
    doc.add_paragraph("BÊN YÊU CẦU DỊCH VỤ (BÊN A):")
    doc.add_paragraph("thảo")
    t = doc.add_table(rows=2, cols=2)
    t.rows[0].cells[0].text = "Địa chỉ"
    t.rows[0].cells[1].text = ": 50/59/31 TX25, Khu phố 2, Phường Thới An, TP Hồ Chí Minh"
    t.rows[1].cells[0].text = "Người đại diện"
    p = t.rows[1].cells[1].paragraphs[0]
    p.add_run(": ")
    p.add_run("Ông PHAN VĂN VŨ").bold = True
    p.add_run("   Chức vụ: Chủ hộ kinh doanh")
    buf = io.BytesIO(); doc.save(buf)
    return eng.load_document(buf.getvalue())


def test_rep_name_bold_preserved_without_bleeding_into_chuc_vu():
    doc = _build_rep_cell_with_bold_name_run()
    parties = {"a": {**NEW_PARTIES["a"], "rep": "thảo", "position": ""}, "b": NEW_PARTIES["b"]}
    eng.fill_party_info_tables(doc, parties)
    p = doc.tables[0].rows[1].cells[1].paragraphs[0]
    bold_text = "".join(r.text for r in p.runs if r.bold)
    nonbold_text = "".join(r.text for r in p.runs if not r.bold)
    assert bold_text.strip() == "thảo"                      # tên mới vẫn in đậm như mẫu gốc
    assert "Chức vụ" in nonbold_text and "Chức vụ" not in bold_text   # nhãn "Chức vụ" KHÔNG bị lây in đậm từ run tên cũ
    assert "PHAN VĂN VŨ" not in (bold_text + nonbold_text)


# ───────── bug thật thứ 3 (báo sau khi đã fix bug #2 ở trên): có mẫu KHÔNG tách run tên/nhãn - CẢ dòng "Người đại diện"
# (tên + "Chức vụ: ...") nằm trong 1-2 run ĐẬM GỘP CHUNG, không phải 1 run tên đậm + 1 run nhãn thường tách sẵn như
# file PLHD. Lúc đó replace_range() ghi đè text vào run đậm sẵn có mà KHÔNG tách rPr - "Chức vụ: Giám đốc" vẫn đậm theo
# dù tên đã đúng - phải tách/ép riêng rPr cho phần nhãn, không chỉ dựa vào run gốc nào đó tình cờ không đậm ─────────
def _build_rep_cell_fully_bold_single_run():
    doc = Document()
    doc.add_paragraph("BÊN YÊU CẦU DỊCH VỤ (BÊN A):")
    doc.add_paragraph("thảo")
    t = doc.add_table(rows=2, cols=2)
    t.rows[0].cells[0].text = "Địa chỉ"
    t.rows[0].cells[1].text = ": abc"
    t.rows[1].cells[0].text = "Người đại diện"
    p = t.rows[1].cells[1].paragraphs[0]
    p.add_run(": Ông CŨ").bold = True
    p.add_run("   Chức vụ: Trưởng phòng").bold = True
    buf = io.BytesIO(); doc.save(buf)
    return eng.load_document(buf.getvalue())


def test_rep_chuc_vu_unbolded_even_when_whole_cell_was_one_bold_run():
    doc = _build_rep_cell_fully_bold_single_run()
    parties = {"a": {**NEW_PARTIES["a"], "rep": "thảo", "position": "Giám đốc"}, "b": NEW_PARTIES["b"]}
    eng.fill_party_info_tables(doc, parties)
    p = doc.tables[0].rows[1].cells[1].paragraphs[0]
    bold_text = "".join(r.text for r in p.runs if r.bold)
    nonbold_text = "".join(r.text for r in p.runs if not r.bold)
    assert "thảo" in bold_text                               # tên vẫn đậm
    assert "Chức vụ: Giám đốc" in nonbold_text                # nhãn + giá trị chức vụ KHÔNG đậm, dù gộp chung run gốc
    assert "Chức vụ" not in bold_text
    assert "Ông CŨ" not in (bold_text + nonbold_text) and "Trưởng phòng" not in (bold_text + nonbold_text)


# ───────── bảng chữ ký ('ĐẠI DIỆN BÊN A (Ký, ghi rõ họ tên)' | 'ĐẠI DIỆN BÊN B (...)') KHÔNG bị hiểu lầm thành bảng
# nhãn:giá trị (2 ô đều bắt đầu bằng 'Đại diện' nên lọt qua match nhãn 'rep' nếu không chặn) - nhưng dòng TÊN NGƯỜI KÝ
# ngay dưới đó vẫn phải được cập nhật đúng khách hàng mới (không để sót tên khách CŨ như bug đã audit trên file thật) ─────────
def _build_signature_block():
    doc = Document()
    t = doc.add_table(rows=1, cols=2)
    for col, side_label, old_name in ((0, "ĐẠI DIỆN BÊN A", "PHAN VĂN VŨ"), (1, "ĐẠI DIỆN BÊN B", "CÔNG TY CỔ PHẦN MARKEE CŨ")):
        cell = t.rows[0].cells[col]
        cell.paragraphs[0].text = side_label
        cell.add_paragraph("(Ký, ghi rõ họ tên, đóng dấu)")
        cell.add_paragraph(old_name)
    buf = io.BytesIO(); doc.save(buf)
    return eng.load_document(buf.getvalue())


def test_signature_block_not_treated_as_label_value_table():
    doc = _build_signature_block()
    res = eng.fill_party_info_tables(doc, NEW_PARTIES)
    assert res["unresolvedTables"] == 0                      # không phải bảng nhãn:giá trị -> không báo "chưa xác định Bên"
    keys = {f["key"] for f in res["filled"]}
    assert "rep" not in keys or all(f["key"] != "rep" for f in res["filled"] if f.get("old", "").startswith("ĐẠI DIỆN"))


def test_signature_names_updated_to_new_customer_not_leaked():
    doc = _build_signature_block()
    res = eng.fill_party_info_tables(doc, NEW_PARTIES)
    full_text = "\n".join(c.text for t in doc.tables for r in t.rows for c in r.cells)
    assert "PHAN VĂN VŨ" not in full_text
    sig = [f for f in res["filled"] if f["key"] == "signature_name"]
    assert {f["side"] for f in sig} == {"a", "b"}
    assert any(f["new"] == "thảo" for f in sig)
    assert any(f["new"] == "DƯƠNG ĐÌNH HUẤN" for f in sig)
