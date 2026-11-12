from datetime import datetime, timezone

from app.modules.facebook.src.modules.messenger.services.fb_circuit_breaker import FbCircuitBreaker


class _Q:
    def __init__(self, rows): self.rows = rows
    def __getattr__(self, _name): return lambda *a, **k: self
    def execute(self): return type("R", (), {"data": self.rows})()


class _SB:
    def __init__(self, account): self.account = account
    def table(self, _name): return _Q([self.account])


def _acc(**kw):
    base = {"is_active": True, "status": "connected", "warm_up_tier": 1,
            "daily_sent_count": 30, "last_sent_at": datetime.now(timezone.utc).isoformat()}
    return {**base, **kw}


def test_cold_message_still_limited():
    ok, reason, _ = FbCircuitBreaker.can_send_message(_SB(_acc()), "a1")
    assert not ok and "hạn mức" in reason


def test_reply_skips_quota_and_cooldown():
    ok, _, _ = FbCircuitBreaker.can_send_message(_SB(_acc()), "a1", is_reply=True)
    assert ok


def test_reply_still_blocked_when_checkpoint():
    ok, _, _ = FbCircuitBreaker.can_send_message(_SB(_acc(status="checkpoint")), "a1", is_reply=True)
    assert not ok


def test_cold_message_cooldown_is_one_minute_for_new_nick():
    from datetime import timedelta
    old = (datetime.now(timezone.utc) - timedelta(seconds=61)).isoformat()
    ok, _, _ = FbCircuitBreaker.can_send_message(
        _SB(_acc(daily_sent_count=2, daily_sent_limit=None, last_sent_at=old)), "a1")
    assert ok


def test_classify_bridge_block():
    from app.modules.facebook.src.modules.messenger.services.fb_messenger_service import classify_bridge_block
    assert classify_bridge_block("Facebook từ chối tin nhắn: You're temporarily blocked") == 1357004
    assert classify_bridge_block("error 368: too fast") == 368
    assert classify_bridge_block("Tài khoản bị checkpoint") == 405
    assert classify_bridge_block("recipient 1003685 not found") is None
    assert classify_bridge_block("kết nối E2EE chưa sẵn sàng") is None
