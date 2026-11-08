/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type { ApiResponse } from "@/types/unified.types";
import { API_BASE_URL } from "@/lib/env";

const BASE = `${API_BASE_URL}/api/all-platform/auto-seeding-comments`;

export interface AutoSeedingComment {
  id: string;
  id_post_fb: string | null;
  /** Bài LinkedIn (migration 174) — song song id_post_fb, chỉ đúng 1 trong 2 cột được điền. */
  id_post_li: string | null;
  /** "facebook" | "linkedin" — nền tảng thật của nhiệm vụ, dùng để gọi đúng lệnh extension. */
  platform: "facebook" | "linkedin";
  post_url: string;
  group_name: string | null;
  id_member: string | null;
  comment_content: string;
  lead_score: number | null;
  need_category: string | null;
  status: "pending" | "posted" | "failed";
  error_message: string | null;
  link_comment: string | null;
  created_at: string;
  posted_at: string | null;
}

async function request<T = any>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
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

// "Nhiệm vụ comment seeding tự động" — tạo tự động ở backend khi lead_score_service.py
// chấm 1 bài Facebook >=70 (xem auto_seeding_comment_service.py). Hook
// useAutoSeedingCommentRuntime (use-seeding-extension.ts) poll danh sách này để tự gọi
// extension comment thật, không cần ai bấm.
export const autoSeedingCommentService = {
  async getPending(limit = 50) {
    return request<AutoSeedingComment[]>(`${BASE}/?limit=${limit}`);
  },

  async markPosted(id: string, linkComment = "") {
    return request(`${BASE}/${id}/mark-posted`, {
      method: "POST",
      body: JSON.stringify({ link_comment: linkComment }),
    });
  },

  async markFailed(id: string, errorMessage = "") {
    return request(`${BASE}/${id}/mark-failed`, {
      method: "POST",
      body: JSON.stringify({ error_message: errorMessage }),
    });
  },
};
