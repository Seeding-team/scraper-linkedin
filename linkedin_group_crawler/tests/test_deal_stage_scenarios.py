"""Kich ban Sales Pipeline: nhieu Deal/bao gia, request->draft->approved, cach ly workspace, khong ghi de stage thu cong,
rollback chon loc + idempotent. Dung DB gia trong bo nho (ton trong bo loc .eq) - KHONG cham DB that."""
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app.modules.all_platform.services import deal_stage_sync_service as svc

_SPEC = importlib.util.spec_from_file_location("selective_rollback", Path(__file__).resolve().parents[1] / "scripts" / "selective_rollback_deal_stages.py")
rb = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(rb)


class MemSB:
    def __init__(self, **tables):
        self.t = {k: [dict(r) for r in v] for k, v in tables.items()}

    def table(self, name):
        return _Op(self, name)


class _Op:
    def __init__(self, sb, name):
        self.sb, self.name, self.op, self.payload, self.f = sb, name, "select", None, []

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def eq(self, col, val): self.f.append((col, val)); return self

    def execute(self):
        rows = self.sb.t.setdefault(self.name, [])
        if self.op == "insert":
            rows.append(dict(self.payload)); return SimpleNamespace(data=[self.payload])
        hit = [r for r in rows if all(r.get(c) == v for c, v in self.f)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        return SimpleNamespace(data=[dict(r) for r in hit])


def _sync(sb, deal_id, instance="markee"):
    settings = SimpleNamespace(crm_instance=instance)
    with mock.patch.object(svc, "get_supabase_client", return_value=sb), mock.patch.object(svc, "settings", settings), \
            mock.patch("app.modules.all_platform.services.customer_lead_service._write_activity_log"):
        return svc.sync_deal_stage(deal_id, source="test")


def _quote(qid, deal, instance="markee", **kw):
    return {"id": qid, "deal_id": deal, "instance": instance, "status": "draft", "processing_stage": "request", "deleted_at": None, "customer_outcome": None, **kw}


def _stage(sb, deal_id):
    return next(r for r in sb.t["customer_leads"] if r["id"] == deal_id)["deal_stage"]


def test_customer_with_many_deals_only_the_quoted_deal_moves():
    sb = MemSB(
        customer_leads=[{"id": d, "instance": "markee", "customer_id": "K", "deal_stage": "dealing"} for d in ("D1", "D2", "D3")],
        quotes=[_quote("Q1", "D1", status="approved"), _quote("Q2", "D2", processing_stage="pricing")],
        contracts=[],
    )
    for d in ("D1", "D2", "D3"):
        _sync(sb, d)
    assert [_stage(sb, d) for d in ("D1", "D2", "D3")] == ["negotiation", "proposal_sent", "dealing"]


def test_request_to_draft_to_approved_progression_never_demotes():
    sb = MemSB(customer_leads=[{"id": "D", "instance": "markee", "customer_id": "K", "deal_stage": "dealing"}], quotes=[_quote("Q", "D")], contracts=[])
    q = sb.t["quotes"][0]
    _sync(sb, "D"); assert _stage(sb, "D") == "dealing"                 # request: Presale moi tiep nhan
    q["processing_stage"] = "technical"; _sync(sb, "D"); assert _stage(sb, "D") == "dealing"
    q["processing_stage"] = "pricing"; _sync(sb, "D"); assert _stage(sb, "D") == "proposal_sent"   # bat dau lap bao gia nhap
    q["status"] = "approved"; _sync(sb, "D"); assert _stage(sb, "D") == "negotiation"
    q["status"] = "cancelled"; _sync(sb, "D"); assert _stage(sb, "D") == "negotiation"               # huy khong keo lui


def test_workspace_isolation():
    sb = MemSB(
        customer_leads=[{"id": "D", "instance": "markee", "customer_id": "K", "deal_stage": "dealing"}],
        quotes=[_quote("Q", "D", instance="markee", status="approved")], contracts=[],
    )
    assert _sync(sb, "D", instance="cloudgate")["changed"] is False     # workspace khac khong thay Deal
    assert _stage(sb, "D") == "dealing"
    assert _sync(sb, "D", instance="markee")["changed"] is True


def test_manual_stages_are_never_overwritten():
    for manual in ("payment_1", "implementation", "post_sale_care", "on_hold", "lost", "won"):
        sb = MemSB(customer_leads=[{"id": "D", "instance": "markee", "customer_id": "K", "deal_stage": manual}], quotes=[_quote("Q", "D", status="approved")], contracts=[])
        assert _sync(sb, "D")["changed"] is False and _stage(sb, "D") == manual


# ---- rollback chon loc ----
ITEM = {"dealId": "D", "instance": "markee", "from": "requirement", "to": "proposal_sent", "stageEnteredAt": "2026-09-08T11:23:59+00:00"}
BF_LOG = {"action": "stage_change", "from_stage": "requirement", "to_stage": "proposal_sent", "note": "Backfill tự động: x", "created_at": "2026-10-09T10:17:45+00:00"}
DEAL = {"id": "D", "instance": "markee", "deal_stage": "proposal_sent"}
REQ_ONLY = [{"status": "draft", "processing_stage": "request"}]


def test_rollback_restores_only_unjustified_untouched_deal():
    r = rb.evaluate_item(ITEM, DEAL, [BF_LOG], REQ_ONLY, [])
    assert r["action"] == "restore" and r["restoreTo"] == "requirement"


def test_rollback_skips_deal_with_valid_evidence():
    r = rb.evaluate_item(ITEM, DEAL, [BF_LOG], [{"status": "draft", "processing_stage": "pricing"}], [])
    assert r["action"] == "skip_keep" and r["restoreTo"] is None


def test_rollback_conflicts_when_stage_changed_by_someone_else():
    assert rb.evaluate_item(ITEM, {**DEAL, "deal_stage": "negotiation"}, [BF_LOG], REQ_ONLY, [])["action"] == "conflict"
    later = {"action": "stage_change", "from_stage": "proposal_sent", "to_stage": "proposal_sent", "note": "Sale", "created_at": "2026-10-10T01:00:00+00:00"}
    assert rb.evaluate_item(ITEM, DEAL, [BF_LOG, later], REQ_ONLY, [])["action"] == "conflict"
    assert rb.evaluate_item(ITEM, DEAL, [], REQ_ONLY, [])["action"] == "conflict"                       # khong co log backfill
    assert rb.evaluate_item(ITEM, {**DEAL, "instance": "cloudgate"}, [BF_LOG], REQ_ONLY, [])["action"] == "conflict"
    assert rb.evaluate_item(ITEM, None, [BF_LOG], REQ_ONLY, [])["action"] == "conflict"


def test_rollback_writes_only_stage_fields_and_is_idempotent():
    other = {"id": "OTHER", "instance": "markee", "deal_stage": "proposal_sent", "stage_entered_at": "x", "customer_name": "keep"}
    deal = {"id": "D", "instance": "markee", "deal_stage": "proposal_sent", "stage_entered_at": "now", "customer_name": "Giữ nguyên", "budget": 5}
    sb = MemSB(customer_leads=[deal, other], customer_lead_activity_log=[])
    assert rb.restore_deal(sb, ITEM) is True
    d = next(r for r in sb.t["customer_leads"] if r["id"] == "D")
    assert d["deal_stage"] == "requirement" and d["stage_entered_at"] == ITEM["stageEnteredAt"]
    assert d["customer_name"] == "Giữ nguyên" and d["budget"] == 5                                   # cac truong khac giu nguyen
    assert next(r for r in sb.t["customer_leads"] if r["id"] == "OTHER")["deal_stage"] == "proposal_sent"  # Deal khac khong bi dong
    assert rb.restore_deal(sb, ITEM) is False                                                         # chay lai: khong ghi them
    assert len(sb.t["customer_lead_activity_log"]) == 1
