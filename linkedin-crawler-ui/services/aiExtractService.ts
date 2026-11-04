"use client";

import { API_BASE_URL, API_KEY } from "@/lib/env";

const BASE = `${API_BASE_URL}/api/all-platform`;

export interface ExtractPostNeedPayload {
  content: string;
  group_name?: string;
  post_url?: string;
}

export interface ExtractPostNeedResult {
  need: string;
  zalo_message: string;
}

/**
 * AI Extractor Service:
 * Bóc tách nhu cầu của khách từ bài viết post feed bằng Gemini AI,
 * kèm Fallback Regex Heuristic tiếng Việt siêu tốc.
 */
export async function extractPostNeed(payload: ExtractPostNeedPayload): Promise<ExtractPostNeedResult> {
  const content = (payload.content || "").trim();
  const postUrl = (payload.post_url || "").trim();
  const groupName = (payload.group_name || "").trim();

  try {
    const res = await fetch(`${BASE}/crm/leads/ai-extract-need`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
      },
      body: JSON.stringify({
        content,
        group_name: groupName || undefined,
        post_url: postUrl || undefined,
      }),
    });

    if (res.ok) {
      const body = await res.json();
      if (body.success && body.data?.need) {
        return {
          need: body.data.need,
          zalo_message: body.data.zalo_message || "",
        };
      }
    }
  } catch (err) {
    console.warn("AI extract need API call failed, falling back to local heuristic:", err);
  }

  // Fallback bóc tách cục bộ (Local Heuristic)
  const cleaned = content
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(?:\+?84|0084|0)(?:\D*\d){8,10}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(/(cần\s+(?:tìm|thuê|mua|hợp tác|tư vấn|làm|triển khai)[^.,;!\n\?]+)/i);
  let need = match ? match[1].trim() : "";
  if (!need) {
    const firstPart = cleaned.split(/[.\n;!?]/)[0] || "";
    need = firstPart.length > 70 ? firstPart.slice(0, 70).trim() : firstPart.trim();
  }
  if (!need) {
    need = "Tư vấn theo nội dung bài viết";
  } else {
    need = need.charAt(0).toUpperCase() + need.slice(1);
  }

  const gText = groupName ? ` trong nhóm "${groupName}"` : "";
  const lines = [
    `Chào bạn, mình thấy bài viết của bạn${gText} đang có nhu cầu: "${need}".`,
    "Bên mình có giải pháp và kinh nghiệm có thể hỗ trợ bạn ngay.",
    "Mình gửi thông tin chi tiết qua Zalo để bạn tiện tham khảo nhé!",
  ];
  if (postUrl) {
    lines.push(`Link bài viết: ${postUrl}`);
  }

  return {
    need,
    zalo_message: lines.join("\n"),
  };
}

