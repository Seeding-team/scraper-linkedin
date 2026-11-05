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


def test_apply_template_request_schema_optional_week_end():
    from app.modules.all_platform.schemas.kpi_setup import ApplyTemplateRequest

    # Case 1: week_end is omitted -> should be valid (None), not 422
    req = ApplyTemplateRequest(
        crm_team_id="team-1",
        template_id="tpl-1",
        week_start="2026-11-02",
        skill_solution_id=None,
        skill_vendor_id=None,
    )
    assert req.week_start == "2026-11-02"
    assert req.week_end is None

    # Case 2: week_end is explicitly provided -> should be preserved
    req2 = ApplyTemplateRequest(
        crm_team_id="team-1",
        template_id="tpl-1",
        week_start="2026-11-02",
        week_end="2026-11-08",
    )
    assert req2.week_end == "2026-11-08"


def test_apply_template_route_auto_computes_week_end(monkeypatch):
    from app.modules.all_platform.schemas.kpi_setup import ApplyTemplateRequest
    from app.modules.all_platform.routers.kpi_setup import apply_kpi_template_to_team
    import app.modules.all_platform.services.kpi_session_service as sess_svc

    captured_payload = {}
    def mock_apply(payload, user_id=None):
        captured_payload["week_start"] = payload.week_start
        captured_payload["week_end"] = payload.week_end
        return {"id": "sess-mock-1", "week_end": payload.week_end}

    monkeypatch.setattr(sess_svc, "apply_template", mock_apply)

    # Calling without week_end -> auto computes 2026-11-02 + 6 days = 2026-11-08
    req = ApplyTemplateRequest(
        crm_team_id="team-1",
        template_id="tpl-1",
        week_start="2026-11-02",
    )
    res = apply_kpi_template_to_team(req, user={"id": "u-1"})
    assert res.success is True
    assert captured_payload["week_end"] == "2026-11-08"

    # Calling with explicit week_end -> preserves explicit week_end
    req_explicit = ApplyTemplateRequest(
        crm_team_id="team-1",
        template_id="tpl-1",
        week_start="2026-11-02",
        week_end="2026-11-09",
    )
    res_explicit = apply_kpi_template_to_team(req_explicit, user={"id": "u-1"})
    assert res_explicit.success is True
    assert captured_payload["week_end"] == "2026-11-09"


def test_preview_session_returns_metrics_and_total_manday(monkeypatch):
    import app.modules.all_platform.services.kpi_calculation_service as calc_svc
    import app.modules.all_platform.services.kpi_session_service as sess_svc
    import app.modules.all_platform.services.kpi_metric_service as metric_svc

    mock_metrics = [
        {"code": "can-lien-he", "name": "Cần liên hệ", "description": "", "sort_order": 1},
        {"code": "khong-phu-hop", "name": "Không phù hợp", "description": "", "sort_order": 2},
    ]
    monkeypatch.setattr(metric_svc, "get_valid_metrics", lambda: mock_metrics)
    monkeypatch.setattr(calc_svc, "get_valid_metrics", lambda: mock_metrics)
    monkeypatch.setattr(calc_svc, "get_valid_metric_codes", lambda: ["can-lien-he", "khong-phu-hop"])

    mock_session = {
        "id": "sess-test-1",
        "crm_team_id": "team-test-1",
        "week_start": "2026-11-02",
        "week_end": "2026-11-08",
        "status": "draft",
        "crm_teams": {"name": "Team Tiên Trần (TT)"},
        "source_template_id": None,
        "kpi_session_allocations": [
            {
                "user_id": "u-1",
                "weight_pct": 100,
                "app_users": {"name": "Lâm Seeding", "email": "lam@markeeai.com"},
            }
        ],
        "kpi_session_levels": [
            {
                "metric_code": "can-lien-he",
                "level_normal": 10,
                "level_high": 20,
                "level_critical": 30,
                "manday_normal": 1.0,
                "manday_high": 2.0,
                "manday_critical": 3.0,
            }
        ],
        "kpi_session_member_overrides": [],
    }

    monkeypatch.setattr(sess_svc, "get_session_detail", lambda sid: mock_session)
    monkeypatch.setattr(calc_svc, "count_actuals_by_users", lambda ws, we, uids, codes: {"u-1": {"can-lien-he": 35, "khong-phu-hop": 0}})

    preview = calc_svc.preview_session("sess-test-1")

    # Verify keys required by frontend
    assert preview["session_id"] == "sess-test-1"
    assert preview["status"] == "draft"
    assert preview["metrics"] == mock_metrics
    assert preview["total_team_manday"] == 3.0
    assert len(preview["members"]) == 1

    member = preview["members"][0]
    assert member["weight"] == 100.0
    assert member["weight_pct"] == 100.0
    assert member["total_manday"] == 3.0
    assert member["metrics"]["can-lien-he"]["effective_critical"] == 30.0
    assert member["metrics"]["can-lien-he"]["tier_reached"] == "critical"


def test_kpi_template_level_schema_aliases():
    from app.modules.all_platform.schemas.kpi_setup import KpiTemplateLevelSchema

    # Case 1: Frontend sends normal_count, high_count, critical_count
    schema_fe = KpiTemplateLevelSchema.model_validate({
        "metric_code": "can-lien-he",
        "normal_count": 1,
        "high_count": 2,
        "critical_count": 30,
        "manday_normal": 1.0,
        "manday_high": 2.0,
        "manday_critical": 3.0,
    })
    assert schema_fe.level_normal == 1.0
    assert schema_fe.level_high == 2.0
    assert schema_fe.level_critical == 30.0
    assert schema_fe.manday_normal == 1.0
    assert schema_fe.manday_high == 2.0
    assert schema_fe.manday_critical == 3.0

    # Case 2: Backend sends level_normal, level_high, level_critical
    schema_be = KpiTemplateLevelSchema.model_validate({
        "metric_code": "can-lien-he",
        "level_normal": 5.0,
        "level_high": 10.0,
        "level_critical": 50.0,
        "manday_normal": 1.0,
        "manday_high": 2.0,
        "manday_critical": 3.0,
    })
    assert schema_be.level_normal == 5.0
    assert schema_be.level_high == 10.0
    assert schema_be.level_critical == 50.0


def test_apply_template_copies_exact_levels_not_zeros(monkeypatch):
    import app.modules.all_platform.services.kpi_session_service as sess_svc
    import app.modules.all_platform.services.kpi_template_service as tpl_svc
    from app.modules.all_platform.schemas.kpi_setup import ApplyTemplateRequest

    mock_template = {
        "id": "tpl-123",
        "name": "Template Solution Standard",
        "kpi_template_levels": [
            {
                "metric_code": "can-lien-he",
                "level_normal": 1.0,
                "level_high": 2.0,
                "level_critical": 30.0,
                "manday_normal": 1.0,
                "manday_high": 2.0,
                "manday_critical": 3.0,
            },
            {
                "metric_code": "khong-phu-hop",
                "normal_count": 5.0,
                "high_count": 10.0,
                "critical_count": 100.0,
                "manday_normal": 1.0,
                "manday_high": 2.0,
                "manday_critical": 3.0,
            }
        ],
    }

    monkeypatch.setattr(tpl_svc, "get_template", lambda tid: mock_template)
    monkeypatch.setattr(sess_svc, "get_team_members", lambda tid: [])

    inserted_session_levels = []

    class MockTable:
        def __init__(self, name):
            self.name = name
        def select(self, *args, **kwargs):
            return self
        def eq(self, *args, **kwargs):
            return self
        def limit(self, *args, **kwargs):
            return self
        def update(self, *args, **kwargs):
            return self
        def delete(self, *args, **kwargs):
            return self
        def insert(self, rows):
            if self.name == "kpi_session_levels":
                inserted_session_levels.extend(rows)
            return self
        def execute(self):
            m = MagicMock()
            if self.name == "kpi_sessions":
                m.data = [{"id": "sess-new-123"}]
            else:
                m.data = []
            return m

    class MockSupabase:
        def table(self, name):
            return MockTable(name)

    monkeypatch.setattr(sess_svc, "get_supabase_client", lambda: MockSupabase())
    monkeypatch.setattr(sess_svc, "get_session_detail", lambda sid: {
        "id": sid,
        "kpi_session_levels": inserted_session_levels,
    })

    req = ApplyTemplateRequest(
        crm_team_id="team-tien-tran",
        template_id="tpl-123",
        week_start="2026-11-02",
        week_end="2026-11-08",
    )

    result = sess_svc.apply_template(req, user_id="admin-user")

    assert len(inserted_session_levels) == 2

    # Level 1: from level_normal/high/critical
    lvl1 = next(l for l in inserted_session_levels if l["metric_code"] == "can-lien-he")
    assert lvl1["level_normal"] == 1.0
    assert lvl1["level_high"] == 2.0
    assert lvl1["level_critical"] == 30.0
    assert lvl1["manday_normal"] == 1.0
    assert lvl1["manday_high"] == 2.0
    assert lvl1["manday_critical"] == 3.0

    # Level 2: from normal_count/high_count/critical_count fallback
    lvl2 = next(l for l in inserted_session_levels if l["metric_code"] == "khong-phu-hop")
    assert lvl2["level_normal"] == 5.0
    assert lvl2["level_high"] == 10.0
    assert lvl2["level_critical"] == 100.0
    assert lvl2["manday_normal"] == 1.0
    assert lvl2["manday_high"] == 2.0
    assert lvl2["manday_critical"] == 3.0


