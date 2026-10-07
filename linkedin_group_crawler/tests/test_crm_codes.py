"""Rule ma: convert giu NGUYEN contact_code cua Lead cho Contact moi; Customer sinh customer_code luc convert."""
from unittest import mock

from app.modules.all_platform.services import crm_lead_service as svc


class _Q:
    def __init__(self, log, table):
        self.log, self.table, self.payload, self.filters = log, table, None, {}

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, k, v):
        self.filters[k] = v
        return self

    def execute(self):
        self.log.append((self.table, self.payload, dict(self.filters)))
        return mock.Mock(data=[{}])


class _DB:
    def __init__(self):
        self.log = []

    def table(self, name):
        return _Q(self.log, name)


def _run(data, payload, lead_code):
    db = _DB()
    with mock.patch.object(svc, "get_supabase_client", return_value=db), \
            mock.patch("app.modules.all_platform.services.supabase_project_service._resolve_customer_code", return_value="ACME") as resolve:
        svc._apply_convert_codes(data, payload, lead_code)
    return db, resolve


def test_new_contact_keeps_lead_code_and_customer_gets_code():
    data = {"contact": {"id": "c1", "contact_code": "LH000099"}, "customer": {"id": "k1"}}
    db, resolve = _run(data, {}, "LH000005")
    assert data["contact"]["contact_code"] == "LH000005"
    assert db.log and db.log[0][0] == "crm_contacts" and db.log[0][1] == {"contact_code": "LH000005"}
    resolve.assert_called_once_with("k1")
    assert data["customer"]["customer_code"] == "ACME"


def test_existing_contact_is_not_overwritten():
    data = {"contact": {"id": "c1", "contact_code": "LH000001"}, "customer": {"id": "k1"}}
    db, _ = _run(data, {"contact_id": "c1"}, "LH000005")
    assert not db.log
    assert data["contact"]["contact_code"] == "LH000001"


def test_no_lead_code_leaves_contact_alone():
    data = {"contact": {"id": "c1", "contact_code": "LH000001"}}
    db, _ = _run(data, {}, None)
    assert not db.log
