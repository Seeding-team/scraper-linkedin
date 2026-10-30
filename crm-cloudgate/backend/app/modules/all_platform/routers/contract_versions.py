"""Phiên bản tài liệu hợp đồng (DOCX/PDF), AI rủi ro GẮN VỚI TỪNG PHIÊN BẢN, điều kiện gửi duyệt/ký.

Mọi endpoint kiểm tra quyền theo hợp đồng (cùng quy tắc /contracts/{id}): đọc/ghi = can_edit_contract; hợp đồng thuộc workspace khác => không tìm thấy.
Phiên bản đã lưu là BẤT BIẾN: sửa nội dung pháp lý = lưu phiên bản mới (không ghi đè)."""
from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.logger import get_logger
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import contract_approval_service as approval
from app.modules.all_platform.services import contract_docx_engine as eng
from app.modules.all_platform.services import contract_document_store as store
from app.modules.all_platform.services.crm_permission_service import can_edit_contract

logger = get_logger(__name__)
contract_versions_router = APIRouter()
DOCX_MIME = store.DOCX_MIME


def _authorize(contract_id: str, user: dict):
    """-> (contract, lead). Ném PermissionError/LookupError (router đổi thành BaseResponse)."""
    from app.modules.all_platform.routers.contract import _load_contract_and_lead

    try:
        contract, lead = _load_contract_and_lead(contract_id)
    except Exception as exc:  # noqa: BLE001  (không có trong workspace này / id sai)
        raise LookupError("Không tìm thấy hợp đồng trong workspace này.") from exc
    if not can_edit_contract(user, contract, lead):
        raise PermissionError("Không có quyền với hợp đồng này.")
    return contract, lead


def _deny(exc: Exception) -> BaseResponse:
    return BaseResponse(success=False, message=str(exc))


def _b64(b: bytes | None) -> str | None:
    return base64.b64encode(b).decode("ascii") if b else None


def _issuer_for(contract: dict):
    try:
        from app.modules.all_platform.routers.contract import _issuer_of_quote
        from app.modules.all_platform.services import get_quote

        return _issuer_of_quote(get_quote(contract["quoteId"])) if contract.get("quoteId") else None
    except Exception:  # noqa: BLE001
        return None


def _actor(user: dict) -> dict:
    return {"createdBy": user.get("id"), "createdByName": user.get("full_name") or user.get("display_name") or user.get("email")}


class SaveVersionRequest(BaseModel):
    docx_base64: str
    contract_number: str = ""
    source: str = "ai"          # ai-new | template | manual-edit
    note: str = ""


@contract_versions_router.post("/{contract_id}/versions")
def save_contract_version(contract_id: str, payload: SaveVersionRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Lưu DOCX đã duyệt thành phiên bản MỚI (không ghi đè). Ghi người tạo/thời điểm/nguồn/sha256 + lịch sử hoạt động."""
    try:
        contract, _ = _authorize(contract_id, user)
        docx = base64.b64decode(payload.docx_base64)
        doc = eng.load_document(docx)                   # phải là DOCX hợp lệ (đã kiểm tra kích thước/zip)
        if payload.contract_number:                     # số hợp đồng chỉ có sau khi lưu: chỉ điền {{contract_number}}, không đụng gì khác
            applied, _ = eng.fill_placeholders(doc, {"contract_number": payload.contract_number})
            if applied:
                docx = eng.save_document(doc)
        meta = {**_actor(user), "source": payload.source, "note": payload.note[:300]}
        if payload.source in ("ai-new", "template", "ai"):          # dấu vết AI: model dùng để soạn
            try:
                from app.modules.all_platform.services import contract_ai_service as ai

                meta["aiModel"] = ai._cfg()[2]
            except Exception:  # noqa: BLE001
                pass
        n = store.save_version(contract_id, docx, meta)
        try:
            from app.modules.all_platform.services.supabase_contract_service import _log_activity

            _log_activity(contract_id, user.get("id"), "document_version_saved", {"version": n, "source": payload.source})
        except Exception:  # noqa: BLE001
            logger.warning("Không ghi được lịch sử phiên bản", exc_info=True)
        # BUG THAT DA GAP (audit 2026-10-27, "hop dong AI Copilot khong bao gio tu dong bo
        # Drive"): _queue_drive_sync() chi duoc goi tu create_contract()/update_contract() -
        # hop dong tao qua AI Copilot (ContractAIWizard) goi create_contract() TRUOC khi DOCX
        # ton tai (chua co gi de dong bo), roi luu DOCX qua endpoint NAY (mot duong hoan toan
        # khac, khong di qua create_contract/update_contract) nen KHONG BAO GIO duoc xep lich
        # dong bo - ca lan tao dau tien lan moi lan "Sua noi dung -> tao phien ban moi" sau nay.
        # Xep lich o day (sau khi luu phien ban THAT) de luon dong bo DUNG noi dung moi nhat.
        try:
            from app.modules.all_platform.services.supabase_contract_service import _queue_drive_sync

            _queue_drive_sync(contract_id)
        except Exception:  # noqa: BLE001
            logger.warning("Không xếp lịch đồng bộ Drive được cho phiên bản vừa lưu", exc_info=True)
        return BaseResponse(success=True, data={"version": n})
    except (PermissionError, LookupError) as exc:
        return _deny(exc)
    except Exception as exc:  # noqa: BLE001
        return BaseResponse(success=False, message=f"Không lưu được phiên bản: {exc}")


@contract_versions_router.get("/{contract_id}/versions")
def list_contract_versions(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        _authorize(contract_id, user)
        return BaseResponse(success=True, data=store.list_versions(contract_id))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


@contract_versions_router.get("/{contract_id}/readiness")
def contract_readiness(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Điều kiện gửi duyệt/ký (backend quyết định)."""
    try:
        contract, lead = _authorize(contract_id, user)
        return BaseResponse(success=True, data=approval.compute_readiness(contract, lead, _issuer_for(contract)))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)
    except Exception as exc:  # noqa: BLE001
        return BaseResponse(success=False, message=str(exc))


@contract_versions_router.get("/{contract_id}/versions/{version}/paragraphs")
def version_paragraphs(contract_id: str, version: int, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Đoạn thân tài liệu của 1 phiên bản (để chọn sửa riêng từng đoạn -> lưu thành phiên bản mới) + DOCX base64 của chính phiên bản đó."""
    try:
        _authorize(contract_id, user)
        docx = store.load_version(contract_id, version)
        if not docx:
            return BaseResponse(success=False, message="Không tìm thấy phiên bản.")
        paras = [{"id": p.id, "text": p.text} for p in eng.describe_paragraphs(eng.load_document(docx)) if p.text.strip() and not p.in_table]
        return BaseResponse(success=True, data={"version": version, "paragraphs": paras, "docxBase64": _b64(docx)})
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


@contract_versions_router.get("/{contract_id}/versions/{version}/risk")
def get_version_risk(contract_id: str, version: int, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        _authorize(contract_id, user)
        return BaseResponse(success=True, data=store.load_meta(contract_id, version).get("risk"))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


@contract_versions_router.post("/{contract_id}/versions/{version}/risk")
async def run_version_risk(contract_id: str, version: int, user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI kiểm tra rủi ro trên NỘI DUNG THỰC của phiên bản này (đối chiếu báo giá); kết quả lưu cùng phiên bản, kèm model + thời điểm + sha256 tài liệu."""
    try:
        contract, _ = _authorize(contract_id, user)
        docx = store.load_version(contract_id, version)
        if not docx:
            return BaseResponse(success=False, message="Không tìm thấy phiên bản.")
        from app.modules.all_platform.services import contract_ai_service as ai, get_quote

        clauses = eng.docx_to_clauses(docx)
        quote = get_quote(contract["quoteId"]) if contract.get("quoteId") else None
        result = await ai.review_contract_risk(clauses, quote, contract.get("contractValue"), contract.get("paymentTerms"))
        meta = store.load_meta(contract_id, version)
        try:
            model = ai._cfg()[2]
        except Exception:  # noqa: BLE001
            model = None
        risk = {"score": result.get("score"), "findings": result.get("findings") or [], "verifiedFindings": result.get("verifiedFindings") or [],
                "model": model, "analyzedAt": datetime.now(timezone.utc).isoformat(), "analyzedBy": user.get("id"), "versionSha": meta.get("sha256")}
        store.update_meta(contract_id, version, {"risk": risk})
        try:
            from app.modules.all_platform.services.supabase_contract_service import _log_activity

            _log_activity(contract_id, user.get("id"), "risk_analyzed", {"version": version, "score": risk["score"]})
        except Exception:  # noqa: BLE001
            pass
        return BaseResponse(success=True, data=risk)
    except (PermissionError, LookupError) as exc:
        return _deny(exc)
    except RuntimeError as exc:                         # AI lỗi: báo lỗi thật, không tạo kết quả giả
        return BaseResponse(success=False, message=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("run_version_risk failed")
        return BaseResponse(success=False, message=f"Không kiểm tra được rủi ro: {exc}")


@contract_versions_router.get("/{contract_id}/versions/{version}/{fmt}")
def download_contract_version(contract_id: str, version: int, fmt: str, user: dict = Depends(get_current_user)):
    """Tải đúng phiên bản: docx | pdf (PDF chuyển từ chính DOCX phiên bản đó bằng LibreOffice)."""
    try:
        _authorize(contract_id, user)
    except (PermissionError, LookupError) as exc:
        return _deny(exc)
    docx = store.load_version(contract_id, version)
    if not docx:
        return BaseResponse(success=False, message="Không tìm thấy phiên bản.")
    if fmt == "docx":
        return Response(docx, media_type=DOCX_MIME, headers={"Content-Disposition": f'attachment; filename="hop-dong-v{version}.docx"'})
    if fmt == "pdf":
        try:
            pdf = eng.convert_docx_to_pdf(docx)
        except (eng.PdfEngineUnavailable, ValueError) as exc:
            return BaseResponse(success=False, message=str(exc))
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="hop-dong-v{version}.pdf"'})
    return BaseResponse(success=False, message="Định dạng không hợp lệ (docx|pdf).")


@contract_versions_router.get("/{contract_id}/documents/preview-pdf")
def preview_external_document_as_pdf(contract_id: str, file_url: str, user: dict = Depends(get_current_user)):
    """Xem truoc file hop dong 'ghi nhan ngoai' (chi co contracts.file_url, KHONG phai 1 'version'
    luu trong bucket contract-documents) - xem ContractDetailPage.tsx/ContractDocumentViewer.tsx.
    Proxy LUON qua backend (khong de FE <iframe src={file_url}> truc tiep) vi file_url tro domain
    ngoai co the chan X-Frame-Options/CORS; DOCX thi convert sang PDF bang CHINH engine da dung cho
    cac phien ban luu trong bucket (contract_docx_engine.convert_docx_to_pdf, LibreOffice headless -
    KHONG viet converter rieng). Nhan dien dinh dang theo magic bytes (%PDF.../PK\x03\x04 cho docx,
    vi la file zip) thay vi tin duoi url (link ngoai co the khong co duoi ro rang)."""
    try:
        _authorize(contract_id, user)
    except (PermissionError, LookupError) as exc:
        return _deny(exc)
    if "docs.google.com" in file_url or "drive.google.com" in file_url:
        # KHONG tai qua httpx (se ra trang HTML dang nhap Google, khong phai noi dung that) -
        # dung co che kiem tra quyen that + export rieng cho Google Docs/Drive (2026-10-27, gop y
        # UX "kiem tra quyen doc nguon, neu thieu thi huong dan share thay vi bao loi 401 chung chung").
        from app.modules.all_platform.services.contract_drive_service import (
            check_file_readable, export_google_doc_as_pdf, extract_file_id_from_url,
        )
        from app.core.config import settings as app_settings

        gdoc_id = extract_file_id_from_url(file_url)
        if not gdoc_id:
            return BaseResponse(success=False, message="Không đọc được file_id từ link Google Docs/Drive.")
        if not check_file_readable(gdoc_id):
            return BaseResponse(
                success=False,
                message=(
                    f"Chưa có quyền đọc link này. Hãy chia sẻ file cho "
                    f"{app_settings.google_service_account_email} (vai trò Xem) rồi thử lại, "
                    "hoặc tải file từ máy lên thay thế."
                ),
            )
        try:
            content = export_google_doc_as_pdf(gdoc_id)
        except Exception as exc:  # noqa: BLE001
            return BaseResponse(success=False, message=f"Không xuất được nội dung từ Google Docs: {exc}")
        return Response(content, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="hop-dong.pdf"'})

    import httpx

    try:
        resp = httpx.get(file_url, timeout=20.0, follow_redirects=True)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        return BaseResponse(success=False, message=f"Không tải được file từ link đã lưu: {exc}")
    content = resp.content
    if content[:4] == b"%PDF":
        return Response(content, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="hop-dong.pdf"'})
    if content[:2] == b"PK":  # DOCX la file zip (PK\x03\x04)
        try:
            pdf = eng.convert_docx_to_pdf(content)
        except (eng.PdfEngineUnavailable, ValueError) as exc:
            return BaseResponse(success=False, message=str(exc))
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="hop-dong.pdf"'})
    return BaseResponse(success=False, message="Định dạng file không hỗ trợ xem trước (chỉ PDF/DOCX).")
