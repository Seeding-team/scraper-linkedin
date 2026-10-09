"""Sales Pipeline tu dong theo bao gia/hop dong: chi tien len 1-5, khong ghi de stage 6-10, chi dung Deal, idempotent."""
from unittest import mock

import pytest

from app.modules.all_platform.services import deal_stage_sync_service as svc


def Q(status="draft", stage="pricing", **kw):
    return {"id": kw.pop("id", "q"), "status": status, "processing_stage": stage, "deleted_at": None, "customer_outcome": None, **kw}


def C(status="draft", **kw):
    return {"id": "c", "status": status, "deal_phase": None, **kw}


@pytest.mark.parametrize("current,quotes,contracts,expected", [
    ("dealing", [], [], None),                                     # chua co gi -> giu stage 1
    ("dealing", [Q("draft")], [], "proposal_sent"),                # bao gia nhap dang lap gia (pricing) -> 3
    ("dealing", [Q("draft", "request")], [], None),                # Presale moi tiep nhan yeu cau -> CHUA phai Proposal
    ("requirement", [Q("draft", "technical")], [], None),          # Presale nhap ky thuat -> chua
    ("dealing", [Q("draft", "review")], [], "proposal_sent"),      # cho duyet -> 3
    ("dealing", [Q("draft", "request"), Q("draft", "pricing")], [], "proposal_sent"),   # nhieu bao gia: 1 cai da lap gia -> 3
    ("dealing", [Q("approved", "published")], [], "negotiation"),
    ("requirement", [Q("draft", "pricing")], [], "proposal_sent"),   # stage 2 -> 3
    ("dealing", [Q("confirmed", "request")], [], "negotiation"),    # confirmed = da chot -> 4 (khong phu thuoc processing_stage)
    ("proposal_sent", [Q("approved")], [], "negotiation"),         # duyet -> 4
    ("negotiation", [Q("approved")], [C("draft")], "contract_signed"),   # hop dong da luu -> 5
    ("dealing", [], [C("active")], "contract_signed"),
    ("negotiation", [Q("draft")], [], None),                       # khong keo lui
    ("contract_signed", [Q("approved")], [], None),                # da o 5
    ("payment_1", [Q("approved")], [C("signed")], None),           # 6-10 khong bi ghi de
    ("post_sale_care", [Q("draft")], [], None),
    ("on_hold", [Q("approved")], [], None),
    ("lost", [Q("approved")], [C("signed")], None),
    ("won", [Q("approved")], [], None),
])
def test_compute_target_stage(current, quotes, contracts, expected, monkeypatch):
    monkeypatch.setattr(svc, "CONTRACT_STAGE_SYNC_ENABLED", True)   # logic day du khi bat lai module Hop dong
    assert svc.compute_target_stage(current, quotes, contracts)[0] == expected


def test_cancelled_deleted_out_quotes_and_invalid_contracts_do_not_count():
    dead = [Q("cancelled"), Q("approved", deleted_at="2026-01-01"), Q("approved", customer_outcome="lost")]
    assert svc.compute_target_stage("dealing", dead, [])[0] is None
    assert svc.compute_target_stage("dealing", [], [C("terminated"), C("expired"), C("signed", deal_phase="purchase")])[0] is None
    # con 1 bao gia chua duyet hop le ben canh cac bao gia da OUT -> chi len 3
    assert svc.compute_target_stage("dealing", dead + [Q("draft")], [])[0] == "proposal_sent"


class _FakeSB:
    def __init__(self, deal, quotes, contracts):
        self.tables = {"customer_leads": [deal], "quotes": quotes, "contracts": contracts}
        self.updates = []

    def table(self, name):
        return _Q(self, name)


class _Q:
    def __init__(self, sb, name): self.sb, self.name, self.op, self.payload = sb, name, "select", None
    def select(self, *_a, **_k): return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def execute(self):
        rows = self.sb.tables[self.name]
        if self.op == "update":
            if rows and rows[0].get("deal_stage") != self.payload.get("deal_stage"):
                self.sb.updates.append(self.payload); rows[0].update(self.payload); return mock.Mock(data=[rows[0]])
            return mock.Mock(data=[])
        return mock.Mock(data=list(rows))


def test_sync_updates_only_that_deal_once_and_logs():
    sb = _FakeSB({"id": "D1", "deal_stage": "dealing", "customer_id": "K"}, [Q("approved")], [])
    with mock.patch.object(svc, "get_supabase_client", return_value=sb), \
            mock.patch("app.modules.all_platform.services.customer_lead_service._write_activity_log") as log:
        first = svc.sync_deal_stage("D1", source="duyệt báo giá", actor_id="u1")
        second = svc.sync_deal_stage("D1", source="duyệt báo giá")
    assert first["changed"] and first["to"] == "negotiation" and sb.updates[0]["deal_stage"] == "negotiation"
    assert second["changed"] is False and len(sb.updates) == 1          # idempotent
    log.assert_called_once()
    assert log.call_args.kwargs["from_stage"] == "dealing" and log.call_args.kwargs["to_stage"] == "negotiation"


def test_sync_never_raises_and_skips_unknown_deal():
    assert svc.sync_deal_stage(None, source="x")["changed"] is False
    with mock.patch.object(svc, "get_supabase_client", side_effect=RuntimeError("db down")):
        assert svc.sync_deal_stage("D1", source="x")["changed"] is False


def test_quote_and_contract_services_are_wrapped():
    from app.modules.all_platform.services import supabase_quote_service as qs, supabase_contract_service as cs
    for fn in (qs.create_quote, qs.approve_quote, qs.cancel_quote, qs.soft_delete_quote):
        assert hasattr(fn, "__wrapped__")
    assert cs.create_contract.__name__ == "create_contract" and cs._orig_create_contract is not cs.create_contract


def test_contract_stage_sync_is_disabled_by_default():
    from app.modules.all_platform.services import supabase_contract_service as cs
    assert svc.CONTRACT_STAGE_SYNC_ENABLED is False
    assert svc.compute_target_stage("dealing", [], [C("active")]) == (None, "khong_co_bang_chung")      # hop dong khong keo len stage 5
    assert svc.compute_target_stage("negotiation", [Q("approved")], [C("signed")])[0] is None            # da o 4, bao gia khong len 5
    with mock.patch.object(cs, "_orig_create_contract", return_value={"id": "c1", "dealId": "D9"}) as orig,             mock.patch("app.modules.all_platform.services.deal_stage_sync_service.sync_deal_stage") as sync:
        assert cs.create_contract({"deal_id": "D9", "title": "HD"}, "u1")["id"] == "c1"                   # CRUD van chay
        orig.assert_called_once()
        sync.assert_not_called()


def test_contract_save_triggers_stage_sync_but_unsaved_flow_does_not(monkeypatch):
    from app.modules.all_platform.services import supabase_contract_service as cs
    monkeypatch.setattr(svc, "CONTRACT_STAGE_SYNC_ENABLED", True)
    with mock.patch.object(cs, "_orig_create_contract", return_value={"id": "c1", "dealId": "D9"}), \
            mock.patch("app.modules.all_platform.services.deal_stage_sync_service.sync_deal_stage") as sync:
        cs.create_contract({"deal_id": "D9", "title": "HD"}, "u1")
        sync.assert_called_once()
        assert sync.call_args.args[0] == "D9"
    # Soan AI / chon mau / upload tam KHONG goi API tao hop dong -> khong co sync nao khac duoc goi
