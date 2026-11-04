import { createGroupService } from "@/components/facebook-crawler/modules/facebook-crawl/services/createGroupsService";
import type { CreateGroupPayload } from "@/components/facebook-crawler/modules/facebook-crawl/schemas/create_groups_shemas";
import type { FacebookGroupDTO } from "@/components/facebook-crawler/modules/facebook-crawl/types/data-fb.type";
import {
  addN8nGroup,
  removeN8nGroup,
  updateN8nGroup,
} from "@/services/linkedinCrawlerService";
import type { ManagedGroupRow } from "@/lib/LinkedIn-n8n-groups-normalize";
import {
  detectPlatformFromGroupUrl,
  parseTierForApi,
} from "@/lib/group-form-shared";

export function managedRowToGroupDto(row: ManagedGroupRow): FacebookGroupDTO {
  return {
    group_name: row.name_group,
    url: row.url_group,
    intent: row.type,
    members: row.member,
    platform: "linkedin",
    industry: row.industry,
    tier: row.tier,
    team: row.team
      ? row.team
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    icp: row.icp
      ? row.icp
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    icp_desc: row.icp_desc,
    status: "ACTIVE",
  };
}

export async function submitSharedAddGroup(
  data: CreateGroupPayload,
  linkedInEmail: string,
): Promise<{ ok: boolean; message: string }> {
  const platform = data.platform || detectPlatformFromGroupUrl(data.link_group);
  const tier = parseTierForApi(data.tier);

  if (platform === "linkedin") {
    const email = linkedInEmail.trim();
    if (!email) {
      return {
        ok: false,
        message: "Cần email LinkedIn (Crawler trực tiếp) để thêm nhóm.",
      };
    }
    const res = await addN8nGroup({
      url_group: data.link_group.trim(),
      name_group: data.group_name.trim(),
      member: Number(data.members) || 0,
      email,
      type: data.intent?.trim() || "",
      industry: data.industry?.trim() || undefined,
      tier,
      team: data.team?.trim() || undefined,
      icp: data.icp?.trim() || undefined,
      icp_desc: data.icp_desc?.trim() || undefined,
      platform: "linkedin",
    });
    return {
      ok: Boolean(res.success),
      message:
        res.message ||
        (res.success ? "Đã thêm nhóm LinkedIn." : "Thêm nhóm thất bại."),
    };
  }

  const res = await createGroupService({
    ...data,
    tier: tier ?? data.tier,
  });
  return {
    ok: res.success === "success",
    message:
      res.message ||
      (res.success === "success"
        ? "Đã thêm nhóm Facebook."
        : "Thêm nhóm thất bại."),
  };
}

export type SharedUpdatePayload = {
  group_url: string;
  group_name: string;
  url: string;
  intent?: string;
  members?: number;
  posts_per_week?: number;
  health_score?: number;
  status?: string;
  industry?: string;
  tier?: number;
  team?: string;
  icp?: string;
  icp_desc?: string;
};

export async function submitSharedUpdateGroup(
  original: FacebookGroupDTO,
  data: SharedUpdatePayload,
  linkedInEmail: string,
): Promise<{ ok: boolean; message: string }> {
  const wasLinkedIn =
    original.platform === "linkedin" ||
    detectPlatformFromGroupUrl(original.url) === "linkedin";

  if (wasLinkedIn) {
    const email = linkedInEmail.trim();
    if (!email) {
      return { ok: false, message: "Cần email LinkedIn để cập nhật nhóm." };
    }
    const tier = parseTierForApi(data.tier);
    const origTier = parseTierForApi(original.tier);
    const payload = {
      url_group_need_update: original.url,
      name_group: original.group_name || "",
      member: original.members ?? 0,
      email,
      industry: original.industry,
      tier: origTier,
      team: Array.isArray(original.team)
        ? original.team.join(", ")
        : original.team,
      icp: Array.isArray(original.icp) ? original.icp.join(", ") : original.icp,
      icp_desc: original.icp_desc,
      platform: "linkedin",
    } as Parameters<typeof updateN8nGroup>[0];

    if (data.url.trim()) {
      payload.new_url_group = data.url.trim();
    }
    if (data.group_name.trim()) {
      payload.new_name_group = data.group_name.trim();
    }
    if (data.members != null) {
      payload.new_member = data.members;
    }
    if (data.intent != null) {
      payload.new_type = data.intent?.trim() || "";
    }
    if (data.industry != null) {
      payload.new_industry = data.industry?.trim() || "";
    }
    if (data.tier != null) {
      payload.new_tier = tier ?? null;
    }
    if (data.team != null) {
      payload.new_team = data.team?.trim() || "";
    }
    if (data.icp != null) {
      payload.new_icp = data.icp?.trim() || "";
    }
    if (data.icp_desc != null) {
      payload.new_icp_desc = data.icp_desc?.trim() || "";
    }

    const res = await updateN8nGroup(payload);
    return {
      ok: Boolean(res.success),
      message:
        res.message ||
        (res.success ? "Đã cập nhật nhóm LinkedIn." : "Cập nhật thất bại."),
    };
  }

  const axios = (await import("@/components/facebook-crawler/shared/api/axiosClient"))
    .default;
  const { group_url, ...updateData } = data;
  try {
    const response = await axios.put(
      `/api/v1/groups/update?group_url=${encodeURIComponent(group_url)}`,
      updateData,
    );
    const body = response.data as { success?: boolean; message?: string };
    return {
      ok: body.success !== false,
      message: body.message || "Đã cập nhật nhóm Facebook.",
    };
  } catch (error: unknown) {
    const err = error as {
      response?: { data?: { detail?: string; message?: string } };
    };
    return {
      ok: false,
      message:
        err.response?.data?.detail ||
        err.response?.data?.message ||
        "Lỗi cập nhật nhóm Facebook.",
    };
  }
}

export async function submitSharedDeleteGroup(
  group: FacebookGroupDTO,
  linkedInEmail: string,
): Promise<{ ok: boolean; message: string }> {
  const isLinkedIn =
    group.platform === "linkedin" ||
    detectPlatformFromGroupUrl(group.url) === "linkedin";
  if (isLinkedIn) {
    const email = linkedInEmail.trim();
    if (!email) {
      return { ok: false, message: "Cần email LinkedIn để xóa nhóm." };
    }
    const res = await removeN8nGroup({ url_group: group.url, email });
    return {
      ok: Boolean(res.success),
      message:
        res.message ||
        (res.success ? "Đã xóa nhóm LinkedIn." : "Xóa thất bại."),
    };
  }
  const axios = (await import("@/components/facebook-crawler/shared/api/axiosClient"))
    .default;
  try {
    const response = await axios.delete(
      `/api/v1/groups/delete?group_url=${encodeURIComponent(group.url)}`,
    );
    const body = response.data as { success?: boolean; message?: string };
    return {
      ok: body.success !== false,
      message: body.message || "Đã xóa nhóm Facebook.",
    };
  } catch (error: unknown) {
    const err = error as {
      response?: { data?: { detail?: string; message?: string } };
    };
    return {
      ok: false,
      message:
        err.response?.data?.detail ||
        err.response?.data?.message ||
        "Lỗi xóa nhóm Facebook.",
    };
  }
}
