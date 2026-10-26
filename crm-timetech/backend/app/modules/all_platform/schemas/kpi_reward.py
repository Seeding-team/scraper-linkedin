"""Schemas for KPI reward rule workflow."""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


RewardMetric = Literal["lead", "inbox", "post", "comment", "total_bonus"]
RewardStatus = Literal["draft", "pending", "approved", "rejected"]


class KpiRewardRuleInput(BaseModel):
    metric: RewardMetric
    weight: float = Field(default=1, ge=0)
    threshold_value: float = Field(default=0, ge=0)
    reward_per_unit: float = Field(default=0, ge=0)
    max_reward: Optional[float] = Field(default=None, ge=0)
    max_rate: float = Field(default=200, ge=0)


class KpiRewardRulesSaveRequest(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    rules: list[KpiRewardRuleInput]
    leader_note: Optional[str] = None
    admin_note: Optional[str] = None

    @field_validator("rules")
    @classmethod
    def validate_rules(cls, value: list[KpiRewardRuleInput]) -> list[KpiRewardRuleInput]:
        if not value:
            raise ValueError("rules is required")
        metrics = [rule.metric for rule in value]
        if len(metrics) != len(set(metrics)):
            raise ValueError("duplicate metric")
        return value


class KpiRewardSubmitRequest(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    leader_note: Optional[str] = None


class KpiRewardReviewRequest(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    admin_note: Optional[str] = None


class KpiRewardSummaryRequest(BaseModel):
    start_date: date
    end_date: date
    team_id: Optional[str] = None
