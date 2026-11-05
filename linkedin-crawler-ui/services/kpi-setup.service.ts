"use client";

import { API_BASE_URL, API_KEY } from "@/lib/env";
import type { ApiResponse } from "@/types/unified.types";

const BASE = `${API_BASE_URL}/api/all-platform`;

function getDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }
  return headers;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        ...getDefaultHeaders(),
        ...init?.headers,
      },
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        success: false,
        message: data?.detail || data?.message || `HTTP ${res.status}: ${res.statusText}`,
      };
    }
    return data as ApiResponse<T>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Mất kết nối máy chủ";
    return { success: false, message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricInfo {
  code: string;
  name: string;
  description?: string | null;
}

export interface KpiTemplateLevel {
  id?: string;
  metric_code: string;
  normal_count: number;
  high_count: number;
  critical_count: number;
  manday_normal: number;
  manday_high: number;
  manday_critical: number;
}

export interface KpiBonusRule {
  id?: string;
  metric_code: string;
  min_count: number;
  bonus_manday: number;
  requires_tier?: "normal" | "high" | "critical" | null;
}

export interface KpiTemplate {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at?: string;
  levels: KpiTemplateLevel[];
  bonus_rules: KpiBonusRule[];
}

export interface KpiTemplateCreatePayload {
  name: string;
  description?: string | null;
  is_active?: boolean;
  levels: KpiTemplateLevel[];
  bonus_rules?: KpiBonusRule[];
}

export interface CrmTeamMember {
  user_id: string;
  email: string;
  full_name?: string;
  role?: string;
}

export interface CrmTeam {
  id: string;
  name: string;
  code?: string;
  leader_id?: string;
  leader_name?: string;
  leader_email?: string;
  members?: CrmTeamMember[];
}

export interface KpiSessionSummary {
  id: string;
  crm_team_id: string;
  template_id: string;
  week_start: string;
  week_end: string;
  status: "draft" | "active" | "locked" | "closed" | "completed";
  created_at: string;
  crm_teams?: { id: string; name: string; code?: string };
  kpi_templates?: { id: string; name: string };
  skill_solution_id?: number | null;
  skill_solution_name?: string | null;
  skill_vendor_id?: number | null;
  skill_vendor_name?: string | null;
}

export interface KpiSessionAllocation {
  id: string;
  user_id: string;
  weight: number;
  support_user_id?: string | null;
  app_users?: { id: string; full_name?: string; email?: string };
}

export interface KpiSessionOverride {
  id?: string;
  user_id: string;
  metric_code: string;
  critical_count: number;
}

export interface KpiSessionDetail extends KpiSessionSummary {
  allocations: KpiSessionAllocation[];
  levels: KpiTemplateLevel[];
  overrides: KpiSessionOverride[];
  bonus_rules: KpiBonusRule[];
  latest_sync?: {
    success: boolean;
    synced_at: string;
    error_message?: string;
    created_count?: number;
    updated_count?: number;
    group_url?: string;
  } | null;
}

export interface ApplyTemplatePayload {
  crm_team_id: string;
  template_id: string;
  week_start: string;
  week_end?: string;
  skill_solution_id?: number | null;
  skill_vendor_id?: number | null;
}

export interface KpiAllocationPayload {
  user_id: string;
  weight: number;
  support_user_id?: string | null;
}

export interface KpiPreviewMetricDetail {
  actual_count: number;
  effective_critical?: number;
  level_normal?: number;
  level_high?: number;
  level_critical?: number;
  tier_reached: "normal" | "high" | "critical" | null;
  base_manday: number;
  bonus_manday: number;
  total_manday: number;
}

export interface KpiPreviewMember {
  user_id: string;
  user_name: string;
  user_email: string;
  weight?: number;
  weight_pct?: number;
  support_user_id?: string | null;
  support_user_name?: string | null;
  support_user_email?: string | null;
  metrics: Record<string, KpiPreviewMetricDetail>;
  total_base_manday?: number;
  total_bonus_manday?: number;
  total_manday: number;
}

export interface KpiPreviewResponse {
  session_id: string;
  team_id?: string;
  team_name?: string;
  week_start: string;
  week_end: string;
  status?: string;
  metrics?: MetricInfo[];
  members: KpiPreviewMember[];
  total_team_manday?: number;
  summary_by_metric?: Record<string, any>;
}

export interface PmSkillGroup {
  id: number;
  name: string;
  categoryName?: string;
  skills?: PmSkillVendor[];
}

export interface PmSkillVendor {
  id: number;
  name: string;
}

export interface PmSkillsResponse {
  configured?: boolean;
  groups?: PmSkillGroup[];
  vendors?: PmSkillVendor[];
}

export interface PmSyncResult {
  success: boolean;
  message: string;
  created_count?: number;
  updated_count?: number;
  group_url?: string;
  task_count?: number;
  project_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export const kpiSetupService = {
  // Metrics
  getMetrics: (): Promise<ApiResponse<MetricInfo[]>> =>
    requestJson<MetricInfo[]>(`${BASE}/kpi/metrics`),

  // Templates
  getTemplates: (): Promise<ApiResponse<KpiTemplate[]>> =>
    requestJson<KpiTemplate[]>(`${BASE}/kpi/templates`),

  createTemplate: (payload: KpiTemplateCreatePayload): Promise<ApiResponse<KpiTemplate>> =>
    requestJson<KpiTemplate>(`${BASE}/kpi/templates`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateTemplate: (id: string, payload: KpiTemplateCreatePayload): Promise<ApiResponse<KpiTemplate>> =>
    requestJson<KpiTemplate>(`${BASE}/kpi/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteTemplate: (id: string): Promise<ApiResponse<{ success: boolean; message: string }>> =>
    requestJson<{ success: boolean; message: string }>(`${BASE}/kpi/templates/${id}`, {
      method: "DELETE",
    }),

  // CRM Teams
  getCrmTeams: (): Promise<ApiResponse<CrmTeam[]>> =>
    requestJson<CrmTeam[]>(`${BASE}/crm/teams`),

  // Sessions
  getSessions: (crmTeamId?: string): Promise<ApiResponse<KpiSessionSummary[]>> => {
    const query = crmTeamId ? `?crm_team_id=${encodeURIComponent(crmTeamId)}` : "";
    return requestJson<KpiSessionSummary[]>(`${BASE}/kpi/sessions${query}`);
  },

  getSession: (id: string): Promise<ApiResponse<KpiSessionDetail>> =>
    requestJson<KpiSessionDetail>(`${BASE}/kpi/sessions/${id}`),

  applyTemplate: (payload: ApplyTemplatePayload): Promise<ApiResponse<KpiSessionDetail>> =>
    requestJson<KpiSessionDetail>(`${BASE}/kpi/sessions/apply-template`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateAllocations: (sessionId: string, allocations: KpiAllocationPayload[]): Promise<ApiResponse<{ success: boolean; count: number }>> =>
    requestJson<{ success: boolean; count: number }>(`${BASE}/kpi/sessions/${sessionId}/allocations`, {
      method: "PUT",
      body: JSON.stringify({ allocations }),
    }),

  updateOverrides: (sessionId: string, overrides: KpiSessionOverride[]): Promise<ApiResponse<{ success: boolean; count: number }>> =>
    requestJson<{ success: boolean; count: number }>(`${BASE}/kpi/sessions/${sessionId}/overrides`, {
      method: "PUT",
      body: JSON.stringify({ overrides }),
    }),

  updateSkills: (
    sessionId: string,
    payload: {
      skill_solution_id?: number | null;
      skill_solution_name?: string | null;
      skill_vendor_id?: number | null;
      skill_vendor_name?: string | null;
    }
  ): Promise<ApiResponse<{ success: boolean }>> =>
    requestJson<{ success: boolean }>(`${BASE}/kpi/sessions/${sessionId}/skills`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  activateSession: (sessionId: string): Promise<ApiResponse<{ success: boolean; status: string }>> =>
    requestJson<{ success: boolean; status: string }>(`${BASE}/kpi/sessions/${sessionId}/activate`, {
      method: "POST",
    }),

  getPreview: (sessionId: string): Promise<ApiResponse<KpiPreviewResponse>> =>
    requestJson<KpiPreviewResponse>(`${BASE}/kpi/sessions/${sessionId}/preview`),

  snapshotSession: (sessionId: string): Promise<ApiResponse<{ success: boolean; snapshot_count: number }>> =>
    requestJson<{ success: boolean; snapshot_count: number }>(`${BASE}/kpi/sessions/${sessionId}/snapshot`, {
      method: "POST",
    }),

  // PM Plane.so
  getPmSkills: (): Promise<ApiResponse<PmSkillGroup[] | PmSkillsResponse>> =>
    requestJson<PmSkillGroup[] | PmSkillsResponse>(`${BASE}/kpi/pm-skills`),

  syncPm: (sessionId: string): Promise<ApiResponse<PmSyncResult>> =>
    requestJson<PmSyncResult>(`${BASE}/kpi/sessions/${sessionId}/sync-pm`, {
      method: "POST",
    }),
};

