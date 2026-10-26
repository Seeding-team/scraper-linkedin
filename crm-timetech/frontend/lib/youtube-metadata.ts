/**
 * =============================================================================
 * YOUTUBE METADATA EXTRACTOR (lib/youtube-metadata.ts)
 * =============================================================================
 * Trích xuất Tên Kênh (channel_name), Mô tả (description), và Tiêu đề (title)
 * từ mã nguồn HTML thô của trang YouTube (Video Thường & Shorts).
 */

export interface YouTubeMetadata {
  channel_name: string;
  description: string;
  title: string;
}

/**
 * Giải mã các ký tự HTML entities và JSON escape sequences
 */
function decodeEntities(str: string): string {
  if (!str || typeof str !== "string") return "";
  let decoded = str;

  // 1. Giải mã JSON Unicode escape sequences (\u0026 -> &, \u003c -> <, etc.)
  try {
    decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  } catch (e) {}

  // 2. Giải mã ký tự escaped chuẩn (\", \\, \n, \r)
  decoded = decoded
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "");

  // 3. Giải mã HTML Entities
  decoded = decoded
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");

  return decoded.trim();
}

/**
 * Trích xuất channel_name, description, title từ rawHtml của YouTube
 * @param rawHtml Mã nguồn HTML thô của trang YouTube
 * @returns Object { channel_name, description, title }
 */
export function extractYouTubeMetadata(rawHtml: string): YouTubeMetadata {
  if (!rawHtml || typeof rawHtml !== "string") {
    return { channel_name: "", description: "", title: "" };
  }

  // =========================================================================
  // 1. TRÍCH XUẤT TÊN KÊNH (CHANNEL NAME)
  // =========================================================================
  let channelName = "";

  // Cách 1 (Dành cho Video thường - quét thẻ Meta Schema.org):
  // Regex: /<span itemprop="author"[^>]*>.*?<link itemprop="name" content="([^"]+)">/is
  const authorSchemaMatch = rawHtml.match(
    /<span\s+itemprop=["']author["'][^>]*>[\s\S]*?<link\s+itemprop=["']name["']\s+content=["']([^"']+)["']/i
  );
  if (authorSchemaMatch && authorSchemaMatch[1]) {
    channelName = authorSchemaMatch[1];
  }

  // Cách 1b (Meta author độc lập):
  if (!channelName) {
    const metaAuthorMatch = rawHtml.match(
      /<meta\s+itemprop=["']author["']\s+content=["']([^"']+)["']/i
    );
    if (metaAuthorMatch && metaAuthorMatch[1]) {
      channelName = metaAuthorMatch[1];
    }
  }

  // Cách 2 (Dành cho Shorts & Fallback - quét chuỗi JSON ytInitialData):
  // Regex: /"channel"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"\}/i
  if (!channelName) {
    const channelJsonMatch = rawHtml.match(
      /"channel"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"\}/i
    );
    if (channelJsonMatch && channelJsonMatch[1]) {
      channelName = channelJsonMatch[1];
    }
  }

  // Cách 2b (Các pattern JSON bổ sung cho Shorts/Player):
  if (!channelName) {
    const ownerJsonMatch =
      rawHtml.match(/"videoOwnerRenderer"\s*:\s*\{\s*"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"/i) ||
      rawHtml.match(/"ownerChannelName"\s*:\s*"([^"]+)"/i) ||
      rawHtml.match(/"author"\s*:\s*"([^"]+)"/i);
    if (ownerJsonMatch && ownerJsonMatch[1]) {
      channelName = ownerJsonMatch[1];
    }
  }

  // Cách 2c (Thẻ link itemprop="name"):
  if (!channelName) {
    const linkNameMatch = rawHtml.match(
      /<link\s+itemprop=["']name["']\s+content=["']([^"']+)["']/i
    );
    if (linkNameMatch && linkNameMatch[1]) {
      channelName = linkNameMatch[1];
    }
  }

  // =========================================================================
  // 2. TRÍCH XUẤT MÔ TẢ (DESCRIPTION / CONTENT)
  // =========================================================================
  let description = "";

  // Cách 1 (Dành cho Video thường): /<meta itemprop="description" content="([^"]+)">/i
  const metaDescMatch = rawHtml.match(
    /<meta\s+itemprop=["']description["']\s+content=["']([^"']+)["']/i
  );
  if (metaDescMatch && metaDescMatch[1]) {
    description = metaDescMatch[1];
  }

  // Cách 2 (Dành cho Shorts - fallback sang meta description / og:description / ytInitialData):
  if (!description) {
    const metaNameDescMatch =
      rawHtml.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
      rawHtml.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    if (metaNameDescMatch && metaNameDescMatch[1]) {
      description = metaNameDescMatch[1];
    }
  }

  if (!description) {
    const jsonDescMatch =
      rawHtml.match(/"description"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"\}/i) ||
      rawHtml.match(/"shortDescription"\s*:\s*"([^"]+)"/i);
    if (jsonDescMatch && jsonDescMatch[1]) {
      description = jsonDescMatch[1];
    }
  }

  // =========================================================================
  // 3. TRÍCH XUẤT TIÊU ĐỀ (TITLE)
  // =========================================================================
  let title = "";

  // Regex: /<meta itemprop="name" content="([^"]+)">/i
  const metaTitleMatch =
    rawHtml.match(/<meta\s+itemprop=["']name["']\s+content=["']([^"']+)["']/i) ||
    rawHtml.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    rawHtml.match(/<title[^>]*>(.*?)<\/title>/i);

  if (metaTitleMatch && metaTitleMatch[1]) {
    title = metaTitleMatch[1].replace(/\s*-\s*YouTube$/i, "").trim();
  }

  return {
    channel_name: decodeEntities(channelName),
    description: decodeEntities(description),
    title: decodeEntities(title),
  };
}
