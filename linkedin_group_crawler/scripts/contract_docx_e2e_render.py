"""Giai đoạn 1 của kiểm thử E2E (chạy trên host, KHÔNG cần AI/mạng): dựng mẫu DOCX thực tế -> chạy pipeline với AI giả lập
-> ghi original.docx + edited.docx + report.json vào thư mục đích. Giai đoạn 2 (docker có LibreOffice) chuyển PDF và đối chiếu:
  docker run --rm -v <repo>:/repo -v <out>:/out contract-lo-test python /repo/linkedin_group_crawler/scripts/contract_docx_e2e_pdf.py /out
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))

from contract_docx_fixture import SAMPLE_DEAL, SAMPLE_QUOTE, build_sample_contract  # noqa: E402
from app.modules.all_platform.services import contract_docx_engine as eng  # noqa: E402
from app.modules.all_platform.services.contract_docx_pipeline import render_from_template  # noqa: E402

PROMPT = "Thanh toán 50% khi ký, 40% khi bàn giao và 10% sau nghiệm thu. Thời gian triển khai 45 ngày."


async def fake_ai(paragraphs, deal, quote, extra_prompt):
    """Giả lập AI: đề xuất đúng yêu cầu của Sale + 1 đề xuất VI PHẠM (tự bịa phạt 25%) để kiểm tra chốt chặn."""
    by_text = {t: i for i, t in paragraphs}
    pay = next(i for t, i in by_text.items() if t.startswith("3.1."))
    days = next(i for t, i in by_text.items() if t.startswith("3.3."))
    pen = next(i for t, i in by_text.items() if t.startswith("6.1."))
    return [
        {"id": pay, "text": "3.1. Bên A thanh toán giá trị hợp đồng làm 03 đợt: đợt 1 là 50% khi ký hợp đồng; đợt 2 là 40% khi bàn giao; đợt 3 là 10% sau nghiệm thu.", "reason": "theo yêu cầu Sale"},
        {"id": days, "text": "3.3. Thời gian triển khai dự kiến 45 ngày kể từ ngày hợp đồng có hiệu lực.", "reason": "theo yêu cầu Sale"},
        {"id": pen, "text": "6.1. Bên vi phạm phải chịu phạt 25% giá trị hợp đồng.", "reason": "AI tự thêm (phải bị chặn)"},
    ]


async def main(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    original = build_sample_contract()
    res = await render_from_template(original, SAMPLE_DEAL, SAMPLE_QUOTE, PROMPT, contract_number="HD-2026-0042", contract_value=205_700_000, propose=fake_ai, sign_date="2026-10-09")
    open(os.path.join(out_dir, "original.docx"), "wb").write(original)
    open(os.path.join(out_dir, "edited.docx"), "wb").write(res["docx"])
    report = {k: v for k, v in res.items() if k != "docx"}
    report["fingerprintOriginal"] = {k: str(v) for k, v in eng.fingerprint(eng.load_document(original)).items()}
    report["fingerprintEdited"] = {k: str(v) for k, v in eng.fingerprint(eng.load_document(res["docx"])).items()}
    json.dump(report, open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("edits:", len(res["edits"]), "| rejected:", [(r["id"], r["reason"][:60]) for r in res["rejectedEdits"]])
    print("items:", res["itemsTable"]["rows"], "| structure:", res["structure"], "| warnings:", res["warnings"])


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
