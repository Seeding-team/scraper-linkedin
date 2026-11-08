"""Quote 'Khong chot / OUT': validate, chi OUT Deal khi het nhanh ban hang hoat dong."""
from unittest import mock

import pytest

from app.modules.all_platform.services import quote_outcome_service as svc


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload = db, table, "select", None

    def select(self, *_a, **_k): self.op = "select"; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def eq(self, *_a): return self
    def limit(self, *_a): return self

    def execute(self):
        if self.op == "select":
            return mock.Mock(data=list(self.db.rows.get(self.table, [])))
        self.db.writes.append((self.table, self.op, self.payload))
        return mock.Mock(data=[{}])


class _DB:
    def __init__(self, **rows): self.rows, self.writes = rows, []
    def table(self, name): return _Q(self, name)


def _quote(**kw):
    base = {"id": "q1", "deal_id": "d1", "status": "approved", "processing_stage": "published", "published_at": "2026-10-01", "quote_number": "BG1", "version_chain_id": "c1", "version_number": 1}
    base.update(kw)
    return base


def test_reasons_come_from_backend_and_include_other():
    codes = [r["code"] for r in svc.list_lost_reasons()]
    assert codes == ["price_high", "chose_competitor", "new_quote", "no_need", "no_response", "project_postponed", "other"]


@pytest.mark.parametrize("reason,other", [("", None), ("bogus", None), ("other", None), ("other", "   ")])
def test_requires_valid_reason_and_text_for_other(reason, other):
    with pytest.raises(ValueError):
        svc.mark_quote_lost("q1", {"id": "u"}, reason, other)


def _run(quote_row, other_quotes=(), contracts=(), deal_stage="proposal_sent"):
    db = _DB(quotes=[quote_row, *other_quotes], contracts=list(contracts))
    transition = mock.Mock()
    with mock.patch.object(svc, "get_supabase_client", return_value=db), \
            mock.patch("app.modules.all_platform.services.supabase_quote_service.get_quote", return_value={"id": "q1"}), \
            mock.patch("app.modules.all_platform.services.customer_lead_service.get_customer_lead_by_id", return_value={"id": "d1", "deal_stage": deal_stage}), \
            mock.patch("app.modules.all_platform.services.customer_lead_service.transition_stage", transition):
        res = svc.mark_quote_lost("q1", {"id": "u1", "name": "Sale A"}, "price_high", None, "ghi chu")
    return res, db, transition


def test_not_published_cannot_be_lost():
    with pytest.raises(ValueError):
        _run(_quote(status="draft", processing_stage="pricing", published_at=None))


def test_single_quote_lost_marks_deal_out_and_logs():
    res, db, transition = _run(_quote())
    assert res["dealOut"]["changed"] is True
    transition.assert_called_once()
    assert transition.call_args.args[1]["to_stage"] == "lost"
    tables = [(t, op) for t, op, _ in db.writes]
    assert ("quotes", "update") in tables and ("quote_activity_log", "insert") in tables
    upd = next(p for t, op, p in db.writes if t == "quotes")
    assert upd["customer_outcome"] == "lost" and upd["lost_reason"] == "price_high" and upd["lost_by"] == "u1"


def test_other_active_quote_keeps_deal_alive():
    other = _quote(id="q2", version_chain_id="c2", status="draft", processing_stage="pricing")
    res, _, transition = _run(_quote(), other_quotes=[other])
    assert res["dealOut"]["changed"] is False
    transition.assert_not_called()


def test_other_quote_already_lost_or_cancelled_does_not_keep_deal():
    others = [_quote(id="q2", version_chain_id="c2", customer_outcome="lost"), _quote(id="q3", version_chain_id="c3", status="cancelled")]
    res, _, transition = _run(_quote(), other_quotes=others)
    assert res["dealOut"]["changed"] is True
    transition.assert_called_once()


def test_old_version_of_same_chain_is_not_a_separate_branch():
    old = _quote(id="q0", version_chain_id="c1", version_number=0, status="draft")
    res, _, transition = _run(_quote(version_number=1), other_quotes=[old])
    assert res["dealOut"]["changed"] is True


def test_live_contract_blocks_deal_out_and_terminal_deal_untouched():
    res, _, transition = _run(_quote(), contracts=[{"id": "k1", "status": "active"}])
    assert res["dealOut"]["changed"] is False
    transition.assert_not_called()
    res, _, transition = _run(_quote(), deal_stage="won")
    assert res["dealOut"]["changed"] is False
    transition.assert_not_called()
