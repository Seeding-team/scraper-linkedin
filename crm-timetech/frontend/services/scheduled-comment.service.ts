/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type {
  ScheduledComment,
  CreateScheduledCommentRequest,
  ApiResponse,
} from "@/types/unified.types";
import { API_BASE_URL } from "@/lib/env";

const BASE = `${API_BASE_URL}/api/all-platform/scheduled-comments`;

async function request<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Server returned ${res.status} — không thể parse JSON response`);
  }
  if (!res.ok) {
    const detail = body?.detail || body?.message || `HTTP ${res.status}`;
    throw new Error(Array.isArray(detail) ? detail.map((d: any) => d.msg || String(d)).join("; ") : detail);
  }
  if (!body.success) {
    throw new Error(body.message || "Request failed");
  }
  return body;
}

export const scheduledCommentService = {
  async getAll(params?: {
    status?: string;
    platform?: string;
    page?: number;
    limit?: number;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.platform) searchParams.set("platform", params.platform);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const qs = searchParams.toString();
    return request<ScheduledComment[]>(`${BASE}/${qs ? "?" + qs : ""}`);
  },

  async create(data: CreateScheduledCommentRequest) {
    return request<ScheduledComment>(`${BASE}/`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: {
    comment_content?: string;
    id_social_account?: string;
    scheduled_at?: string;
  }) {
    return request<ScheduledComment>(`${BASE}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async cancel(id: string) {
    return request<ScheduledComment>(`${BASE}/${id}`, { method: "DELETE" });
  },

  async executeNow(id: string) {
    return request(`${BASE}/${id}/execute-now`, { method: "POST" });
  },

  async markPosted(id: string, link_comment?: string) {
    const params = link_comment ? `?link_comment=${encodeURIComponent(link_comment)}` : "";
    return request(`${BASE}/${id}/mark-posted${params}`, { method: "POST" });
  },

  async aiPreview(postContent: string) {
    return request<{ comment: string }>(`${BASE}/ai-preview`, {
      method: "POST",
      body: JSON.stringify({ post_content: postContent }),
    });
  },
};
