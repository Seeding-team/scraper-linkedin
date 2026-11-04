"""AI Highlight hop dong (2026-10-26, Phan B4) - to mau DIRECTLY tren 1 BAN SAO (khong bao gio
dung file goc) theo DUNG dinh dang nguon: DOCX -> DOCX, PDF -> PDF. KHONG gioi han o PDF (nguyen
tac #8 trong plan).

Nguyen tac bat buoc:
  - KHONG BAO GIO sua file dau vao - moi ham nhan `bytes` va tra ve `bytes` MOI, file goc (trong
    contract-documents/crm-attachments) khong he bi dong.
  - Neu KHONG dinh vi duoc 1 doan trich dan (`source_excerpt`) trong noi dung - BO QUA, khong to
    mau nham (nguyen tac #4) - tra ve danh sach "khong dinh vi duoc" rieng de bao Sale biet ro.
  - (2026-10-27, gop y UX "dung but highlight that") MAU DUY NHAT cho moi doan AI xac dinh duoc:
    vang da quang HIGHLIGHT_COLOR (#FFF176) - giong dung but highlight giay that, khong dung
    nhieu mau xanh/do/vang nhat theo verdict nhu truoc (nhin nhat, khong giong highlight that).
    Phan loai Khop/Sai lech/Can kiem tra chuyen hoan toan sang BADGE mau o panel ket qua ben
    phai (FE), KHONG con the hien qua mau to trong tai lieu nua.

DOCX: tai dung CHINH XAC ky thuat XML tho da co tien le trong contract_docx_engine.py
(_set_run_bold/_text_runs/_run_text/replace_range) - KHONG dung python-docx cap cao
(run.font.highlight_color chi co 15 mau co dinh) ma dung <w:shd> (mau tuy y).
"""
from __future__ import annotations

import copy
from typing import Any

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from app.core.logger import get_logger
from app.modules.all_platform.services.contract_docx_engine import (
    _run_text,
    _text_runs,
    global_paragraph_index,
)

logger = get_logger(__name__)

# Mau but highlight DUY NHAT (2026-10-27) - khong con phan biet theo verdict, xem docstring dau
# file.
HIGHLIGHT_COLOR = "FFF176"


def _set_run_shading(run_el: Any, hex_color: str | None) -> None:
    """Them/bo <w:shd> (to nen mau tuy y, KHAC run.font.highlight_color chi co 15 mau co dinh)
    vao <w:rPr> cua 1 run - cung khuon voi _set_run_bold() trong contract_docx_engine.py, chi
    them 1 thuoc tinh vao <w:rPr> da ton tai, KHONG dung gi khac trong run (bang/anh/header-footer
    khong bi anh huong, giong nguyen tac da xac nhan qua tien le co san)."""
    rpr = run_el.find(qn("w:rPr"))
    if rpr is None:
        rpr = OxmlElement("w:rPr")
        run_el.insert(0, rpr)
    shd = rpr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        rpr.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)


def _split_run_at(run_el: Any, split_pos: int) -> Any:
    """Tach run_el tai vi tri split_pos (trong text cua CHINH run do) thanh 2 run (giu nguyen
    rPr) - tra ve run SAU diem tach (phan truoc giu nguyen element goc). Khong lam gi neu
    split_pos o bien (0 hoac het do dai)."""
    t_el = run_el.find(qn("w:t"))
    text = t_el.text or ""
    if split_pos <= 0:
        return run_el
    if split_pos >= len(text):
        return None  # khong co phan "sau" de tach
    before_text, after_text = text[:split_pos], text[split_pos:]
    t_el.text = before_text
    t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    new_r = copy.deepcopy(run_el)
    new_r.find(qn("w:t")).text = after_text
    run_el.addnext(new_r)
    return new_r


def _apply_shading_range(p_el: Any, start: int, end: int, hex_color: str) -> None:
    """To mau nen cho dung vung [start, end) trong text cua 1 doan (p_el) - tach run o ca 2 bien
    neu can (khong trung bien run co san), cac phan khac cua run GIU NGUYEN rPr cu. Mo phong dung
    thuat toan span-tracking cua replace_range() trong contract_docx_engine.py."""
    runs = _text_runs(p_el)
    spans: list[tuple[Any, int, int]] = []
    pos = 0
    for r in runs:
        t = _run_text(r)
        spans.append((r, pos, pos + len(t)))
        pos += len(t)
    for r, rs, re_ in spans:
        if re_ <= start or rs >= end:
            continue
        local_start = max(start, rs) - rs
        local_end = min(end, re_) - rs
        text_len = re_ - rs
        target = r
        if local_end < text_len:
            _split_run_at(target, local_end)
        if local_start > 0:
            target = _split_run_at(target, local_start)
        if target is not None:
            _set_run_shading(target, hex_color)


def _hex_to_rgb01(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def highlight_pdf_text(pdf_bytes: bytes, findings: list[dict[str, Any]]) -> tuple[bytes, dict[str, Any]]:
    """PDF "text" (co text layer that, xac dinh truoc qua classify_pdf_template()=='text') - dung
    PyMuPDF `page.search_for()` de dinh vi CHINH XAC bbox cua excerpt (PyMuPDF tu lam ca viec doc
    LAN ve, khong can ghep pdfplumber (doc) + thu vien khac (ve) nhu ban dau du tinh - don gian +
    it rui ro lech he toa do hon). `add_highlight_annot()` tao highlight that (nguoi dung van
    chon/copy duoc text ben duoi, dung tinh than "highlight" that su cho PDF co text).

    Tra ve them (2026-10-27, fix "khong bao thanh cong gia"): dict {located, notLocated, pages}
    - `pages` map field -> so trang 1-based. KHONG chen/xoa/doi thu tu trang nao (gop y UX
    2026-10-27: "Khong duoc tao them bang tong hop vao dau hop dong... giu nguyen bo cuc goc" -
    bo han buoc chen trang bao cao, file Highlight CHI la ban sao duoc to mau, bao cao
    field/verdict/trich dan CHI hien o panel ket qua AI ben phai + API response, khong nhet vao
    chinh file hop dong nua)."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    located: list[dict[str, Any]] = []
    not_located: list[dict[str, Any]] = []
    pages: dict[str, int] = {}

    for finding in findings:
        excerpt = (finding.get("sourceExcerpt") or "").strip()
        if not excerpt:
            not_located.append(finding)
            continue
        color = HIGHLIGHT_COLOR
        found = False
        for page in doc:
            rects = page.search_for(excerpt)
            if rects:
                annot = page.add_highlight_annot(rects)
                annot.set_colors(stroke=_hex_to_rgb01(color))
                annot.update()
                found = True
                if finding.get("field"):
                    pages[finding["field"]] = page.number + 1  # 1-based, KHONG offset (khong con trang chen them)
                break
        (located if found else not_located).append(finding)

    out = doc.tobytes()
    doc.close()
    meta = {
        "located": [f.get("field") for f in located], "notLocated": [f.get("field") for f in not_located], "pages": pages,
    }
    return out, meta


def highlight_pdf_scan(pdf_bytes: bytes, findings: list[dict[str, Any]], dpi: int = 200) -> tuple[bytes, dict[str, Any]]:
    """PDF "scan" (anh, KHONG co text layer that - pdfplumber khong doc duoc) - render tung trang
    ra anh (fitz.get_pixmap), chay Tesseract OCR CO TOA DO (pytesseract.image_to_data, khac han
    extract_contract_fields_full() chi lay text thuan) de tim bbox THAT cua excerpt trong anh, quy
    doi ve toa do PDF (diem, 72dpi) roi ve 1 hinh chu nhat mo (khong dung add_highlight_annot vi
    trang nay KHONG co text object that de "chon" - add_highlight_annot danh cho PDF co text).
    Neu OCR khong du tin cay (khong tim thay chuoi khop) -> KHONG to mau (nguyen tac #4), dua vao
    not_located."""
    import fitz
    import pytesseract
    from PIL import Image
    import io as _io

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    located: list[dict[str, Any]] = []
    not_located: list[dict[str, Any]] = []
    pages: dict[str, int] = {}
    scale = 72.0 / dpi

    for finding in findings:
        excerpt = (finding.get("sourceExcerpt") or "").strip()
        if not excerpt:
            not_located.append(finding)
            continue
        color = HIGHLIGHT_COLOR
        excerpt_tokens = excerpt.split()
        found = False
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            img = Image.open(_io.BytesIO(pix.tobytes("png")))
            data = pytesseract.image_to_data(img, lang="vie", output_type=pytesseract.Output.DICT)
            words = data["text"]
            n = len(words)
            # Tim day lien tiep cac tu OCR khop VOI excerpt_tokens (so sanh loi long, bo qua dau
            # cau khac biet nho do OCR khong hoan hao) - CHI chap nhan neu khop DU SO TU, khong
            # chap nhan khop 1 phan de tranh to sai vi tri (nguyen tac #4).
            for start in range(n):
                if not words[start].strip():
                    continue
                matched = 0
                boxes = []
                j = start
                for tok in excerpt_tokens:
                    while j < n and not words[j].strip():
                        j += 1
                    if j >= n:
                        break
                    ocr_word = words[j].strip().strip(".,;:()\"'")
                    if ocr_word.lower() == tok.strip().strip(".,;:()\"'").lower():
                        boxes.append((data["left"][j], data["top"][j], data["width"][j], data["height"][j]))
                        matched += 1
                        j += 1
                    else:
                        break
                if matched == len(excerpt_tokens) and boxes:
                    left = min(b[0] for b in boxes)
                    top = min(b[1] for b in boxes)
                    right = max(b[0] + b[2] for b in boxes)
                    bottom = max(b[1] + b[3] for b in boxes)
                    rect = fitz.Rect(left * scale, top * scale, right * scale, bottom * scale)
                    page.draw_rect(rect, color=None, fill=_hex_to_rgb01(color), fill_opacity=0.4, overlay=True)
                    found = True
                    if finding.get("field"):
                        pages[finding["field"]] = page.number + 1  # 1-based, khong offset
                    break
            if found:
                break
        (located if found else not_located).append(finding)

    out = doc.tobytes()
    doc.close()
    meta = {
        "located": [f.get("field") for f in located], "notLocated": [f.get("field") for f in not_located], "pages": pages,
    }
    return out, meta


def _group_paragraphs_into_search_units(doc: Any) -> list[list[Any]]:
    """Nhom cac <w:p> thanh "don vi tim kiem" KHOP VOI DUNG THU TU extract_contract_fields_full()
    da duyet de dung text trich xuat (_extract_docx_text: `doc.paragraphs` truoc, roi
    `for table in doc.tables: for row in table.rows: for cell in row.cells: parts.append(cell.text)`
    - CHU Y row.cells LAP LAI cung 1 o cho cac cot bi GOP NGANG (gridSpan/merge), can giu dung
    hanh vi lap nay thi vi tri excerpt moi khop chinh xac).

    BUG THAT DA GAP (xac nhan qua test that voi file HD/2026/0007, khong phai doan):
    1. Nhan "Mã số thuế" va gia tri ": 0317945970" nam o 2 O KE NHAU trong CUNG 1 HANG bang (bang
       2 cot nhan/gia tri rat pho bien trong mau hop dong tieng Viet) - KHONG phai 2 doan trong
       CUNG 1 o. Don vi tim kiem phai gom theo HANG (row.cells) chu khong phai theo O rieng le.
    2. Hang "TỔNG CỘNG..." co o bi gop ngang (nhan xuat hien 2 LAN lien tiep trong `row.cells` do
       python-docx lap lai cell cho cot bi merge) - duyet truc tiep qua `<w:tc>` xml tho (khong
       qua `row.cells`) se MAT di lan lap nay, lam text don vi tim kiem THIEU 1 doan so voi excerpt
       (vd excerpt co nhan 2 lan, don vi tai tao chi co 1 lan) -> khong bao gio khop. Fix: duyet
       CHINH XAC qua `row.cells` (python-docx, giu nguyen hanh vi lap) thay vi doc XML tho qua
       <w:tr>, dung 100% cung 1 duong di voi _extract_docx_text()."""
    units: list[list[Any]] = []
    for p in doc.paragraphs:  # cap body, KHONG nam trong bang (python-docx tu loai tru)
        units.append([p._p])
    for table in doc.tables:
        for row in table.rows:
            row_paragraphs: list[Any] = []
            for cell in row.cells:  # LAP LAI dung voi _extract_docx_text() khi cot bi gop ngang
                row_paragraphs.extend(p._p for p in cell.paragraphs)
            if row_paragraphs:
                units.append(row_paragraphs)
    return units


def _unit_text_and_bounds(paragraphs: list[Any]) -> tuple[str, list[tuple[int, int]]]:
    texts: list[str] = []
    bounds: list[tuple[int, int]] = []
    pos = 0
    for i, p_el in enumerate(paragraphs):
        t = "".join(_run_text(r) for r in _text_runs(p_el))
        bounds.append((pos, pos + len(t)))
        texts.append(t)
        pos += len(t) + (1 if i < len(paragraphs) - 1 else 0)  # +1 cho ky tu "\n" noi (dung voi cell.text)
    return "\n".join(texts), bounds


def _apply_shading_across_unit(paragraphs: list[Any], bounds: list[tuple[int, int]], start: int, end: int, color: str) -> None:
    for p_el, (b_start, b_end) in zip(paragraphs, bounds):
        if b_end <= start or b_start >= end:
            continue
        local_start = max(start, b_start) - b_start
        local_end = min(end, b_end) - b_start
        _apply_shading_range(p_el, local_start, local_end, color)


def _find_excerpt_span(haystack: str, needle: str) -> tuple[int, int] | None:
    """Tim vi tri (start, end) cua needle trong haystack:
    1) Khop chinh xac 100%
    2) Khop khong phan biet hoa/thuong (phong khi AI tra 'Công ty TNHH...' nhung DOCX viet hoa 'CÔNG TY TNHH...')
    3) Khop linh hoat khoang trang/xuong dong giua cac tu."""
    import re as _re

    idx = haystack.find(needle)
    if idx != -1:
        return idx, idx + len(needle)
    idx_ci = haystack.lower().find(needle.lower())
    if idx_ci != -1:
        return idx_ci, idx_ci + len(needle)
    tokens = [tok for tok in needle.split() if tok]
    if tokens:
        pattern = r"\s+".join(_re.escape(tok) for tok in tokens)
        m = _re.search(pattern, haystack, _re.IGNORECASE)
        if m:
            return m.start(), m.end()
    return None


def highlight_docx(docx_bytes: bytes, findings: list[dict[str, Any]]) -> tuple[bytes, dict[str, Any]]:
    """Tra ve bytes DOCX MOI (ban sao, KHONG dung file dau vao, GIU NGUYEN bo cuc/bang/anh/
    header-footer - CHI them <w:shd> vao run da to mau cho cac doan trung voi `sourceExcerpt`
    cua tung finding, xem _group_paragraphs_into_search_units). KHONG chen trang/bang bao cao nao
    vao file (gop y UX 2026-10-27: "khong duoc tao them bang tong hop vao dau hop dong, lam mat
    bo cuc goc" - bao cao field/verdict/trich dan CHI hien o panel ket qua AI + API response).
    Finding khong co excerpt hoac khong tim thay duoc trong tai lieu -> liet ke rieng trong
    `not_located`, KHONG to mau doan nao khac.

    Tra ve them dict {located, notLocated, pages, pageLookupError}: `pages` xac dinh BAN SAO
    sau khi convert PDF de xem (LibreOffice, cung engine dung cho preview that) roi tim lai
    CHINH excerpt da to mau bang PyMuPDF search_for() - best-effort (khong anh huong file DOCX
    Highlight da tao, chi phuc vu dieu huong "click finding -> dung trang" o FE); loi convert
    duoc bao trong `pageLookupError` thay vi im lang bo qua."""
    from io import BytesIO

    doc = Document(BytesIO(docx_bytes))
    located: list[dict[str, Any]] = []
    not_located: list[dict[str, Any]] = []
    units = _group_paragraphs_into_search_units(doc)
    # (2026-10-27, Word Editor) anchor = vi tri PARAGRAPH TOAN CUC ("p{i}", khop voi
    # contract_docx_engine.describe_paragraphs/paragraph_by_id) + offset ky tu CUC BO trong
    # DUNG doan do - dung de gan paragraph_anchor/char_start/char_end khi tao annotation AI
    # (contract_ai_review_service), KHONG chi dua vao sourceExcerpt de dinh vi lai ve sau.
    anchors: dict[str, dict[str, Any]] = {}

    for finding in findings:
        excerpt = (finding.get("sourceExcerpt") or "").strip()
        if not excerpt:
            not_located.append(finding)
            continue
        color = HIGHLIGHT_COLOR
        found_any = False
        for paragraphs in units:
            if len(paragraphs) == 1:
                full_text = "".join(_run_text(r) for r in _text_runs(paragraphs[0]))
                span_match = _find_excerpt_span(full_text, excerpt)
                if span_match is None:
                    continue
                m_start, m_end = span_match
                _apply_shading_range(paragraphs[0], m_start, m_end, color)
                anchor_p_el, local_start, local_end = paragraphs[0], m_start, m_end
            else:
                combined, bounds = _unit_text_and_bounds(paragraphs)
                span_match = _find_excerpt_span(combined, excerpt)
                if span_match is None:
                    continue
                m_start, m_end = span_match
                _apply_shading_across_unit(paragraphs, bounds, m_start, m_end, color)
                # Neo vao DUNG doan (cell) chua KY TU DAU TIEN cua excerpt trong unit nhieu doan
                # (hang bang) - char_start/char_end quy doi ve cuc bo trong doan do, kep trong
                # bien doan neu excerpt tran sang doan ke (hiem, do +1 noi "\n" giua cac doan).
                anchor_p_el = paragraphs[0]
                local_start, local_end = m_start, m_end
                for p_el, (b_start, b_end) in zip(paragraphs, bounds):
                    if b_start <= m_start < b_end:
                        anchor_p_el = p_el
                        local_start = m_start - b_start
                        local_end = min(m_end, b_end) - b_start
                        break
            found_any = True
            if finding.get("field"):
                gidx = global_paragraph_index(doc, anchor_p_el)
                anchors[finding["field"]] = {
                    "paragraphAnchor": f"p{gidx}" if gidx is not None else None,
                    "charStart": local_start, "charEnd": local_end,
                }
            break  # chi to mau LAN XUAT HIEN DAU TIEN - tranh to trung nhieu cho neu cau lap lai
        (located if found_any else not_located).append(finding)

    out = BytesIO()
    doc.save(out)
    out_bytes = out.getvalue()

    pages: dict[str, int] = {}
    page_lookup_error: str | None = None
    try:
        from app.modules.all_platform.services.contract_docx_engine import convert_docx_to_pdf
        import fitz

        pdf_bytes = convert_docx_to_pdf(out_bytes)
        pdoc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for f in located:
            field = f.get("field")
            excerpt = (f.get("sourceExcerpt") or "").strip()
            if not field or not excerpt:
                continue
            candidates = [excerpt] + [ln.strip() for ln in excerpt.splitlines() if len(ln.strip()) >= 4]
            for page in pdoc:
                if any(page.search_for(cand) for cand in candidates):
                    pages[field] = page.number + 1
                    break
        pdoc.close()
    except Exception as exc:  # noqa: BLE001 - khong lam hong file Highlight da to mau xong, chi thieu dieu huong trang
        page_lookup_error = str(exc)
        logger.warning("Khong xac dinh duoc so trang PDF (preview) cho DOCX Highlight: %s", exc)

    meta = {
        "located": [f.get("field") for f in located], "notLocated": [f.get("field") for f in not_located],
        "pages": pages, "pageLookupError": page_lookup_error, "anchors": anchors,
    }
    return out_bytes, meta
