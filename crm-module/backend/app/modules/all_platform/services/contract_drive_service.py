"""Google Drive - luu file hop dong tren Shared Drive dung chung (2026-10-26, yeu cau sep).

PHASE A1 (hien tai): chi dung client ket noi + ensure_folder() + upload_new_file(), test bang
du lieu throwaway, CHUA dong bo hop dong that. Tien hanh theo plan da duyet (xem
C:\\Users\\Asus\\.claude\\plans\\proud-stargazing-pixel.md).

Nguyen tac bat buoc (xem Context plan):
  - Service account (markee-recruitment-bot@markeeai.iam.gserviceaccount.com) KHONG co dung
    luong tren My Drive thuong - phai dung Shared Drive (ID dang "0A...") da duoc them lam
    Content Manager. Moi goi Drive API phai truyen `supportsAllDrives=True` + (voi files.list)
    `includeItemsFromAllDrives=True`, `corpora='drive'`, `driveId=<shared_drive_id>` - thieu cac
    tham so nay Drive API se KHONG thay/ghi duoc file trong Shared Drive (loi pho bien nhat khi
    dung service account + Shared Drive).
  - KHONG BAO GIO ghi de file da luu (nguyen tac #2 trong plan) - upload_new_file() luon tao
    file MOI, khong co tham so "replace".
  - Private key chi doc tu `settings.google_private_key` (env), KHONG BAO GIO log gia tri hoac
    tra ve trong response loi.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

FOLDER_MIME = "application/vnd.google-apps.folder"
_SCOPES = ["https://www.googleapis.com/auth/drive"]

# Ten workspace hien thi tren Drive (A2) - khac voi gia tri instance ky thuat (SECURITYZONE viet
# hoa toan bo vi ly do lich su) de thu muc Drive nhin gon/dep, khong anh huong gi code khac.
WORKSPACE_DISPLAY_NAMES = {
    "markee": "Markee",
    "cloudgate": "CloudGate",
    "SECURITYZONE": "SecurityZone",
    "timetech": "TimeTech",
}

_drive_service_cache: Any = None


def _drive_client():
    """Tra ve Drive API v3 service da xac thuc bang service account. Cache trong process (token
    tu lam moi noi bo qua thu vien google-auth, khong can tu quan ly het han)."""
    global _drive_service_cache
    if _drive_service_cache is not None:
        return _drive_service_cache
    if not settings.google_service_account_email or not settings.google_private_key:
        raise RuntimeError(
            "Thieu GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY trong .env - chua cau hinh duoc Drive."
        )
    info = {
        "type": "service_account",
        "client_email": settings.google_service_account_email,
        "private_key": settings.google_private_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    credentials = service_account.Credentials.from_service_account_info(info, scopes=_SCOPES)
    _drive_service_cache = build("drive", "v3", credentials=credentials, cache_discovery=False)
    return _drive_service_cache


def shared_drive_id() -> str:
    drive_id = (settings.google_drive_contracts_shared_drive_id or "").strip()
    if not drive_id:
        raise RuntimeError("Thieu GOOGLE_DRIVE_CONTRACTS_SHARED_DRIVE_ID trong .env.")
    return drive_id


def ensure_folder(parent_id: str, name: str) -> str:
    """Tim folder ten `name` ngay trong `parent_id` (trong Shared Drive) - co thi dung lai (idempotent,
    khong tao trung), khong co thi tao moi. Tra ve folder id."""
    client = _drive_client()
    safe_name = name.replace("'", "\\'")
    query = f"name = '{safe_name}' and '{parent_id}' in parents and mimeType = '{FOLDER_MIME}' and trashed = false"
    result = client.files().list(
        q=query,
        corpora="drive",
        driveId=shared_drive_id(),
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        fields="files(id, name)",
        pageSize=10,
    ).execute()
    existing = result.get("files") or []
    if existing:
        return existing[0]["id"]
    created = client.files().create(
        body={"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]},
        supportsAllDrives=True,
        fields="id",
    ).execute()
    return created["id"]


def upload_new_file(folder_id: str, filename: str, content: bytes, mime_type: str) -> str:
    """Luon tao file MOI trong `folder_id` (KHONG ghi de file cung ten - nguyen tac #2). Tra ve
    drive_file_id vua tao."""
    from googleapiclient.http import MediaInMemoryUpload

    client = _drive_client()
    media = MediaInMemoryUpload(content, mimetype=mime_type, resumable=False)
    created = client.files().create(
        body={"name": filename, "parents": [folder_id]},
        media_body=media,
        supportsAllDrives=True,
        fields="id, name, webViewLink",
    ).execute()
    return created["id"]


def delete_file(file_id: str) -> None:
    """Chi dung cho don dep du lieu test throwaway (A1) - KHONG goi trong luong nghiep vu that
    (nguyen tac #2: khong xoa file that da luu).

    QUAN TRONG (xac nhan that qua test A1, khong phai doan): service account chi co vai tro
    "Content Manager" tren Shared Drive - CO THE chuyen vao thung rac (`files.update(trashed=True)`)
    nhung KHONG xoa vinh vien duoc (`files.delete()` tra ve 404 "File not found" du file THAT SU
    ton tai va `files.get()` doc binh thuong - day la gioi han quyen thuc su cua Google Drive,
    chi vai tro "Manager" moi xoa vinh vien duoc, KHONG phai loi code). Vi vay ham nay chi
    CHUYEN VAO THUNG RAC - du don sach khoi moi danh sach/truy van binh thuong, Shared Drive se
    tu xoa han sau thoi gian luu thung rac mac dinh (thuong 30 ngay)."""
    client = _drive_client()
    client.files().update(fileId=file_id, body={"trashed": True}, supportsAllDrives=True).execute()


def content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sanitize_folder_name(name: str) -> str:
    """Drive cho phep hau het ky tu trong ten folder/file (khong nghiem ngat nhu Windows filesystem),
    chi can bo ky tu dieu khien/qua dai de tranh loi API - KHONG can bo dau tieng Viet.

    BUG THAT DA GAP (xac nhan qua backfill that, khong phai doan): `contract_number` trong CRM nay
    co dang "HD/2026/0007" (co dau "/") - Drive API CHO PHEP "/" trong ten (khong phai path
    separator that qua API, chi la 1 ky tu trong chuoi ten) nhung hien ra tren Drive UI/khi tai ve
    may rat de gay hieu nham la 3 cap thu muc long nhau, hoac loi khi he dieu hanh khong cho luu
    file co "/" trong ten. Thay bang "-" cho AN TOAN VA DE DOC."""
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", (name or "").strip())
    cleaned = cleaned.replace("/", "-").replace("\\", "-")
    cleaned = unicodedata.normalize("NFC", cleaned)
    return (cleaned or "Chưa đặt tên")[:150]


def ensure_contract_folder(instance: str, company_label: str, contract_number: str) -> str:
    """Dung day du cay thu muc (A2): {Shared Drive}/{Workspace}/{short_name/company}/{contract_number}/.
    Moi cap deu idempotent qua ensure_folder() - goi lai nhieu lan khong tao trung."""
    root = shared_drive_id()
    workspace_name = WORKSPACE_DISPLAY_NAMES.get(instance, instance)
    workspace_folder = ensure_folder(root, workspace_name)
    company_folder = ensure_folder(workspace_folder, _sanitize_folder_name(company_label))
    contract_folder = ensure_folder(company_folder, _sanitize_folder_name(contract_number))
    return contract_folder


def find_file_by_hash(folder_id: str, content_hash_hex: str) -> dict[str, Any] | None:
    """Tim 1 file trong folder co `properties.contentHash` khop (Drive ho tro gan custom
    properties cho moi file) - dung de chong tao trung THEO NOI DUNG (nguyen tac #2/#5), khong
    chi theo ten. Tra ve {id, name} hoac None."""
    client = _drive_client()
    result = client.files().list(
        q=f"'{folder_id}' in parents and trashed = false and properties has {{ key='contentHash' and value='{content_hash_hex}' }}",
        corpora="drive",
        driveId=shared_drive_id(),
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        fields="files(id, name)",
        pageSize=5,
    ).execute()
    files = result.get("files") or []
    return files[0] if files else None


def upload_new_file_with_hash(folder_id: str, filename: str, content: bytes, mime_type: str) -> dict[str, Any]:
    """Nhu upload_new_file() nhung gan kem `properties.contentHash` (SHA256) de lan sau
    find_file_by_hash() doi chieu duoc, VA tu kiem tra truoc - neu da co file cung hash trong
    folder nay thi KHONG upload lai (chong trung that su theo noi dung, nguyen tac #2/#5). Tra ve
    {drive_file_id, content_hash, reused: bool}."""
    from googleapiclient.http import MediaInMemoryUpload

    digest = content_sha256(content)
    existing = find_file_by_hash(folder_id, digest)
    if existing:
        return {"drive_file_id": existing["id"], "content_hash": digest, "reused": True}
    client = _drive_client()
    media = MediaInMemoryUpload(content, mimetype=mime_type, resumable=False)
    created = client.files().create(
        body={"name": filename, "parents": [folder_id], "properties": {"contentHash": digest}},
        media_body=media,
        supportsAllDrives=True,
        fields="id",
    ).execute()
    return {"drive_file_id": created["id"], "content_hash": digest, "reused": False}


def check_file_readable(file_id: str) -> bool:
    """(A1 mo rong, nguyen tac gop y #4) - kiem tra THAT quyen doc 1 file/Google Doc theo
    file_id truoc khi dung cho files.export()/files.get_media() - KHONG mac dinh "co link la co
    quyen". Tra ve False (khong raise) neu 403/404 - goi noi dung cu the ro rang cho Sale, KHONG
    coi la loi he thong chung chung."""
    client = _drive_client()
    try:
        client.files().get(fileId=file_id, fields="id", supportsAllDrives=True).execute()
        return True
    except HttpError:
        return False


def extract_file_id_from_url(url: str) -> str | None:
    """Lay fileId tu 1 link Google Docs/Drive dang 'docs.google.com/document/d/<id>/edit' hoac
    'drive.google.com/file/d/<id>/view' - cac dang pho bien nhat Sale hay dan vao."""
    m = re.search(r"/d/([a-zA-Z0-9_-]{15,})", url)
    return m.group(1) if m else None


def export_google_doc_as_pdf(file_id: str) -> bytes:
    """Xuat SNAPSHOT tinh (PDF) cua 1 Google Doc qua Drive API `files.export()` - KHONG dung
    Google Docs API, KHONG sua gi Doc goc (nguyen tac #1/#4 trong plan "tao ban review rieng,
    khong chinh sua gg docs goc"). File PDF tra ve duoc chay qua DUNG pipeline highlight_pdf_text/
    highlight_pdf_scan nhu 1 PDF binh thuong."""
    client = _drive_client()
    return client.files().export(fileId=file_id, mimeType="application/pdf").execute()


def _resolve_contract_source_file(contract_row: dict[str, Any]) -> tuple[bytes, str, str] | None:
    """Tai noi dung file CAN dong bo cho 1 hop dong - uu tien `file_url` (luong "Ghi nhan hop dong
    co san", bucket cong khai `crm-attachments`), fallback version DOCX moi nhat trong bucket
    rieng `contract-documents` (luong AI Copilot). Tra ve (content, filename, mime_type) hoac
    None neu khong co gi de dong bo (hop dong chi co thong tin, chua co file/link - dung yeu cau
    "van luu duoc ban ghi, chi hien Chua co tai lieu")."""
    import httpx

    contract_number = _sanitize_folder_name(contract_row.get("contract_number") or contract_row.get("id"))

    # (2026-10-28, Word Editor - fix nguon hieu luc) Mot amendment DA DUYET phai UU TIEN HON
    # file_url/link ngoai - day la hanh dong Sale+nguoi duyet co y DINH RO RANG "noi dung nay
    # bay gio la ban hieu luc". Thieu buoc nay thi moi hop dong "Ghi nhan co san" (co file_url)
    # se KHONG BAO GIO thay doi nguon hieu luc du amendment da duoc duyet - lam vo hieu hoa toan
    # bo he thong duyet amendment cho dung loai hop dong ma no duoc thiet ke de bao ve. Hop dong
    # KHONG co amendment nao duoc duyet van di qua nhanh file_url/version cu NHU HIEN TAI (khong
    # regression).
    from app.modules.all_platform.services import contract_document_store

    approved_version = _latest_approved_amendment_version(contract_row["id"])
    if approved_version is not None:
        content = contract_document_store.load_version(contract_row["id"], approved_version)
        if content:
            return (
                content,
                f"{contract_number}_Goc_v{approved_version}.docx",
                contract_document_store.DOCX_MIME,
            )

    file_url = (contract_row.get("file_url") or "").strip()
    if file_url:
        # Google Docs/Drive link - KHONG tai qua httpx (se tra ve trang HTML dang nhap, khong
        # phai noi dung that) - dung export_google_doc_as_pdf() rieng, kiem tra o sync_contract_file().
        if "docs.google.com" in file_url or "drive.google.com" in file_url:
            return None
        try:
            resp = httpx.get(file_url, timeout=30.0, follow_redirects=True)
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Khong tai duoc file_url cho hop dong %s: %s", contract_row.get("id"), exc)
            return None
        ext = file_url.rsplit(".", 1)[-1].lower() if "." in file_url.rsplit("/", 1)[-1] else "bin"
        mime = resp.headers.get("content-type") or "application/octet-stream"
        return resp.content, f"{contract_number}_Goc.{ext}", mime

    from app.modules.all_platform.services import contract_document_store

    versions = contract_document_store.list_versions(contract_row["id"])
    if versions:
        excluded = _unapproved_amendment_versions(contract_row["id"])
        effective = [v for v in versions if v["version"] not in excluded]
        if effective:
            latest = effective[-1]
            content = contract_document_store.load_version(contract_row["id"], latest["version"])
            if content:
                return content, f"{contract_number}_Goc_v{latest['version']}.docx", contract_document_store.DOCX_MIME

    return None


def _latest_approved_amendment_version(contract_id: str) -> int | None:
    """(2026-10-28, Word Editor - fix nguon hieu luc) Số version DOCX moi nhat gan voi 1
    `contract_amendments` dang 'approved' cho hop dong nay, neu co - day la nguon hieu luc THAT
    SU sau khi nguoi co quyen da duyet ban sua doi. Best-effort: bang/migration 199 chua chay
    hoac khong co amendment nao duoc duyet -> None (hanh vi CU, khong anh huong)."""
    try:
        from app.core.supabase_client import get_supabase_client

        rows = (
            get_supabase_client().table("contract_amendments").select("version_id, approved_at")
            .eq("contract_id", contract_id).eq("status", "approved")
            .order("approved_at", desc=True).limit(1).execute().data
        ) or []
    except Exception:  # noqa: BLE001
        return None
    if not rows:
        return None
    m = re.fullmatch(r"v(\d+)", (rows[0].get("version_id") or "").strip())
    return int(m.group(1)) if m else None


def _unapproved_amendment_versions(contract_id: str) -> set[int]:
    """(2026-10-27, Word Editor - mục 4 plan) Số version gắn với 1 `contract_amendments` đang
    'draft'/'pending_approval' - PHẢI loại khỏi "nguồn hiệu lực" (AI Review, viewer mặc định,
    file Drive hiện hành) cho tới khi amendment được duyệt. Best-effort: bảng/migration 199 chưa
    chạy thì coi như không có amendment nào (hành vi CŨ, không chặn luồng hiện tại)."""
    try:
        from app.core.supabase_client import get_supabase_client

        rows = (
            get_supabase_client().table("contract_amendments").select("version_id")
            .eq("contract_id", contract_id).in_("status", ["draft", "pending_approval"]).execute().data
        ) or []
    except Exception:  # noqa: BLE001
        return set()
    out: set[int] = set()
    for r in rows:
        m = re.fullmatch(r"v(\d+)", (r.get("version_id") or "").strip())
        if m:
            out.add(int(m.group(1)))
    return out


def _resolve_company_label(contract_row: dict[str, Any]) -> str:
    """Ten thu muc cong ty tren Drive - uu tien short_name (tinh nang vua lam truoc do, ten gon
    dep - vd 'STARTECH') cua crm_customers, fallback company_name/customer_name, cuoi cung dung
    ten/manual_customer_name ngay tren hop dong (hop dong AI khong gan CRM)."""
    from app.core.supabase_client import get_supabase_client

    customer_id = contract_row.get("customer_id")
    if customer_id:
        sb = get_supabase_client()
        rows = sb.table("crm_customers").select("short_name, company_name, customer_name").eq("id", customer_id).limit(1).execute().data
        if rows:
            row = rows[0]
            return row.get("short_name") or row.get("company_name") or row.get("customer_name") or "Chưa rõ khách hàng"
    return contract_row.get("manual_customer_name") or "Chưa rõ khách hàng"


def sync_contract_file(contract_id: str) -> dict[str, Any]:
    """(A3) Dong bo file GOC cua 1 hop dong len Drive - idempotent (chong trung qua hash, xem
    upload_new_file_with_hash), best-effort (khong raise len tren - loi duoc goi xu ly ghi vao
    job). Tra ve {status: 'synced'|'skipped'|'error', ...chi tiet}."""
    from app.core.supabase_client import get_supabase_client

    sb = get_supabase_client()
    rows = sb.table("contracts").select("*").eq("id", contract_id).limit(1).execute().data
    if not rows:
        return {"status": "error", "error": "Khong tim thay hop dong"}
    contract = rows[0]

    file_url = (contract.get("file_url") or "").strip()
    source_info = None
    if file_url and ("docs.google.com" in file_url or "drive.google.com" in file_url):
        gdoc_id = extract_file_id_from_url(file_url)
        if not gdoc_id:
            return {"status": "error", "error": "Không đọc được file_id từ link Google Docs/Drive"}
        if not check_file_readable(gdoc_id):
            return {
                "status": "error",
                "error": f"Chưa có quyền đọc link này — cần share cho {settings.google_service_account_email} trước",
            }
        try:
            content = export_google_doc_as_pdf(gdoc_id)
            source_info = (content, f"{_sanitize_folder_name(contract.get('contract_number') or contract_id)}_Goc.pdf", "application/pdf")
        except HttpError as exc:
            return {"status": "error", "error": f"Export Google Doc lỗi: {exc}"}
    else:
        source_info = _resolve_contract_source_file(contract)

    if source_info is None:
        return {"status": "skipped", "reason": "Hợp đồng chưa có file/link hợp lệ để đồng bộ"}

    content, filename, mime_type = source_info
    company_label = _resolve_company_label(contract)
    folder_id = ensure_contract_folder(contract["instance"], company_label, contract.get("contract_number") or contract_id)
    result = upload_new_file_with_hash(folder_id, filename, content, mime_type)

    # BUG THAT DA GAP (xac nhan qua test that, khong phai doan): upload_new_file_with_hash() da
    # dung dedup THEO NOI DUNG tren Drive (khong tao file trung), nhung ham nay truoc do LUON
    # insert 1 dong moi vao contract_drive_files bat ke `reused` - goi lai sync 2 lan (vd worker
    # retry + nguoi dung bam "Dong bo lai") tao 2 dong DB cung tro ve 1 drive_file_id, lam
    # "TAT CA FILE Drive cua hop dong" (A4 UI) hien trung lap. Chi insert khi THAT SU la file moi.
    if not result["reused"]:
        sb.table("contract_drive_files").insert({
            "contract_id": contract_id,
            "drive_file_id": result["drive_file_id"],
            "file_name": filename,
            "file_type": "original",
            "content_hash": result["content_hash"],
            "source_bucket": "crm-attachments" if file_url and "docs.google.com" not in file_url and "drive.google.com" not in file_url else ("google_docs" if file_url else "contract-documents"),
        }).execute()
    sb.table("contracts").update({"drive_folder_id": folder_id}).eq("id", contract_id).execute()

    return {"status": "synced", "driveFileId": result["drive_file_id"], "reused": result["reused"], "folderId": folder_id}


def check_connection() -> dict[str, Any]:
    """Test ket noi toi Shared Drive - tra ve thong tin co ban de xac nhan service account da co
    quyen (dung cho A1, khong dung trong luong nghiep vu that)."""
    client = _drive_client()
    try:
        drive_info = client.drives().get(driveId=shared_drive_id(), fields="id, name").execute()
    except HttpError as exc:
        raise RuntimeError(
            f"Khong doc duoc Shared Drive (kiem tra lai service account da duoc them vao Shared Drive chua): {exc}"
        ) from exc
    return {"driveId": drive_info.get("id"), "driveName": drive_info.get("name")}
