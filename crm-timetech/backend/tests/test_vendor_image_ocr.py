import asyncio
import json

import pytest

from app.modules.all_platform.services import vendor_ai_parse_service as svc


class _FakeResp:
    def __init__(self, content):
        self._content = content

    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


def _fake_openai(monkeypatch, content, sent):
    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            sent.append(json)
            return _FakeResp(content)

    monkeypatch.setattr(svc.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(svc.settings, "gemini_api_key", "")
    monkeypatch.setattr(svc.settings, "openai_api_key", "sk-test")


def test_image_upload_is_sent_to_vision_model(monkeypatch):
    sent = []
    _fake_openai(monkeypatch, json.dumps({"items": [{"sku": "FG-60F", "name": "FortiGate 60F", "net_price": 620}]}), sent)
    items, raw = asyncio.run(svc.VendorAIParsingService.parse_file(b"\x89PNG fake", "image/png", "quote.png"))
    assert items == [{"sku": "FG-60F", "name": "FortiGate 60F", "net_price": 620}]
    assert raw == "[Ảnh] quote.png"
    image_part = sent[0]["messages"][1]["content"][1]
    assert image_part["type"] == "image_url"
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")


def test_image_with_no_products_reports_clear_error(monkeypatch):
    _fake_openai(monkeypatch, json.dumps({"items": []}), [])
    with pytest.raises(ValueError, match="Không tìm thấy sản phẩm"):
        asyncio.run(svc.VendorAIParsingService.parse_file(b"x", "image/jpeg", "quote.jpg"))


def test_image_without_ai_key_explains_config(monkeypatch):
    monkeypatch.setattr(svc.settings, "gemini_api_key", "")
    monkeypatch.setattr(svc.settings, "openai_api_key", "")
    with pytest.raises(ValueError, match="Chưa cấu hình AI"):
        asyncio.run(svc.VendorAIParsingService.parse_file(b"x", "image/png", "quote.png"))
