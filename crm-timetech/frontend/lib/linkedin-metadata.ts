/**
 * =============================================================================
 * LINKEDIN METADATA EXTRACTOR (lib/linkedin-metadata.ts)
 * =============================================================================
 * Trích xuất Tên người đăng (author_name) và Nội dung (content) bài viết LinkedIn
 * từ object metadata do API trả về.
 */

export interface LinkedInMetadataInput {
  page_title?: string;
  title?: string;
  description?: string;
  metadata?: {
    title?: string;
    description?: string;
    image?: string;
    site_name?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface LinkedInMetadataResult {
  author_name: string;
  content: string;
}

/**
 * Trích xuất author_name và content từ object metadata do API trả về
 * @param input Object metadata hoặc chuỗi JSON từ API
 * @returns Object { author_name: string, content: string }
 */
export function extractLinkedInMetadata(input: LinkedInMetadataInput | string | any): LinkedInMetadataResult {
  if (!input) {
    return { author_name: "", content: "" };
  }

  // Parse JSON nếu input là chuỗi string
  let data: any = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      data = { description: input };
    }
  }

  // 1. Trích xuất Nội dung bài viết (Content / Description)
  const rawContent =
    data?.metadata?.description ||
    data?.description ||
    "";
  
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  // 2. Trích xuất Tên người đăng (Author Name) từ title / page_title
  const rawTitle =
    data?.metadata?.title ||
    data?.page_title ||
    data?.title ||
    "";

  const fullTitle = typeof rawTitle === "string" ? rawTitle.trim() : "";
  let authorName = "";

  if (fullTitle.includes(" | ")) {
    // Trường hợp tiêu chuẩn: "Nội dung bài viết... | Tên Người Đăng"
    const parts = fullTitle.split(" | ");
    authorName = parts[parts.length - 1].trim();
  } else if (fullTitle.includes(" on LinkedIn:")) {
    // Fallback định dạng LinkedIn tiếng Anh: "Tên Người Đăng on LinkedIn: Nội dung..."
    authorName = fullTitle.split(" on LinkedIn:")[0].trim();
  } else if (fullTitle.includes(" trên LinkedIn:")) {
    // Fallback định dạng LinkedIn tiếng Việt: "Tên Người Đăng trên LinkedIn: Nội dung..."
    authorName = fullTitle.split(" trên LinkedIn:")[0].trim();
  }

  return {
    author_name: authorName,
    content: content,
  };
}

/**
 * Chuẩn hóa URL LinkedIn:
 * 1. Chuyển bất kỳ subdomain quốc gia nào (vn.linkedin.com, en.linkedin.com,...) về www.linkedin.com
 * 2. Cắt bỏ toàn bộ query/tracking parameters phía sau dấu ?
 * @param url URL bài viết LinkedIn thô
 * @returns URL LinkedIn sạch dạng https://www.linkedin.com/...
 */
export function sanitizeLinkedInUrl(url: string): string {
  if (!url || typeof url !== "string" || !url.toLowerCase().includes("linkedin.com")) {
    return url || "";
  }
  let cleanUrl = url.trim().replace(/https?:\/\/[a-z]{2,3}\.linkedin\.com/i, "https://www.linkedin.com");
  cleanUrl = cleanUrl.split("?")[0].trim();
  return cleanUrl;
}

