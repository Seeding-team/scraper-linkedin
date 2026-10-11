import { API_BASE_URL, API_KEY } from "@/lib/env";

export type SalesAssetType =
  | "proposal"
  | "sale_kit"
  | "portfolio"
  | "other";

export type SalesAssetStatus = "active" | "inactive" | "archived";
export type SalesAssetSourceType = "canva" | "google_docs" | "google_drive" | "external";

export interface SalesAsset {
  id: string;
  type: SalesAssetType;
  title: string;
  version: string;
  sourceType: SalesAssetSourceType;
  sourceUrl: string;
  description: string;
  tags: string[];
  industry: string;
  servicePackage: string;
  customerLeadId?: string | null;
  customerName: string;
  customerCompanyName: string;
  dealId?: string | null;
  dealName: string;
  projectName: string;
  fileUrl: string;
  publicUrl: string;
  thumbnailUrl: string;
  status: SalesAssetStatus;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  shareUrl: string;
}

export interface SalesAssetInput {
  customerLeadId?: string | null;
  dealId?: string | null;
  projectName?: string;
  type: SalesAssetType;
  title: string;
  version?: string;
  sourceType?: SalesAssetSourceType;
  sourceUrl?: string;
  description?: string;
  tags?: string[];
  industry?: string;
  servicePackage?: string;
  fileUrl?: string;
  publicUrl?: string;
  thumbnailUrl?: string;
  status?: SalesAssetStatus;
}

export interface SalesAssetSendInput {
  platform?: "facebook" | "zalo" | string;
  conversationId?: string;
  dealId?: string;
  sendMode?: "link" | "file";
  note?: string;
}

export interface SalesAssetSendResult {
  asset: SalesAsset;
  link: string;
  messageText: string;
  logged: boolean;
  dealId?: string | null;
  platform?: string;
  sendMode?: string;
}

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

function formHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Loi may chu (${res.status})`);
  }
  return body.data as T;
}

function toPayload(input: Partial<SalesAssetInput>) {
  return {
    customer_lead_id: input.customerLeadId || null,
    deal_id: input.dealId || null,
    project_name: input.projectName,
    type: input.type,
    title: input.title,
    version: input.version,
    source_type: input.sourceType,
    source_url: input.sourceUrl,
    description: input.description,
    tags: input.tags || [],
    industry: input.industry,
    service_package: input.servicePackage,
    file_url: input.fileUrl,
    public_url: input.publicUrl,
    thumbnail_url: input.thumbnailUrl,
    status: input.status,
  };
}

function toSendPayload(input: SalesAssetSendInput) {
  return {
    platform: input.platform,
    conversation_id: input.conversationId,
    deal_id: input.dealId,
    send_mode: input.sendMode || "link",
    note: input.note,
  };
}

export const SALES_ASSET_TYPE_OPTIONS: Array<{ value: SalesAssetType; label: string }> = [
  { value: "proposal", label: "Proposal" },
  { value: "sale_kit", label: "Sale Kit" },
  { value: "portfolio", label: "Portfolio" },
  { value: "other", label: "Khác" },
];

export const SALES_ASSET_STATUS_OPTIONS: Array<{ value: SalesAssetStatus; label: string }> = [
  { value: "active", label: "Đang hoạt động" },
  { value: "inactive", label: "Tạm ẩn" },
  { value: "archived", label: "Lưu trữ" },
];

export const SALES_ASSET_SOURCE_OPTIONS: Array<{ value: SalesAssetSourceType; label: string }> = [
  { value: "canva", label: "Canva" },
  { value: "google_docs", label: "Google Docs" },
  { value: "google_drive", label: "Google Drive" },
  { value: "external", label: "Link khác" },
];

export function getSalesAssetTypeLabel(type: SalesAssetType | string): string {
  return SALES_ASSET_TYPE_OPTIONS.find((item) => item.value === type)?.label || String(type || "");
}

export function getSalesAssetStatusLabel(status: SalesAssetStatus | string): string {
  return SALES_ASSET_STATUS_OPTIONS.find((item) => item.value === status)?.label || String(status || "");
}

export function getSalesAssetSourceLabel(sourceType: SalesAssetSourceType | string): string {
  return SALES_ASSET_SOURCE_OPTIONS.find((item) => item.value === sourceType)?.label || String(sourceType || "");
}

export const salesAssetService = {
  async list(params?: {
    search?: string;
    type?: SalesAssetType | "";
    status?: SalesAssetStatus | "";
    customerLeadId?: string;
    dealId?: string;
    projectName?: string;
    includeArchived?: boolean;
  }): Promise<SalesAsset[]> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.type) qs.set("type", params.type);
    if (params?.status) qs.set("status", params.status);
    if (params?.customerLeadId) qs.set("customer_lead_id", params.customerLeadId);
    if (params?.dealId) qs.set("deal_id", params.dealId);
    if (params?.projectName) qs.set("project_name", params.projectName);
    if (params?.includeArchived) qs.set("include_archived", "true");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets${suffix}`, {
      credentials: "include",
      headers: jsonHeaders(),
    });
    return parseResponse<SalesAsset[]>(res);
  },

  async get(id: string): Promise<SalesAsset> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: jsonHeaders(),
    });
    return parseResponse<SalesAsset>(res);
  },

  async create(input: SalesAssetInput): Promise<SalesAsset> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets`, {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders(),
      body: JSON.stringify(toPayload(input)),
    });
    return parseResponse<SalesAsset>(res);
  },

  async update(id: string, input: Partial<SalesAssetInput>): Promise<SalesAsset> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: jsonHeaders(),
      body: JSON.stringify(toPayload(input)),
    });
    return parseResponse<SalesAsset>(res);
  },

  async archive(id: string): Promise<SalesAsset> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders(),
    });
    return parseResponse<SalesAsset>(res);
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: jsonHeaders(),
    });
    await parseResponse<void>(res);
  },

  async send(id: string, input: SalesAssetSendInput): Promise<SalesAssetSendResult> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets/${encodeURIComponent(id)}/send`, {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders(),
      body: JSON.stringify(toSendPayload(input)),
    });
    return parseResponse<SalesAssetSendResult>(res);
  },

  async upload(file: File, assetId?: string): Promise<{ url: string; name: string; size: number; content_type: string }> {
    const form = new FormData();
    form.append("file", file);
    if (assetId) form.append("asset_id", assetId);
    const res = await fetch(`${API_BASE_URL}/api/all-platform/sales-assets/upload`, {
      method: "POST",
      credentials: "include",
      headers: formHeaders(),
      body: form,
    });
    return parseResponse(res);
  },
};
