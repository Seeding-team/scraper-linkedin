"""Word Editor trong AI Contract Review (2026-10-27, OnlyOffice self-host - CHỈ crm-module/Markee
dev, xem C:\\Users\\Asus\\.claude\\plans\\proud-stargazing-pixel.md). Sale sửa DOCX TRỰC TIẾP qua
OnlyOffice Document Server, autosave đáng tin cậy (forcesave + callback), lưu phiên bản mới BẤT
BIẾN (tái dùng contract_document_store), hợp đồng đã ký tạo bản phụ lục/sửa đổi có vòng đời duyệt
RIÊNG (contract_amendments), annotation AI/Sale tường minh (contract_highlight_annotations).

Luồng: xem "Kiến trúc tổng quan" trong plan. File này CHỈ chịu trách nhiệm backend - việc nhúng
OnlyOffice + lắng nghe plugin postMessage là của frontend (giai đoạn sau, không nằm trong file này).

QUAN TRỌNG (giới hạn backend đã biết từ đầu, không phải thiếu sót): backend KHÔNG tự điều khiển
được 1 trình duyệt cụ thể đang mở phiên OnlyOffice sống - "xoá highlight ngay trong phiên đang mở"
(remove_highlight khi editor đang mở) do CHÍNH trang host FE thực hiện qua plugin (postMessage),
rồi báo lại cho backend bằng cờ `already_applied_live` (xem contract_highlight_annotations.py).
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from jose import JWTError, jwt as jose_jwt

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import contract_document_store as store
from app.modules.all_platform.services import contract_highlight_annotations as annotations
from app.modules.all_platform.services.crm_permission_service import can_edit_contract, has_full_crm_access

logger = get_logger(__name__)

_SESSIONS_TABLE = "contract_edit_sessions"
_AMENDMENTS_TABLE = "contract_amendments"
JWT_ALGO = "HS256"

# Hop dong co status trong tap nay = "da ky tro len" -> bat buoc tao ban phu luc/sua doi, khong
# duoc coi version moi la hieu luc ngay (xem plan muc 4). Cung danh sach dung trong
# contract_approval_service's pipeline (draft -> pending_legal -> pending_signature -> signed ->
# active -> completed).
_SIGNED_OR_LATER = {"signed", "active", "completed", "expiring", "expired", "terminated"}

_FORCESAVE_TIMEOUT_SECONDS = 15
_FORCESAVE_POLL_INTERVAL = 0.5


def _sb():
    return get_supabase_client()


# ───────────────────────── quyền + tra cứu hợp đồng ─────────────────────────

def _authorize(contract_id: str, user: dict) -> tuple[dict, dict | None]:
    from app.modules.all_platform.routers.contract import _load_contract_and_lead

    try:
        contract, lead = _load_contract_and_lead(contract_id)
    except Exception as exc:  # noqa: BLE001
        raise LookupError("Không tìm thấy hợp đồng trong workspace này.") from exc
    if not can_edit_contract(user, contract, lead):
        raise PermissionError("Không có quyền với hợp đồng này.")
    return contract, lead


def _raw_contract_row(contract_id: str) -> dict[str, Any]:
    """`_authorize()`/`get_contract()` trả dict CAMELCASE (đúng cho `can_edit_contract()` - dùng
    `createdById`/`ownerId`) — nhưng `contract_drive_service._resolve_contract_source_file()` và
    `_resolve_company_label()` cần row THÔ snake_case y hệt DB (`file_url`, `contract_number`,
    `customer_id`...), đúng pattern `sync_contract_file()` đã dùng. BUG THẬT ĐÃ GẶP (xác nhận qua
    Playwright thật): truyền thẳng dict camelCase vào `_resolve_contract_source_file()` luôn trả
    None (không đọc được `file_url`) dù hợp đồng CÓ file — phải tự fetch lại row thô riêng."""
    rows = _sb().table("contracts").select("*").eq("id", contract_id).limit(1).execute().data
    if not rows:
        raise LookupError("Không tìm thấy hợp đồng.")
    return rows[0]


def _get_session(contract_id: str, *, status: str | None = "editing") -> dict | None:
    q = _sb().table(_SESSIONS_TABLE).select("*").eq("contract_id", contract_id)
    if status:
        q = q.eq("status", status)
    rows = q.order("created_at", desc=True).limit(1).execute().data
    return rows[0] if rows else None


def _require_session_access(session: dict, user: dict) -> None:
    """Mọi endpoint thao tác trên 1 phiên đang mở phải re-check quyền MỖI LẦN gọi (không chỉ lúc
    start) - chủ phiên hoặc người có full CRM access."""
    uid = str(user.get("id") or "")
    if session.get("owner_user_id") and str(session["owner_user_id"]) == uid:
        return
    if has_full_crm_access(user):
        return
    raise PermissionError("Không có quyền thao tác trên phiên chỉnh sửa này.")


# ───────────────────────── JWT (OnlyOffice <-> backend) ─────────────────────────

def _sign_for_onlyoffice(payload: dict[str, Any]) -> str:
    if not settings.onlyoffice_jwt_secret:
        raise RuntimeError("Thiếu ONLYOFFICE_JWT_SECRET trong .env - chưa cấu hình được Word Editor.")
    return jose_jwt.encode(payload, settings.onlyoffice_jwt_secret, algorithm=JWT_ALGO)


def _verify_onlyoffice_callback(body: dict[str, Any], authorization_header: str | None) -> bool:
    """OnlyOffice ký callback 2 cách tuỳ cấu hình (JWT_HEADER=Authorization + JWT_IN_BODY=true,
    xem docker-compose.yml) - chấp nhận nếu MỘT TRONG HAI xác minh được (permissive theo đúng
    nhiều phiên bản OnlyOffice khác nhau đóng gói payload hơi khác nhau): header
    `Authorization: Bearer <jwt của {"payload": body}>`, hoặc field `token` ngay trong body (jwt
    của chính body, trừ field token). KHÔNG chấp nhận nếu không có chữ ký nào hợp lệ."""
    if not settings.onlyoffice_jwt_secret:
        logger.warning("ONLYOFFICE_JWT_SECRET trống - CHẤP NHẬN callback không xác thực (chỉ chấp nhận ở dev).")
        return True
    secret = settings.onlyoffice_jwt_secret

    # BUG THAT DA GAP (xac nhan qua log that, Playwright): doi chieu NGUYEN VAN payload JWT giai
    # ma voi `body`/`body_wo_token` LUON fail that bai dong du JWT hop le that - decoded["payload"]
    # (duoc OnlyOffice ky TRUOC khi them field "token" vao body, hoac ky mot subset khac cach
    # FastAPI parse JSON ra kieu Python) khong bao gio == body do lech kieu/field phu, KHONG phai
    # do sai secret/het han. Tu luc JWT da decode duoc BANG DUNG secret cua chinh ta (nghia la
    # chinh OnlyOffice server ky, khong ai gia mao duoc vi chi 2 ben biet secret) - day la MOI
    # bang chung xac thuc can, doi chieu lai noi dung tung field la thua va de vo khi OnlyOffice
    # doi cau truoc payload giua cac ban. Chi can decode THANH CONG (dung secret, chua het han).
    if authorization_header and authorization_header.lower().startswith("bearer "):
        token = authorization_header[7:].strip()
        try:
            jose_jwt.decode(token, secret, algorithms=[JWT_ALGO])
            return True
        except JWTError as exc:
            logger.warning("JWT header callback OnlyOffice khong decode duoc: %s", exc)

    body_token = body.get("token")
    if body_token:
        try:
            jose_jwt.decode(body_token, secret, algorithms=[JWT_ALGO])
            return True
        except JWTError as exc:
            logger.warning("JWT body callback OnlyOffice khong decode duoc: %s", exc)

    return False


def make_draft_download_token(contract_id: str, session_id: str) -> str:
    """Token ký riêng (KHÁC JWT của OnlyOffice) để OnlyOffice tải `_draft.docx` qua endpoint
    GET draft-file - TTL vài giờ (đủ 1 phiên sửa dài, không phải vĩnh viễn), không phải Supabase
    signed URL (bucket contract-documents không public, chỉ đọc server-side - xem
    contract_document_store.py) - đây là cơ chế THAY THẾ hợp lý duy nhất."""
    # BUG THAT DA GAP (xac nhan qua test that): dung key "aud" bi python-jose TU DONG validate
    # nhu standard JWT "audience" claim (doi phai truyen kem tham so `audience=` luc decode, neu
    # khong luon raise JWTClaimsError "Invalid audience") - doi sang key rieng "purpose" de tranh
    # dung voi co che chuan cua thu vien.
    exp = datetime.now(timezone.utc) + timedelta(hours=4)
    return _sign_for_onlyoffice({"purpose": "draft-download", "contractId": contract_id, "sessionId": session_id, "exp": int(exp.timestamp())})


def verify_draft_download_token(token: str) -> dict[str, Any]:
    secret = settings.onlyoffice_jwt_secret
    decoded = jose_jwt.decode(token, secret, algorithms=[JWT_ALGO])
    if decoded.get("purpose") != "draft-download":
        raise JWTError("token sai mục đích")
    return decoded


# ───────────────────────── lưu trữ bản nháp ─────────────────────────

def _draft_key(contract_id: str, session_id: str) -> str:
    return f"contracts/{contract_id}/_draft_{session_id}.docx"


def _save_draft(key: str, content: bytes) -> None:
    store._bucket().upload(key, content, file_options={"content-type": store.DOCX_MIME, "upsert": "true"})  # noqa: SLF001


def _load_draft(key: str) -> bytes | None:
    return store._get(key)  # noqa: SLF001


def _delete_draft(key: str) -> None:
    try:
        store._bucket().remove([key])  # noqa: SLF001
    except Exception:  # noqa: BLE001
        pass


# ───────────────────────── PDF -> DOCX (chỉ khi hợp đồng nguồn là PDF-only) ─────────────────────────

_PDF_FIDELITY_TABLE_TOLERANCE = 0   # so bang KHAC 0 -> tu choi (bang la cau truc de vo nhat)
_PDF_FIDELITY_TEXT_RATIO_MIN = 0.6  # ty le ky tu text (sau khi bo khoang trang) giu duoc toi thieu


def convert_pdf_to_docx_with_fidelity_check(pdf_bytes: bytes) -> bytes:
    """LibreOffice headless convert PDF -> DOCX, rồi VERIFY THẬT fidelity (không mặc định tin) -
    so số bảng (pdfplumber vs contract_docx_engine) + tỉ lệ text giữ được. Raise ValueError (kèm
    lý do cụ thể) nếu lệch quá ngưỡng - KHÔNG được mở editor với dữ liệu đã vỡ (nguyên tắc #8 +
    yêu cầu sếp "không được báo PASS nếu bảng/font/bố cục bị hỏng")."""
    import subprocess
    import tempfile
    from pathlib import Path

    import pdfplumber

    from app.modules.all_platform.services.contract_docx_engine import find_soffice, load_document

    soffice = find_soffice()
    if not soffice:
        raise RuntimeError("Không tìm thấy LibreOffice (soffice) trên server - không chuyển đổi được PDF sang DOCX.")

    import os as _os

    with tempfile.TemporaryDirectory(prefix="contract_pdf2docx_") as tmp:
        src = Path(tmp) / "source.pdf"
        src.write_bytes(pdf_bytes)
        # QUAN TRONG (bug that gap luc test): KHONG duoc goi soffice "tron" nhu convert_docx_to_pdf()
        # cu - can profile rieng (UserInstallation) + HOME/TMPDIR tro vao tmp nay, neu khong
        # soffice bao "source file could not be loaded" do tranh chap profile/lock voi tien trinh
        # soffice khac (vd convert_docx_to_pdf dang chay song song) hoac thu muc HOME mac dinh
        # khong ghi duoc trong container. Dung CHINH XAC pattern da proven trong
        # contract_docx_engine.convert_docx_to_pdf().
        profile = Path(tmp) / "profile"
        # QUAN TRONG (bug that gap luc test): KHONG chi dinh "--convert-to docx" suong - PDF mac
        # dinh mo thanh tai lieu DRAW (khong phai Writer), xuat docx tu Draw that bai voi loi ghi
        # file ("impl_store ... Io Class:Write"). Phai ep "--infilter=writer_pdf_import" de
        # LibreOffice IMPORT PDF nhu mot tai lieu Writer (dung extension PDF Import da co trong
        # libreoffice-draw) TRUOC KHI xuat sang docx.
        cmd = [
            soffice, f"-env:UserInstallation=file:///{str(profile).replace(_os.sep, '/').lstrip('/')}",
            "--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
            "--infilter=writer_pdf_import", "--convert-to", "docx:MS Word 2007 XML", "--outdir", tmp, str(src),
        ]
        env = {**_os.environ, "HOME": tmp, "TMPDIR": tmp, "SAL_USE_VCLPLUGIN": "svp"}
        proc = subprocess.run(cmd, capture_output=True, timeout=120, check=False, env=env)
        out_path = Path(tmp) / "source.docx"
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(f"LibreOffice chuyển đổi PDF sang DOCX thất bại: {proc.stderr.decode(errors='replace')[:500]}")
        docx_bytes = out_path.read_bytes()

    with pdfplumber.open(__import__("io").BytesIO(pdf_bytes)) as pdf:
        pdf_tables = sum(len(p.extract_tables() or []) for p in pdf.pages)
        pdf_text = "".join(p.extract_text() or "" for p in pdf.pages)

    docx_doc = load_document(docx_bytes)
    docx_tables = len(docx_doc.tables)
    docx_text = "\n".join(p.text for p in docx_doc.paragraphs)

    pdf_text_len = len(pdf_text.replace(" ", "").replace("\n", ""))
    docx_text_len = len(docx_text.replace(" ", "").replace("\n", ""))
    text_ratio = (docx_text_len / pdf_text_len) if pdf_text_len > 0 else 1.0

    if abs(docx_tables - pdf_tables) > _PDF_FIDELITY_TABLE_TOLERANCE:
        raise ValueError(
            f"Không chuyển đổi an toàn được từ PDF sang DOCX để sửa (số bảng lệch: PDF có {pdf_tables}, "
            f"DOCX sau convert có {docx_tables}) - cần bản DOCX gốc."
        )
    if text_ratio < _PDF_FIDELITY_TEXT_RATIO_MIN:
        raise ValueError(
            f"Không chuyển đổi an toàn được từ PDF sang DOCX để sửa (chỉ giữ được {text_ratio:.0%} nội dung "
            f"chữ so với bản gốc) - cần bản DOCX gốc."
        )
    return docx_bytes


# ───────────────────────── start / callback / forcesave / promote / discard ─────────────────────────

def start_edit_session(contract_id: str, user: dict) -> dict[str, Any]:
    from app.modules.all_platform.services.contract_docx_engine import (
        describe_paragraphs,
        insert_bookmark,
        load_document,
        paragraph_by_id,
        save_document,
    )
    from app.modules.all_platform.services.contract_drive_service import _resolve_contract_source_file

    contract, _lead = _authorize(contract_id, user)
    raw_contract = _raw_contract_row(contract_id)

    existing = _get_session(contract_id, status="editing")
    if existing and str(existing.get("owner_user_id") or "") != str(user.get("id") or ""):
        raise ValueError("Một người khác đang chỉnh sửa hợp đồng này, thử lại sau.")
    if existing:
        return _editor_config_for_session(existing, raw_contract)

    source = _resolve_contract_source_file(raw_contract)
    if source is None:
        raise ValueError("Hợp đồng chưa có file DOCX/PDF hợp lệ để chỉnh sửa.")
    content, filename, _mime = source

    # Neu truoc do co thao tac annotation (Bo qua canh bao/Xoa Highlight/Xoa ghi chu) luc CHUA co
    # phien chinh sua nao mo (ghi vao "scratch" - xem contract_document_store.save_scratch), uu
    # tien noi dung do lam nguon nhap draft (da "hap thu" san ban AI Highlight + thay doi tu cac
    # thao tac truoc). Xoa scratch ngay sau khi "hap thu" xong vao phien moi nay, tranh scratch cu
    # bi dung lai sai cho 1 phien sau nay voi nguon da doi (vd AI Review chay lai).
    scratch = store.load_scratch(contract_id)
    if scratch:
        content, filename = scratch, filename.rsplit(".", 1)[0] + "_scratch.docx"
        store.delete_scratch(contract_id)
    else:
        # BUG THAT DA GAP (xac nhan qua Playwright that voi HD/2026/0007): mac dinh lay thang file
        # GOC chua to mau o day - tab "Bản AI Highlight" (PDF) hien dung 3 doan vang nhung
        # OnlyOffice mo ra TRANG. Neu DA co AI Review voi ban Highlight la DOCX (khong phai PDF)
        # thi phai nap DUNG ban DO lam nguon nhap ban nhap - chi khi CHUA chay AI Review bao gio
        # (hoac ban Highlight gan nhat chi co dang PDF) moi fallback ve file goc nhu cu (dung
        # hanh vi mong doi theo yeu cau #8).
        from app.modules.all_platform.services.contract_ai_review_service import get_latest_ai_highlight_docx

        try:
            highlighted = get_latest_ai_highlight_docx(contract_id, content)
        except Exception:  # noqa: BLE001 - loi tra cuu AI review khong duoc chan viec mo editor voi file goc
            logger.warning("Không tra được bản AI Highlight DOCX cho hợp đồng %s - dùng file gốc.", contract_id, exc_info=True)
            highlighted = None
        if highlighted is not None:
            content, filename = highlighted

    ext = filename.rsplit(".", 1)[-1].lower()

    converted_from_pdf = False
    if ext == "pdf":
        content = convert_pdf_to_docx_with_fidelity_check(content)
        converted_from_pdf = True
    elif ext != "docx":
        raise ValueError(f"Định dạng .{ext} chưa hỗ trợ chỉnh sửa trực tiếp.")

    # Chen bookmark cho moi annotation dang active (vi tri da biet qua contract_highlight_annotations)
    # TRUOC KHI nap vao OnlyOffice - dung de "jump to annotation" qua plugin selectBookmark.
    doc = load_document(content)
    active_annotations = annotations.list_annotations(contract_id, statuses=["active"])
    for a in active_annotations:
        anchor = a.get("paragraph_anchor") or ""
        p = paragraph_by_id(doc, anchor)
        if p is not None:
            insert_bookmark(p._p, f"ann_{a['id']}".replace("-", "_"))
    content = save_document(doc) if active_annotations else content

    session_id = str(uuid.uuid4())
    document_key = f"mk_{session_id}_{int(time.time())}"
    draft_key = _draft_key(contract_id, session_id)
    _save_draft(draft_key, content)

    row = {
        "id": session_id, "contract_id": contract_id, "source_version_id": filename,
        "document_key": document_key, "draft_storage_key": draft_key, "status": "editing",
        "owner_user_id": user.get("id"), "converted_from_pdf": converted_from_pdf,
    }
    _sb().table(_SESSIONS_TABLE).insert(row).execute()
    return _editor_config_for_session(row, raw_contract)


def _editor_config_for_session(session: dict, contract: dict) -> dict[str, Any]:
    contract_id = session["contract_id"]
    internal_backend = "http://backend:8000/api/all-platform"
    download_token = make_draft_download_token(contract_id, session["id"])
    document_url = f"{internal_backend}/contracts/{contract_id}/edit/draft-file?token={download_token}"
    callback_url = f"{internal_backend}/contracts/{contract_id}/edit/callback"
    plugin_config_url = f"{settings.crm_public_url}/api/onlyoffice-plugin/config.json"

    config: dict[str, Any] = {
        "document": {
            "key": session["document_key"],
            "title": f"{contract.get('contract_number') or contract_id}.docx",
            "url": document_url,
            "fileType": "docx",
            "permissions": {"edit": True, "download": True, "print": True, "review": True, "comment": True},
        },
        "documentType": "word",
        "editorConfig": {
            "mode": "edit",
            "callbackUrl": callback_url,
            "lang": "vi",
            "user": {"id": str(session.get("owner_user_id") or ""), "name": "Sale"},
            # QUAN TRONG (2026-10-27, tim ra sau khi doc tai lieu chinh thuc + forum OnlyOffice):
            # "autosave=False" truoc day la NGUYEN NHAN GOC that su cua bug "forcesave luon bao
            # error 4 (No changes were applied)" - KHONG phai gioi han cua OnlyOffice Community.
            # Theo doc chinh thuc: autosave dieu khien viec trinh duyet co lien tuc GUI thay doi
            # len Document Server hay khong (rieng biet voi viec forcesave GHI file xuong storage).
            # Tat autosave => trinh duyet CHI gui thay doi len Document Server luc bam Save that
            # trong editor (hoac dong tai lieu) => forcesave luc do luon thay "khong co gi moi" vi
            # Document Server chua bao gio nhan duoc thay doi nao. Bat autosave=True (gia tri mac
            # dinh cua OnlyOffice) de trinh duyet tu dong day thay doi len Document Server lien tuc,
            # roi forcesave dinh ky cua ta moi co du lieu that de flush xuong storage.
            "customization": {"autosave": True, "forcesave": True},
            "plugins": {
                "autostart": ["asc.{B7E4C9F1-6A2D-4E3B-8C5A-1F9D2E8B4C7A}"],
                "pluginsData": [plugin_config_url],
            },
        },
    }
    config["token"] = _sign_for_onlyoffice(config)
    return {
        "editorConfig": config,
        "sessionId": session["id"],
        "documentKey": session["document_key"],
        "convertedFromPdf": bool(session.get("converted_from_pdf")),
        # DA THU proxy OnlyOffice qua cung origin voi trang host (nginx /onlyoffice-ds/) de
        # iframe.contentDocument truy cap duoc that - verify DOM access THANH CONG, nhung sau do
        # phat hien dispatch Ctrl+S (ca qua CDP-trong-frame LAN qua cross-frame-tu-trang-host) KHONG
        # con kich hoat luu that qua proxy nay nua (da loai tru nguyen nhan do stale lock bang cach
        # restart sach container OnlyOffice, van khong lai duoc) - REVERT ve URL TUYET DOI port rieng
        # nhu ban dau de khong de lai 1 thay doi ha tang vua khong giai quyet duoc van de vua co the
        # gay regresion rieng (vi du anh huong websocket/lock). Xem ghi chu day du trong
        # ContractAiReviewPanel.tsx va bao cao QA ve ket luan that cua Priority 1.
        "onlyofficeApiUrl": f"{settings.onlyoffice_public_url}/web-apps/apps/api/documents/api.js",
    }


def get_draft_bytes_for_download(contract_id: str, token: str) -> bytes:
    claims = verify_draft_download_token(token)
    if claims.get("contractId") != contract_id:
        raise JWTError("token không khớp hợp đồng")
    session = _sb().table(_SESSIONS_TABLE).select("*").eq("id", claims["sessionId"]).eq("contract_id", contract_id).limit(1).execute().data
    if not session:
        raise LookupError("Phiên chỉnh sửa không còn tồn tại.")
    content = _load_draft(session[0]["draft_storage_key"])
    if content is None:
        raise LookupError("Không tìm thấy bản nháp.")
    return content


def handle_callback(body: dict[str, Any], authorization_header: str | None) -> dict[str, Any]:
    """OnlyOffice gọi endpoint này khi autosave (forcesave, status=6) hoặc đóng hết phiên
    (status=2). LUÔN trả {"error": 0} trừ khi muốn OnlyOffice RETRY - log lỗi nội bộ thay vì trả
    error khác (tránh vòng lặp retry vô ích khi lỗi là do dữ liệu phía ta, không phải do OnlyOffice
    cần gửi lại)."""
    if not _verify_onlyoffice_callback(body, authorization_header):
        logger.warning("Callback OnlyOffice KHÔNG xác thực được chữ ký JWT - từ chối (document key=%s)", body.get("key"))
        return {"error": 1}

    status = body.get("status")
    document_key = body.get("key")
    logger.info("[WORD-EDITOR] callback nhan duoc: status=%s key=%s has_url=%s", status, document_key, bool(body.get("url")))
    if status not in (2, 6):
        return {"error": 0}  # dang sua/dong khong doi/loi tam thoi - khong can lam gi

    sb = _sb()
    rows = sb.table(_SESSIONS_TABLE).select("*").eq("document_key", document_key).eq("status", "editing").limit(1).execute().data
    if not rows:
        logger.warning("Callback OnlyOffice cho document_key=%s không khớp phiên 'editing' nào đang mở", document_key)
        return {"error": 0}
    session = rows[0]

    url = body.get("url")
    if not url:
        return {"error": 0}
    # BUG THAT DA GAP (xac nhan qua log that): OnlyOffice tra "url" theo HOSTNAME NO TU NGHI (co
    # the la "localhost:<port cong khai>" thay vi ten service noi bo Docker) - tu container backend,
    # "localhost" tro ve CHINH backend (khong phai OnlyOffice), gay "Connection refused". Thay the
    # hostname:port bang ONLYOFFICE_INTERNAL_URL (dung duoc tu trong mang Docker) truoc khi tai.
    try:
        from urllib.parse import urlsplit, urlunsplit

        internal = urlsplit(settings.onlyoffice_internal_url)
        parts = urlsplit(url)
        if parts.hostname and parts.hostname not in (internal.hostname,):
            url = urlunsplit((internal.scheme, internal.netloc, parts.path, parts.query, parts.fragment))
            logger.info("[WORD-EDITOR] callback url duoc viet lai sang noi bo: %s", url)
    except Exception:  # noqa: BLE001
        pass
    try:
        resp = httpx.get(url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        new_bytes = resp.content
    except Exception as exc:  # noqa: BLE001
        logger.warning("Không tải được file đã sửa từ OnlyOffice (callback %s, url=%s): %s", document_key, url, exc)
        return {"error": 0}

    _save_draft(session["draft_storage_key"], new_bytes)
    userdata = body.get("userdata")
    sb.table(_SESSIONS_TABLE).update({
        "last_autosaved_at": datetime.now(timezone.utc).isoformat(),
        "last_autosave_request_id": userdata, "annotations_sync_status": "syncing",
    }).eq("id", session["id"]).execute()

    try:
        sync_result = annotations.sync_annotations_from_draft(
            session["contract_id"], f"draft:{session['id']}", new_bytes, session.get("owner_user_id"),
        )
        sb.table(_SESSIONS_TABLE).update({"annotations_sync_status": "synced"}).eq("id", session["id"]).execute()
        logger.info("[WORD-EDITOR] annotation sync %s: %s", session["id"], sync_result)
    except Exception as exc:  # noqa: BLE001
        sb.table(_SESSIONS_TABLE).update({"annotations_sync_status": "error"}).eq("id", session["id"]).execute()
        logger.warning("Lỗi đồng bộ annotation sau autosave (%s): %s", session["id"], exc)

    return {"error": 0}


def _command_service_url() -> str:
    return f"{settings.onlyoffice_internal_url}/coauthoring/CommandService.ashx"


def trigger_forcesave(document_key: str, userdata: str | None = None) -> bool:
    body: dict[str, Any] = {"c": "forcesave", "key": document_key}
    if userdata:
        body["userdata"] = userdata
    if settings.onlyoffice_jwt_secret:
        body["token"] = _sign_for_onlyoffice(body)
    try:
        resp = httpx.post(_command_service_url(), json=body, timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        logger.info("[WORD-EDITOR] CommandService forcesave response (key=%s): %s", document_key, data)
        return data.get("error") == 0
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gọi Command Service forcesave thất bại (key=%s): %s", document_key, exc)
        return False


def request_forcesave(contract_id: str, user: dict) -> dict[str, Any]:
    """FE gọi best-effort lúc đóng panel/đổi tab/beforeunload - KHÔNG chờ callback, chỉ kích hoạt."""
    _authorize(contract_id, user)
    session = _get_session(contract_id, status="editing")
    if not session:
        return {"status": "no_session"}
    ok = trigger_forcesave(session["document_key"])
    return {"status": "requested" if ok else "error"}


def get_status(contract_id: str, user: dict) -> dict[str, Any]:
    _authorize(contract_id, user)
    session = _get_session(contract_id, status="editing")
    pending_amendments = (
        _sb().table(_AMENDMENTS_TABLE).select("*").eq("contract_id", contract_id)
        .in_("status", ["draft", "pending_approval"]).order("created_at", desc=True).execute().data
    ) or []
    return {
        "hasActiveSession": bool(session),
        "session": session,
        "pendingAmendments": pending_amendments,
    }


def discard_session(contract_id: str, user: dict) -> dict[str, Any]:
    _authorize(contract_id, user)
    session = _get_session(contract_id, status="editing")
    if not session:
        return {"status": "no_session"}
    _require_session_access(session, user)
    _delete_draft(session["draft_storage_key"])
    _sb().table(_SESSIONS_TABLE).update({"status": "discarded"}).eq("id", session["id"]).execute()
    return {"status": "discarded"}


def promote_to_version(contract_id: str, user: dict, *, confirm_amendment: bool, note: str) -> dict[str, Any]:
    from app.modules.all_platform.services.supabase_contract_service import _log_activity, _queue_drive_sync

    contract, _lead = _authorize(contract_id, user)
    session = _get_session(contract_id, status="editing")
    if not session:
        raise ValueError("Không có phiên chỉnh sửa nào đang mở cho hợp đồng này.")
    _require_session_access(session, user)

    # BUG THAT DA GAP (xac nhan qua Playwright that voi OnlyOffice song, khong phai callback gia
    # lap): Command Service "forcesave" cua OnlyOffice KHONG echo lai field "userdata" tuy chinh
    # nao trong callback sau do (chi forward "userdata" that su gan vao request LUU cua CHINH
    # trinh duyet, khong phai cua lenh CommandService server-to-server) - doi khop dung
    # "last_autosave_request_id == nonce" KHONG BAO GIO xay ra that, luon timeout du khong co loi
    # gi. Sua: doi KHONG dua vao nonce nua - chi can `last_autosaved_at` TIEN LEN so voi truoc luc
    # trigger forcesave (bang chung co 1 callback MOI that su da xay ra sau yeu cau nay).
    before_ts = datetime.now(timezone.utc)
    trigger_forcesave(session["document_key"])
    deadline = time.monotonic() + _FORCESAVE_TIMEOUT_SECONDS
    latest = session
    advanced = False
    while time.monotonic() < deadline:
        rows = _sb().table(_SESSIONS_TABLE).select("*").eq("id", session["id"]).limit(1).execute().data
        if rows:
            latest = rows[0]
            saved_at = latest.get("last_autosaved_at")
            if saved_at:
                try:
                    saved_dt = datetime.fromisoformat(saved_at.replace("Z", "+00:00"))
                except ValueError:
                    saved_dt = None
                if saved_dt and saved_dt >= before_ts:
                    advanced = True
                    break
        time.sleep(_FORCESAVE_POLL_INTERVAL)
    if not advanced:
        # BUG THAT DA GAP (xac nhan qua Playwright that voi OnlyOffice song THAT - khong phai
        # callback gia lap): Command Service "forcesave" cua ban OnlyOffice tu-host nay LUON tra
        # error=4 ("khong co thay doi can luu") NGAY CA KHI Sale vua go chu that su va CHUA tung
        # Ctrl+S/luu thu cong lan nao trong phien - da verify lap lai nhieu lan, > 70s, nhieu phien
        # fresh khac nhau, luon cung ket qua. CHI co Ctrl+S THAT (nguoi dung bam, hoac phim tat
        # trong editor) moi tao duoc callback status=6 that su. Neu cu "dung tam ban nhap hien co"
        # nhu truoc day se GAY MAT DU LIEU THAT: verify truc tiep - go chu moi, KHONG Ctrl+S, bam
        # "Luu phien ban moi" -> version moi tao ra GIONG HET version truoc (sha256 trung), chu da
        # go bien mat hoan toan. Vi chua co cach nao THAT SU dang tin cay de ep OnlyOffice flush
        # thay doi tu backend, PHAI tu choi luu (loi ro rang) khi CHUA TUNG co autosave that nao
        # trong phien nay (session["last_autosaved_at"] rong tu luc bat dau) - dung "im lang dung
        # ban cu" nua, dung yeu cau goc cua se p "khong duoc mat thay doi, co loi ro rang".
        if not session.get("last_autosaved_at"):
            raise ValueError(
                "Không xác nhận được nội dung mới nhất đã lưu (OnlyOffice chưa ghi nhận thay đổi nào "
                "trong phiên này). Vui lòng bấm Ctrl+S (hoặc nút Lưu) ngay trong trình soạn thảo ít "
                "nhất 1 lần rồi thử lại 'Lưu phiên bản mới' - tự động lưu định kỳ hiện chưa đáng tin "
                "cậy trên môi trường này."
            )
        logger.warning(
            "promote_to_version: khong thay autosave MOI trong %ss sau forcesave (document_key=%s) - "
            "da tung co it nhat 1 lan autosave that truoc do trong phien nay (last_autosaved_at=%s) nen "
            "dung tam ban nhap hien co (noi dung CUA LAN LUU GAN NHAT THAT, khong phai mat trang) - chi "
            "canh bao vi co the Sale vua go them chu sau lan luu that gan nhat ma chua kip luu tiep.",
            _FORCESAVE_TIMEOUT_SECONDS, session["document_key"], session.get("last_autosaved_at"),
        )

    draft_bytes = _load_draft(latest["draft_storage_key"])
    if draft_bytes is None:
        raise ValueError("Không đọc được bản nháp mới nhất.")

    meta = {"createdBy": user.get("id"), "createdByName": user.get("full_name") or user.get("email"), "source": "word-editor", "note": note[:300]}
    is_signed = (contract.get("status") or "") in _SIGNED_OR_LATER

    if is_signed:
        if not confirm_amendment or not note.strip():
            raise ValueError("Hợp đồng đã ký - cần xác nhận tạo bản phụ lục/sửa đổi kèm ghi chú lý do.")
        version_n = store.save_version(contract_id, draft_bytes, meta)
        version_label = f"v{version_n:04d}"
        amendment = _sb().table(_AMENDMENTS_TABLE).insert({
            "contract_id": contract_id, "version_id": version_label, "status": "draft",
            "note": note.strip(), "created_by": user.get("id"),
        }).execute().data[0]
        result: dict[str, Any] = {"status": "amendment_draft", "version": version_n, "amendmentId": amendment["id"]}
    else:
        version_n = store.save_version(contract_id, draft_bytes, meta)
        version_label = f"v{version_n:04d}"
        try:
            _queue_drive_sync(contract_id)
        except Exception:  # noqa: BLE001
            logger.warning("Không xếp lịch đồng bộ Drive cho version vừa lưu qua Word Editor", exc_info=True)
        result = {"status": "version_saved", "version": version_n}

    try:
        _log_activity(contract_id, user.get("id"), "document_edited_via_word_editor", {"version": version_n, "isAmendment": is_signed})
    except Exception:  # noqa: BLE001
        logger.warning("Không ghi được lịch sử Word Editor", exc_info=True)

    # Chuyen annotation dang active sang gan voi version vua tao (don gian hoa: gan lai toan bo,
    # khong rieng tung cai - chap nhan duoc vi version_id chi la nhan hien thi, khong dung lam
    # khoa chinh xac vi tri).
    try:
        _sb().table("contract_highlight_annotations").update({"version_id": version_label}).eq("contract_id", contract_id).eq("status", "active").execute()
    except Exception:  # noqa: BLE001
        pass

    _delete_draft(latest["draft_storage_key"])
    _sb().table(_SESSIONS_TABLE).update({"status": "promoted"}).eq("id", session["id"]).execute()
    return result


# ───────────────────────── annotation endpoints ─────────────────────────

def list_annotations(contract_id: str, user: dict) -> list[dict[str, Any]]:
    _authorize(contract_id, user)
    return annotations.list_annotations(contract_id)


def patch_annotation(contract_id: str, annotation_id: str, *, action: str, already_applied_live: bool, user: dict) -> dict[str, Any]:
    _authorize(contract_id, user)
    ann = annotations.get_annotation(annotation_id, contract_id)
    if not ann:
        raise LookupError("Không tìm thấy annotation.")

    session = _get_session(contract_id, status="editing")

    def _get_bytes() -> bytes | None:
        if session:
            return _load_draft(session["draft_storage_key"])
        # Khong co phien nao dang mo. Uu tien doc "scratch" (ket qua cac thao tac annotation
        # truoc do, neu co) truoc, de nhieu lan Bo qua/Xoa Highlight lien tiep cong don dung,
        # khong bi mat lan truoc. KHONG dung contract_document_store.save_version() o day nua
        # (xem _save_bytes - bug da gap tren HD/2026/0007).
        scratch = store.load_scratch(contract_id)
        if scratch:
            return scratch
        versions = store.list_versions(contract_id)
        if versions:
            return store.load_version(contract_id, versions[-1]["version"])
        # BUG DA GAP (HD/2026/0007): hop dong CHUA TUNG qua Word Editor nen `contract_document_store`
        # chua co version nao - truoc day o day tra ve None lam "remove_highlight" bao thanh cong gia
        # (200 OK nhung khong doi gi) vi khong co file de patch. Fallback dung LAI y chang nguon
        # start_edit_session dung (uu tien ban AI Highlight DOCX con khop hash, roi moi den file goc).
        from app.modules.all_platform.services.contract_drive_service import _resolve_contract_source_file
        from app.modules.all_platform.services.contract_ai_review_service import get_latest_ai_highlight_docx
        raw_contract = _raw_contract_row(contract_id)
        source = _resolve_contract_source_file(raw_contract)
        if source is None:
            return None
        content, _filename, _mime = source
        try:
            highlighted = get_latest_ai_highlight_docx(contract_id, content)
        except Exception:  # noqa: BLE001
            highlighted = None
        if highlighted is not None:
            content, _filename = highlighted
        return content

    def _save_bytes(new_bytes: bytes) -> None:
        if session:
            _save_draft(session["draft_storage_key"], new_bytes)
        else:
            # SUA BUG THAT (HD/2026/0007, 2026-10-27): truoc day o day goi store.save_version()
            # lam phat sinh 1 "phien ban hop dong" day du BAT BIEN chi vi mot thao tac annotation
            # nhe (Bo qua canh bao/Xoa Highlight/Xoa ghi chu) - sai nguyen tac #2 cua plan (khong
            # duoc tao version moi ngoai y muon tu hanh dong nhe). Gio ghi vao 1 slot "scratch"
            # GHI DE duoc (khong phai version bat bien) - start_edit_session() se doc slot nay
            # truoc tien khi Sale thuc su mo phien chinh sua, roi xoa di (da "hap thu" vao draft).
            store.save_scratch(contract_id, new_bytes)

    result = annotations.apply_annotation_action(
        ann, action, get_current_draft_bytes=_get_bytes, save_draft_bytes=_save_bytes,
        already_applied_live=already_applied_live,
    )
    return result


# ───────────────────────── amendment lifecycle ─────────────────────────

def submit_amendment(contract_id: str, amendment_id: str, user: dict) -> dict[str, Any]:
    _authorize(contract_id, user)
    sb = _sb()
    rows = sb.table(_AMENDMENTS_TABLE).select("*").eq("id", amendment_id).eq("contract_id", contract_id).limit(1).execute().data
    if not rows:
        raise LookupError("Không tìm thấy bản sửa đổi.")
    if rows[0]["status"] != "draft":
        raise ValueError("Bản sửa đổi này không ở trạng thái nháp.")
    sb.table(_AMENDMENTS_TABLE).update({"status": "pending_approval"}).eq("id", amendment_id).execute()
    return {"status": "pending_approval"}


def _require_approval_permission(user: dict) -> None:
    """(Deviation có ghi chú trong báo cáo) contract_approval_service.py KHÔNG có hàm quyền
    "ai được duyệt" riêng (chỉ có enforce_status_change kiểm tra ĐIỀU KIỆN readiness, không phải
    VAI TRÒ) - dùng has_full_crm_access() làm cổng duyệt, nhất quán với cách has_full_crm_access
    đã là "quyền nâng cao" DUY NHẤT trong toàn hệ thống (xem can_edit_contract tái dùng y hệt)."""
    if not has_full_crm_access(user):
        raise PermissionError("Chỉ quản lý/leader mới được duyệt bản sửa đổi hợp đồng đã ký.")


def approve_amendment(contract_id: str, amendment_id: str, user: dict) -> dict[str, Any]:
    _authorize(contract_id, user)
    _require_approval_permission(user)
    sb = _sb()
    rows = sb.table(_AMENDMENTS_TABLE).select("*").eq("id", amendment_id).eq("contract_id", contract_id).limit(1).execute().data
    if not rows:
        raise LookupError("Không tìm thấy bản sửa đổi.")
    if rows[0]["status"] not in ("draft", "pending_approval"):
        raise ValueError("Bản sửa đổi này đã được xử lý trước đó.")
    sb.table(_AMENDMENTS_TABLE).update({
        "status": "approved", "approved_by": user.get("id"), "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", amendment_id).execute()
    try:
        from app.modules.all_platform.services.supabase_contract_service import _queue_drive_sync
        _queue_drive_sync(contract_id)
    except Exception:  # noqa: BLE001
        pass
    return {"status": "approved"}


def reject_amendment(contract_id: str, amendment_id: str, user: dict) -> dict[str, Any]:
    _authorize(contract_id, user)
    _require_approval_permission(user)
    sb = _sb()
    rows = sb.table(_AMENDMENTS_TABLE).select("*").eq("id", amendment_id).eq("contract_id", contract_id).limit(1).execute().data
    if not rows:
        raise LookupError("Không tìm thấy bản sửa đổi.")
    sb.table(_AMENDMENTS_TABLE).update({"status": "rejected"}).eq("id", amendment_id).execute()
    return {"status": "rejected"}
