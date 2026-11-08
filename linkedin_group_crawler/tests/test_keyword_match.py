"""Unit tests for keyword matching & Vietnamese normalization utilities."""

from __future__ import annotations

import sys
from pathlib import Path

# Cho phép test module keyword_match độc lập mà không cần load toàn bộ package app/supabase
services_dir = Path(__file__).resolve().parent.parent / "app" / "modules" / "all_platform" / "services"
if str(services_dir) not in sys.path:
    sys.path.insert(0, str(services_dir))

from keyword_match import (
    has_matching_keyword,
    match_keywords,
    normalize_keyword_text,
    remove_vietnamese_accents,
)


def test_remove_vietnamese_accents():
    # Có dấu sang không dấu
    assert remove_vietnamese_accents("Đa cấp") == "Da cap"
    assert remove_vietnamese_accents("HỘI THẢO ĐẦU TƯ") == "HOI THAO DAU TU"
    assert remove_vietnamese_accents("Tuyển dụng việc làm") == "Tuyen dung viec lam"
    assert remove_vietnamese_accents("Tiếng Việt có dấu: á à ả ã ạ") == "Tieng Viet co dau: a a a a a"
    assert remove_vietnamese_accents("đường đèo Đà Lạt") == "duong deo Da Lat"
    assert remove_vietnamese_accents("") == ""
    assert remove_vietnamese_accents(None) == ""


def test_normalize_keyword_text():
    # Lowercase + stripped accents + single spaces
    assert normalize_keyword_text("  Đa   Cấp   ") == "da cap"
    assert normalize_keyword_text("VIỆC   LÀM THÊM") == "viec lam them"
    assert normalize_keyword_text("Cờ Bạc Online") == "co bac online"
    assert normalize_keyword_text("") == ""
    assert normalize_keyword_text(None) == ""


def test_match_keywords_accent_and_case_insensitive():
    content = "Tham gia hội thảo ĐA CẤP làm giàu không khó tại TP.HCM"
    keywords = ["đa cấp", "tiền ảo", "chứng khoán"]

    matched = match_keywords(content, keywords)
    assert matched == ["đa cấp"]


def test_match_keywords_unaccented_keyword_against_accented_content():
    content = "Nhóm tuyển dụng việc làm thời vụ lương cao"
    keywords = ["viec lam", "tuyen dung", "bat dong san"]

    matched = match_keywords(content, keywords)
    assert "viec lam" in matched
    assert "tuyen dung" in matched
    assert "bat dong san" not in matched


def test_match_keywords_multiple_simultaneous_matches():
    content = "Cảnh báo lừa đảo đầu tư tiền ảo forex và đánh bạc trực tuyến"
    keywords = ["lừa đảo", "tiền ảo", "forex", "đánh bạc", "tuyển sinh"]

    matched = match_keywords(content, keywords)
    assert len(matched) == 4
    assert "lừa đảo" in matched
    assert "tiền ảo" in matched
    assert "forex" in matched
    assert "đánh bạc" in matched
    assert "tuyển sinh" not in matched


def test_match_keywords_no_match():
    content = "Chia sẻ kiến thức lập trình Python và AI cho người mới bắt đầu"
    keywords = ["đa cấp", "cá độ", "lô đề", "tuyển dụng"]

    matched = match_keywords(content, keywords)
    assert matched == []
    assert not has_matching_keyword(content, keywords)


def test_has_matching_keyword():
    content = "Nhận kéo tài xỉu uy tín 100%"
    assert has_matching_keyword(content, ["tai xiu", "lo de"])
    assert not has_matching_keyword(content, ["lap trinh", "marketing"])
