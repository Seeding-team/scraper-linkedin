"""Test cho Việc 1 (2026-11-26): `fetch_public_group_info()` — phương án dự phòng lấy
{name, member_count} qua proxy SIM 4G của Public Crawler khi Extension timeout/lỗi.

Ràng buộc bắt buộc cần test: KHÔNG chạy khi sim.status=="rotating" (trả lỗi "busy" ngay,
không chờ, không gọi HTTP nào); concurrency=1 (gọi chồng lên nhau trả "busy"); phát hiện
đúng login_wall (redirect + text) và private_group; parse đúng title/member-count.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from app.modules.all_platform.services import public_4g_crawler_service as svc


class _FakeCookies:
    def clear(self) -> None:
        pass


class _FakeResponse:
    def __init__(self, status_code: int, text: str = "", headers: dict[str, str] | None = None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}


class _FakeHttpClient:
    def __init__(self, responses: list[_FakeResponse]):
        self._responses = list(responses)
        self.cookies = _FakeCookies()
        self.closed = False

    async def get(self, _url: str) -> _FakeResponse:
        return self._responses.pop(0)

    async def aclose(self) -> None:
        self.closed = True


def _fake_sim(status: str = "idle", socks_url: str = "http://fake-proxy.local:8080") -> Any:
    return SimpleNamespace(status=status, socks_url=socks_url, platform="facebook")


_SAMPLE_GROUP_HTML = (
    "<html><head><title>Hội Việc Làm CNTT Đà Nẵng | Facebook</title></head>"
    "<body><div>12.345 thành viên</div><div>Một vài bài viết công khai...</div></body></html>"
)


def test_parse_group_name_and_member_count_from_sample_html():
    name, count = svc._parse_group_name_and_member_count(_SAMPLE_GROUP_HTML)
    assert name == "Hội Việc Làm CNTT Đà Nẵng"
    assert count == 12345


def test_parse_handles_english_members_pattern_and_missing_title():
    html_text = "<html><body>No title here. 2,500 members joined this year.</body></html>"
    name, count = svc._parse_group_name_and_member_count(html_text)
    assert name is None
    assert count == 2500


def test_fetch_group_info_success(monkeypatch):
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: _fake_sim())
    monkeypatch.setattr(
        svc,
        "_build_guest_http_client",
        lambda _proxy: _FakeHttpClient([_FakeResponse(200, text=_SAMPLE_GROUP_HTML)]),
    )

    result = asyncio.run(svc.fetch_public_group_info("https://facebook.com/groups/vieclamcnttdn"))

    assert result["success"] is True
    assert result["group_name"] == "Hội Việc Làm CNTT Đà Nẵng"
    assert result["member_count"] == 12345


def test_fetch_group_info_busy_when_sim_rotating(monkeypatch):
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: _fake_sim(status="rotating"))

    def _should_not_be_called(_proxy):
        raise AssertionError("Khong duoc goi HTTP nao khi sim dang rotating")

    monkeypatch.setattr(svc, "_build_guest_http_client", _should_not_be_called)

    result = asyncio.run(svc.fetch_public_group_info("https://facebook.com/groups/vieclamcnttdn"))

    assert result["success"] is False
    assert result["error_code"] == "busy"


def test_fetch_group_info_no_proxy_configured(monkeypatch):
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: None)

    result = asyncio.run(svc.fetch_public_group_info("https://facebook.com/groups/vieclamcnttdn"))

    assert result["success"] is False
    assert result["error_code"] == "no_proxy"


def test_fetch_group_info_login_wall_via_redirect(monkeypatch):
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: _fake_sim())
    monkeypatch.setattr(
        svc,
        "_build_guest_http_client",
        lambda _proxy: _FakeHttpClient(
            [_FakeResponse(302, headers={"location": "https://facebook.com/login/?next=..."})]
        ),
    )

    result = asyncio.run(svc.fetch_public_group_info("https://facebook.com/groups/vieclamcnttdn"))

    assert result["success"] is False
    assert result["error_code"] == "login_required"


def test_fetch_group_info_private_group_detected_from_body_text(monkeypatch):
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: _fake_sim())
    private_html = (
        "<html><head><title>Nhóm Kín ABC | Facebook</title></head>"
        "<body>Đây là Nhóm riêng tư. Tham gia nhóm để xem bài viết.</body></html>"
    )
    monkeypatch.setattr(
        svc,
        "_build_guest_http_client",
        lambda _proxy: _FakeHttpClient([_FakeResponse(200, text=private_html)]),
    )

    result = asyncio.run(svc.fetch_public_group_info("https://facebook.com/groups/some-private-group"))

    assert result["success"] is False
    assert result["error_code"] == "not_found"


def test_fetch_group_info_rate_limit_from_http_429(monkeypatch):
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: _fake_sim())
    monkeypatch.setattr(
        svc,
        "_build_guest_http_client",
        lambda _proxy: _FakeHttpClient([_FakeResponse(429, text="")]),
    )

    result = asyncio.run(svc.fetch_public_group_info("https://facebook.com/groups/vieclamcnttdn"))

    assert result["success"] is False
    assert result["error_code"] == "blocked"


def test_fetch_group_info_busy_when_already_locked(monkeypatch):
    """concurrency=1: neu lock dang bi giu (1 request khac dang chay), tra "busy" ngay,
    khong cho, khong goi HTTP nao."""
    monkeypatch.setattr(svc, "_pick_facebook_guest_sim", lambda: _fake_sim())

    def _should_not_be_called(_proxy):
        raise AssertionError("Khong duoc goi HTTP nao khi lock da bi giu")

    monkeypatch.setattr(svc, "_build_guest_http_client", _should_not_be_called)

    async def _run_while_locked():
        async with svc._group_info_fetch_lock:
            return await svc.fetch_public_group_info("https://facebook.com/groups/vieclamcnttdn")

    result = asyncio.run(_run_while_locked())

    assert result["success"] is False
    assert result["error_code"] == "busy"
