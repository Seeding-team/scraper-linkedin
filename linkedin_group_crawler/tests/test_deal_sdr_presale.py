"""Sale phu trach (sdr_id) cua Co hoi duoc la Presale; Nguoi phu trach (leaded_by) van chi Sale/Both."""
from unittest import mock

import pytest

from app.modules.all_platform.services import customer_lead_service as svc

ADMIN = {"id": "admin", "role": "admin"}


def _user(role):
    return {"id": "u1", "isActive": True, "quoteBusinessRole": role}


def _check(field, role):
    with mock.patch.object(svc, "get_member_option_by_id", return_value=_user(role)):
        svc._validate_one_deal_assignment_field(ADMIN, field, field + "_hint", {field: "u1"}, {})


def test_sdr_may_be_presale():
    for role in ("sale", "both", "presale"):
        _check("sdr_id", role)


def test_leaded_by_still_rejects_presale():
    _check("leaded_by", "sale")
    with pytest.raises(ValueError, match="Presale"):
        _check("leaded_by", "presale")


def test_sdr_rejects_other_roles():
    with pytest.raises(ValueError):
        _check("sdr_id", "marketing")
