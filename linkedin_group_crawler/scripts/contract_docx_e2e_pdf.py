"""Giai đoạn 2 của kiểm thử E2E (chạy TRONG container có LibreOffice): DOCX -> PDF bằng document engine, rồi đối chiếu PDF với DOCX.
Đọc <out>/original.docx và <out>/edited.docx do contract_docx_e2e_render.py tạo; ghi PDF + PNG + pdf_report.json vào <out>.
Engine nạp bằng đường dẫn file (chỉ cần python-docx + pdfplumber), không kéo cả app."""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys

OUT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("eng", os.path.join(HERE, "..", "app", "modules", "all_platform", "services", "contract_docx_engine.py"))
eng = importlib.util.module_from_spec(spec)
sys.modules["eng"] = eng
spec.loader.exec_module(eng)


def nows(s: str) -> str:
    return re.sub(r"\s+", "", s)


def docx_paragraph_texts(path: str) -> list[str]:
    doc = eng.load_document(open(path, "rb").read())
    return [p.text for p in eng.describe_paragraphs(doc) if p.text.strip()]


report: dict = {"sofficeFound": bool(eng.find_soffice())}
for name in ("original", "edited"):
    docx = open(os.path.join(OUT, f"{name}.docx"), "rb").read()
    pdf = eng.convert_docx_to_pdf(docx)
    open(os.path.join(OUT, f"{name}.pdf"), "wb").write(pdf)
    pages = eng.pdf_page_count(pdf)
    text = eng.pdf_text(pdf)
    paras = docx_paragraph_texts(os.path.join(OUT, f"{name}.docx"))
    flat = nows(text)
    words = set(re.findall(r"\w+", text))
    # đoạn vắt qua 2 trang bị xen header/footer, ô bảng bị ngắt dòng -> so theo TỪ: mọi từ của đoạn phải có trong PDF
    missing = [p[:70] for p in paras if not set(re.findall(r"\w+", p)) <= words]
    fonts = subprocess.run(["pdffonts", os.path.join(OUT, f"{name}.pdf")], capture_output=True, text=True).stdout.strip().splitlines()[2:]
    subprocess.run(["pdftoppm", "-r", "60", "-png", os.path.join(OUT, f"{name}.pdf"), os.path.join(OUT, f"{name}_page")], check=False)
    report[name] = {
        "pages": pages, "docxParagraphsMissingInPdf": missing, "paragraphsChecked": len(paras),
        "pdfFonts": [re.split(r"\s{2,}", f.strip())[0] for f in fonts], "fontReport": eng.font_report(docx),
        "hasHeader": "HỢP ĐỒNG DỊCH VỤ" in text, "hasPageNumberFooter": bool(re.search(r"Trang\s*\d", text)),
        "vietnameseOk": all(w in text for w in ("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", "Độc lập - Tự do - Hạnh phúc", "ĐẠI DIỆN BÊN A")),
    }
edited_text = eng.pdf_text(open(os.path.join(OUT, "edited.pdf"), "rb").read())
report["editedPdfChecks"] = {
    "customerFilled": "CÔNG TY CỔ PHẦN GIẢI PHÁP ÁNH DƯƠNG" in edited_text and "0312345678" in edited_text,
    "itemRows": all(set(re.findall(r"\w+", x)) <= set(re.findall(r"\w+", edited_text)) for x in ("Thiết kế bộ nhận diện thương hiệu", "Chiến dịch quảng cáo đa kênh (3 tháng)", "Quản trị fanpage và sản xuất nội dung")),
    "totalsRow": "205.700.000" in edited_text.replace(" ", ""),
    "paymentEdited": "50% khi ký hợp đồng" in edited_text.replace("\n", " ") or "50%khiký" in nows(edited_text),
    "noLeftoverPlaceholder": "{{" not in edited_text,
    "unauthorisedPenaltyAbsent": "25%" not in edited_text,
    "signatureBlock": "ĐẠI DIỆN BÊN A" in edited_text and "ĐẠI DIỆN BÊN B" in edited_text,
}
json.dump(report, open(os.path.join(OUT, "pdf_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(report, ensure_ascii=False, indent=1))
