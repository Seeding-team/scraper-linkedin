/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type { ApiResponse } from "@/types/unified.types";
import { API_BASE_URL } from "@/lib/env";

const BASE = `${API_BASE_URL}/api/all-platform`;

function getAuthTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)crawlpro_access_token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return localStorage.getItem("token") || localStorage.getItem("access_token");
}

async function requestJson<T = any>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const token = getAuthTokenFromCookie();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> || {}),
  };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  return res.json();
}

export const allPlatformPostsDeleteService = {
  deleteFacebookPost: async (payload: { id?: string; post_url?: string }) => {
    return requestJson(`${BASE}/unified/posts/facebook`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },
  deleteThreadsPost: async (payload: { id?: string; post_url?: string }) => {
    return requestJson(`${BASE}/unified/posts/threads`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },
  deleteYoutubePost: async (payload: { id?: string; post_url?: string }) => {
    return requestJson(`${BASE}/unified/posts/youtube`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },
};
