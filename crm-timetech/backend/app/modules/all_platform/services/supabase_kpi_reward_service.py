"""KPI reward rule workflow and reward calculation."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_user_service import (
    get_all_teams,
    get_all_teams_with_kpi,
)

RULES_TABLE = "kpi_reward_rules"
LOGS_TABLE = "kpi_reward_rule_logs"
METRICS = ("lead", "inbox", "post", "comment", "total_bonus")
STATUS_ORDER = {"draft": 0, "rejected": 1, "pending": 2, "approved": 3}

METRIC_LABELS = {
    "lead": "Lead",
    "inbox": "Inbox",
    "post": "Post",
    "comment": "Comment",
    "total_bonus": "Bonus Total",
}
FIELD_LABELS = {
    "threshold_value": "Ngưỡng (%)",
    "reward_per_unit": "Bonus",
    "max_reward": "Max Bonus",
    "max_rate": "Max Rate (%)",
}

# Khop 1-1 voi RULE_GROUPS mac dinh o frontend (KpiRewardSections.tsx) - dung khi
# team chua tung cai rule tuan nao ca (khong co ca tuan truoc de sao chep). Neu
# khong co bang nay, cac tuan "default" se tinh thuong = 0 cho toan bo thanh vien
# du ho da dat KPI that, vi khong co rule nao de ap dung ca.
DEFAULT_RULE_VALUES: dict[str, dict[str, Any]] = {
    "total_bonus": {"weight": 100, "threshold_value": 75, "reward_per_unit": 100000, "max_reward": None, "max_rate": 200},
    "lead": {"weight": 40, "threshold_value": 80, "reward_per_unit": 10000, "max_reward": None, "max_rate": 200},
    "inbox": {"weight": 30, "threshold_value": 80, "reward_per_unit": 3000, "max_reward": None, "max_rate": 200},
    "post": {"weight": 20, "threshold_value": 80, "reward_per_unit": 2000, "max_reward": None, "max_rate": 200},
    "comment": {"weight": 10, "threshold_value": 80, "reward_per_unit": 1000, "max_reward": None, "max_rate": 200},
}


def _default_rules(team_id: str, start: str, end: str) -> list[dict[str, Any]]:
    return [
        _normalize_rule({
            "id": None,
            "team_id": team_id,
            "start_date": start,
            "end_date": end,
            "metric": metric,
            "status": "draft",
            **values,
        })
        for metric, values in DEFAULT_RULE_VALUES.items()
    ]

# Khop dung trong so hien thi ngay tren bang "Cai dat Bonus KPI" (LEAD 40% / INBOX
# 30% / POST 20% / COMMENT 10%, xem RULE_GROUPS.weightLabel o frontend) - KHONG
# phai bo trong so cua trang Teams overview (Lead 45/Inbox 40/Post 10/Comment 5),
# do la 2 cong thuc khac nhau cho 2 muc dich khac nhau, tung bi nham lan chung 1.
KPI_PERCENT_WEIGHTS = {"lead": 0.40, "inbox": 0.30, "post": 0.20, "comment": 0.10}


def _metric_percent(actual: int, target: int) -> float:
    if target <= 0:
        return 0.0
    return round(min(actual / target, 1.0) * 100, 1)


def _kpi_status(percent: float, has_target: bool = True) -> str:
    if not has_target:
        return "chua_dat"
    if percent >= 100:
        return "dat"
    if percent >= 80:
        return "gan_dat"
    return "chua_dat"


def _weighted_percent(actuals: dict[str, int], targets: dict[str, int]) -> tuple[float, bool]:
    # Chia cho TONG trong so co dinh (100%), khong chi chia cho trong so cua cac
    # metric co giao target - neu khong, metric chua giao target (target=0) se bi
    # LOAI hoan toan khoi mau so thay vi tinh la 0%, lam %KPI tong bi thoi phong
    # ao (vd chi dat Inbox+Comment ma bao 100% du Lead/Post con "Chua dat").
    has_target = any(targets.get(metric, 0) > 0 for metric in KPI_PERCENT_WEIGHTS)
    if not has_target:
        return 0.0, False
    weighted_sum = 0.0
    for metric, weight in KPI_PERCENT_WEIGHTS.items():
        target = targets.get(metric, 0)
        if target > 0:
            weighted_sum += weight * min(actuals.get(metric, 0) / target, 1.0)
    return round(weighted_sum * 100, 1), True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _role(user: dict[str, Any]) -> str:
    return str(user.get("role") or "member").strip().lower()


def _is_admin(user: dict[str, Any]) -> bool:
    return _role(user) in {"admin", "superadmin"}


def _date_str(value: date | str) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)


def _money(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _round_money(value: float) -> int:
    return int(round(max(0.0, value)))


def _team_map() -> dict[str, dict[str, Any]]:
    return {str(team.get("id")): team for team in get_all_teams() if team.get("id")}


def _assert_team_access(team_id: str, user: dict[str, Any]) -> None:
    if _is_admin(user):
        return
    if _role(user) != "leader":
        raise PermissionError("Chi leader hoac admin moi duoc thao tac KPI thuong.")
    team = _team_map().get(team_id)
    if not team or str(team.get("id_leader")) != str(user.get("id")):
        raise PermissionError("Leader chi duoc thao tac team minh quan ly.")


def _accessible_team_ids(user: dict[str, Any], team_id: str | None = None) -> set[str]:
    teams = _team_map()
    if _is_admin(user):
        ids = set(teams.keys())
    elif _role(user) == "leader":
        ids = {tid for tid, team in teams.items() if str(team.get("id_leader")) == str(user.get("id"))}
    elif _role(user) == "member":
        user_id = str(user.get("id") or "")
        ids = {
            tid
            for tid, team in teams.items()
            if any(str(member.get("id")) == user_id for member in (team.get("members") or []))
        }
    else:
        ids = set()
    if team_id:
        if team_id not in ids:
            raise PermissionError("Khong co quyen xem team nay.")
        return {team_id}
    return ids


def _normalize_rule(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "teamId": row.get("team_id"),
        "startDate": row.get("start_date"),
        "endDate": row.get("end_date"),
        "metric": row.get("metric"),
        "weight": _money(row.get("weight")),
        "thresholdValue": _money(row.get("threshold_value")),
        "rewardPerUnit": _money(row.get("reward_per_unit")),
        "maxReward": None if row.get("max_reward") is None else _money(row.get("max_reward")),
        "maxRate": _money(row.get("max_rate")) or 200,
        "status": row.get("status") or "draft",
        "leaderNote": row.get("leader_note") or "",
        "adminNote": row.get("admin_note") or "",
        "createdBy": row.get("created_by"),
        "submittedBy": row.get("submitted_by"),
        "reviewedBy": row.get("reviewed_by"),
        "submittedAt": row.get("submitted_at"),
        "reviewedAt": row.get("reviewed_at"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def list_reward_rules(
    *,
    user: dict[str, Any],
    start_date: date | str | None = None,
    end_date: date | str | None = None,
    team_id: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    supabase: Client = get_supabase_client()
    allowed_team_ids = _accessible_team_ids(user, team_id)
    if not allowed_team_ids:
        return []

    query = supabase.table(RULES_TABLE).select("*").in_("team_id", list(allowed_team_ids))
    if start_date:
        query = query.eq("start_date", _date_str(start_date))
    if end_date:
        query = query.eq("end_date", _date_str(end_date))
    if status:
        query = query.eq("status", status)
    res = query.order("start_date", desc=True).order("metric").execute()
    teams = _team_map()
    rows = [_normalize_rule(row) for row in (res.data or [])]
    for row in rows:
        team = teams.get(str(row.get("teamId"))) or {}
        row["teamName"] = team.get("name_team") or ""
        row["leaderEmail"] = team.get("leader_email") or ""
        row["leaderName"] = team.get("leader_name") or ""
    return rows


def get_effective_reward_rules(
    *,
    user: dict[str, Any],
    team_id: str,
    start_date: date | str,
    end_date: date | str,
) -> dict[str, Any]:
    """Rule dang dung cho tuan nay: uu tien rule da luu dung tuan, neu chua co thi
    sao chep tu tuan gan nhat truoc do (leader khong phai tao lai tu dau moi tuan),
    neu chua tung co rule nao thi tra ve rong (frontend tu dung default cung).
    """
    start = _date_str(start_date)
    end = _date_str(end_date)
    exact = list_reward_rules(user=user, team_id=team_id, start_date=start, end_date=end)
    if exact:
        return {"rules": exact, "source": "current", "sourceWeek": None}

    supabase: Client = get_supabase_client()
    prev_res = (
        supabase.table(RULES_TABLE)
        .select("start_date,end_date")
        .eq("team_id", team_id)
        .lt("start_date", start)
        .order("start_date", desc=True)
        .limit(1)
        .execute()
    )
    if prev_res.data:
        prev_start = prev_res.data[0]["start_date"]
        prev_end = prev_res.data[0]["end_date"]
        prev_rules = list_reward_rules(user=user, team_id=team_id, start_date=prev_start, end_date=prev_end)
        copied = [
            {**rule, "id": None, "startDate": start, "endDate": end, "status": "draft"}
            for rule in prev_rules
        ]
        return {"rules": copied, "source": "copied", "sourceWeek": {"start": prev_start, "end": prev_end}}

    return {"rules": _default_rules(team_id, start, end), "source": "default", "sourceWeek": None}


def _diff_rule_changes(
    existing_by_metric: dict[str, dict[str, Any]],
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for row in records:
        metric = str(row["metric"])
        existing = existing_by_metric.get(metric) or {}
        for field in ("threshold_value", "reward_per_unit", "max_reward", "max_rate"):
            old_val = existing.get(field)
            new_val = row.get(field)
            old_num = None if old_val is None else _money(old_val)
            new_num = None if new_val is None else _money(new_val)
            if old_num == new_num:
                continue
            changes.append({
                "metric": metric,
                "metricLabel": METRIC_LABELS.get(metric, metric),
                "field": field,
                "fieldLabel": FIELD_LABELS.get(field, field),
                "oldValue": old_num,
                "newValue": new_num,
            })
    return changes


def _log_rule_changes(
    *,
    team_id: str,
    start: str,
    end: str,
    user: dict[str, Any],
    changes: list[dict[str, Any]],
) -> None:
    if not changes:
        return
    try:
        supabase: Client = get_supabase_client()
        supabase.table(LOGS_TABLE).insert({
            "team_id": team_id,
            "start_date": start,
            "end_date": end,
            "changed_by": user.get("id"),
            "changed_by_name": user.get("name") or user.get("email"),
            "changed_by_email": user.get("email"),
            "changes": changes,
        }).execute()
    except Exception:
        # Ghi log la best-effort - khong duoc lam hong luong luu rule chinh.
        pass


def save_reward_rules(
    *,
    payload: dict[str, Any],
    user: dict[str, Any],
    status: str = "draft",
) -> list[dict[str, Any]]:
    team_id = str(payload["team_id"])
    _assert_team_access(team_id, user)
    start = _date_str(payload["start_date"])
    end = _date_str(payload["end_date"])
    now = _now_iso()

    supabase: Client = get_supabase_client()
    existing_res = (
        supabase.table(RULES_TABLE)
        .select("metric,threshold_value,reward_per_unit,max_reward,max_rate")
        .eq("team_id", team_id)
        .eq("start_date", start)
        .eq("end_date", end)
        .execute()
    )
    existing_by_metric = {str(row["metric"]): row for row in (existing_res.data or [])}

    records: list[dict[str, Any]] = []
    for rule in payload.get("rules") or []:
        row = {
            "team_id": team_id,
            "start_date": start,
            "end_date": end,
            "metric": rule["metric"],
            "weight": rule.get("weight", 1),
            "threshold_value": rule.get("threshold_value", 0),
            "reward_per_unit": rule.get("reward_per_unit", 0),
            "max_reward": rule.get("max_reward"),
            "max_rate": rule.get("max_rate", 200),
            "status": status,
            "leader_note": payload.get("leader_note") or "",
            "created_by": user.get("id"),
            "updated_at": now,
        }
        if status == "pending":
            row["submitted_by"] = user.get("id")
            row["submitted_at"] = now
            row["reviewed_by"] = None
            row["reviewed_at"] = None
            row["admin_note"] = ""
        if status == "approved":
            row["submitted_by"] = user.get("id")
            row["submitted_at"] = now
            row["reviewed_by"] = user.get("id")
            row["reviewed_at"] = now
            row["admin_note"] = payload.get("admin_note") or ""
        records.append(row)

    changes = _diff_rule_changes(existing_by_metric, records)

    res = (
        supabase.table(RULES_TABLE)
        .upsert(records, on_conflict="team_id,start_date,end_date,metric")
        .execute()
    )
    _log_rule_changes(team_id=team_id, start=start, end=end, user=user, changes=changes)
    return [_normalize_rule(row) for row in (res.data or [])]


def list_reward_rule_logs(
    *,
    user: dict[str, Any],
    team_id: str,
    start_date: date | str,
    end_date: date | str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    # Xem log la read-only, dung chung 1 muc quyen voi list_reward_rules/get_reward_summary -
    # member cung duoc xem log cua team minh, khong can quyen sua (leader/admin).
    _accessible_team_ids(user, team_id)
    supabase: Client = get_supabase_client()
    res = (
        supabase.table(LOGS_TABLE)
        .select("*")
        .eq("team_id", team_id)
        .eq("start_date", _date_str(start_date))
        .eq("end_date", _date_str(end_date))
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [
        {
            "id": row.get("id"),
            "changedByName": row.get("changed_by_name") or row.get("changed_by_email") or "Không rõ",
            "changedByEmail": row.get("changed_by_email"),
            "changes": row.get("changes") or [],
            "createdAt": row.get("created_at"),
        }
        for row in (res.data or [])
    ]


def submit_reward_rules(payload: dict[str, Any], user: dict[str, Any]) -> list[dict[str, Any]]:
    team_id = str(payload["team_id"])
    _assert_team_access(team_id, user)
    existing = list_reward_rules(
        user=user,
        team_id=team_id,
        start_date=payload["start_date"],
        end_date=payload["end_date"],
    )
    if not existing:
        raise ValueError("Chua co rule de gui duyet.")
    now = _now_iso()
    supabase: Client = get_supabase_client()
    update_data = {
        "status": "pending",
        "leader_note": payload.get("leader_note") or "",
        "submitted_by": user.get("id"),
        "submitted_at": now,
        "reviewed_by": None,
        "reviewed_at": None,
        "admin_note": "",
        "updated_at": now,
    }
    res = (
        supabase.table(RULES_TABLE)
        .update(update_data)
        .eq("team_id", team_id)
        .eq("start_date", _date_str(payload["start_date"]))
        .eq("end_date", _date_str(payload["end_date"]))
        .execute()
    )
    return [_normalize_rule(row) for row in (res.data or [])]


def review_reward_rules(
    *,
    payload: dict[str, Any],
    user: dict[str, Any],
    status: str,
) -> list[dict[str, Any]]:
    if not _is_admin(user):
        raise PermissionError("Chi admin moi duoc duyet KPI thuong.")
    if status not in {"approved", "rejected"}:
        raise ValueError("Trang thai review khong hop le.")
    now = _now_iso()
    supabase: Client = get_supabase_client()
    res = (
        supabase.table(RULES_TABLE)
        .update({
            "status": status,
            "admin_note": payload.get("admin_note") or "",
            "reviewed_by": user.get("id"),
            "reviewed_at": now,
            "updated_at": now,
        })
        .eq("team_id", str(payload["team_id"]))
        .eq("start_date", _date_str(payload["start_date"]))
        .eq("end_date", _date_str(payload["end_date"]))
        .execute()
    )
    return [_normalize_rule(row) for row in (res.data or [])]


def _rule_status(rules: list[dict[str, Any]]) -> str:
    if not rules:
        return "draft"
    statuses = {str(rule.get("status") or "draft") for rule in rules}
    if len(statuses) == 1:
        return next(iter(statuses))
    return max(statuses, key=lambda item: STATUS_ORDER.get(item, 0))


def _metric_actual(row: dict[str, Any], metric: str) -> int:
    if metric == "lead":
        return int(row.get("kpi_lead_current") or row.get("lead_count") or 0)
    if metric == "inbox":
        return int(row.get("kpi_inbox_current") or row.get("inbox_count") or 0)
    if metric == "post":
        return int(row.get("kpi_post_current") or row.get("post_count") or 0)
    if metric == "comment":
        return int(row.get("verified_count") or 0)
    return 0


def _metric_target(row: dict[str, Any], metric: str) -> int:
    if metric == "lead":
        return int(row.get("kpi_lead") or 0)
    if metric == "inbox":
        return int(row.get("kpi_inbox") or 0)
    if metric == "post":
        return int(row.get("kpi_post") or 0)
    if metric == "comment":
        return int(row.get("kpi_comment") or 0)
    return 0


def _apply_rule(actual: int, target: int, rule: dict[str, Any]) -> int:
    threshold = _money(rule.get("thresholdValue"))
    percent = 0 if target <= 0 else (actual / target) * 100
    if threshold > 0 and percent < threshold:
        return 0
    amount = actual * _money(rule.get("rewardPerUnit"))
    max_reward = rule.get("maxReward")
    if max_reward is not None:
        amount = min(amount, _money(max_reward))
    elif target > 0:
        max_rate = _money(rule.get("maxRate")) or 200
        amount = min(amount, target * _money(rule.get("rewardPerUnit")) * max_rate / 100)
    return _round_money(amount)


def _bonus_amount(row: dict[str, Any], rule: dict[str, Any]) -> int:
    target_total = sum(_metric_target(row, metric) for metric in ("lead", "inbox", "post", "comment"))
    actual_total = sum(_metric_actual(row, metric) for metric in ("lead", "inbox", "post", "comment"))
    percent = 0 if target_total <= 0 else round((actual_total / target_total) * 100, 2)
    threshold = _money(rule.get("thresholdValue")) or 100
    if percent < threshold:
        return 0
    amount = _money(rule.get("rewardPerUnit"))
    max_reward = rule.get("maxReward")
    if max_reward is not None:
        amount = min(amount, _money(max_reward))
    return _round_money(amount)


def get_reward_summary(
    *,
    user: dict[str, Any],
    start_date: date | str,
    end_date: date | str,
    team_id: str | None = None,
) -> dict[str, Any]:
    start = _date_str(start_date)
    end = _date_str(end_date)
    allowed_team_ids = _accessible_team_ids(user, team_id)
    if not allowed_team_ids:
        return {"rules": [], "teamSummaries": [], "memberSummaries": [], "totals": {"totalReward": 0, "teamCount": 0, "memberCount": 0}}

    teams_payload = get_all_teams_with_kpi(start_date=start, end_date=end)
    teams = {
        str(team.get("id")): team
        for team in (teams_payload.get("teams") or [])
        if str(team.get("id")) in allowed_team_ids
    }

    # QUAN TRONG: phai dung rule "dang co hieu luc" (uu tien tuan nay, sao chep tu
    # tuan truoc neu chua luu) giong het nhung gi bang Cai dat Bonus KPI dang hien
    # thi - neu chi lay rule da luu dung tuan (list_reward_rules) thi tuan nao chua
    # bam Luu se tinh thuong = 0 cho toan bo thanh vien du ho da dat KPI thuc te,
    # trong khi UI van hien thi nhu dang co rule (gay hieu lam "dat ma khong duoc tinh").
    rules: list[dict[str, Any]] = []
    for tid in teams:
        effective = get_effective_reward_rules(user=user, team_id=tid, start_date=start, end_date=end)
        rules.extend(effective["rules"])
    rules_by_team: dict[str, dict[str, dict[str, Any]]] = {}
    for rule in rules:
        rules_by_team.setdefault(str(rule["teamId"]), {})[str(rule["metric"])] = rule

    member_summaries: list[dict[str, Any]] = []
    team_totals: dict[str, dict[str, Any]] = {}
    # RPC kpi_tracker doi khi tra >1 dong cho cung 1 member (du lieu mo coi/trung
    # khoang ngay) - dedupe theo (team, member) truoc khi cong don, tranh nhan doi
    # actual/reward va tranh key trung tren frontend (React key warning).
    seen_members: set[tuple[str, str]] = set()
    for row in teams_payload.get("kpi_data") or []:
        tid = str(row.get("team_id") or "")
        if tid not in teams:
            continue
        member_key = (tid, str(row.get("member_id") or ""))
        if member_key in seen_members:
            continue
        seen_members.add(member_key)
        team_rules = rules_by_team.get(tid, {})
        metric_rewards: dict[str, int] = {}
        actuals: dict[str, int] = {}
        targets: dict[str, int] = {}
        for metric in ("lead", "inbox", "post", "comment"):
            actuals[metric] = _metric_actual(row, metric)
            targets[metric] = _metric_target(row, metric)
            rule = team_rules.get(metric)
            metric_rewards[metric] = _apply_rule(actuals[metric], targets[metric], rule) if rule else 0
        bonus_rule = team_rules.get("total_bonus")
        metric_rewards["total_bonus"] = _bonus_amount(row, bonus_rule) if bonus_rule else 0
        total_reward = sum(metric_rewards.values())
        status = _rule_status(list(team_rules.values()))

        metric_percents = {m: _metric_percent(actuals[m], targets[m]) for m in ("lead", "inbox", "post", "comment")}
        metric_statuses = {m: _kpi_status(metric_percents[m], targets[m] > 0) for m in ("lead", "inbox", "post", "comment")}
        kpi_percent, kpi_has_target = _weighted_percent(actuals, targets)
        kpi_status = _kpi_status(kpi_percent, kpi_has_target)

        member_summary = {
            "teamId": tid,
            "teamName": teams[tid].get("name_team") or row.get("team_name") or "",
            "leaderEmail": teams[tid].get("leader_email") or row.get("leader_email") or "",
            "memberId": row.get("member_id"),
            "memberEmail": row.get("member_email"),
            "memberName": row.get("member_name") or row.get("member_email") or "",
            "actuals": actuals,
            "targets": targets,
            "metricPercents": metric_percents,
            "metricStatuses": metric_statuses,
            "kpiPercent": kpi_percent,
            "kpiStatus": kpi_status,
            "rewards": metric_rewards,
            "totalReward": total_reward,
            "status": status,
            "isEstimate": status != "approved",
        }
        member_summaries.append(member_summary)

        team_total = team_totals.setdefault(tid, {
            "teamId": tid,
            "teamName": member_summary["teamName"],
            "leaderEmail": member_summary["leaderEmail"],
            "totalReward": 0,
            "memberCount": 0,
            "status": status,
            "isEstimate": status != "approved",
            "_actualsSum": {"lead": 0, "inbox": 0, "post": 0, "comment": 0},
            "_targetsSum": {"lead": 0, "inbox": 0, "post": 0, "comment": 0},
        })
        team_total["totalReward"] += total_reward
        team_total["memberCount"] += 1
        team_total["status"] = _rule_status(list(team_rules.values()))
        team_total["isEstimate"] = team_total["status"] != "approved"
        for metric in ("lead", "inbox", "post", "comment"):
            team_total["_actualsSum"][metric] += actuals[metric]
            team_total["_targetsSum"][metric] += targets[metric]

    team_summaries = list(team_totals.values())
    for team_total in team_summaries:
        actuals_sum = team_total.pop("_actualsSum")
        targets_sum = team_total.pop("_targetsSum")
        kpi_percent, kpi_has_target = _weighted_percent(actuals_sum, targets_sum)
        team_total["kpiPercent"] = kpi_percent
        team_total["kpiStatus"] = _kpi_status(kpi_percent, kpi_has_target)
    total_reward = sum(int(team["totalReward"]) for team in team_summaries)
    return {
        "rules": rules,
        "teamSummaries": team_summaries,
        "memberSummaries": member_summaries,
        "totals": {
            "totalReward": total_reward,
            "teamCount": len(team_summaries),
            "memberCount": len(member_summaries),
            "approvedReward": sum(int(team["totalReward"]) for team in team_summaries if team["status"] == "approved"),
            "estimatedReward": sum(int(team["totalReward"]) for team in team_summaries if team["status"] != "approved"),
        },
        "range": {"start": start, "end": end},
    }
