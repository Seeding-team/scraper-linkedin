"""Lưu file mẫu gốc + các phiên bản DOCX của hợp đồng trên Supabase Storage (bucket RIÊNG TƯ, không public).

Không cần migration DB: phiên bản nằm ở tên object, metadata nằm ở file JSON cạnh bên:
  templates/<template_id>/original.<ext>   - file mẫu gốc (không bao giờ bị ghi đè: upsert=false)
  contracts/<contract_id>/v0001.docx       - mỗi lần lưu là 1 phiên bản mới, KHÔNG ghi đè bản cũ
  contracts/<contract_id>/v0001.json       - metadata của phiên bản (người tạo, thời điểm, nguồn, sha256, kết quả AI rủi ro GẮN VỚI phiên bản này)
Chỉ file .json (metadata) được cập nhật (vd thêm kết quả rủi ro); file .docx đã lưu là bất biến.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

BUCKET = "contract-documents"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_VERSION_RE = re.compile(r"^v(\d{4})\.docx$")


def _bucket():
    client = get_supabase_client()
    try:
        client.storage.get_bucket(BUCKET)
    except Exception:  # noqa: BLE001
        try:
            client.storage.create_bucket(BUCKET, options={"public": False})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Không tạo được bucket %s: %s", BUCKET, exc)
    return client.storage.from_(BUCKET)


def _put(key: str, content: bytes, content_type: str, upsert: bool = False) -> None:
    _bucket().upload(key, content, file_options={"content-type": content_type, "cache-control": "3600", "upsert": "true" if upsert else "false"})


def _get(key: str) -> bytes | None:
    try:
        return _bucket().download(key)
    except Exception:  # noqa: BLE001
        return None


def save_template_original(template_id: str, file_name: str, content: bytes) -> str | None:
    """Lưu file mẫu gốc (best-effort: lỗi storage không làm hỏng việc tải mẫu lên). Trả key hoặc None."""
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    key = f"templates/{template_id}/original.{ext}"
    try:
        _put(key, content, DOCX_MIME if ext == "docx" else ("application/pdf" if ext == "pdf" else "application/octet-stream"))
        return key
    except Exception as exc:  # noqa: BLE001
        logger.warning("Không lưu được file mẫu gốc %s: %s", template_id, exc)
        return None


def load_template_original(template_id: str) -> tuple[str, bytes] | None:
    for ext in ("docx", "pdf"):
        data = _get(f"templates/{template_id}/original.{ext}")
        if data:
            return ext, data
    return None


def remove_template_original(template_id: str) -> None:
    try:
        _bucket().remove([f"templates/{template_id}/original.docx", f"templates/{template_id}/original.pdf"])
    except Exception:  # noqa: BLE001
        pass


def load_template_preview_pdf(template_id: str, content_sha256: str) -> bytes | None:
    """PDF xem trước ĐÃ chuyển đổi từ file DOCX gốc, cache theo hash nội dung file gốc (đổi file mới = hash khác = chuyển lại,
    không đụng tới cache của file cũ). Mẫu PDF gốc không cần qua đây (xem thẳng, không convert)."""
    return _get(f"templates/{template_id}/preview-{content_sha256[:16]}.pdf")


def save_template_preview_pdf(template_id: str, content_sha256: str, pdf: bytes) -> None:
    try:
        _put(f"templates/{template_id}/preview-{content_sha256[:16]}.pdf", pdf, "application/pdf", upsert=True)
    except Exception as exc:  # noqa: BLE001  (cache ghi lỗi không được làm hỏng việc xem trước - FE vẫn nhận PDF vừa convert)
        logger.warning("Không lưu được cache PDF xem trước mẫu %s: %s", template_id, exc)


def _meta_key(contract_id: str, version: int) -> str:
    return f"contracts/{contract_id}/v{version:04d}.json"


def load_meta(contract_id: str, version: int) -> dict[str, Any]:
    raw = _get(_meta_key(contract_id, version))
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def update_meta(contract_id: str, version: int, patch: dict[str, Any]) -> dict[str, Any]:
    """Cập nhật metadata (KHÔNG đụng file DOCX). Dùng cho kết quả AI rủi ro của đúng phiên bản."""
    meta = {**load_meta(contract_id, version), **patch}
    _put(_meta_key(contract_id, version), json.dumps(meta, ensure_ascii=False).encode("utf-8"), "application/json", upsert=True)
    return meta


def list_versions(contract_id: str) -> list[dict[str, Any]]:
    try:
        items = _bucket().list(f"contracts/{contract_id}") or []
    except Exception:  # noqa: BLE001
        return []
    out = []
    for it in items:
        m = _VERSION_RE.match(it.get("name") or "")
        if m:
            v = int(m.group(1))
            meta = load_meta(contract_id, v)
            out.append({"version": v, "createdAt": meta.get("createdAt") or it.get("created_at"), "size": (it.get("metadata") or {}).get("size"),
                        "createdBy": meta.get("createdBy"), "createdByName": meta.get("createdByName"), "source": meta.get("source"), "note": meta.get("note"),
                        "sha256": meta.get("sha256"), "risk": meta.get("risk"), "aiModel": meta.get("aiModel")})
    return sorted(out, key=lambda x: x["version"])


def save_version(contract_id: str, docx: bytes, meta: dict[str, Any] | None = None) -> int:
    """Lưu thành phiên bản mới (không ghi đè). Trả số phiên bản."""
    existing = list_versions(contract_id)
    n = (existing[-1]["version"] if existing else 0) + 1
    _put(f"contracts/{contract_id}/v{n:04d}.docx", docx, DOCX_MIME)
    info = {"version": n, "createdAt": datetime.now(timezone.utc).isoformat(), "sha256": hashlib.sha256(docx).hexdigest(), "bytes": len(docx), **(meta or {})}
    try:
        _put(_meta_key(contract_id, n), json.dumps(info, ensure_ascii=False).encode("utf-8"), "application/json")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Không ghi được metadata phiên bản %s/%s: %s", contract_id, n, exc)
    return n


def load_version(contract_id: str, version: int) -> bytes | None:
    return _get(f"contracts/{contract_id}/v{version:04d}.docx")
