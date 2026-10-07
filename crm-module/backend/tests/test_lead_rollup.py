"""Progress tong Lead 360: Lead -> KH/Co hoi -> Bao gia -> Hop dong, roll-up tu du lieu that cua cac bao gia."""
from app.modules.all_platform.services.lead_overview_service import _rollup_steps


def _q(id, **kw):
    base = {"id": id, "processing_stage": "pricing", "status": "draft"}
    base.update(kw)
    return base


def _run(quotes, contracts=(), deal=True, deal_stage="proposal_sent", open_tasks=None, links=None):
    links = links or {}
    deal_row = {"id": "d", "deal_stage": deal_stage} if deal else None
    steps = _rollup_steps(
        lead={"created_at": "2026-10-01T00:00:00+00:00", "status": "sql"}, deal=deal_row, quotes=list(quotes), contracts=list(contracts),
        open_tasks=open_tasks or [], contracts_of=lambda q: links.get(q["id"], []), lead_actor="A", convert_actor="B",
    )
    return {s["key"]: s["state"] for s in steps}, steps


PUB = {"processing_stage": "published", "status": "approved", "published_at": "2026-10-02T00:00:00+00:00"}


def test_no_deal_stops_at_lead():
    st, _ = _run([], deal=False)
    assert st == {"lead": "done", "customer_deal": "current", "quote": "pending", "contract": "pending"}


def test_deal_without_quote_waits_for_quote():
    st, _ = _run([])
    assert st["customer_deal"] == "done" and st["quote"] == "current" and st["contract"] == "pending"


def test_quote_in_progress_and_overdue():
    st, _ = _run([_q("q1")], open_tasks=[{"_rank": 1, "due": None, "assignee": "x"}])
    assert st["quote"] == "current" and st["contract"] == "pending"
    st, _ = _run([_q("q1")], open_tasks=[{"_rank": 0, "due": {"dueAt": "2026-10-01"}, "assignee": "x"}])
    assert st["quote"] == "overdue"


def test_published_waiting_for_customer():
    st, _ = _run([_q("q1", **PUB)])
    assert st["quote"] == "done" and st["contract"] == "current"


def test_quote_with_contract_completes_whole_progress():
    q = _q("q1", **PUB)
    st, steps = _run([q], contracts=[{"id": "k", "created_at": "2026-10-03T00:00:00+00:00"}], links={"q1": [{"id": "k"}]})
    assert st == {"lead": "done", "customer_deal": "done", "quote": "done", "contract": "done"}


def test_multi_quote_contract_on_one_other_still_open():
    q1, q2 = _q("q1", **PUB), _q("q2")
    st, steps = _run([q1, q2], contracts=[{"id": "k"}], links={"q1": [{"id": "k"}]}, open_tasks=[{"_rank": 1, "due": None, "assignee": "x"}])
    assert st["contract"] == "done" and st["quote"] == "done"
    assert "1/2" in next(s for s in steps if s["key"] == "contract")["note"]


def test_multi_quote_one_lost_other_in_progress_is_not_done_or_out():
    q1, q2 = _q("q1", **PUB, customer_outcome="lost"), _q("q2")
    st, _ = _run([q1, q2], open_tasks=[{"_rank": 1, "due": None, "assignee": "x"}])
    assert st["quote"] == "current" and st["contract"] == "pending"


def test_one_lost_other_awaiting_customer():
    q1, q2 = _q("q1", **PUB, customer_outcome="lost"), _q("q2", **PUB)
    st, _ = _run([q1, q2])
    assert st["quote"] == "done" and st["contract"] == "current"


def test_all_quotes_lost_is_out_without_contract():
    st, steps = _run([_q("q1", **PUB, customer_outcome="lost"), _q("q2", **PUB, customer_outcome="lost")], deal_stage="lost")
    assert st["contract"] == "out" and st["quote"] == "done"
    assert next(s for s in steps if s["key"] == "contract")["label"] == "OUT"


def test_lost_quote_with_other_having_contract_is_done():
    q1, q2 = _q("q1", **PUB, customer_outcome="lost"), _q("q2", **PUB)
    st, _ = _run([q1, q2], contracts=[{"id": "k"}], links={"q2": [{"id": "k"}]})
    assert st["contract"] == "done"
