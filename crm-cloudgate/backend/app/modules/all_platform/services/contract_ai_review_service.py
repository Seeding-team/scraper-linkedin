"""AI Contract Review - orchestration (2026-10-26, Phan B1+B5, sua lai 2026-10-27 theo gop y UX
"phai xem truoc Highlight THAT truoc khi xac nhan, khong mock"). Noi ket:
  B2 (contract_ocr_service.extract_contract_fields_full) + B3 (compare_contract_to_quote_full)
  + B1 (cache theo contract_ai_reviews) + B4 (contract_highlight_service) + Drive (confirm).

Luong (DA SUA - xem UX_FIX_2026-10-27 o duoi):
  run_ai_review_full(contract_id) -> B2+B3 + TAO LUON file Highlight that (B4), luu TAM trong
    bucket `contract-documents` (KHONG dong Drive) - Sale xem truoc DUNG file nay qua
    get_highlight_preview(). KHONG dong gi len Drive o buoc nay.
  confirm_ai_review(contract_id, review_id, actor_id) -> CHI day DUNG file da tao o buoc tren
    len Drive (KHONG tao lai/sinh moi) - dam bao ban Sale xem truoc == ban luu Drive 100%,
    dung nguyen tac "khong tu dong luu Drive truoc khi Sale xac nhan" (#6) + "xem truoc that"
    (gop y UX moi).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.contract_ocr_service import (
    RULES_VERSION,
    compare_contract_to_quote_full,
    extract_contract_fields_full,
    extract_risk_clauses,
)

logger = get_logger(__name__)

HIGHLIGHT_BUCKET = "contract-documents"

# (2026-10-27, fix bug "mat trang thai khi dong/mo lai panel") Khoa theo contract_id - tranh 2
# request chay AI Review TRUNG GIO cho CUNG 1 hop dong (vd Sale bam nhanh 2 lan / 2 tab) tao 2
# ban ghi / goi AI that 2 lan lang phi. Request thu 2 CHO request dau xong roi moi doc cache -
# luc nay cache da co (ban ghi vua duoc request dau tao) nen tra ve NGAY, khong chay AI lai.
# Don gian hoa (khong can bang DB job-status rieng) vi process backend nay chi chay 1 worker.
_run_locks: dict[str, asyncio.Lock] = {}


def _lock_for(contract_id: str) -> asyncio.Lock:
    lock = _run_locks.get(contract_id)
    if lock is None:
        lock = asyncio.Lock()
        _run_locks[contract_id] = lock
    return lock


async def _compute_current_hashes(contract: dict[str, Any]) -> tuple[str | None, str]:
    """Dung chung boi run_ai_review_full() va get_latest_review_status()/confirm_ai_review() -
    tinh hash HIEN TAI cua file hop dong + bao gia lien ket, de biet 1 ban ghi review da luu co
    con "current" hay da "stale" (hop dong/bao gia doi sau khi chay review)."""
    from app.modules.all_platform.services import get_quote
    from app.modules.all_platform.services.contract_drive_service import _resolve_contract_source_file

    source = _resolve_contract_source_file(contract)
    contract_hash = _content_hash(source[0]) if source else None
    quote = None
    if contract.get("quote_id"):
        try:
            quote = get_quote(contract["quote_id"])
        except Exception:  # noqa: BLE001
            quote = None
    return contract_hash, _quote_content_hash(quote)


def _content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _quote_content_hash(quote: dict[str, Any] | None) -> str:
    """Hash noi dung bao gia (B1 mo rong theo gop y: khong chi hash hop dong, phai tinh ca bao
    gia - bao gia doi thi phai cache-miss du hop dong khong doi). Khong can hash THAT SU toan bo
    JSON lon - chi can 1 chu ky doi dien dai dien cho "noi dung quan trong" (tong tien + so hang
    muc + updatedAt neu co), du de phat hien thay doi thuc su."""
    if not quote:
        return "no_quote"
    payload = {
        "id": quote.get("id"),
        "totalAmount": quote.get("totalAmount"),
        "subtotalAmount": quote.get("subtotalAmount"),
        "vatAmount": quote.get("vatAmount"),
        "itemCount": len(quote.get("items") or []),
        "updatedAt": quote.get("updatedAt"),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _extract_plain_text(content: bytes, filename: str) -> str:
    """Tai dung logic doc text da co trong contract_ocr_service (KHONG viet lai) - uu tien DOCX,
    fallback pdfplumber cho PDF text, tra rong neu khong doc duoc (PDF scan/anh - B2 se tra ve
    insufficient qua nguong do dai, dung hanh vi cu)."""
    from app.modules.all_platform.services.contract_ocr_service import _extract_docx_text
    from app.modules.all_platform.services.vendor_ai_parse_service import VendorAIParsingService

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "docx":
        try:
            return _extract_docx_text(content)
        except Exception:  # noqa: BLE001
            return ""
    if ext == "pdf":
        try:
            return VendorAIParsingService.extract_from_pdf(content)
        except ValueError:
            return ""
    return ""


def _generate_highlight(content: bytes, filename: str, findings: list[dict[str, Any]]) -> tuple[bytes, str, str, dict[str, Any]]:
    """(B4) Tao bytes Highlight DUNG dinh dang nguon - ham dung chung, goi 1 LAN DUY NHAT trong
    run_ai_review_full() (khong goi lai trong confirm - xem docstring dau file). Tra ve them
    `meta` {located, notLocated, pages} (2026-10-27, fix "khong bao thanh cong gia") de caller
    biet CHINH XAC bao nhieu finding duoc to mau that, khong chi "co file la coi nhu xong"."""
    from app.modules.all_platform.services.contract_docx_engine import classify_pdf_template
    from app.modules.all_platform.services.contract_highlight_service import highlight_docx, highlight_pdf_scan, highlight_pdf_text

    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "docx":
        out, meta = highlight_docx(content, findings)
        return out, "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", meta
    if ext == "pdf":
        cls = classify_pdf_template(content)
        if cls["kind"] == "scan":
            out, meta = highlight_pdf_scan(content, findings)
        else:
            out, meta = highlight_pdf_text(content, findings)
        return out, "pdf", "application/pdf", meta
    raise ValueError(f"Định dạng {ext} chưa hỗ trợ tạo bản Highlight")


async def run_ai_review_full(contract_id: str) -> dict[str, Any]:
    async with _lock_for(contract_id):
        return await _run_ai_review_full_locked(contract_id)


async def _run_ai_review_full_locked(contract_id: str) -> dict[str, Any]:
    from app.modules.all_platform.services import get_quote
    from app.modules.all_platform.services.contract_drive_service import _resolve_contract_source_file

    sb = get_supabase_client()
    rows = sb.table("contracts").select("*").eq("id", contract_id).limit(1).execute().data
    if not rows:
        raise ValueError("Không tìm thấy hợp đồng")
    contract = rows[0]

    source = _resolve_contract_source_file(contract)
    if source is None:
        return {"status": "no_file", "message": "Hợp đồng chưa có file/link hợp lệ để chạy AI Review"}
    content, filename, _mime = source
    contract_hash = _content_hash(content)

    quote = None
    if contract.get("quote_id"):
        try:
            quote = get_quote(contract["quote_id"])
        except Exception:  # noqa: BLE001
            quote = None
    quote_hash = _quote_content_hash(quote)

    # B1: kiem tra cache truoc khi chay AI that
    cached = (
        sb.table("contract_ai_reviews").select("*")
        .eq("contract_id", contract_id)
        .eq("contract_content_hash", contract_hash)
        .eq("quote_content_hash", quote_hash)
        .eq("rules_version", RULES_VERSION)
        .order("created_at", desc=True).limit(1).execute().data
    )
    if cached:
        row = cached[0]
        comp = row["quote_comparison"] or []
        risk_result_cached = (row.get("extracted_fields") or {}).get("risk_clauses") or {"method": "heuristic_candidate", "clauses": []}
        risk_cached = risk_result_cached["clauses"]
        _backfill_ai_annotations_if_missing(contract_id, row)
        return {
            "status": "ok", "fromCache": True, "reviewId": row["id"],
            "extractedFields": row["extracted_fields"], "comparison": comp,
            "riskClauses": risk_cached, "riskClauseMethod": risk_result_cached["method"],
            "confirmed": bool(row.get("confirmed_at")),
            "highlightAvailable": bool(row.get("highlight_source_key")),
            "highlightFileExt": (row.get("highlight_file_name") or "").rsplit(".", 1)[-1] if row.get("highlight_file_name") else None,
            "extractionMethod": (row.get("extracted_fields") or {}).get("extraction_method"),
            "highlightLocatedCount": sum(1 for r in (comp + risk_cached) if r.get("located")),
            "highlightTotalCount": sum(1 for r in (comp + risk_cached) if r.get("sourceExcerpt")),
        }

    text = _extract_plain_text(content, filename)
    extracted = await extract_contract_fields_full(text)

    customer = None
    customer_id = contract.get("customer_id")
    if customer_id:
        crows = sb.table("crm_customers").select("company_name, customer_name, tax_code").eq("id", customer_id).limit(1).execute().data
        customer = crows[0] if crows else None

    comparison = compare_contract_to_quote_full(extracted, quote, customer, contract.get("warranty_period"))

    # (2026-10-27, yeu cau sep "AI phai doc TOAN BO hop dong tim dieu khoan quan trong/rui ro,
    # khong chi highlight du lieu dinh danh") - phan tich NGU NGHIA rieng, KHONG phu thuoc bao
    # gia, tach biet khoi bang doi chieu (hien o muc rieng "Dieu khoan quan trong & rui ro").
    risk_result = await extract_risk_clauses(text)
    risk_clauses: list[dict[str, Any]] = risk_result["clauses"]
    extracted["risk_clauses"] = risk_result
    for i, c in enumerate(risk_clauses):
        c["field"] = f"risk_{i}"
        c["sourceExcerpt"] = c.get("excerpt")  # dong bo ten key voi `comparison` de dung chung logic dem/highlight ben duoi

    # UX_FIX_2026-10-27: tao HIGHLIGHT THAT NGAY O DAY (khong doi den confirm) de Sale xem truoc
    # dung 100% noi dung se duoc luu - best-effort, loi o buoc nay KHONG chan ket qua doi chieu
    # (Sale van xem duoc bang so sanh, chi khong co preview Highlight neu dinh dang chua ho tro).
    # Highlight CA comparison LAN risk_clauses trong 1 lan duyet duy nhat (findings gop chung) -
    # mau DUY NHAT vang #FFF176 cho moi doan (xem contract_highlight_service.HIGHLIGHT_COLOR).
    highlight_key: str | None = None
    highlight_filename: str | None = None
    highlight_error: str | None = None
    combined_findings: list[dict[str, Any]] = [*comparison, *({"field": c["field"], "sourceExcerpt": c.get("excerpt")} for c in risk_clauses)]
    try:
        from app.modules.all_platform.services.contract_drive_service import _sanitize_folder_name
        from app.modules.all_platform.services import contract_document_store

        highlight_bytes, out_ext, out_mime, meta = _generate_highlight(content, filename, combined_findings)
        highlight_filename = f"{_sanitize_folder_name(contract.get('contract_number') or contract_id)}_AI_Highlight_v1.{out_ext}"
        highlight_key = f"ai_highlights/{contract_id}/{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}.{out_ext}"
        contract_document_store._bucket().upload(  # noqa: SLF001 - tai dung bucket co san
            highlight_key, highlight_bytes, file_options={"content-type": out_mime, "upsert": "false"},
        )
        # Gan lai KET QUA THAT (to mau duoc/khong, trang nao) vao dung tung dong doi chieu VA
        # tung dieu khoan rui ro - de FE bao dung "X/Y da to mau" + dieu huong finding -> dung
        # trang, khong bao thanh cong gia khi file duoc tao nhung thuc ra khong dinh vi duoc gi.
        pages = meta.get("pages") or {}
        located_set = set(meta.get("located") or [])
        for row in comparison:
            field = row.get("field")
            row["located"] = field in located_set
            row["highlightPage"] = pages.get(field)
        for c in risk_clauses:
            c["located"] = c["field"] in located_set
            c["highlightPage"] = pages.get(c["field"])

        # (2026-10-27, Word Editor) Tao annotation TUONG MINH source='ai' NGAY o day - khong doi
        # Sale mo editor. version_id dung chung hash noi dung (on dinh du nguon la file_url hay
        # version DOCX) - xem contract_highlight_annotations.seed_ai_annotations().
        try:
            from app.modules.all_platform.services.contract_highlight_annotations import seed_ai_annotations

            seed_ai_annotations(
                contract_id, f"hash:{contract_hash[:16]}", [*comparison, *risk_clauses],
                meta.get("anchors") or {}, pages, is_pdf=(out_ext == "pdf"),
            )
        except Exception as exc:  # noqa: BLE001 - khong duoc chan ket qua doi chieu chi vi loi seed annotation
            logger.warning("Không tạo được annotation AI cho hợp đồng %s: %s", contract_id, exc)

        # Khi tao ban Highlight MOI (cache miss / bump RULES_VERSION), xoa scratch cu va huy phien
        # Word Editor dang mo nhung CHUA TUNG autosave (last_autosaved_at is None) de tab
        # "Chỉnh sửa (Word)" nap dung ban Highlight moi nhat thay vi giu draft cu thieu highlight.
        try:
            contract_document_store.delete_scratch(contract_id)
            idle_sessions = (
                sb.table("contract_edit_sessions").select("id, draft_storage_key")
                .eq("contract_id", contract_id).eq("status", "editing").is_("last_autosaved_at", "null").execute().data
            ) or []
            for s in idle_sessions:
                if s.get("draft_storage_key"):
                    try:
                        contract_document_store._bucket().remove([s["draft_storage_key"]])  # noqa: SLF001
                    except Exception:  # noqa: BLE001
                        pass
                sb.table("contract_edit_sessions").update({"status": "discarded"}).eq("id", s["id"]).execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Không dọn được phiên draft/scratch cũ khi tạo AI Review mới cho %s: %s", contract_id, exc)
    except Exception as exc:  # noqa: BLE001
        highlight_error = str(exc)
        logger.warning("Không tạo được bản Highlight xem trước cho hợp đồng %s: %s", contract_id, exc)

    inserted = sb.table("contract_ai_reviews").insert({
        "contract_id": contract_id,
        "contract_content_hash": contract_hash,
        "quote_content_hash": quote_hash,
        "rules_version": RULES_VERSION,
        "extracted_fields": extracted,
        "quote_comparison": comparison,
        "highlight_source_bucket": HIGHLIGHT_BUCKET if highlight_key else None,
        "highlight_source_key": highlight_key,
        "highlight_file_name": highlight_filename or filename,
    }).execute().data[0]

    return {
        "status": "ok", "fromCache": False, "reviewId": inserted["id"],
        "extractedFields": extracted, "comparison": comparison, "riskClauses": risk_clauses,
        "riskClauseMethod": risk_result["method"], "confirmed": False,
        "highlightAvailable": bool(highlight_key),
        "highlightFileExt": highlight_filename.rsplit(".", 1)[-1] if highlight_filename else None,
        "highlightError": highlight_error,
        "extractionMethod": extracted.get("extraction_method"),
        "highlightLocatedCount": sum(1 for r in (comparison + risk_clauses) if r.get("located")),
        "highlightTotalCount": sum(1 for r in (comparison + risk_clauses) if r.get("sourceExcerpt")),
    }


def _review_response_shape(row: dict[str, Any], *, stale: bool) -> dict[str, Any]:
    comp = row.get("quote_comparison") or []
    risk_result = (row.get("extracted_fields") or {}).get("risk_clauses") or {"method": "heuristic_candidate", "clauses": []}
    risk = risk_result["clauses"]
    status = "stale" if stale else ("confirmed" if row.get("confirmed_at") else "pending_confirmation")
    return {
        "status": status, "reviewId": row["id"],
        "extractedFields": row.get("extracted_fields"), "comparison": comp,
        "riskClauses": risk, "riskClauseMethod": risk_result["method"],
        "confirmed": bool(row.get("confirmed_at")),
        "highlightAvailable": bool(row.get("highlight_source_key")),
        "highlightFileExt": (row.get("highlight_file_name") or "").rsplit(".", 1)[-1] if row.get("highlight_file_name") else None,
        "extractionMethod": (row.get("extracted_fields") or {}).get("extraction_method"),
        "highlightLocatedCount": sum(1 for r in (comp + risk) if r.get("located")),
        "highlightTotalCount": sum(1 for r in (comp + risk) if r.get("sourceExcerpt")),
        "stale": stale,
        "driveFileId": row.get("drive_file_id"),
        "runAt": row.get("created_at"),
    }


def _backfill_ai_annotations_if_missing(contract_id: str, row: dict[str, Any]) -> None:
    """(2026-10-27, Word Editor) Review ĐÃ CACHE từ TRƯỚC KHI có tính năng annotation (ví dụ
    HD/2026/0007 — review tạo 2026-10-26) sẽ KHÔNG có dòng nào trong
    `contract_highlight_annotations` (`seed_ai_annotations()` chỉ được gọi ở nhánh chạy AI MỚI,
    xem `_run_ai_review_full_locked`) — panel "Thông tin quan trọng đã Highlight" sẽ trống RỖNG
    đúng với kết quả cache thật, KHÔNG phải lỗi hiển thị. Backfill 1 LẦN duy nhất (idempotent —
    kiểm tra đã có annotation nào của ĐÚNG `version_id` này chưa trước khi seed) mỗi khi đọc lại
    1 review đã lưu (cả đường "chạy AI" cache-hit lẫn "đọc review gần nhất" khi mở lại panel),
    dùng dữ liệu ĐÃ CÓ sẵn trong row (comparison/risk_clauses đã embed sourceExcerpt/highlightPage/
    located từ lần chạy thật) — KHÔNG chạy lại AI. Hạn chế ĐÃ BIẾT: review cũ không lưu riêng
    "anchors" (vị trí đoạn/ký tự DOCX chính xác từng field) nên annotation backfill cho hợp đồng
    nguồn DOCX sẽ có excerpt nhưng KHÔNG có `paragraph_anchor` chính xác (nhảy-tới sẽ không điều
    hướng được, chỉ hiện trích dẫn) — PDF vẫn có `paragraph_anchor` dạng "page:N" đầy đủ vì
    `highlightPage` đã được lưu sẵn trong từng finding. Đây là giới hạn dữ liệu thật, không giả vờ
    có đủ."""
    try:
        from app.modules.all_platform.services.contract_highlight_annotations import list_annotations, seed_ai_annotations

        contract_hash = row.get("contract_content_hash") or ""
        version_label = f"hash:{contract_hash[:16]}"
        existing_ai = [a for a in list_annotations(contract_id) if a.get("version_id") == version_label and a.get("source") == "ai"]
        if existing_ai:
            return
        comp = row.get("quote_comparison") or []
        risk_cached = ((row.get("extracted_fields") or {}).get("risk_clauses") or {}).get("clauses") or []
        findings = [*comp, *risk_cached]
        if not findings:
            return
        is_pdf_cached = (row.get("highlight_file_name") or "").lower().endswith(".pdf")
        pages_cached = {f.get("field"): f.get("highlightPage") for f in findings if f.get("field") and f.get("highlightPage")}
        seed_ai_annotations(contract_id, version_label, findings, {}, pages_cached, is_pdf=is_pdf_cached)
    except Exception as exc:  # noqa: BLE001 - khong duoc chan ket qua review chi vi loi backfill
        logger.warning("Không backfill được annotation AI cho review %s của hợp đồng %s: %s", row.get("id"), contract_id, exc)


async def get_latest_review_status(contract_id: str) -> dict[str, Any]:
    """(2026-10-27, fix bug "mat trang thai khi dong/mo lai panel") Doc phien AI Review GAN
    NHAT da luu - KHONG goi AI, KHONG tao ban ghi moi - de FE khoi phuc day du khi mo lai
    chi tiet hop dong/tab AI Review (dong panel/doi tab/F5/dang nhap lai deu phai thay LAI
    dung ket qua nay, khong duoc hien "chua chay gi"). Neu hop dong/bao gia da doi so voi
    luc chay review nay -> `stale=True`, van tra ve DAY DU ket qua CU de xem lich su (nguyen
    tac #5: khong xoa, khong ghi de), FE tu quyet dinh co cho xac nhan hay bat chay lai.
    (2026-10-28) Neu review gan nhat CHUA xac nhan luu Drive (`confirmed_at` la None) va dung
    `rules_version` cu (khac RULES_VERSION hien tai) -> tu dong chay lai `run_ai_review_full()`
    ngay khi mo panel de nang cap ban Highlight + doi chieu theo quy tac moi nhat."""
    sb = get_supabase_client()
    rows = sb.table("contract_ai_reviews").select("*").eq("contract_id", contract_id).order("created_at", desc=True).limit(1).execute().data
    if not rows:
        return {"status": "none"}
    row = rows[0]

    rules_outdated = row.get("rules_version") != RULES_VERSION
    if rules_outdated and not row.get("confirmed_at"):
        try:
            return await run_ai_review_full(contract_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Tự động nâng cấp AI Review theo RULES_VERSION=%s thất bại (%s), trả bản cũ: %s", RULES_VERSION, contract_id, exc)

    contract_rows = sb.table("contracts").select("*").eq("id", contract_id).limit(1).execute().data
    stale = rules_outdated
    if contract_rows and not stale:
        current_contract_hash, current_quote_hash = await _compute_current_hashes(contract_rows[0])
        stale = (
            (current_contract_hash is not None and row.get("contract_content_hash") != current_contract_hash)
            or row.get("quote_content_hash") != current_quote_hash
        )
    _backfill_ai_annotations_if_missing(contract_id, row)
    return _review_response_shape(row, stale=stale)


def get_latest_ai_highlight_docx(contract_id: str, current_source_content: bytes) -> tuple[bytes, str] | None:
    """(2026-10-27, Word Editor - fix BUG THAT: OnlyOffice mo ban KHONG highlight) Tim bản Highlight
    DOCX (khac PDF) GAN NHAT da tao san qua run_ai_review_full() (cung co che voi
    get_highlight_preview_bytes/confirm_ai_review ben duoi - KHONG tao lai, chi doc dung file da
    co). Dung lam nguon nhap ban nhap Word Editor THAY VI goi thang
    contract_drive_service._resolve_contract_source_file() (ban GOC chua to mau) - BUG da xac nhan
    qua Playwright that: tab "Bản AI Highlight" (PDF) hien dung 3 doan vang nhung tab "Chinh sua
    (Word)" mo ra TRANG (vi start_edit_session cu lay thang file goc). Tra None neu CHUA co review
    nao, hoac review gan nhat chi co ban Highlight dang PDF (nguon la PDF, khong the nap thang vao
    OnlyOffice nhu DOCX sua duoc - caller tu fallback ve ban goc/convert PDF nhu binh thuong, dung
    gia vo sua duoc PDF nhu DOCX theo dung nguyen tac #8).

    AN TOAN QUAN TRONG (khong co trong bug report goc nhung PHAT HIEN khi code fix - tranh mat sua
    cua Sale): review Highlight co the da STALE so voi noi dung hieu luc HIEN TAI (vi du Sale da
    `promote_to_version` 1 lan truoc do, tao version MOI, nhung AI Review CHUA duoc chay lai tren
    version do) - neu cu nap Highlight CU vao editor se am tham "revert" noi dung ve ban truoc khi
    Sale sua, mat trang. Chi dung Highlight khi `contract_content_hash` cua review KHOP DUNG hash
    cua `current_source_content` (noi dung hieu luc hien tai) - khong khop thi coi nhu "chua co
    Highlight cho ban nay", fallback ve file goc (dung = chinh ban hieu luc hien tai, chi la chua
    to mau vi AI chua chay lai, KHONG mat gi)."""
    sb = get_supabase_client()
    rows = (
        sb.table("contract_ai_reviews").select("id, highlight_source_key, highlight_file_name, contract_content_hash")
        .eq("contract_id", contract_id).order("created_at", desc=True).limit(1).execute().data
    )
    if not rows or not rows[0].get("highlight_source_key"):
        return None
    row = rows[0]
    if row.get("contract_content_hash") != _content_hash(current_source_content):
        logger.info(
            "get_latest_ai_highlight_docx: review gần nhất của hợp đồng %s đã stale so với nội dung "
            "hiệu lực hiện tại (vd. đã có version mới sau khi Sale lưu) - dùng file gốc hiện hành, "
            "không nạp lại Highlight cũ.", contract_id,
        )
        return None
    ext = (row.get("highlight_file_name") or "").rsplit(".", 1)[-1].lower()
    if ext != "docx":
        return None  # ban Highlight gan nhat la PDF - khong dung lam nguon Word Editor
    result = get_highlight_preview_bytes(row["id"])
    if result is None:
        return None
    content, _mime = result
    return content, row.get("highlight_file_name") or "highlight.docx"


def get_highlight_preview_bytes(review_id: str) -> tuple[bytes, str] | None:
    """Tai bytes Highlight DA TAO SAN o run_ai_review_full() de FE xem truoc - tra ve
    (content, mime_type) hoac None neu chua co (dinh dang chua ho tro/loi tao truoc do)."""
    from app.modules.all_platform.services import contract_document_store

    sb = get_supabase_client()
    rows = sb.table("contract_ai_reviews").select("highlight_source_bucket, highlight_source_key, highlight_file_name").eq("id", review_id).limit(1).execute().data
    if not rows or not rows[0].get("highlight_source_key"):
        return None
    key = rows[0]["highlight_source_key"]
    ext = (rows[0].get("highlight_file_name") or "").rsplit(".", 1)[-1].lower()
    mime = "application/pdf" if ext == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    content = contract_document_store._bucket().download(key)  # noqa: SLF001
    return content, mime


async def confirm_ai_review(contract_id: str, review_id: str, actor_id: str | None) -> dict[str, Any]:
    """(B5, nguyen tac #6, sua lai UX_FIX_2026-10-27) Sale xac nhan - CHI day DUNG file Highlight
    DA TAO SAN (xem truoc o run_ai_review_full) len Drive, KHONG tao lai/sinh moi - dam bao ban
    xem truoc == ban luu Drive 100%."""
    from app.modules.all_platform.services.contract_drive_service import (
        _resolve_company_label,
        ensure_contract_folder,
        upload_new_file_with_hash,
    )

    sb = get_supabase_client()
    review_rows = sb.table("contract_ai_reviews").select("*").eq("id", review_id).eq("contract_id", contract_id).limit(1).execute().data
    if not review_rows:
        raise ValueError("Không tìm thấy kết quả AI Review tương ứng")
    review = review_rows[0]
    if not review.get("highlight_source_key"):
        raise ValueError("Chưa có bản Highlight xem trước để xác nhận — vui lòng chạy lại AI Review")

    contract_rows = sb.table("contracts").select("*").eq("id", contract_id).limit(1).execute().data
    if not contract_rows:
        raise ValueError("Không tìm thấy hợp đồng")
    contract = contract_rows[0]

    # (2026-10-27, fix bug "xac nhan nham ban Review cu") Yeu cau sep #7: "API confirm phai xac
    # minh dung version/hash... khong lay nham ban moi nhat". Kiem tra LAI ngay truoc khi day
    # Drive - hop dong/bao gia co the da doi TU LUC review nay duoc tao (vd Sale mo tab khac
    # sua hop dong trong luc dang xem AI Review) - KHONG cho xac nhan 1 ban Highlight da loi thoi.
    if review.get("rules_version") != RULES_VERSION:
        raise ValueError("Kết quả AI Review này dùng phiên bản quy tắc cũ — hãy chạy lại AI Review trước khi xác nhận.")
    current_contract_hash, current_quote_hash = await _compute_current_hashes(contract)
    if current_contract_hash is not None and review.get("contract_content_hash") != current_contract_hash:
        raise ValueError("Tài liệu hợp đồng đã thay đổi từ lúc chạy AI Review này — hãy chạy lại AI Review trước khi xác nhận.")
    if review.get("quote_content_hash") != current_quote_hash:
        raise ValueError("Báo giá liên kết đã thay đổi từ lúc chạy AI Review này — hãy chạy lại AI Review trước khi xác nhận.")

    preview = get_highlight_preview_bytes(review_id)
    if preview is None:
        raise ValueError("Không tải được bản Highlight đã tạo trước đó")
    highlight_bytes, out_mime = preview
    highlight_filename = review["highlight_file_name"]

    company_label = _resolve_company_label(contract)
    folder_id = ensure_contract_folder(contract["instance"], company_label, contract.get("contract_number") or contract_id)
    drive_result = upload_new_file_with_hash(folder_id, highlight_filename, highlight_bytes, out_mime)

    if not drive_result["reused"]:  # chong trung dong DB khi file duoc tai dung (da xac nhan bug that o sync_contract_file)
        sb.table("contract_drive_files").insert({
            "contract_id": contract_id, "drive_file_id": drive_result["drive_file_id"],
            "file_name": highlight_filename, "file_type": "ai_highlight",
            "content_hash": drive_result["content_hash"], "source_bucket": HIGHLIGHT_BUCKET,
        }).execute()
    sb.table("contract_ai_reviews").update({
        "confirmed_by": actor_id, "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "drive_file_id": drive_result["drive_file_id"],
    }).eq("id", review_id).execute()

    return {"status": "confirmed", "driveFileId": drive_result["drive_file_id"], "fileName": highlight_filename}
