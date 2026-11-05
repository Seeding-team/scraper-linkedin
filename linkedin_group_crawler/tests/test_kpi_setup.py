"""Unit tests for KPI Setup, Calculations and PM Sync payload building."""

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# Ensure app is in sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# Mock third-party libs if running on host without all deps
for mod in [
    "supabase", "supabase.lib", "supabase.lib.client_options",
    "postgrest", "postgrest.exceptions",
    "playwright", "playwright.sync_api",
    "loguru"
]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

# Lightweight services package to avoid loading bloated services/__init__.py
services_path = str(root_dir / "app" / "modules" / "all_platform" / "services")
if "app.modules.all_platform.services" not in sys.modules:
    services_pkg = types.ModuleType("app.modules.all_platform.services")
    services_pkg.__path__ = [services_path]
    services_pkg.__file__ = str(Path(services_path) / "__init__.py")
    sys.modules["app.modules.all_platform.services"] = services_pkg

# Lightweight routers package to avoid loading bloated routers/__init__.py
routers_path = str(root_dir / "app" / "modules" / "all_platform" / "routers")
if "app.modules.all_platform.routers" not in sys.modules:
    routers_pkg = types.ModuleType("app.modules.all_platform.routers")
    routers_pkg.__path__ = [routers_path]
    routers_pkg.__file__ = str(Path(routers_path) / "__init__.py")
    sys.modules["app.modules.all_platform.routers"] = routers_pkg

# Mock auth_deps if needed
if "app.modules.all_platform.auth_deps" not in sys.modules:
    auth_deps = types.ModuleType("app.modules.all_platform.auth_deps")
    auth_deps.get_current_user = lambda: {"id": "test-user"}
    sys.modules["app.modules.all_platform.auth_deps"] = auth_deps

import pytest
from app.modules.all_platform.services.kpi_calculation_service import (
    compute_manday,
    resolve_tier,
)
from app.modules.all_platform.services import kpi_pm_sync_service as pm_svc
from app.modules.all_platform.services.kpi_pm_sync_service import (
    build_payload,
    is_pm_configured,
    sync_session_to_pm,
    get_pm_skills,
)


def test_resolve_tier():
    # Normal: 10, High: 20, Critical: 30
    assert resolve_tier(5, 10, 20, 30) is None
    assert resolve_tier(10, 10, 20, 30) == "normal"
    assert resolve_tier(15, 10, 20, 30) == "normal"
    assert resolve_tier(20, 10, 20, 30) == "high"
    assert resolve_tier(25, 10, 20, 30) == "high"
    assert resolve_tier(30, 10, 20, 30) == "critical"
    assert resolve_tier(40, 10, 20, 30) == "critical"

    # Edge case: critical = 0 (khong co moc)
    assert resolve_tier(50, 10, 20, 0) == "high"
    # All 0
    assert resolve_tier(50, 0, 0, 0) is None


def test_compute_manday_without_bonus():
    # Mandays: normal=1.0, high=2.0, critical=3.0
    res_none = compute_manday(None, 1.0, 2.0, 3.0, 5)
    assert res_none["base_manday"] == 0.0
    assert res_none["bonus_manday"] == 0.0
    assert res_none["total_manday"] == 0.0

    res_normal = compute_manday("normal", 1.0, 2.0, 3.0, 10)
    assert res_normal["base_manday"] == 1.0
    assert res_normal["bonus_manday"] == 0.0
    assert res_normal["total_manday"] == 1.0

    res_critical = compute_manday("critical", 1.0, 2.0, 3.0, 35)
    assert res_critical["base_manday"] == 3.0
    assert res_critical["bonus_manday"] == 0.0
    assert res_critical["total_manday"] == 3.0


def test_compute_manday_with_bonus():
    bonus_rules = [
        {"metric_code": "can-lien-he", "min_count": 50, "bonus_manday": 0.5, "requires_tier": "critical"},
        {"metric_code": "can-lien-he", "min_count": 100, "bonus_manday": 1.0, "requires_tier": "critical"},
    ]

    # actual_count = 60, tier = critical -> qualifies for rule 1 (+0.5)
    calc1 = compute_manday("critical", 1.0, 2.0, 3.0, 60, bonus_rules)
    assert calc1["base_manday"] == 3.0
    assert calc1["bonus_manday"] == 0.5
    assert calc1["total_manday"] == 3.5

    # actual_count = 120, tier = critical -> qualifies for rule 1 (+0.5) and rule 2 (+1.0)
    calc2 = compute_manday("critical", 1.0, 2.0, 3.0, 120, bonus_rules)
    assert calc2["base_manday"] == 3.0
    assert calc2["bonus_manday"] == 1.5
    assert calc2["total_manday"] == 4.5

    # actual_count = 120 but tier = high -> does not qualify for requires_tier = 'critical'
    calc3 = compute_manday("high", 1.0, 2.0, 3.0, 120, bonus_rules)
    assert calc3["base_manday"] == 2.0
    assert calc3["bonus_manday"] == 0.0
    assert calc3["total_manday"] == 2.0


def test_build_payload_for_pm():
    session = {
        "id": "sess-uuid-123",
        "crm_team_id": "team-uuid-456",
        "week_start": "2026-11-02",
        "crm_teams": {"name": "Team Seeding Alpha"},
        "skill_solution_id": 10,
        "skill_vendor_id": 25,
    }

    preview_data = {
        "members": [
            {
                "user_id": "user-uuid-1",
                "user_name": "Nguyen Van A",
                "user_email": "nguyenvana@markeeai.com",
                "support_user_email": "nguyenvanb@markeeai.com",
                "metrics": {
                    "can-lien-he": {
                        "tier_reached": "critical",
                        "total_manday": 3.5,
                    },
                    "khong-phu-hop": {
                        "tier_reached": None,  # Not reached -> should be excluded!
                        "total_manday": 0.0,
                    },
                },
            },
            {
                "user_id": "user-uuid-2",
                "user_name": "Nguyen Van B",
                "user_email": "nguyenvanb@markeeai.com",
                "support_user_email": None,
                "metrics": {
                    "can-lien-he": {
                        "tier_reached": "high",
                        "total_manday": 2.0,
                    },
                },
            },
        ]
    }

    payload = build_payload(session, preview_data)
    assert payload["group"]["name"] == "Tuần 2026-11-02 - Team Seeding Alpha"
    assert payload["group"]["externalKey"] == "seeding-kpi:team-uuid-456:sess-uuid-123"
    assert payload["week"]["startDate"] == "2026-11-02"

    tasks = payload["tasks"]
    assert len(tasks) == 2  # 1 from user A, 1 from user B (unreached metric is excluded)

    task_a = tasks[0]
    assert task_a["externalKey"] == "seeding-kpi:team-uuid-456:sess-uuid-123:user-uuid-1:can-lien-he"
    assert task_a["assigneeEmail"] == "nguyenvana@markeeai.com"
    assert task_a["supporterEmail"] == "nguyenvanb@markeeai.com"
    assert task_a["priority"] == "Critical"
    assert task_a["manday"] == 3.5
    assert task_a["ratio"] == {"assign": 90, "support": 10}
    assert task_a["skillGroupId"] == 10
    assert task_a["skillId"] == 25

    task_b = tasks[1]
    assert task_b["externalKey"] == "seeding-kpi:team-uuid-456:sess-uuid-123:user-uuid-2:can-lien-he"
    assert task_b["priority"] == "High"
    assert "supporterEmail" not in task_b


def test_sync_session_unconfigured_pm(monkeypatch):
    monkeypatch.delenv("PM_BASE_URL", raising=False)
    monkeypatch.delenv("PM_SYNC_TOKEN", raising=False)
    monkeypatch.delenv("PM_PROJECT_ID", raising=False)

    assert not is_pm_configured()
    res = sync_session_to_pm("sess-dummy-id")
    assert not res["success"]
    assert "Chưa cấu hình" in res["message"]


def test_get_pm_skills_unconfigured(monkeypatch):
    pm_svc._SKILLS_CACHE = {"expires_at": 0.0, "data": []}
    monkeypatch.delenv("PM_BASE_URL", raising=False)
    monkeypatch.delenv("PM_SYNC_TOKEN", raising=False)
    monkeypatch.delenv("PM_PROJECT_ID", raising=False)

    res = pm_svc.get_pm_skills()
    assert res["success"] is False
    assert "Chưa cấu hình" in res["message"]
    assert res["groups"] == []
    assert res["data"] == []


def test_get_pm_skills_mock_httpx(monkeypatch):
    import httpx
    pm_svc._SKILLS_CACHE = {"expires_at": 0.0, "data": []}

    monkeypatch.setenv("PM_BASE_URL", "https://kpi.test.markeeai.com")
    monkeypatch.setenv("PM_SYNC_TOKEN", "valid-token-123")
    monkeypatch.setenv("PM_PROJECT_ID", "859")

    mock_groups = [
        {
            "id": 1,
            "name": "Skill Solution A",
            "skills": [{"id": 101, "name": "Skill Vendor X"}],
        }
    ]

    class MockResponse:
        status_code = 200
        def json(self):
            return {"groups": mock_groups}

    def mock_get(url, **kwargs):
        assert url == "https://kpi.test.markeeai.com/api/msc-sync/skills"
        assert kwargs.get("headers", {}).get("X-MSC-Sync-Token") == "valid-token-123"
        return MockResponse()

    monkeypatch.setattr(httpx, "get", mock_get)

    res = pm_svc.get_pm_skills()
    assert res["success"] is True
    assert res["groups"] == mock_groups
    assert res["data"] == mock_groups


def test_get_pm_skills_proxy_mapping(monkeypatch):
    from app.modules.all_platform.routers.kpi_setup import get_pm_skills_proxy

    # 1. Success case: maps res["groups"] to BaseResponse.data
    mock_groups = [{"id": 5, "name": "Solution 5", "skills": []}]
    monkeypatch.setattr(pm_svc, "get_pm_skills", lambda: {"success": True, "groups": mock_groups, "data": mock_groups})

    resp = get_pm_skills_proxy(user={"id": "usr-1"})
    assert resp.success is True
    assert resp.data == mock_groups
    assert resp.message == ""

    # 2. Failure case: Plane.so error (401/403/503) -> BaseResponse.success is False, data=[]
    monkeypatch.setattr(pm_svc, "get_pm_skills", lambda: {"success": False, "message": "PM trả về lỗi HTTP 401", "groups": [], "data": []})
    resp_err = get_pm_skills_proxy(user={"id": "usr-1"})
    assert resp_err.success is False
    assert resp_err.data == []
    assert "HTTP 401" in resp_err.message

    # 3. Exception case: network timeout or unhandled exception -> caught, returns success=False
    def raise_exc():
        raise RuntimeError("Connection timed out")

    monkeypatch.setattr(pm_svc, "get_pm_skills", raise_exc)
    resp_exc = get_pm_skills_proxy(user={"id": "usr-1"})
    assert resp_exc.success is False
    assert resp_exc.data == []
    assert "Connection timed out" in resp_exc.message


def test_kpi_setup_router_routes():
    from app.modules.all_platform.routers.kpi_setup import router

    routes_map = {}
    for route in router.routes:
        routes_map.setdefault(route.path, set()).update(route.methods)

    # 1. apply-template and apply routes
    assert "/sessions/apply-template" in routes_map
    assert "POST" in routes_map["/sessions/apply-template"]
    assert "/sessions/apply" in routes_map
    assert "POST" in routes_map["/sessions/apply"]

    # 2. allocations and overrides support both PUT and PATCH
    assert "/sessions/{session_id}/allocations" in routes_map
    assert {"PUT", "PATCH"}.issubset(routes_map["/sessions/{session_id}/allocations"])

    assert "/sessions/{session_id}/overrides" in routes_map
    assert {"PUT", "PATCH"}.issubset(routes_map["/sessions/{session_id}/overrides"])

    # 3. snapshot singular and plural
    assert "/sessions/{session_id}/snapshot" in routes_map
    assert "POST" in routes_map["/sessions/{session_id}/snapshot"]
    assert "/sessions/{session_id}/snapshots" in routes_map
    assert "POST" in routes_map["/sessions/{session_id}/snapshots"]
