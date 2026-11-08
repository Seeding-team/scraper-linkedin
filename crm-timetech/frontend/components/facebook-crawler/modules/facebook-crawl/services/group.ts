// src/modules/group/services/group.service.ts
import axiosClient from "../../../shared/api/axiosClient";
import { getAllN8nGroups } from "@/services/linkedinCrawlerService";
import { normalizeN8nGroupsList } from "@/lib/LinkedIn-n8n-groups-normalize";
import { managedRowToGroupDto } from "@/lib/group-platform-api";
import { FacebookGroupDTO } from "../types/data-fb.type";

export interface GetPresetGroupsResponse {
    status: string;
    data: FacebookGroupDTO[];
}

export const getPresetGroupsService = async (): Promise<FacebookGroupDTO[]> => {
    const response = await axiosClient.get<GetPresetGroupsResponse>("/api/v1/groups");
    return response.data.data || [];
};

export const getLinkedInGroupsService = async (
  email: string,
): Promise<FacebookGroupDTO[]> => {
  if (!email?.trim()) return [];
  const res = await getAllN8nGroups({ email: email.trim() });
  if (!res.success) return [];
  // Ưu tiên `groups` từ backend (đã chuẩn hóa đủ taxonomy); fallback `parsed` thô từ n8n.
  const raw =
    Array.isArray(res.data?.groups) && res.data.groups.length > 0
      ? res.data.groups
      : res.data?.parsed;
  const list = normalizeN8nGroupsList(raw);
  return list.map(managedRowToGroupDto);
};