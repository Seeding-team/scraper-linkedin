"""Vietnamese accent stripping and keyword matching utilities."""

from __future__ import annotations

import unicodedata
from typing import Iterable


def remove_vietnamese_accents(text: str) -> str:
    """Loại bỏ dấu tiếng Việt (chuẩn hóa Unicode NFD + xóa diacritics + đổi đ/Đ thành d/D)."""
    if not text:
        return ""
    # Normalize sang NFD để tách ký tự gốc và dấu thanh
    normalized = unicodedata.normalize("NFD", text)
    # Lọc bỏ các dấu tổ hợp (Nonspacing Mark - Mn)
    no_marks = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    # Chuyển đổi đ/Đ đặc thù của tiếng Việt
    no_marks = no_marks.replace("đ", "d").replace("Đ", "D")
    return no_marks


def normalize_keyword_text(text: str) -> str:
    """Chuẩn hóa chuỗi văn bản: bỏ dấu tiếng Việt, viết thường, gộp khoảng trắng thừa."""
    if not text:
        return ""
    stripped = remove_vietnamese_accents(text).lower()
    # Gộp nhiều khoảng trắng thành 1 khoảng trắng đơn
    return " ".join(stripped.split())


def match_keywords(content: str, keywords: Iterable[str]) -> list[str]:
    """Kiểm tra và trả về danh sách từ khóa gốc khớp trong nội dung (contains match, không phân biệt hoa thường/dấu)."""
    if not content or not keywords:
        return []

    norm_content = normalize_keyword_text(content)
    if not norm_content:
        return []

    matched: list[str] = []
    seen_matched: set[str] = set()

    for kw in keywords:
        if not kw:
            continue
        kw_str = str(kw).strip()
        norm_kw = normalize_keyword_text(kw_str)
        if not norm_kw:
            continue

        if norm_kw in norm_content and norm_kw not in seen_matched:
            matched.append(kw_str)
            seen_matched.add(norm_kw)

    return matched


def has_matching_keyword(content: str, keywords: Iterable[str]) -> bool:
    """Kiểm tra xem nội dung có chứa ít nhất 1 từ khóa hay không."""
    return len(match_keywords(content, keywords)) > 0

