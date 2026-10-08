"""GD3 - Ban giao xu ly / Re-assign / Xac minh dat chuan + email (chong gui trung, khong email cho chinh minh)."""
import itertools
from unittest import mock

import pytest

from app.modules.all_platform.services import crm_lead_handover_service as svc


# ── fake Supabase toi gian ────────────────────────────────────────────────────────────────────
class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload, self.filters, self._limit = db, table, "select", None, [], None

    def select(self, *_a, **_k): self.op = "select"; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, k, v): self.filters.append((k, "eq", v)); return self
    def in_(self, k, v): self.filters.append((k, "in", list(v))); return self
    def order(self, *_a, **_k): return self
    def limit(self, n): self._limit = n; return self

    def _match(self, row):
        for k, op, v in self.filters:
            if op == "eq" and row.get(k) != v:
                return False
            if op == "in" and row.get(k) not in v:
                return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = dict(self.payload)
            row.setdefault("id", f"{self.table}-{next(self.db.seq)}")
            if self.table == "crm_lead_handovers" and row.get("idempotency_key"):
                if any(r.get("idempotency_key") == row["idempotency_key"] and r.get("instance") == row.get("instance") for r in rows):
                    raise Exception('duplicate key value violates unique constraint "crm_lead_handovers_idem_unique"')
            rows.append(row)
            return mock.Mock(data=[row])
        matched = [r for r in rows if self._match(r)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
            self.db.updates.append((self.table, self.payload, list(self.filters)))
            return mock.Mock(data=matched)
        if self.op == "delete":
            for r in matched:
                rows.remove(r)
            return mock.Mock(data=matched)
        return mock.Mock(data=matched[: self._limit] if self._limit else matched)


class _DB:
    def __init__(self):
        self.tables = {
            "app_users": [
                {"id": "actor", "name": "Chi Thuy", "email": "thuy@x.vn"},
                {"id": "trung", "name": "Duc Trung", "email": "trung@x.vn"},
                {"id": "mai", "name": "Mai", "email": "mai@x.vn"},
                {"id": "noemail", "name": "No Mail", "email": None},
            ],
            "crm_leads": [{"id": "L1", "contact_code": "LH000123"}],
        }
        self.seq = itertools.count(1)
        self.updates = []

    def table(self, name): return _Q(self, name)


LEAD = {"id": "L1", "instance": "markee", "lead_name": "Anh Quang", "company_name": "Cong ty A", "phone": "0900", "email": "q@a.vn", "source": "website",
        "qualification_need": "Website", "qualification_ae_id": None, "team_id": None, "status": "mql", "handover_links": []}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://crm.test.example")
    monkeypatch.delenv("EMAIL_LINK_ALLOWED_ORIGINS", raising=False)
    db = _DB()
    sent = []
    lead_state = dict(LEAD)

    def fake_get_lead(lead_id, user):
        return dict(lead_state)

    def fake_update_lead(lead_id, payload, user):
        lead_state.update(payload)
        return dict(lead_state)

    patches = [
        mock.patch.object(svc, "get_supabase_client", return_value=db),
        mock.patch("app.modules.all_platform.services.crm_lead_service.get_lead", side_effect=fake_get_lead),
        mock.patch("app.modules.all_platform.services.crm_lead_service.update_lead", side_effect=fake_update_lead),
        mock.patch("app.modules.all_platform.services.crm_permission_service.can_write_lead", return_value=True),
        mock.patch("app.modules.all_platform.services.crm_permission_service.get_crm_team_id_for_user", return_value="TEAM-X"),
        mock.patch.object(svc, "_send_email", side_effect=lambda to, subject, text, html: sent.append((to, subject, text, html)) or "sent"),
    ]
    for p in patches:
        p.start()
    yield db, sent, lead_state
    for p in patches:
        p.stop()


USER = {"id": "actor", "name": "Chi Thuy", "email": "thuy@x.vn"}


# ── link tai lieu ────────────────────────────────────────────────────────────────────────────
def test_normalize_links():
    out = svc.normalize_doc_links("https://docs.google.com/spreadsheets/d/1\nhttps://docs.google.com/document/d/2 https://docs.google.com/document/d/2")
    assert [l["title"] for l in out] == ["Google Sheet", "Google Doc"]  # dedupe + tu dat ten
    assert svc.normalize_doc_links(None) == [] and svc.normalize_doc_links([{"url": "https://a.vn/x", "title": "BG"}])[0]["title"] == "BG"
    with pytest.raises(ValueError):
        svc.normalize_doc_links("ftp://x")
    with pytest.raises(ValueError):
        svc.normalize_doc_links([f"https://a.vn/{i}" for i in range(25)])


# ── noi dung email ───────────────────────────────────────────────────────────────────────────
def test_email_has_codes_links_missing_and_deep_link(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://crm.test.example")
    links = svc.normalize_doc_links("https://docs.google.com/spreadsheets/d/1")
    subject, text, html = svc.build_handover_email(
        kind="handover", lead={**LEAD}, lead_code="LH000123", actor_name="Chi Thuy", to_name="Trung", links=links, missing_items=["Giá trị dự kiến", "SĐT"],
    )
    assert "LH000123" in subject and "LH000123" in text and "docs.google.com/spreadsheets/d/1" in text and "Giá trị dự kiến" in text
    assert "/all-platform/crm/leads?lead=L1&mode=verify" in text and "/all-platform/crm/leads?lead=L1&amp;mode=verify" in html

    subject, text, html = svc.build_handover_email(
        kind="assign_qualified", lead={**LEAD}, lead_code="LH000123", actor_name="Chi Thuy", to_name="Trung", links=links, missing_items=[],
        customer={"id": "K1", "customer_name": "Cong ty A"}, customer_code="CONGTYA",
    )
    assert "CONGTYA" in text and "LH000123" in text and "/all-platform/crm/customers/K1?tab=quotes" in text


# ── 1) ban giao ──────────────────────────────────────────────────────────────────────────────
def test_handover_saves_assignee_team_links_and_sends_one_email(env):
    db, sent, state = env
    res = svc.assign_lead("L1", {"to_user_id": "trung", "doc_links": "https://docs.google.com/spreadsheets/d/1", "missing_items": ["SĐT"], "idempotency_key": "k1"}, USER)
    assert state["qualification_ae_id"] == "trung" and state["team_id"] == "TEAM-X"
    assert res["handover"]["kind"] == "handover" and res["handover"]["email_status"] == "sent"
    assert len(sent) == 1 and sent[0][0] == "trung@x.vn" and "LH000123" in sent[0][2]
    saved = next(p for t, p, _f in db.updates if t == "crm_leads" and "handover_links" in p)
    assert saved["handover_links"][0]["url"].endswith("/d/1") and saved["handover_by"] == "actor"


def test_retry_with_same_key_does_not_send_again(env):
    db, sent, _ = env
    svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "same"}, USER)
    again = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "same"}, USER)
    assert again["duplicate"] is True and len(sent) == 1
    assert len(db.tables["crm_lead_handovers"]) == 1


def test_self_assign_never_emails(env):
    _, sent, state = env
    res = svc.assign_lead("L1", {"to_user_id": "actor", "send_email": True, "idempotency_key": "s"}, USER)
    assert not sent and res["handover"]["email_status"] == "skipped" and state["qualification_ae_id"] == "actor"


def test_untick_send_email_skips(env):
    _, sent, _ = env
    res = svc.assign_lead("L1", {"to_user_id": "trung", "send_email": False, "idempotency_key": "n"}, USER)
    assert not sent and res["handover"]["email_status"] == "skipped"


def test_reassign_when_someone_else_was_assignee(env):
    db, sent, state = env
    state["qualification_ae_id"] = "mai"   # dang do Mai phu trach, Chi Thuy doi sang Trung
    res = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "r"}, USER)
    row = res["handover"]
    assert row["kind"] == "reassign" and row["prev_assignee_id"] == "mai" and row["to_user_id"] == "trung"
    assert "Đổi người phụ trách" in sent[0][1]


def test_actor_handing_over_own_lead_is_handover_not_reassign(env):
    _, _, state = env
    state["qualification_ae_id"] = "actor"
    res = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "h"}, USER)
    assert res["handover"]["kind"] == "handover"


def test_email_failure_does_not_break_handover(env):
    db, sent, state = env
    with mock.patch.object(svc, "_send_email", side_effect=RuntimeError("smtp down")):
        res = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "f"}, USER)
    assert state["qualification_ae_id"] == "trung" and res["handover"]["email_status"] == "failed" and "smtp down" in res["handover"]["email_error"]


def test_recipient_without_email_marked_failed(env):
    _, sent, state = env
    res = svc.assign_lead("L1", {"to_user_id": "noemail", "idempotency_key": "e"}, USER)
    assert res["handover"]["email_status"] == "failed" and not sent and state["qualification_ae_id"] == "noemail"


def test_invalid_recipient_and_failed_update_rolls_back_history(env):
    db, _, _ = env
    with pytest.raises(ValueError):
        svc.assign_lead("L1", {"to_user_id": "ghost"}, USER)
    with mock.patch("app.modules.all_platform.services.crm_lead_service.update_lead", side_effect=RuntimeError("boom")):
        with pytest.raises(RuntimeError):
            svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "x"}, USER)
    assert not db.tables.get("crm_lead_handovers")


# ── 2) du SQL: sau convert ───────────────────────────────────────────────────────────────────
RESULT = {"customer": {"id": "K1", "customer_name": "Cong ty A", "customer_code": "CONGTYA"}, "contact": {"id": "C1"}}


def test_convert_with_other_recipient_emails_kh_and_lh_codes(env):
    db, sent, _ = env
    row = svc.record_convert_handover(
        {**LEAD, "qualification_ae_id": "actor"}, RESULT,
        {"deal": {"sdr_id": "trung"}, "handover": {"doc_links": "https://docs.google.com/document/d/9", "idempotency_key": "c1"}}, USER, "LH000123",
    )
    assert row["kind"] == "assign_qualified" and row["to_user_id"] == "trung" and row["email_status"] == "sent"
    body = sent[0][2]
    assert "CONGTYA" in body and "LH000123" in body and "docs.google.com/document/d/9" in body and "customers/K1" in body


def test_convert_self_process_has_no_history_and_no_email(env):
    db, sent, _ = env
    row = svc.record_convert_handover({**LEAD}, RESULT, {"deal": {"sdr_id": "actor"}, "handover": {"send_email": True}}, USER, "LH000123")
    assert row is None and not sent and not db.tables.get("crm_lead_handovers")


def test_convert_retry_same_key_no_second_email(env):
    _, sent, _ = env
    payload = {"deal": {"sdr_id": "trung"}, "handover": {"idempotency_key": "c2"}}
    svc.record_convert_handover({**LEAD}, RESULT, payload, USER, "LH000123")
    svc.record_convert_handover({**LEAD}, RESULT, payload, USER, "LH000123")
    assert len(sent) == 1


def test_assignee_verifying_own_lead_after_handover_gets_no_email(env):
    """Trung nhan ban giao, mo link, bam Xac minh -> nguoi thao tac == nguoi nhan -> khong gui lai."""
    _, sent, _ = env
    trung = {"id": "trung", "name": "Duc Trung"}
    row = svc.record_convert_handover({**LEAD, "qualification_ae_id": "trung"}, RESULT, {"deal": {"sdr_id": "trung"}}, trung, "LH000123")
    assert row is None and not sent


# ── base URL theo deployment + gui lai email ─────────────────────────────────────────────────
class _S:  # settings gia: instance_domain_map nhu clone da hop nhat (alias domain -> instance)
    crm_instance = "markee"
    instance_domain_map = {"crm.markee.vn": "markee", "crm.markeeai.com": "markee", "crm.getcloudgate.com": "cloudgate", "crm.securityzone.vn": "securityzone"}


def test_base_url_official_domain_per_workspace(monkeypatch):
    for k in ("PUBLIC_APP_BASE_URL", "EMAIL_LINK_WORKSPACE_DOMAINS", "WORKSPACE_DOMAINS", "EMAIL_LINK_ALLOWED_ORIGINS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://dev.seeding.markeeai.com")     # DEV chung KHONG duoc de len domain workspace
    with mock.patch.object(svc, "settings", _S):
        assert svc.resolve_base_url("markee") == "https://crm.markee.vn"
        assert svc.resolve_base_url("cloudgate") == "https://crm.getcloudgate.com"
        assert svc.resolve_base_url("securityzone") == "https://crm.securityzone.vn"
        assert svc.resolve_base_url("SecurityZone") == "https://crm.securityzone.vn"
        # alias cung workspace duoc phep; domain workspace khac / origin la bi bo qua
        assert svc.resolve_base_url("markee", "https://crm.markeeai.com") == "https://crm.markeeai.com"
        assert svc.resolve_base_url("cloudgate", "https://crm.securityzone.vn") == "https://crm.getcloudgate.com"
        assert svc.resolve_base_url("cloudgate", "https://crm.markee.vn") == "https://crm.getcloudgate.com"
        assert svc.resolve_base_url("markee", "https://dev.seeding.markeeai.com") == "https://crm.markee.vn"
        assert svc.resolve_base_url("markee", "https://evil.example.com") == "https://crm.markee.vn"


def test_base_url_env_override_and_fallback(monkeypatch):
    for k in ("PUBLIC_APP_BASE_URL", "EMAIL_LINK_WORKSPACE_DOMAINS", "WORKSPACE_DOMAINS", "EMAIL_LINK_ALLOWED_ORIGINS"):
        monkeypatch.delenv(k, raising=False)
    with mock.patch.object(svc, "settings", _S):
        monkeypatch.setenv("EMAIL_LINK_WORKSPACE_DOMAINS", '{"markee": "https://crm-uat.example.vn/"}')
        assert svc.resolve_base_url("markee") == "https://crm-uat.example.vn"
        assert svc.resolve_base_url("cloudgate") == "https://crm.getcloudgate.com"       # instance khac khong bi anh huong
        monkeypatch.delenv("EMAIL_LINK_WORKSPACE_DOMAINS")
        # instance la (khong co domain): chi khi do moi dung PUBLIC_APP_BASE_URL; khong co -> bao loi cau hinh
        with pytest.raises(svc.EmailLinkConfigError):
            svc.resolve_base_url("brandx")
        monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://crm.brandx.vn")
        assert svc.resolve_base_url("brandx") == "https://crm.brandx.vn"
        monkeypatch.setenv("PUBLIC_APP_BASE_URL", "http://localhost:3001")
        with pytest.raises(svc.EmailLinkConfigError):
            svc.resolve_base_url("brandx")                                              # localhost khong duoc dung am tham
        monkeypatch.setenv("EMAIL_LINK_ALLOWED_ORIGINS", "http://localhost:3001")
        assert svc.resolve_base_url("brandx") == "http://localhost:3001"


def test_config_error_marks_failed_but_keeps_handover(env, monkeypatch):
    for k in ("PUBLIC_APP_BASE_URL", "EMAIL_LINK_WORKSPACE_DOMAINS", "WORKSPACE_DOMAINS"):
        monkeypatch.delenv(k, raising=False)
    _, sent, lead_state = env
    lead_state["instance"] = "brandx"                                                   # workspace chua co domain
    res = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "cfg"}, USER)
    assert res["handover"]["email_status"] == "failed" and "brandx" in res["handover"]["email_error"] and not sent
    assert lead_state["qualification_ae_id"] == "trung"   # thao tac chinh van thanh cong


def test_email_links_follow_lead_workspace_for_all_kinds(env):
    _, sent, lead_state = env
    for i, (inst, host) in enumerate((("markee", "crm.markee.vn"), ("cloudgate", "crm.getcloudgate.com"), ("securityzone", "crm.securityzone.vn"))):
        lead_state.update({"instance": inst, "qualification_ae_id": "mai", "status": "mql"})
        svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": f"ws{i}", "_base_url": "https://dev.seeding.markeeai.com"}, USER)
        text = sent[-1][2]
        assert f"https://{host}/all-platform/crm/leads?lead=L1&mode=verify" in text and "dev.seeding" not in text and sent[-1][3].count(host) >= 1


def _rules(conds=None):
    from app.modules.all_platform.services import crm_lead_rule_service as rules
    return mock.patch.object(rules, "get_rule_set", return_value={"conditions": conds or rules.DEFAULT_CONDITIONS})


def test_reassign_not_ready_email_has_dynamic_checklist(env):
    _, sent, lead_state = env
    lead_state.update({"qualification_ae_id": "mai", "status": "mql"})
    with _rules():
        res = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "ck1"}, USER)
    assert res["handover"]["kind"] == "reassign"
    _, subject, text, html_body = sent[0]
    assert "[Đổi người phụ trách]" in subject
    for label in ("Giá trị dự kiến", "Việc tiếp theo", "Hạn follow-up", "Mức độ quan tâm"):
        assert label in text and label in html_body
    assert "Sale nhận bàn giao" not in text            # chi hien dieu kien THUC SU thieu (da co nguoi nhan)
    assert "bổ sung các mục còn thiếu" in text and "Tiếp nhận và xử lý Lead" in text
    assert ">—<" not in html_body                        # khong dau gach hang loat cho truong trong
    assert "https://crm.markee.vn/all-platform/crm/leads?lead=L1&mode=verify" in text


def test_checklist_follows_rule_engine_config(env):
    _, sent, lead_state = env
    lead_state.update({"qualification_ae_id": "mai", "status": "mql"})
    from app.modules.all_platform.services import crm_lead_rule_service as rules
    conds = {**rules.DEFAULT_CONDITIONS, "sql_interest": False, "sql_follow": False}   # Admin tat 2 dieu kien
    with _rules(conds):
        svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "ck2"}, USER)
    text = sent[0][2]
    assert "Mức độ quan tâm" not in text and "Hạn follow-up" not in text and "Giá trị dự kiến" in text


def test_reassign_ready_but_not_converted_says_verify(env):
    _, sent, lead_state = env
    lead_state.update({"qualification_ae_id": "mai", "status": "mql", "score": 80, "qualification_estimated_value": 1000000, "next_step": "Goi", "follow_up_date": "2026-10-20", "qualification_icp_fit": True})
    with _rules():
        svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "rd"}, USER)
    _, _, text, html_body = sent[0]
    assert "Tiếp nhận và xử lý Lead" in text and "bổ sung các mục còn thiếu" not in text and "Sẵn sàng xác minh" in html_body


def test_reassign_after_convert_points_to_customer_without_verify_checklist(env):
    db, sent, lead_state = env
    lead_state.update({"qualification_ae_id": "mai", "status": "sql", "converted_customer_id": "K1", "converted_deal_id": "D1"})
    db.tables["crm_customers"] = [{"id": "K1", "customer_name": "Cong ty A", "company_name": "Cong ty A", "customer_code": "KH000009"}]
    with _rules():
        svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "cv"}, USER)
    _, subject, text, html_body = sent[0]
    assert "https://crm.markee.vn/all-platform/crm/customers/K1?tab=quotes" in text
    assert "Thông tin cần bổ sung" not in text and "Xem hồ sơ & lập báo giá" in text and "leads?lead=" not in text
    for banned in ("đã convert", "không cần xác minh lại", "SQL đã đạt", "bàn giao khách hàng/cơ hội", "Lead đã được xác minh"):
        assert banned not in text and banned not in html_body


def test_email_html_is_table_based_with_links_and_plain_fallback(env):
    _, sent, lead_state = env
    lead_state.update({"qualification_ae_id": "mai", "status": "mql"})
    with _rules():
        svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "ht", "doc_links": ["https://docs.google.com/spreadsheets/d/1", "https://docs.google.com/document/d/2"]}, USER)
    _, _, text, h = sent[0]
    assert h.count("<table") >= 3 and "#07151D" in h and "#EF2B2D" in h and "MARKEE CRM" in h and "role=\"presentation\"" in h
    assert "Google Sheet" in h and "Google Doc" in h and "https://docs.google.com/spreadsheets/d/1" in h
    assert "<" not in text and "Google Sheet: https://docs.google.com/spreadsheets/d/1" in text


def test_resend_after_failure_then_never_twice(env):
    db, sent, _ = env
    with mock.patch.object(svc, "_send_email", side_effect=RuntimeError("smtp chua cau hinh")):
        res = svc.assign_lead("L1", {"to_user_id": "trung", "idempotency_key": "rs"}, USER)
    row_id = res["handover"]["id"]
    assert res["handover"]["email_status"] == "failed" and not sent
    again = svc.resend_handover_email("L1", row_id, USER)
    assert again["email_status"] == "sent" and len(sent) == 1
    with pytest.raises(ValueError):
        svc.resend_handover_email("L1", row_id, USER)   # da gui thanh cong -> khong gui lai
    assert len(sent) == 1


def test_customer_handover_docs_returns_only_leads_with_links():
    db = _DB()
    db.tables["crm_leads"] = [
        {"id": "L1", "lead_name": "A", "contact_code": "LH1", "converted_customer_id": "K1", "converted_deal_id": "D1", "instance": svc.settings.crm_instance,
         "handover_links": [{"url": "https://docs.google.com/x", "title": "Google Doc"}], "handover_by": "actor", "qualification_ae_id": "trung"},
        {"id": "L2", "lead_name": "B", "contact_code": "LH2", "converted_customer_id": "K1", "converted_deal_id": "D2", "instance": svc.settings.crm_instance, "handover_links": []},
    ]
    with mock.patch.object(svc, "get_supabase_client", return_value=db), \
            mock.patch("app.modules.all_platform.services.crm_customer_service.get_customer", return_value={"id": "K1"}):
        out = svc.customer_handover_docs("K1", USER)
    assert [d["leadCode"] for d in out] == ["LH1"] and out[0]["dealId"] == "D1" and out[0]["handedOverBy"] == "Chi Thuy" and out[0]["assignee"] == "Duc Trung"


def _build(kind, lead=None, **kw):
    base = {**LEAD, "company_name": "Công ty TNHH Minh Phát", "follow_up_date": "2026-10-20", "qualification_estimated_value": 25000000}
    base.update(lead or {})
    return svc.build_handover_email(kind=kind, lead=base, lead_code="LH000001", actor_name="Minh", to_name="Vũ", links=[], missing_items=kw.pop("missing", []), base_url=None, **kw)


def test_email_copy_four_scenarios(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://crm.test.example")
    cust = {"id": "K1", "customer_name": "Minh Phát", "customer_code": "KH000001"}
    _, t, _ = _build("handover", missing=["Giá trị dự kiến"])                                                       # A
    assert "Bạn được giao phụ trách Lead Công ty TNHH Minh Phát." in t and "Mở Lead và bổ sung thông tin" in t
    _, t, _ = _build("assign_qualified", customer=cust, customer_code="KH000001", lead={"converted_customer_id": "K1"})   # B
    assert "Khách hàng Công ty TNHH Minh Phát đã được chuyển đến bạn phụ trách." in t and "Xem hồ sơ khách hàng" in t
    _, t, _ = _build("reassign", missing=["Giá trị dự kiến"], prev_name="Lâm")                                    # C
    assert "tiếp nhận Lead Công ty TNHH Minh Phát từ Lâm." in t and "Tiếp nhận và xử lý Lead" in t
    _, t, h = _build("reassign", customer=cust, prev_name="Lâm", lead={"converted_customer_id": "K1"})            # D
    assert "tiếp nhận khách hàng Công ty TNHH Minh Phát từ Lâm." in t and "Xem hồ sơ & lập báo giá" in t
    assert "20/10/2026" in t and "25.000.000 ₫" in t
    assert t.count("Công ty TNHH Minh Phát") == 2 and "Khách hàng:" not in t   # loi chao + tieu de card; khong con dong "Khach hang" trung
