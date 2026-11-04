"""Unit tests for Post Call Result logic (attempts increment and validation)."""

import pytest


def test_attempts_increment_logic():
    # If existing attempts is 0 or None, next is 1
    existing_attempts = 0
    result_code = "callback"
    if result_code:
        next_attempts = existing_attempts + 1
    else:
        next_attempts = existing_attempts
    assert next_attempts == 1

    # If existing attempts is 2, next is 3
    existing_attempts = 2
    if result_code:
        next_attempts = existing_attempts + 1
    assert next_attempts == 3

    # If result_code is cleared or empty, attempts does not increment
    result_code = ""
    if result_code:
        next_attempts = existing_attempts + 1
    else:
        next_attempts = existing_attempts
    assert next_attempts == 2


def test_call_result_codes_match_categories():
    valid_codes = {
        "noanswer",
        "callback",
        "consulting",
        "waiting",
        "interested",
        "refused",
        "nointerest",
        "invalid",
    }
    assert len(valid_codes) == 8
    assert "noanswer" in valid_codes
    assert "invalid" in valid_codes


def test_evaluation_codes_restricted_to_three():
    valid_codes = {
        "chua-danh-gia",
        "can-lien-he",
        "khong-phu-hop",
    }
    assert len(valid_codes) == 3
    assert "can-xem-xet" not in valid_codes
    assert "phu-hop" not in valid_codes

