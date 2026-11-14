"""Threads Language Service — Nhận diện ngôn ngữ & Loại bỏ bài viết tiếng Anh / ngoại ngữ cho Threads.

Yêu cầu Master (2026-11-15):
- Riêng nền tảng Threads chỉ nhắm đến các bài viết tiếng Việt.
- Bỏ qua AI check & đánh giá điểm đối với bài viết tiếng Anh / tiếng nước khác (tiết kiệm 100% token AI).
- Gạch bỏ vĩnh viễn khỏi database (threads_posts).
"""

from __future__ import annotations

import re
from typing import Optional

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

# Bảng ký tự tiếng Việt có dấu (cả hoa lẫn thường)
VIETNAMESE_DIACRITICS_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ"
    r"ÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]"
)

# Ký tự chữ tượng hình hoặc ngoại ngữ phi Latin (Trung, Nhật, Hàn, Nga, Thái, Ả Rập...)
FOREIGN_SCRIPTS_RE = re.compile(
    r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]"
)

# Từ dừng phổ biến của tiếng Anh
ENGLISH_STOPWORDS = {
    "the", "and", "is", "in", "to", "of", "for", "with", "on", "at", "from",
    "by", "about", "as", "into", "like", "through", "after", "over", "between",
    "out", "against", "during", "without", "before", "under", "around", "among",
    "this", "that", "these", "those", "it", "its", "they", "them", "their",
    "we", "us", "our", "you", "your", "he", "him", "his", "she", "her",
    "are", "was", "were", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "shall", "should", "may", "might", "must", "can", "could",
    "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
    "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "because", "while", "if", "then", "also", "looking", "project", "need"
}

# Từ vựng tiếng Việt không dấu phổ biến
UNACCENTED_VIETNAMESE_WORDS = {
    "minh", "ban", "can", "tim", "lam", "thiet", "ke", "website", "phan", "mem",
    "gia", "bao", "inbox", "lien", "he", "sdt", "zalo", "nhom", "chia", "se",
    "chao", "nhe", "moi", "nguoi", "ai", "biet", "khong", "duoc", "khach", "hang",
    "ung", "dung", "dich", "vu", "ho", "tro", "re", "uy", "tin", "chat", "luong",
    "chuyen", "nghiep", "cong", "ty", "du", "an", "gia", "re", "chay", "quang", "cao"
}


def is_vietnamese_content(text: Optional[str]) -> bool:
    """Xác định nội dung có phải là tiếng Việt hay không (độ chính xác cao cho Threads).

    - Chặn toàn bộ các ký tự chữ phi Latin (Trung, Nhật, Hàn, Nga, Thái...).
    - Khớp dấu tiếng Việt đặc trưng.
    - Phát hiện và loại bỏ các bài viết thuần tiếng Anh.
    - Hỗ trợ tiếng Việt không dấu phổ biến trong tìm kiếm IT/Seeding.
    """
    if not text or not str(text).strip():
        return False
    clean = str(text).strip()

    # 1. Chặn các bảng chữ cái ngoại quốc phi Latin
    if FOREIGN_SCRIPTS_RE.search(clean):
        return False

    # 2. Kiểm tra dấu tiếng Việt đặc trưng (>= 2 dấu -> 100% tiếng Việt)
    diacritics_matches = VIETNAMESE_DIACRITICS_RE.findall(clean)
    if len(diacritics_matches) >= 2:
        return True

    # 3. Phân tách từ để đối chiếu tiếng Anh vs tiếng Việt không dấu
    words = re.findall(r"\b[a-zA-ZÀ-ỹ]+\b", clean.lower())
    if not words:
        return False

    english_hits = sum(1 for w in words if w in ENGLISH_STOPWORDS)
    vn_hits = sum(1 for w in words if w in UNACCENTED_VIETNAMESE_WORDS)

    # Nếu có 1 dấu tiếng Việt và không bị áp đảo bởi tiếng Anh
    if len(diacritics_matches) == 1 and english_hits <= 2:
        return True

    # Nếu tiếng Anh chiếm ưu thế rõ rệt
    if english_hits >= 3 and english_hits > vn_hits:
        return False
    if len(words) >= 4 and (english_hits / len(words)) >= 0.25:
        return False

    # Nếu có từ vựng tiếng Việt không dấu
    if vn_hits >= 2:
        return True

    # Nếu bài ngắn không có dấu và không có từ tiếng Việt -> Loại trừ
    if len(diacritics_matches) == 0 and vn_hits == 0:
        return False

    return True


def purge_foreign_threads_posts(batch_size: int = 100) -> dict[str, int]:
    """Quét và gạch khỏi DB các bài viết Threads tiếng Anh / ngoại ngữ hiện có."""
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table("threads_posts")
            .select("id, content")
            .order("created_at", desc=True)
            .limit(batch_size)
            .execute()
        )
        rows = res.data or []
        deleted_ids = []
        for r in rows:
            content = r.get("content") or ""
            if not is_vietnamese_content(content):
                deleted_ids.append(r.get("id"))

        if deleted_ids:
            for pid in deleted_ids:
                try:
                    supabase.table("threads_posts").delete().eq("id", pid).execute()
                except Exception as del_err:
                    logger.warning(f"[PURGE-THREADS] Lỗi xóa bài {pid}: {del_err}")

        logger.info(f"[PURGE-THREADS] Đã quét {len(rows)} bài, gạch bỏ {len(deleted_ids)} bài ngoại ngữ khỏi database.")
        return {"scanned": len(rows), "deleted": len(deleted_ids)}
    except Exception as e:
        logger.error(f"[PURGE-THREADS] Lỗi khi quét dọn bài ngoại ngữ Threads: {e}")
        return {"scanned": 0, "deleted": 0, "error": str(e)}
