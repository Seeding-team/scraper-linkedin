"""Tests cho update_call_result_note (Việc 3, 2026-11-21) — cập nhật riêng cột `note`, KHÔNG
đổi result_code/attempts/last_call_at, KHÔNG tạo bản ghi mới. Tests tự chứa (tests/ không có
conftest.py), harness fake Supabase tối giản chỉ đủ cho post_call_results."""

from __future__ import annotations

from typing import Any, Optional
from unittest import mock

import pytest

from app.modules.all_platform.services import post_call_result_service as svc

USER: dict[str, Any] = {"id": "user-1", "role": "member"}


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple] = []
        self._update_payload: Optional[dict] = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def maybe_single(self):
        return self

    def update(self, payload: dict):
        self._update_payload = payload
        return self

    def _matching_rows(self):
        out = []
        for r in self.rows:
            if all(r.get(k) == v for k, v in self.filters):
                out.append(r)
        return out

    def execute(self):
        matched = self._matching_rows()
        if self._update_payload is not None:
            for r in matched:
                r.update(self._update_payload)
            return _Result([dict(r) for r in matched])
        if len(matched) == 1:
            return _Result(dict(matched[0]))
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []))


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched(fake_db):
    with mock.patch.object(svc, "get_supabase_client", return_value=fake_db):
        yield fake_db


def test_update_note_does_not_touch_result_code_or_attempts(patched):
    fake_db = patched
    fake_db.store.setdefault("post_call_results", []).append({
        "id": "row-1",
        "post_id": "post-1",
        "platform": "facebook",
        "result_code": "interested",
        "attempts": 2,
        "last_call_at": "2026-11-20T10:00:00+00:00",
        "note": None,
        "updated_by": "someone-else",
        "updated_at": "2026-11-20T10:00:00+00:00",
    })

    result = svc.update_call_result_note("post-1", "facebook", "Khách hẹn gọi lại tuần sau", user=USER)

    assert result["note"] == "Khách hẹn gọi lại tuần sau"
    assert result["result_code"] == "interested"
    assert result["attempts"] == 2
    assert result["last_call_at"] == "2026-11-20T10:00:00+00:00"
    assert result["updated_by"] == "user-1"


def test_update_note_empty_string_clears_note(patched):
    fake_db = patched
    fake_db.store.setdefault("post_call_results", []).append({
        "id": "row-1",
        "post_id": "post-1",
        "platform": "facebook",
        "result_code": "callback",
        "attempts": 1,
        "last_call_at": "2026-11-20T10:00:00+00:00",
        "note": "ghi chú cũ",
        "updated_by": "user-1",
        "updated_at": "2026-11-20T10:00:00+00:00",
    })

    result = svc.update_call_result_note("post-1", "facebook", "", user=USER)
    assert result["note"] is None


def test_update_note_raises_when_no_existing_call_result(patched):
    with pytest.raises(ValueError):
        svc.update_call_result_note("post-without-call", "facebook", "ghi chú", user=USER)
