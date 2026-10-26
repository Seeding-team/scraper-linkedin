"""Test logic DERIVE tien do Lead 360 (thuan, khong DB): han chot, buoc quote/contract, chon phien ban moi nhat."""
from datetime import datetime, timedelta, timezone

from app.modules.all_platform.services import lead_overview_service as svc


def _iso(delta_hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).isoformat()


def test_due_info_remaining_days_and_hours():
    d = svc._due_info(_iso(50))
    assert d["status"] == "in_progress" and d["daysRemaining"] == 2
    soon = svc._due_info(_iso(2))
    assert soon["status"] == "due_soon" and soon["daysRemaining"] == 0 and soon["remainingHours"] in (1, 2)


def test_due_info_overdue_days_and_hours():
    d = svc._due_info(_iso(-50))
    assert d["status"] == "overdue" and d["overdueDays"] == 2
    h = svc._due_info(_iso(-5))
    assert h["status"] == "overdue" and h["overdueDays"] == 0 and h["overdueHours"] in (4, 5)


def test_due_info_completed_and_empty():
    assert svc._due_info(_iso(-100), completed=True)["status"] == "completed"
    assert svc._due_info(None) is None and svc._due_info("khong phai ngay") is None


def test_quote_steps_follow_processing_stage():
    # chua co bao gia: moi buoc quote/contract pending
    assert set(svc._quote_step_states(None, []).values()) == {"pending"}
    q = {"processing_stage": "technical"}
    s = svc._quote_step_states(q, [])
    assert s["quote_request"] == "done" and s["presale"] == "current" and s["sale"] == "pending" and s["approval"] == "pending"
    s = svc._quote_step_states({"processing_stage": "pricing"}, [])
    assert s["presale"] == "done" and s["sale"] == "current"
    s = svc._quote_step_states({"processing_stage": "review"}, [])
    assert s["sale"] == "done" and s["approval"] == "current" and s["quote"] == "pending"


def test_quote_steps_approved_published_and_contract():
    approved = {"processing_stage": "ready_to_publish", "status": "approved", "approved_at": _iso(-1)}
    s = svc._quote_step_states(approved, [])
    assert s["approval"] == "done" and s["quote"] == "current" and s["contract"] == "pending"
    sent = {**approved, "processing_stage": "published", "published_at": _iso(-1), "sent_at": _iso(-1)}
    s = svc._quote_step_states(sent, [])
    assert s["quote"] == "done" and s["contract"] == "current"
    s = svc._quote_step_states(sent, [{"id": "c1"}])
    assert s["contract"] == "done"


def test_latest_version_per_chain():
    quotes = [
        {"id": "a1", "version_chain_id": "A", "version_number": 1, "created_at": "2026-10-01"},
        {"id": "a2", "version_chain_id": "A", "version_number": 2, "created_at": "2026-10-02"},
        {"id": "b1", "version_chain_id": None, "version_number": 1, "created_at": "2026-10-03"},
    ]
    out = svc._latest_per_chain(quotes)
    assert [q["id"] for q in out] == ["b1", "a2"]  # moi chuoi 1 ban moi nhat, moi tao truoc


def test_approval_state_and_waiting_on():
    nm = {"p1": "Presale A", "s1": "Sale B"}.get
    assert svc._approval_state({"processing_stage": "technical"}) == ("not_yet", "Chưa tới bước duyệt")
    assert svc._approval_state({"processing_stage": "review"}) == ("pending", "Chờ duyệt")
    assert svc._approval_state({"processing_stage": "ready_to_publish", "approved_at": "2026-10-01"})[0] == "approved"
    assert svc._approval_state({"processing_stage": "pricing", "requested_changes_at": "2026-10-01"})[0] == "changes_requested"
    assert svc._waiting_on({"processing_stage": "technical", "technical_owner_id": "p1"}, nm) == "Presale: Presale A"
    assert svc._waiting_on({"processing_stage": "pricing", "quote_owner_id": "s1"}, nm) == "Sale: Sale B"
    assert svc._waiting_on({"processing_stage": "review"}, nm).startswith("Người duyệt")
    assert svc._waiting_on({"processing_stage": "ready_to_publish", "approved_at": "x"}, nm) == "Chờ phát hành/gửi khách"
    assert svc._waiting_on({"processing_stage": "published", "approved_at": "x", "sent_at": "y"}, nm) is None
