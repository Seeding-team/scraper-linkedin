"""Mã hợp đồng theo workspace: quy tắc cấu hình được + sinh số an toàn khi nhiều request đồng thời.

* Mặc định GIỮ NGUYÊN hành vi hiện tại: `HD/{YYYY}/{SEQ}` (vd HD/2026/0007). Không bao giờ tự đổi mã hợp đồng đã có.
* Quy tắc theo workspace lưu ở bảng `workspace_contract_settings` (migration 184 - ĐÃ VIẾT, CHƯA CHẠY). Bảng chưa có => dùng mặc định và báo
  `schemaReady=false` (không ghi, không lỗi). Token: {SHORT} tên viết tắt công ty phát hành, {YYYY}, {SEQ} (SEQ tăng theo tiền tố đã thay token).
* Tên viết tắt {SHORT} lấy từ hồ sơ công ty phát hành báo giá (`quote_issuer_companies.code`); KHÔNG suy đoán từ tên pháp lý. Thiếu => dùng mặc định.
* Sinh số: đọc max hiện có rồi INSERT; nếu trùng (UNIQUE contract_number) => tính lại và thử lại (xem create_with_retry) - an toàn khi tạo đồng thời.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

DEFAULT_FORMAT = "HD/{YYYY}/{SEQ}"
SETTINGS_TABLE = "workspace_contract_settings"
_TOKEN = re.compile(r"\{(SHORT|YYYY|SEQ)\}")
_SAFE_SHORT = re.compile(r"[^A-Za-z0-9\-]")


def sanitize_short(value: str | None) -> str:
    """Tên viết tắt dùng trong mã: chỉ chữ/số/gạch ngang, in hoa (không dấu cách, không dấu '/')."""
    return _SAFE_SHORT.sub("", (value or "").strip().upper().replace(" ", "-"))[:20]


def validate_format(fmt: str) -> str | None:
    """Trả thông báo lỗi nếu quy tắc không hợp lệ."""
    f = (fmt or "").strip()
    if not f:
        return "Quy tắc mã không được để trống."
    if "{SEQ}" not in f:
        return "Quy tắc phải chứa {SEQ} (số thứ tự) để mã luôn duy nhất."
    if len(f) > 60:
        return "Quy tắc quá dài (tối đa 60 ký tự)."
    leftover = _TOKEN.sub("", f)
    if re.search(r"\{[^}]*\}", leftover):
        return "Chỉ hỗ trợ token {SHORT}, {YYYY}, {SEQ}."
    return None


def get_settings() -> dict[str, Any]:
    """Quy tắc của workspace hiện tại. Bảng chưa tồn tại => mặc định + schemaReady=false."""
    try:
        rows = get_supabase_client().table(SETTINGS_TABLE).select("*").eq("instance", settings.crm_instance).limit(1).execute().data or []
        row = rows[0] if rows else {}
        return {"format": row.get("number_format") or DEFAULT_FORMAT, "shortName": row.get("short_name") or None, "schemaReady": True, "configured": bool(row)}
    except Exception as exc:  # noqa: BLE001
        if "does not exist" in str(exc).lower() or "42p01" in str(exc).lower() or "schema cache" in str(exc).lower() or "pgrst205" in str(exc).lower():
            return {"format": DEFAULT_FORMAT, "shortName": None, "schemaReady": False, "configured": False}
        raise


def save_settings(fmt: str, short_name: str | None, actor_id: str | None) -> dict[str, Any]:
    err = validate_format(fmt)
    if err:
        raise ValueError(err)
    current = get_settings()
    if not current["schemaReady"]:
        raise ValueError("Chưa có bảng cấu hình mã hợp đồng (migration 184 chưa được áp). Quy tắc mặc định HD/{YYYY}/{SEQ} vẫn đang dùng.")
    payload = {"instance": settings.crm_instance, "number_format": fmt.strip(), "short_name": sanitize_short(short_name) or None,
               "updated_by": actor_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    get_supabase_client().table(SETTINGS_TABLE).upsert(payload, on_conflict="instance").execute()
    return get_settings()


def render_prefix(fmt: str, short: str | None, year: int) -> str:
    """Phần trước {SEQ}. {SHORT} thiếu => bỏ token (kèm dấu phân cách thừa) thay vì chèn giá trị bịa."""
    short = sanitize_short(short)
    head = fmt.split("{SEQ}")[0]
    head = head.replace("{YYYY}", str(year))
    head = head.replace("{SHORT}", short) if short else re.sub(r"\{SHORT\}[/\-_.]?", "", head)
    return head


def next_number(existing_numbers: list[str], fmt: str = DEFAULT_FORMAT, short: str | None = None, year: int | None = None) -> str:
    """Hàm thuần: số kế tiếp cho tiền tố đã render. Hậu tố sau {SEQ} (nếu có) được giữ."""
    year = year or datetime.now(timezone.utc).year
    prefix = render_prefix(fmt, short, year)
    suffix = fmt.split("{SEQ}", 1)[1] if "{SEQ}" in fmt else ""
    max_seq = 0
    for num in existing_numbers:
        if num.startswith(prefix) and num.endswith(suffix) if suffix else num.startswith(prefix):
            body = num[len(prefix): len(num) - len(suffix)] if suffix else num[len(prefix):]
            if body.isdigit():
                max_seq = max(max_seq, int(body))
    return f"{prefix}{max_seq + 1:04d}{suffix}"


def peek_next(short: str | None = None) -> dict[str, Any]:
    cfg = get_settings()
    year = datetime.now(timezone.utc).year
    prefix = render_prefix(cfg["format"], short or cfg["shortName"], year)
    rows = get_supabase_client().table("contracts").select("contract_number").like("contract_number", f"{prefix}%").execute().data or []
    return {"example": next_number([r["contract_number"] for r in rows], cfg["format"], short or cfg["shortName"], year), **cfg}


def create_with_retry(insert: Callable[[str], Any], short: str | None = None, attempts: int = 6) -> Any:
    """Sinh số + INSERT, trùng UNIQUE => tính lại số kế tiếp rồi thử lại. `insert(number)` ném lỗi nếu trùng."""
    last: Exception | None = None
    for _ in range(attempts):
        info = peek_next(short)
        try:
            return insert(info["example"])
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            if "duplicate" in msg or "unique" in msg or "23505" in msg:
                last = exc
                continue
            raise
    raise ValueError("Không cấp được mã hợp đồng duy nhất sau nhiều lần thử, vui lòng thử lại.") from last
