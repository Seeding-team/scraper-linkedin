"""Khoá Web Intake: allowlist endpoint + ngoại lệ quyền tối thiểu cho user kỹ thuật."""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test")

from app.core.config import settings
from app.modules.all_platform.auth_deps import _web_intake_allows
from app.modules.all_platform.services import crm_permission_service as perm

U = "11111111-1111-1111-1111-111111111111"


def test_allowlist_allows_only_what_project2_needs():
    allowed = [
        ("GET", "/api/all-platform/categories"),
        ("GET", "/api/all-platform/quotes/issuer-companies"),
        ("GET", "/api/all-platform/quotes/exchange-rate"),
        ("GET", "/api/all-platform/quotes"),
        ("POST", "/api/all-platform/quotes"),
        ("PUT", f"/api/all-platform/quotes/{U}"),
        ("POST", f"/api/all-platform/quotes/{U}/evaluate-rules"),
        ("POST", "/api/all-platform/crm/customers"),
        ("POST", "/api/all-platform/projects"),
        ("POST", "/api/all-platform/customer-leads"),
    ]
    denied = [
        ("POST", f"/api/all-platform/quotes/{U}/approve"),
        ("POST", "/api/all-platform/quotes/exchange-rate/refresh"),
        ("PUT", "/api/all-platform/quotes/exchange-rate"),
        ("POST", f"/api/all-platform/quotes/{U}/processing-stage"),
        ("POST", f"/api/all-platform/quotes/{U}/owners"),
        ("POST", f"/api/all-platform/quotes/{U}/publish"),
        ("POST", f"/api/all-platform/quotes/{U}/send"),
        ("POST", f"/api/all-platform/quotes/{U}/hard-delete"),
        ("DELETE", f"/api/all-platform/quotes/{U}"),
        ("POST", "/api/all-platform/quotes/issuer-companies"),
        ("POST", "/api/all-platform/categories/add"),
        ("GET", "/api/all-platform/users/members"),
        ("PUT", f"/api/all-platform/projects/{U}"),
        ("DELETE", f"/api/all-platform/crm/customers/{U}"),
    ]
    assert all(_web_intake_allows(m, p) for m, p in allowed)
    assert not any(_web_intake_allows(m, p) for m, p in denied)


def test_owner_exception_only_for_intake_user_on_own_quote(monkeypatch):
    monkeypatch.setattr(settings, "web_intake_user_id", "intake-1")
    intake = {"id": "intake-1", "role": "member"}
    other = {"id": "someone", "role": "member"}
    own = {"createdById": "intake-1"}
    foreign = {"createdById": "x"}
    assert perm.can_edit_technical_quote(intake, own)
    assert not perm.can_transition_quote_stage(intake, own, "technical")  # không tự chuyển bước
    assert not perm.can_edit_technical_quote(intake, {**own, "processingStage": "technical"})  # nội bộ đã nhận xử lý
    assert not perm.can_edit_technical_quote(intake, foreign)
    assert not perm.can_edit_technical_quote(other, own)
    assert not perm.can_approve_quote(intake)


def test_duplicate_customer_not_blocked_and_not_leaked_for_web_intake(monkeypatch):
    import pytest
    from app.modules.all_platform.services import crm_customer_service as svc

    monkeypatch.setattr(settings, "web_intake_user_id", "intake-1")
    existing = [{"id": "c1", "customer_name": "Khách thật", "phone": "0900000000"}]
    intake, staff = {"id": "intake-1", "role": "member"}, {"id": "s1", "role": "member"}

    data = {"note": None}
    svc._handle_duplicates(intake, existing, data)  # không ném lỗi, không lộ danh sách khách trùng
    assert "Trùng" in data["note"] and "Khách thật" not in data["note"]
    with pytest.raises(svc.DuplicateCustomerError):  # nội bộ vẫn bị chặn như cũ
        svc._handle_duplicates(staff, existing, {})
