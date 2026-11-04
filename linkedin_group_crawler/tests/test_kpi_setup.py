"""Unit tests for KPI Setup, Calculations and PM Sync payload building."""

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# Ensure app is in sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# Mock app.modules.all_platform.services package to avoid loading its bloated __init__.py
services_path = str(root_dir / "app" / "modules" / "all_platform" / "services")
if "app.modules.all_platform.services" not in sys.modules:
    services_pkg = types.ModuleType("app.modules.all_platform.services")
    services_pkg.__path__ = [services_path]
    services_pkg.__file__ = str(Path(services_path) / "__init__.py")
    sys.modules["app.modules.all_platform.services"] = services_pkg

# Mock supabase / third-party libs if shadowed or running on host without deps
if "supabase" not in sys.modules or not hasattr(sys.modules["supabase"], "create_client"):
    mock_sb = MagicMock()
    mock_sb.Client = MagicMock
    mock_sb.create_client = MagicMock()
    sys.modules["supabase"] = mock_sb
    sys.modules["supabase.lib"] = MagicMock()
    sys.modules["supabase.lib.client_options"] = MagicMock()

if "loguru" not in sys.modules:
    sys.modules["loguru"] = MagicMock()

import pytest
from app.modules.all_platform.services.kpi_calculation_service import (
    compute_manday,
    resolve_tier,
)
from app.modules.all_platform.services.kpi_pm_sync_service import (
    build_payload,
    is_pm_configured,
    sync_session_to_pm,
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
