/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type { ApiResponse } from "@/types/unified.types";
import { API_BASE_URL } from "@/lib/env";

const BASE = `${API_BASE_URL}/api/all-platform`;

async function requestJson<T = any>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
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
};


