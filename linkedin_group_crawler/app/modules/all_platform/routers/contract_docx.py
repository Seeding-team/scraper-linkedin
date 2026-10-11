"""Endpoint tài liệu hợp đồng theo MẪU: render DOCX từ mẫu (AI đề xuất + document engine áp), xuất PDF từ chính DOCX, lưu phiên bản.

Không đổi CRUD hợp đồng. PDF luôn là chuyển đổi từ DOCX; không có LibreOffice thì trả lỗi rõ ràng (pdfError), KHÔNG dựng PDF cách khác."""
from __future__ import annotations

import asyncio
import base64
import json
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.logger import get_logger
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import contract_docx_engine as eng
from app.modules.all_platform.services import contract_document_store as store
from app.modules.all_platform.services import contract_source_service as source
from app.modules.all_platform.services.contract_ai_service import _format_deal_context, _format_quote_context, propose_clause_edit
from app.modules.all_platform.services.contract_docx_pipeline import render_from_template
from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

logger = get_logger(__name__)
contract_docx_router = APIRouter()

_MAX_BYTES = 10 * 1024 * 1024
DOCX_MIME = store.DOCX_MIME


def _b64(data: bytes | None) -> str | None:
    return base64.b64encode(data).decode("ascii") if data else None


def _try_pdf(docx: bytes) -> tuple[bytes | None, str | None]:
    try:
        return eng.convert_docx_to_pdf(docx), None
    except (eng.PdfEngineUnavailable, ValueError) as exc:
        return None, str(exc)


async def _try_pdf_async(docx: bytes) -> tuple[bytes | None, str | None]:
    """soffice có thể chạy vài chục giây: đẩy sang thread để không chặn event loop của cả backend."""
    return await asyncio.to_thread(_try_pdf, docx)


@contract_docx_router.get("/health")
async def engine_health(deep: bool = False):
    """Health check engine PDF (LibreOffice). Nông (mặc định, không cần đăng nhập, rất nhẹ): soffice + version + font Việt.
    Sâu (?deep=true): chuyển thử DOCX tiếng Việt -> PDF (cache 5 phút) - dùng cho smoke test sau deploy. HTTP 503 khi engine không dùng được."""
    result = await asyncio.to_thread(eng.health_check, deep)
    return Response(content=json.dumps(result, ensure_ascii=False), media_type="application/json", status_code=200 if result["ok"] else 503)


def _editable_paragraphs(docx: bytes) -> list[dict]:
    """Đoạn thân tài liệu (không nằm trong bảng, có chữ) để người dùng chọn sửa riêng từng đoạn."""
    return [{"id": p.id, "text": p.text} for p in eng.describe_paragraphs(eng.load_document(docx)) if p.text.strip() and not p.in_table]


@contract_docx_router.post("/extract-reference")
async def extract_reference(file: UploadFile = File(...), _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Mẫu PDF/DOCX tải lên để AI THAM CHIẾU văn phong khi soạn mới. PDF text: trích nội dung; PDF scan: CHƯA hỗ trợ (không có OCR đáng tin cậy);
    PDF form: trích text nhưng không điền form. Không bao giờ giữ nguyên form PDF."""
    try:
        name, content = file.filename or "template", await file.read()
        if len(content) > _MAX_BYTES:
            return BaseResponse(success=False, message="File quá lớn - tối đa 10MB.")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext == "pdf":
            info = eng.classify_pdf_template(content)
            if info["kind"] == "scan":
                return BaseResponse(success=False, message="PDF là ảnh scan - hệ thống chưa hỗ trợ OCR đáng tin cậy. Hãy dùng bản DOCX hoặc PDF dạng text.")
            from app.modules.all_platform.services.contract_template_service import extract_text_from_file

            _, text = extract_text_from_file(name, content)
            if not text.strip():
                return BaseResponse(success=False, message="Không trích được nội dung từ PDF này.")
            return BaseResponse(success=True, data={**info, "text": text[:20000], "usage": "reference-only"})
        return BaseResponse(success=False, message="Chỉ dùng cho mẫu PDF. Mẫu .docx dùng chế độ chỉnh trực tiếp để giữ bố cục.")
    except ValueError as exc:
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("extract_reference failed")
        return BaseResponse(success=False, message=f"Không đọc được file: {exc}")


class ProposeEditRequest(BaseModel):
    text: str
    instruction: str
    neighbors: str = ""
    deal_id: str = ""
    quote_id: str = ""
    customer_id: str = ""


@contract_docx_router.post("/propose-edit")
async def propose_edit(payload: ProposeEditRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI chỉnh RIÊNG 1 điều khoản/đoạn theo yêu cầu: trả trước/sau + cờ rủi ro (số liệu/chủ đề pháp lý). KHÔNG áp vào tài liệu - người dùng phải chấp nhận."""
    try:
        if not payload.instruction.strip():
            return BaseResponse(success=False, message="Hãy nhập yêu cầu chỉnh sửa cho phần này.")
        deal, quote = source.resolve_source(payload.deal_id or None, payload.quote_id or None, payload.customer_id or None) if (payload.deal_id or payload.quote_id) else (None, None)
        proposal = await propose_clause_edit(payload.text, payload.instruction, payload.neighbors, deal, quote)
        if not proposal["text"]:
            return BaseResponse(success=False, message="AI không đề xuất được nội dung mới - thử mô tả cụ thể hơn.")
        # Số do chính người dùng gõ trong yêu cầu được xem là nguồn hợp lệ; số do AI tự thêm thì bị chặn
        ctx = " ".join([_format_deal_context(deal), _format_quote_context(quote), payload.instruction])
        risk = source.edit_risk_flags(payload.text, proposal["text"], ctx)
        return BaseResponse(success=True, data={"before": payload.text, "after": proposal["text"], "reason": proposal["reason"], **risk})
    except source.SourceError as exc:
        return BaseResponse(success=False, message=str(exc))
    except RuntimeError as exc:
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("propose_edit failed")
        return BaseResponse(success=False, message=f"Không chỉnh được: {exc}")


class ApplyParagraphRequest(BaseModel):
    docx_base64: str
    paragraph_id: str
    text: str


@contract_docx_router.post("/apply-paragraph")
async def apply_paragraph(payload: ApplyParagraphRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Áp CHỈ đoạn đã chọn (người dùng đã chấp nhận) vào bản sao DOCX; giữ bố cục; trả DOCX + PDF mới cùng nội dung."""
    try:
        from app.modules.all_platform.services.contract_docx_pipeline import verify_structure

        original = base64.b64decode(payload.docx_base64)
        doc = eng.load_document(original)
        if not payload.text.strip():
            return BaseResponse(success=False, message="Không cho phép để trống nội dung đoạn.")
        applied = eng.apply_edits(doc, [{"id": payload.paragraph_id, "text": payload.text}])
        if not applied:
            return BaseResponse(success=False, message="Không áp dụng được (đoạn không tồn tại hoặc nội dung không đổi).")
        result = eng.save_document(doc)
        structure = verify_structure(original, result)
        pdf, pdf_error = await _try_pdf_async(result)
        return BaseResponse(success=True, data={
            "docxBase64": _b64(result), "pdfBase64": _b64(pdf), "pdfError": pdf_error, "pages": eng.pdf_page_count(pdf) if pdf else None,
            "applied": applied[0], "structure": structure, "layoutPreserved": structure["preserved"], "paragraphs": _editable_paragraphs(result),
        })
    except ValueError as exc:
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("apply_paragraph failed")
        return BaseResponse(success=False, message=f"Không áp dụng được: {exc}")


class ReplaceBodyRequest(BaseModel):
    docx_base64: str
    lines: list[str]


@contract_docx_router.post("/replace-body")
async def replace_body(payload: ReplaceBodyRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Sửa TỰ DO toàn bộ đoạn văn thân tài liệu (không giới hạn số dòng - cho thêm/bớt đoạn tuỳ ý), dùng khi sửa 1 hợp
    đồng ĐÃ TẠO (không phải lúc render mẫu lần đầu). Bảng (hạng mục, thông tin Bên A/B...) không bị đụng tới."""
    try:
        from app.modules.all_platform.services.contract_docx_pipeline import verify_structure

        original = base64.b64decode(payload.docx_base64)
        doc = eng.load_document(original)
        changes = eng.replace_body_paragraphs(doc, payload.lines)
        if not changes:
            return BaseResponse(success=False, message="Không có gì thay đổi.")
        result = eng.save_document(doc)
        structure = verify_structure(original, result)
        pdf, pdf_error = await _try_pdf_async(result)
        return BaseResponse(success=True, data={
            "docxBase64": _b64(result), "pdfBase64": _b64(pdf), "pdfError": pdf_error, "pages": eng.pdf_page_count(pdf) if pdf else None,
            "applied": {"id": "body", "before": f"{len(changes)} thay đổi", "after": ""}, "changes": changes,
            "structure": structure, "layoutPreserved": structure["preserved"], "paragraphs": _editable_paragraphs(result),
        })
    except ValueError as exc:
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("replace_body failed")
        return BaseResponse(success=False, message=f"Không áp dụng được: {exc}")


@contract_docx_router.post("/render")
async def render_template(
    file: UploadFile | None = File(None),
    template_id: str = Form(""),
    deal_id: str = Form(""),
    quote_id: str = Form(""),
    extra_prompt: str = Form(""),
    contract_number: str = Form(""),
    contract_value: float = Form(0),
    sign_date: str = Form(""),
    customer_id: str = Form(""),
    acknowledge_missing: bool = Form(False),
    items_table_index: int = Form(-1),
    _user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Mẫu DOCX (upload hoặc thư viện) -> DOCX đã chỉnh + PDF cùng nội dung + báo cáo thay đổi. KHÔNG ghi DB, KHÔNG ghi đè mẫu."""
    try:
        name, content = "", b""
        if file is not None:
            name, content = file.filename or "template", await file.read()
        elif template_id:
            loaded = store.load_template_original(template_id)
            if not loaded:
                return BaseResponse(success=False, message="Mẫu trong thư viện chưa có file gốc (mẫu tải lên trước khi có tính năng này). Hãy tải lại file DOCX của mẫu.")
            ext, content = loaded
            name = f"template.{ext}"
        else:
            return BaseResponse(success=False, message="Chưa chọn mẫu hợp đồng.")
        if len(content) > _MAX_BYTES:
            return BaseResponse(success=False, message="File quá lớn - tối đa 10MB.")
        if (name.rsplit(".", 1)[-1].lower() if "." in name else "") == "docx":
            eng.validate_docx_bytes(content)
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext == "pdf":
            info = eng.classify_pdf_template(content)
            return BaseResponse(success=True, data={"mode": "pdf-reference", **info})
        if ext != "docx":
            return BaseResponse(success=False, message="Chỉ hỗ trợ giữ nguyên bố cục với mẫu .docx. File .txt/.doc không đủ cấu trúc để chỉnh trực tiếp.")

        # Backend tự kiểm tra (không tin frontend): Deal/báo giá đúng workspace + đã duyệt + không OUT/xoá; trường pháp lý thiếu phải được xác nhận
        deal, quote = source.resolve_source(deal_id or None, quote_id or None, customer_id or None, require_deal=bool(customer_id))
        issuer = None
        representative = None
        if deal:
            from app.modules.all_platform.routers.contract import _issuer_of_quote
            from app.modules.all_platform.services.contract_ai_service import resolve_representative

            issuer = _issuer_of_quote(quote)
            representative = resolve_representative(deal)
            source.enforce_gaps(source.legal_gaps(deal, quote, issuer, representative), acknowledge_missing)
        res = await render_from_template(
            content, deal, quote, extra_prompt or None, contract_number=contract_number or None,
            contract_value=contract_value or None, sign_date=sign_date or None,
            items_table_index=items_table_index if items_table_index >= 0 else None,
            issuer=issuer, representative=representative,
        )
        pdf, pdf_error = await _try_pdf_async(res["docx"])
        original_pdf, _ = await _try_pdf_async(content)
        data = {k: v for k, v in res.items() if k != "docx"}
        data.update({
            "mode": "template-docx", "layoutPreserved": res["structure"]["preserved"],
            "docxBase64": _b64(res["docx"]), "pdfBase64": _b64(pdf), "pdfError": pdf_error, "originalPdfBase64": _b64(original_pdf),
            "pages": eng.pdf_page_count(pdf) if pdf else None, "originalPages": eng.pdf_page_count(original_pdf) if original_pdf else None,
            "paragraphs": _editable_paragraphs(res["docx"]),
        })
        return BaseResponse(success=True, data=data)
    except source.SourceError as exc:
        return BaseResponse(success=False, message=str(exc))
    except (RuntimeError, ValueError) as exc:           # AI không khả dụng / file không hợp lệ
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("render_template failed")
        return BaseResponse(success=False, message=f"Không xử lý được mẫu: {exc}")


class FromClausesRequest(BaseModel):
    title: str
    contract_number: str = ""
    clauses: list[dict]
    party_a: str = ""
    party_b: str = ""
    # Có deal/báo giá: backend TỰ lấy lại dữ liệu thật (hai bên, hạng mục, VAT, tổng) và kiểm tra hợp lệ - không tin dữ liệu số do client gửi
    deal_id: str = ""
    quote_id: str = ""
    customer_id: str = ""
    # Loại hợp đồng (nhãn tự do) quyết định tên vai trò Bên A/Bên B; direction='buy' (hợp đồng mua vào) đổi chỗ: công ty phát hành là Bên A
    contract_type: str = ""
    direction: str = "sell"
    # Người liên hệ + người đại diện ký Sale đã chọn/xác nhận ở Copilot (None = tự suy ra mặc định, xem resolve_representative()).
    contact_id: str = ""
    representative: dict | None = None


@contract_docx_router.post("/from-clauses")
def docx_from_clauses(payload: FromClausesRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI soạn mới: dựng DOCX chuyên nghiệp (Điều 1 hai bên theo trường, Điều 2 BẢNG hạng mục thật từ báo giá, Điều 3 tổng trước thuế/VAT/thanh toán +
    lịch thanh toán chính xác) -> DOCX là nguồn chuẩn -> PDF chuyển từ chính DOCX bằng LibreOffice."""
    try:
        from app.modules.all_platform.routers.contract import _issuer_of_quote
        from app.modules.all_platform.services.contract_ai_service import build_parties, resolve_representative
        from app.modules.all_platform.services.contract_docx_builder import build_contract_docx

        deal, quote = (source.resolve_source(payload.deal_id or None, payload.quote_id or None, payload.customer_id or None, contact_id=payload.contact_id or None)
                       if (payload.deal_id or payload.quote_id) else (None, None))
        from app.modules.all_platform.services.contract_roles import arrange_parties, role_labels

        representative = resolve_representative(deal, payload.representative) if deal else None
        parties = build_parties(deal, quote, _issuer_of_quote(quote), representative) if deal else None
        if parties:
            parties = arrange_parties(parties, payload.direction)
        role_a, role_b = role_labels(payload.contract_type)
        # Vai trò luôn: Bên A = bên mua/sử dụng, Bên B = bên cung cấp. Hợp đồng bán ra: A = khách hàng; mua vào (direction='buy'): A = công ty phát hành.
        docx, warnings = build_contract_docx(payload.title, payload.contract_number, payload.clauses, parties=parties, quote=quote,
                                             signer_a=payload.party_a, signer_b=payload.party_b, roles=(role_a, role_b))
        pdf, pdf_error = _try_pdf(docx)
        return BaseResponse(success=True, data={
            "mode": "generated-docx", "layoutPreserved": False, "docxBase64": _b64(docx), "pdfBase64": _b64(pdf), "pdfError": pdf_error,
            "pages": eng.pdf_page_count(pdf) if pdf else None, "warnings": ["Không dùng mẫu DOCX: tài liệu dựng theo bố cục chuẩn của hệ thống."] + warnings,
        })
    except source.SourceError as exc:
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("docx_from_clauses failed")
        return BaseResponse(success=False, message=f"Không dựng được tài liệu: {exc}")


class AnalyzeDraftRequest(BaseModel):
    docx_base64: str
    deal_id: str = ""
    quote_id: str = ""
    customer_id: str = ""
    contract_value: float = 0


@contract_docx_router.post("/analyze-draft")
async def analyze_draft(payload: AnalyzeDraftRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI kiểm tra rủi ro trên bản nháp CHƯA lưu (chỉ để người soạn tham khảo; không ghi gì). Sau khi lưu phiên bản, kết quả chính thức được chạy lại
    ở server và gắn với đúng phiên bản (POST /{id}/versions/{n}/risk)."""
    try:
        from app.modules.all_platform.services import contract_ai_service as ai

        docx = base64.b64decode(payload.docx_base64)
        clauses = eng.docx_to_clauses(docx)
        deal, quote = (source.resolve_source(payload.deal_id or None, payload.quote_id or None, payload.customer_id or None)
                       if (payload.deal_id or payload.quote_id) else (None, None))
        result = await ai.review_contract_risk(clauses, quote, payload.contract_value or None, None)
        return BaseResponse(success=True, data={"score": result.get("score"), "findings": result.get("findings") or [],
                                                 "verifiedFindings": result.get("verifiedFindings") or [], "preliminary": True})
    except source.SourceError as exc:
        return BaseResponse(success=False, message=str(exc))
    except (RuntimeError, ValueError) as exc:
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("analyze_draft failed")
        return BaseResponse(success=False, message=f"Không phân tích được: {exc}")
