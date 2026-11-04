"""Service upload attachment cho CRM pipeline lên Supabase Storage.

Bucket: ``crm-attachments`` (public read). Cấu trúc path trong bucket:

    <stage>/<customer_id_or_uuid>/<timestamp>__<safe_filename>

Trong đó ``<stage>`` là 1 trong:
  - ``brief``        — brief yêu cầu (requirement stage)
  - ``proposal``     — proposal (proposal_sent stage)
  - ``contract``     — hợp đồng (contract_sent stage)

Mỗi customer deal có thể có nhiều file qua các lần stage change → phân tách
theo customer_id + timestamp để không trùng key.
"""

from __future__ import annotations

import logging
import os
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Tuple

logger = logging.getLogger(__name__)

BUCKET_NAME = "crm-attachments"

# Supabase Storage giới hạn key length 1024 chars + an toàn dấu /. Ở đây key
# luôn < 256 ký tự → không lo.
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    """Chuẩn hoá tên file: bỏ dấu, thay ký tự lạ thành `_`, giữ extension."""
    # Bỏ dấu tiếng Việt
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c))
    safe = _SAFE_FILENAME_RE.sub("_", ascii_only).strip("._")
    if not safe:
        safe = "file"
    # Giới hạn 120 ký tự
    if len(safe) > 120:
        base, dot, ext = safe.rpartition(".")
        if dot and len(ext) < 8:
            safe = base[: 120 - len(ext) - 1] + "." + ext
        else:
            safe = safe[:120]
    return safe


def _build_object_key(prefix: str, customer_id: str | None, filename: str) -> str:
    """Build key dạng ``<prefix>/<customer_or_uuid>/<ts>__<safe>``.

    ``customer_id`` có thể None (chưa gắn với deal cụ thể — vd upload từ
    màn hình tạo deal mới trước khi có ID). Khi đó dùng uuid4 thay thế.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    sub = customer_id or "unbound"
    return f"{prefix}/{sub}/{ts}__{_safe_filename(filename)}"


def upload_attachment(
    *,
    prefix: str,
    customer_id: str | None,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    bucket: str = BUCKET_NAME,
) -> Tuple[str | None, str | None]:
    """Upload 1 file lên Supabase Storage. Trả về ``(public_url, error)``.

    - ``prefix``: ``"brief"`` | ``"proposal"`` | ``"contract"``.
    - ``customer_id``: UUID của deal (optional, dùng uuid4 nếu None).
    - ``filename``: tên file gốc (sanitize trước khi build key).
    - ``content``: bytes của file.
    - ``content_type``: MIME (mặc định octet-stream nếu không biết).

    Trả về ``(public_url, None)`` nếu thành công, ``(None, error_msg)`` nếu lỗi.
    KHÔNG raise — caller quyết định HTTP status.

    Lưu ý: bucket ``crm-attachments`` cần được tạo public ở Supabase
    Dashboard (Storage → New bucket → Public). Nếu chưa có → trả lỗi
    ``"bucket_not_found"`` để caller hiển thị hướng dẫn admin.
    """
    try:
        from app.core.supabase_client import get_supabase_client

        client = get_supabase_client()
        key = _build_object_key(prefix, customer_id, filename)
        # QUAN TRỌNG: storage3 (thư viện supabase-py dùng) đọc file_options như
        # HTTP headers THẬT (key "content-type"/"cache-control" — xem
        # storage3/_sync/file_api.py: `headers.pop("content-type")`), KHÔNG
        # phải camelCase "contentType"/"cacheControl" như trước đây. Dùng sai
        # key khiến giá trị bị bỏ qua ÂM THẦM (không lỗi), rơi về mặc định
        # DEFAULT_FILE_OPTIONS["content-type"] = "text/plain;charset=UTF-8" —
        # mọi file (PDF, ảnh...) upload xong đều bị phục vụ với Content-Type
        # sai, trình duyệt không mở/hiển thị được, chỉ hiện chữ lộn xộn.
        options: dict[str, Any] = {"cache-control": "3600", "upsert": False}
        if content_type:
            options["content-type"] = content_type

        # supabase-py v2: storage.from_(bucket).upload(path, file, options)
        client.storage.from_(bucket).upload(
            key,
            content,
            file_options=options,
        )

        # Lấy public URL — bucket phải public thì mới truy cập được.
        public_url = client.storage.from_(bucket).get_public_url(key)
        return public_url, None
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}"
        logger.error("Upload %s/%s failed: %s", prefix, filename, msg)
        # Bucket chưa tạo → Supabase trả 404 'Bucket not found'
        if "Bucket not found" in msg or "not found" in msg.lower():
            return None, (
                f"Bucket Supabase Storage '{bucket}' chưa được tạo. "
                "Vào Supabase Dashboard → Storage → New bucket → tên 'crm-attachments', tick Public."
            )
        return None, msg


def allowed_mime(content_type: str | None) -> bool:
    """Whitelist MIME cho phép. Tránh upload file thực thi."""
    if not content_type:
        return False
    ok = (
        content_type.startswith("image/")
        or content_type == "application/pdf"
        or content_type.startswith("video/")
        or content_type.startswith("audio/")
        or content_type in (
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/plain",
            "text/csv",
            "application/zip",
            "application/x-7z-compressed",
            "application/x-rar-compressed",
        )
    )
    return ok


# Giới hạn kích thước 25MB — đủ cho PDF scan, ảnh, video ngắn.
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024