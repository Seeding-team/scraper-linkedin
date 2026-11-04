"""Dịch vụ kiểm tra và khử trùng lặp nội dung bài viết (Content Deduplication)
và nhận diện bài viết đối thủ chào mời dịch vụ (Competitor / Seller Filter).

Mục tiêu (yêu cầu Master 2026-11-04):
1. Chống trùng lặp nội dung hoàn toàn: Khi cào bài về, kiểm tra trong database xem
   đã có bài viết nào có content trùng chưa (so khớp content chuẩn hóa, không phụ thuộc link).
   Nếu trùng thì loại bỏ/xóa ngay.
2. Nhận diện đối thủ đăng tìm khách / chào mời dịch vụ: Lọc sạch các bài 'em nhận...',
   'bên em chuyên...', 'inbox em tư vấn', không để lọt vào feed và xóa sạch khỏi database.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional, Set, Tuple, List
from app.core.logger import get_logger

logger = get_logger(__name__)

# Danh sách cụm từ nhận diện đối thủ / bên cung cấp dịch vụ chào mời khách (Seller / Competitor)
_SELLER_PHRASES = (
    "em nhận thiết kế", "bên em nhận thiết kế", "mình nhận thiết kế", "team em nhận thiết kế",
    "nhận thiết kế website", "nhận thiết kế web", "nhận làm website", "nhận làm web",
    "nhận thiết kế landing page", "nhận làm landing page", "nhận làm landingpage",
    "nhận làm app", "nhận code app", "nhận viết app", "nhận viết tool", "nhận làm tool", "nhận code tool",
    "chuyên thiết kế website", "chuyên thiết kế web", "chuyên làm web", "chuyên làm app",
    "bên em chuyên", "bên mình chuyên", "em chuyên thiết kế", "team em chuyên", "team mình chuyên",
    "ib em tư vấn", "inbox em tư vấn", "ib em hỗ trợ", "inbox em hỗ trợ", "ib em báo giá", "inbox em báo giá",
    "liên hệ em tư vấn", "liên hệ bên em", "inbox mình tư vấn", "ib mình tư vấn", "liên hệ mình tư vấn",
    "hỗ trợ kỹ thuật 24/7", "hỗ trợ 24/7", "hợp đồng+ hóa đơn vat", "hợp đồng + hóa đơn vat",
    "hóa đơn vat", "xuất hóa đơn vat", "có xuất vat", "bảo hành trọn đời", "demo miễn phí",
    "giá sinh viên", "chi phí cực rẻ", "kho giao diện phong phú", "kho theme",
    "bác nào cần ib em", "ai cần ib em", "ai cần làm ib em", "ai cần website ib",
    "quý anh chị cần", "quý khách cần", "nhận gia công phần mềm", "nhận outsource",
    "nhận phát triển phần mềm", "hãy liên hệ ngay", "nhắn tin cho em qua zalo",
    "quy trình - chi phí rõ ràng", "chi phí rõ ràng. ib em", "ib em hỗ trợ tư vấn",
)

# Các cụm từ phủ định (chỉ xuất hiện khi KHÁCH HÀNG thực sự đang đi tìm người làm)
_BUYER_INTENT_PHRASES = (
    "cần tìm", "tìm người", "cần thuê", "cần dev", "cần tuyển", "tìm đơn vị",
    "tìm agency", "tìm bên", "cần làm", "cần thiết kế", "ai nhận làm", "ai làm được",
    "mình đang cần", "em đang cần", "bên mình đang cần", "bên em đang cần", "cần báo giá",
)


def normalize_content_for_dedupe(content: Optional[str]) -> str:
    """Chuẩn hoá nội dung để so khớp trùng lặp chính xác:
    - Loại bỏ ký tự điều khiển ẩn
    - Chuẩn hóa Unicode NFC
    - Chuyển chữ thường
    - Gộp toàn bộ khoảng trắng, xuống dòng thành 1 dấu cách duy nhất
    """
    if not content:
        return ""
    text = unicodedata.normalize("NFC", str(content))
    # Loại bỏ emoji hoặc icon trang trí dư thừa để chỉ giữ text cốt lõi nếu cần
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def is_obvious_competitor_seller(content: Optional[str]) -> Tuple[bool, str]:
    """Phát hiện nhanh bài viết của ĐỐI THỦ / BÊN BÁN DỊCH VỤ đăng chào mời khách.
    Trả về (is_competitor: bool, reason: str).
    """
    if not content:
        return False, ""
    norm = normalize_content_for_dedupe(content)
    if len(norm) < 15:
        return False, ""

    # Kiểm tra xem có dấu hiệu chào mời của đối thủ không
    matched_seller_phrase = None
    for phrase in _SELLER_PHRASES:
        if phrase in norm:
            matched_seller_phrase = phrase
            break

    if not matched_seller_phrase:
        return False, ""

    # Kiểm tra trường hợp khách hàng hỏi dạng phủ định: "mình cần tìm người nhận thiết kế..."
    for buyer_phrase in _BUYER_INTENT_PHRASES:
        # Nếu có từ khóa buyer đứng trước từ khóa seller (vd: "cần tìm đơn vị nhận thiết kế...")
        if buyer_phrase in norm:
            b_idx = norm.find(buyer_phrase)
            s_idx = norm.find(matched_seller_phrase)
            if b_idx < s_idx and (s_idx - b_idx) < 50:
                # Đây là khách hàng tìm người nhận làm
                return False, ""

    return True, f"Phát hiện mẫu câu chào mời dịch vụ đối thủ: '{matched_seller_phrase}'"


def fetch_existing_normalized_contents(supabase: Any, table: str, limit: int = 1500) -> Set[str]:
    """Lấy danh sách các content bài viết gần nhất trong database và chuẩn hóa để so khớp."""
    existing_set: Set[str] = set()
    try:
        res = (
            supabase.table(table)
            .select("content")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        for row in (res.data or []):
            raw = row.get("content")
            if raw:
                norm = normalize_content_for_dedupe(raw)
                if len(norm) >= 15:
                    existing_set.add(norm)
    except Exception as e:
        logger.warning(f"[DEDUPE] Lỗi lấy existing contents từ {table}: {e}")
    return existing_set


def filter_posts_by_unique_content(
    supabase: Any,
    table: str,
    posts: List[dict],
    content_key: str = "content",
) -> Tuple[List[dict], int]:
    """Lọc danh sách bài viết cào về:
    1. Khử trùng trong chính batch hiện tại.
    2. Khử trùng với toàn bộ bài viết đã có trong Database theo content.
    Trả về (danh sách bài hợp lệ, số lượng bài bị loại bỏ do trùng content).
    """
    if not posts:
        return [], 0

    existing_set = fetch_existing_normalized_contents(supabase, table)
    unique_posts: List[dict] = []
    seen_in_batch: Set[str] = set()
    skipped_duplicate_count = 0

    for p in posts:
        content_val = p.get(content_key) or ""
        norm = normalize_content_for_dedupe(content_val)

        # Bài quá ngắn không xét trùng nhưng nếu rỗng thì bỏ
        if not norm:
            skipped_duplicate_count += 1
            continue

        if norm in seen_in_batch:
            skipped_duplicate_count += 1
            logger.info(f"[DEDUPE] Bỏ qua bài trùng content trong cùng đợt cào ({table}): '{norm[:60]}...'")
            continue

        if norm in existing_set:
            skipped_duplicate_count += 1
            logger.info(f"[DEDUPE] Bỏ qua bài trùng content đã có trong DB ({table}): '{norm[:60]}...'")
            continue

        seen_in_batch.add(norm)
        existing_set.add(norm)
        unique_posts.append(p)

    return unique_posts, skipped_duplicate_count


def cleanup_duplicate_posts_in_table(supabase: Any, table: str, max_scan: int = 1500) -> int:
    """Quét và xóa bỏ các bài viết đang bị trùng lặp content trong Database,
    chỉ giữ lại 1 bản ghi duy nhất có điểm cao nhất hoặc mới nhất.
    """
    deleted_count = 0
    try:
        res = (
            supabase.table(table)
            .select("id, content, lead_score, score, created_at")
            .order("created_at", desc=True)
            .limit(max_scan)
            .execute()
        )
        rows = res.data or []
        groups: dict[str, list[dict]] = {}

        for r in rows:
            raw = r.get("content")
            if not raw:
                continue
            norm = normalize_content_for_dedupe(raw)
            if len(norm) < 15:
                continue
            groups.setdefault(norm, []).append(r)

        ids_to_delete: list[str] = []
        for norm, items in groups.items():
            if len(items) > 1:
                # Sắp xếp: ưu tiên bài có lead_score cao nhất, rồi đến score, rồi đến created_at mới nhất
                items.sort(
                    key=lambda x: (
                        x.get("lead_score") or 0,
                        x.get("score") or 0,
                        x.get("created_at") or "",
                    ),
                    reverse=True,
                )
                # Giữ items[0], xóa toàn bộ items[1:]
                for dup in items[1:]:
                    if dup.get("id"):
                        ids_to_delete.append(dup["id"])

        if ids_to_delete:
            logger.info(f"[CLEANUP-DEDUPE] Tìm thấy {len(ids_to_delete)} bài trùng content trong {table}, đang xoá...")
            for i in range(0, len(ids_to_delete), 50):
                chunk = ids_to_delete[i : i + 50]
                supabase.table(table).delete().in_("id", chunk).execute()
                deleted_count += len(chunk)
            logger.info(f"[CLEANUP-DEDUPE] Đã xoá thành công {deleted_count} bài trùng trong {table}")

    except Exception as e:
        logger.warning(f"[CLEANUP-DEDUPE] Lỗi quét trùng {table}: {e}")

    return deleted_count


def cleanup_competitor_posts_in_table(supabase: Any, table: str, max_scan: int = 1500) -> int:
    """Quét và xóa triệt để các bài viết của đối thủ chào mời dịch vụ hiện có trong Database."""
    deleted_count = 0
    try:
        res = (
            supabase.table(table)
            .select("id, content")
            .order("created_at", desc=True)
            .limit(max_scan)
            .execute()
        )
        rows = res.data or []
        ids_to_delete: list[str] = []

        for r in rows:
            raw = r.get("content")
            is_comp, reason = is_obvious_competitor_seller(raw)
            if is_comp and r.get("id"):
                ids_to_delete.append(r["id"])

        if ids_to_delete:
            logger.info(f"[CLEANUP-COMPETITOR] Tìm thấy {len(ids_to_delete)} bài đối thủ trong {table}, đang xoá...")
            for i in range(0, len(ids_to_delete), 50):
                chunk = ids_to_delete[i : i + 50]
                supabase.table(table).delete().in_("id", chunk).execute()
                deleted_count += len(chunk)
            logger.info(f"[CLEANUP-COMPETITOR] Đã xoá thành công {deleted_count} bài đối thủ trong {table}")

    except Exception as e:
        logger.warning(f"[CLEANUP-COMPETITOR] Lỗi quét bài đối thủ {table}: {e}")

    return deleted_count

