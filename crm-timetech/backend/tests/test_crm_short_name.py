"""Tên viết tắt khách hàng: quy tắc, thương hiệu đã có, AI có kiểm chứng + fallback, không ép khách cá nhân."""
from unittest import mock

import pytest

from app.modules.all_platform.services import crm_short_name_service as svc


@pytest.mark.parametrize("company,expected", [
    ("Công ty Cổ phần Tập đoàn FPT", "FPT"),
    ("Công ty TNHH Công nghệ và Giải pháp ABC", "ABC"),
    ("Công ty TNHH Thương mại Dịch vụ Hoàng Gia", "Hoàng Gia"),
    ("HỘ KINH DOANH DEN FOOD", "DEN FOOD"),
    ("CÔNG TY CỔ PHẦN THƯƠNG MẠI VÀ SẢN XUẤT HGF", "HGF"),
    ("Công ty Cổ phần Chuyển đổi số DTC", "DTC"),
    ("Tổng công ty điện lực miền trung (CPC)", "CPC"),
    ("CÔNG TY ĐIỆN LỰC ĐẮK LẮK - CHI NHÁNH TỔNG CÔNG TY ĐIỆN LỰC MIỀN TRUNG", "ĐIỆN LỰC ĐẮK LẮK"),
    ("CÔNG TY TNHH STARTECH SOLUTIONS VIỆT NAM", "STARTECH SOLUTIONS"),
    ("Asia Dragon", "Asia Dragon"),     # ngắn + rõ nghĩa -> giữ nguyên
    ("HANDEE", "HANDEE"),
    ("Cao Sơn", "Cao Sơn"),             # không có loại hình -> không cắt nhầm tên riêng
    ("Văn Phong", "Văn Phong"),
])
def test_rule_examples(company, expected):
    assert svc.rule_suggest(company)["suggestion"] == expected


def test_long_name_without_basis_is_kept_not_initials():
    out = svc.rule_suggest("Trung tâm Chăm sóc khách hàng Điện lực miền Trung - Chi nhánh Tổng công ty Điện lực miền Trung")
    assert out["suggestion"] == "Trung tâm Chăm sóc khách hàng Điện lực miền Trung" and out["confident"] is False
    assert "TTCSKH" not in out["suggestion"]


def test_known_brand_wins():
    with mock.patch.object(svc, "_known_brands", return_value=["FPT", "Hoàng Gia", "AB"]):
        assert svc.suggest_short_name("Công ty CP Tập đoàn FPT Software Việt Nam", use_ai=False)["source"] == "brand"
        assert svc.suggest_short_name("Công ty CP Tập đoàn FPT Software Việt Nam", use_ai=False)["suggestion"] == "FPT"
        # thuong hieu qua ngan (<3 ky tu) khong duoc dung
        assert svc.suggest_short_name("Công ty AB Việt", use_ai=False)["source"] != "brand"


def _fake_ai(value):
    resp = mock.Mock()
    resp.raise_for_status = mock.Mock()
    resp.json.return_value = {"choices": [{"message": {"content": '{"short_name": "%s"}' % value}}]}
    return mock.patch.object(svc.httpx, "post", return_value=resp)


LONG = "Trung tâm Chăm sóc khách hàng Điện lực miền Trung - Chi nhánh Tổng công ty Điện lực miền Trung"


def test_ai_used_only_when_rule_not_confident_and_validated():
    with mock.patch.object(svc, "_known_brands", return_value=[]), mock.patch.object(svc.settings, "openai_api_key", "k"):
        with _fake_ai("Chăm sóc khách hàng Điện lực"):
            out = svc.suggest_short_name(LONG)
        assert out == {"suggestion": "Chăm sóc khách hàng Điện lực", "source": "ai"}
        with _fake_ai("EVNCPC"):  # co tu khong co trong ten goc -> bi tu choi -> fallback quy tac
            out = svc.suggest_short_name(LONG)
        assert out["source"] == "keep" and out["suggestion"].startswith("Trung tâm")


def test_ai_not_called_for_confident_rule_or_when_disabled():
    with mock.patch.object(svc, "_known_brands", return_value=[]), mock.patch.object(svc.settings, "openai_api_key", "k"):
        with mock.patch.object(svc.httpx, "post") as post:
            assert svc.suggest_short_name("Công ty TNHH ABC")["suggestion"] == "ABC"
            svc.suggest_short_name(LONG, use_ai=False)
            post.assert_not_called()


def test_ai_failure_falls_back_stably():
    with mock.patch.object(svc, "_known_brands", return_value=[]), mock.patch.object(svc.settings, "openai_api_key", "k"):
        with mock.patch.object(svc.httpx, "post", side_effect=RuntimeError("timeout")):
            out = svc.suggest_short_name(LONG)
        assert out["source"] == "keep" and out["suggestion"]
    with mock.patch.object(svc, "_known_brands", return_value=[]), mock.patch.object(svc.settings, "openai_api_key", ""):
        assert svc.suggest_short_name(LONG)["source"] == "keep"   # chua cau hinh AI


def test_personal_customers_are_not_forced_into_companies():
    assert svc.looks_like_enterprise("Anh Khoa", None, None) is False
    assert svc.looks_like_enterprise("Chị Nghi", "", "") is False
    assert svc.looks_like_enterprise("Trung tâm Y tế A", None, None) is True
    assert svc.looks_like_enterprise("Lê Thị Ánh", None, "0312345678") is True      # có MST -> tổ chức
    data = {"customer_name": "Anh Khoa"}
    svc.fill_short_name_for_new(data)
    assert "short_name" not in data


def test_fill_for_new_respects_manual_and_sets_auto():
    typed = {"customer_name": "X", "short_name": "  Mine "}
    svc.fill_short_name_for_new(typed)
    assert typed["short_name"] == "Mine" and typed["short_name_manual"] is True
    with mock.patch.object(svc, "_known_brands", return_value=[]):
        auto = {"customer_name": "CÔNG TY CỔ PHẦN MARKEE", "company_name": "CÔNG TY CỔ PHẦN MARKEE"}
        svc.fill_short_name_for_new(auto)
    assert auto["short_name"] == "MARKEE" and auto["short_name_manual"] is False


def test_is_brand_of():
    assert svc.is_brand_of("DENFOOD", "HỘ KINH DOANH DEN FOOD")
    assert svc.is_brand_of("STARTECH", "CÔNG TY TNHH STARTECH SOLUTIONS")
    assert not svc.is_brand_of("Anh Dũng", "Sở Giáo Dục Nghệ An")
