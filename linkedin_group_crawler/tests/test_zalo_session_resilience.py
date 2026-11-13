import pytest
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    _looks_like_auth_expired as listener_looks_like_expired,
    _AUTH_EXPIRED_MARKERS as LISTENER_MARKERS,
)
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    _looks_like_auth_expired as bridge_looks_like_expired,
    _AUTH_EXPIRED_MARKERS as BRIDGE_MARKERS,
)


def test_error_code_does_not_trigger_auth_expired():
    """Lỗi API bình thường chứa error_code tuyệt đối không được đánh dấu hết hạn phiên."""
    assert "error_code" not in LISTENER_MARKERS
    assert "error_code" not in BRIDGE_MARKERS

    normal_errors = [
        '{"error_code": 161, "message": "thread does not exist"}',
        '{"error_code": 429, "message": "too many requests"}',
        '{"error_code": 500, "message": "internal server error"}',
        '{"error_code": 1001, "message": "unknown action"}',
        'Socket error with code=10054 error_code=-1',
    ]

    for err in normal_errors:
        assert listener_looks_like_expired(err) is False, f"Listener triggered auth expired on: {err}"
        assert bridge_looks_like_expired(err) is False, f"Bridge triggered auth expired on: {err}"


def test_arbitrary_401_numbers_do_not_trigger_auth_expired():
    """Số điện thoại hoặc conversation ID chứa số 401 không được kích hoạt hết hạn phiên."""
    assert "401" not in BRIDGE_MARKERS

    non_auth_strings = [
        "Conversation 4018291823 has no new messages",
        "Phone number 0942401824 was updated",
        "Worker thread 401 completed task",
    ]

    for text in non_auth_strings:
        assert bridge_looks_like_expired(text) is False, f"Bridge falsely triggered on: {text}"
        assert listener_looks_like_expired(text) is False, f"Listener falsely triggered on: {text}"


def test_genuine_auth_expired_strings_are_detected():
    """Các chuỗi hết hạn phiên thật sự phải được phát hiện chuẩn xác 100%."""
    genuine_expired = [
        "đăng nhập thất bại do thông tin không chính xác",
        "Error: logincookie is missing or invalidated",
        "login failed: user credentials rejected",
        "Session expired, please re-authenticate",
        "User is not logged in",
        "Invalid cookie or session terminated",
        "Cookie expired on remote server",
        "zpw_enk key missing",
        "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.",
    ]

    for text in genuine_expired:
        assert listener_looks_like_expired(text) is True, f"Listener failed to detect: {text}"
        assert bridge_looks_like_expired(text) is True, f"Bridge failed to detect: {text}"
