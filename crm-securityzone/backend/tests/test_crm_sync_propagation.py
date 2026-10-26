"""Test dong bo Lead -> Khach hang/Lien he/Co hoi -> Bao gia (crm_sync_service + helper trong quote service).

Dung DB GIA trong bo nho (khong cham DB that)."""
from __future__ import annotations

import copy

import pytest

from app.modules.all_platform.services import crm_cascade_sync_service as sync
from app.modules.all_platform.services import supabase_quote_service as qs

INSTANCE = "test"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.mode, self.payload, self._limit = [], "select", None, None

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def limit(self, n):
        self._limit = n
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, list(vals)))
        return self

    def is_(self, col, _val):
        self.filters.append(("null", col, None))
        return self

    @staticmethod
    def _get(row, col):
        if "->>" in col:
            base, key = col.split("->>")
            value = (row.get(base) or {}).get(key)
            return None if value is None else str(value)
        return row.get(col)

    def _match(self, row):
        for kind, col, val in self.filters:
            cur = self._get(row, col)
            if kind == "eq" and str(cur) != str(val):
                return False
            if kind == "in" and cur not in val:
                return False
            if kind == "null" and cur is not None:
                return False
        return True

    def execute(self):
        rows = [r for r in self.db[self.table] if self._match(r)]
        if self.mode == "update":
            for r in rows:
                r.update(copy.deepcopy(self.payload))
        if self._limit:
            rows = rows[: self._limit]
        return _Result([copy.deepcopy(r) for r in rows])


class _FakeSupabase:
    def __init__(self, db):
        self.db = db

    def table(self, name):
        self.db.setdefault(name, [])
        return _Query(self.db, name)


@pytest.fixture
def db(monkeypatch):
    data = {
        "crm_leads": [],
        "crm_contacts": [{"id": "ct1", "instance": INSTANCE, "name": "Chi Hanh", "phone": "0900000001", "email": None, "position": None}],
        "crm_customers": [{
            "id": "cu1", "instance": INSTANCE, "customer_name": "Cong ty A", "company_name": "Cong ty A",
            "phone": "0900000001", "email": None, "zalo": None, "facebook": None, "telegram": None,
            "website": None, "address": None, "tax_code": None,
        }],
        "customer_leads": [{
            "id": "d1", "instance": INSTANCE, "customer_id": "cu1", "customer_name": "Cong ty A", "company_name": "Cong ty A",
            "phone": "0900000001", "email": None, "address": None, "tax_code": None, "primary_contact_id": "ct1",
        }],
        "quotes": [
            {"id": "q1", "instance": INSTANCE, "deal_id": "d1", "deleted_at": None, "data": {
                "customerCompanyName": "Cong ty A", "customerRecipient": "Chi Hanh", "customerContactName": "Chi Hanh",
                "customerPhone": "0900000001", "customerContactId": "ct1"}},
            # bao gia cu: chua luu customerContactId
            {"id": "q2", "instance": INSTANCE, "deal_id": "d1", "deleted_at": None, "data": {
                "customerCompanyName": "Cong ty A", "customerRecipient": "Chi Hanh"}},
            # nguoi dung go tay "Kinh gui" rieng
            {"id": "q3", "instance": INSTANCE, "deal_id": "d1", "deleted_at": None, "data": {
                "customerCompanyName": "Cong ty A", "customerRecipient": "Quy khach hang", "customerContactId": "ct1"}},
        ],
    }
    fake = _FakeSupabase(data)
    for mod in (sync, qs):
        monkeypatch.setattr(mod, "get_supabase_client", lambda: fake)
    # settings.crm_instance co the la thuoc tinh thuong hoac property (crm-module) -> patch o cap class
    monkeypatch.setattr(type(sync.settings), "crm_instance", property(lambda _self: INSTANCE), raising=False)
    monkeypatch.setattr(qs, "_crm_instance", lambda: INSTANCE)
    return data


def _q(db, qid):
    return next(q for q in db["quotes"] if q["id"] == qid)["data"]


def test_customer_change_propagates_to_deal_and_all_quotes(db):
    db["crm_customers"][0].update(company_name="Cong ty A Moi", customer_name="Cong ty A Moi", address="1 Le Loi", tax_code="0312345678")
    sync.propagate_customer_change(db["crm_customers"][0])
    deal = db["customer_leads"][0]
    assert deal["company_name"] == "Cong ty A Moi" and deal["customer_name"] == "Cong ty A Moi"
    assert deal["address"] == "1 Le Loi" and deal["tax_code"] == "0312345678"
    for qid in ("q1", "q2", "q3"):
        d = _q(db, qid)
        assert d["customerCompanyName"] == "Cong ty A Moi" and d["customerAddress"] == "1 Le Loi" and d["customerTaxCode"] == "0312345678"


def test_customer_blank_field_does_not_wipe_quote(db):
    db["quotes"][0]["data"]["customerAddress"] = "Dia chi cu"
    db["crm_customers"][0].update(address="", company_name="Cong ty A")
    sync.propagate_customer_change(db["crm_customers"][0])
    assert _q(db, "q1")["customerAddress"] == "Dia chi cu"


def test_contact_change_syncs_quotes_but_keeps_hand_typed_recipient(db):
    old = copy.deepcopy(db["crm_contacts"][0])
    db["crm_contacts"][0].update(name="Chi Bao Hanh", phone="0911111111")
    qs.sync_contact_snapshot_to_quotes(db["crm_contacts"][0], old_row=old)
    assert _q(db, "q1")["customerRecipient"] == "Chi Bao Hanh" and _q(db, "q1")["customerPhone"] == "0911111111"
    # bao gia cu (khong co customerContactId nhung deal co lien he chinh nay) cung doi theo
    assert _q(db, "q2")["customerRecipient"] == "Chi Bao Hanh" and _q(db, "q2")["customerContactId"] == "ct1"
    # ten go tay rieng ("Quy khach hang") duoc giu, nhung SDT (khong go tay) van cap nhat
    assert _q(db, "q3")["customerRecipient"] == "Quy khach hang"
    assert _q(db, "q3").get("customerPhone") == "0911111111"


def test_lead_change_flows_to_contact_customer_deal_and_quotes(db):
    old = {"lead_name": "Chi Hanh", "company_name": "Cong ty A", "phone": "0900000001", "email": None}
    new = {**old, "lead_name": "Chi Bao Hanh", "company_name": "Cong ty A Moi", "phone": "0922222222", "email": "h@a.vn",
           "converted_contact_id": "ct1", "converted_customer_id": "cu1", "converted_deal_id": "d1"}
    sync.propagate_lead_change(old, new)
    assert db["crm_contacts"][0]["name"] == "Chi Bao Hanh" and db["crm_contacts"][0]["phone"] == "0922222222"
    assert db["crm_customers"][0]["company_name"] == "Cong ty A Moi" and db["crm_customers"][0]["customer_name"] == "Cong ty A Moi"
    assert db["crm_customers"][0]["email"] == "h@a.vn"
    assert db["customer_leads"][0]["company_name"] == "Cong ty A Moi" and db["customer_leads"][0]["phone"] == "0922222222"
    assert _q(db, "q1")["customerRecipient"] == "Chi Bao Hanh"
    assert _q(db, "q1")["customerCompanyName"] == "Cong ty A Moi"


def test_lead_change_does_not_overwrite_shared_customer(db):
    # Khach hang dung chung da duoc doi ten rieng -> khong con la ban sao cua lead -> khong bi ghi de
    db["crm_customers"][0].update(customer_name="Tap doan Z", company_name="Tap doan Z")
    old = {"lead_name": "Chi Hanh", "company_name": "Cong ty A", "phone": "0900000001"}
    new = {**old, "company_name": "Cong ty A Moi", "converted_customer_id": "cu1"}
    sync.propagate_lead_change(old, new)
    assert db["crm_customers"][0]["company_name"] == "Tap doan Z"
    assert db["crm_customers"][0]["customer_name"] == "Tap doan Z"


def test_primary_contact_change_updates_quotes_of_deal(db):
    old_contact = copy.deepcopy(db["crm_contacts"][0])
    new_contact = {"id": "ct2", "name": "Anh Minh", "phone": "0933333333", "email": "m@a.vn"}
    qs.sync_deal_primary_contact_to_quotes("d1", new_contact, old_contact)
    for qid in ("q1", "q2"):
        d = _q(db, qid)
        assert d["customerRecipient"] == "Anh Minh" and d["customerContactId"] == "ct2" and d["customerEmail"] == "m@a.vn"
    assert _q(db, "q3")["customerRecipient"] == "Quy khach hang"  # go tay giu nguyen


def test_errors_never_raise(monkeypatch):
    def boom():
        raise RuntimeError("db down")
    monkeypatch.setattr(sync, "get_supabase_client", boom)
    monkeypatch.setattr(qs, "get_supabase_client", boom)
    sync.propagate_customer_change({"id": "x", "company_name": "A"})
    sync.propagate_lead_change({"lead_name": "a"}, {"lead_name": "b", "converted_contact_id": "c"})
    assert qs.sync_contact_snapshot_to_quotes({"id": "x", "name": "a"}) == 0
    assert qs.sync_deal_primary_contact_to_quotes("d", {"id": "c", "name": "a"}) == 0

def test_customer_owner_follows_new_sale_when_owner_was_derived_from_lead(db):
    db["crm_customers"][0]["owner_id"] = "creator"  # owner = nguoi tao/chuyen doi lead
    old = {"lead_name": "Chi Hanh", "company_name": "Cong ty A", "qualification_ae_id": None, "sdr_id": "creator", "created_by": "creator", "converted_by": "creator"}
    new = {**old, "qualification_ae_id": "sale1", "sdr_id": "sale1", "converted_customer_id": "cu1"}
    sync.propagate_lead_change(old, new)
    assert db["crm_customers"][0]["owner_id"] == "sale1"


def test_customer_owner_chosen_by_someone_else_is_kept(db):
    db["crm_customers"][0]["owner_id"] = "other_owner"  # chu that do nguoi khac dat, khong phai owner sinh ra tu lead nay
    old = {"lead_name": "Chi Hanh", "company_name": "Cong ty A", "qualification_ae_id": None, "sdr_id": "creator", "created_by": "creator", "converted_by": "creator"}
    new = {**old, "qualification_ae_id": "sale1", "sdr_id": "sale1", "converted_customer_id": "cu1"}
    sync.propagate_lead_change(old, new)
    assert db["crm_customers"][0]["owner_id"] == "other_owner"
