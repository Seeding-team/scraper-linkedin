/**
 * =============================================================================
 * THREADS METADATA EXTRACTOR (lib/threads-metadata.ts)
 * =============================================================================
 * Trích xuất Tên người đăng, Nội dung và Ảnh bài viết Threads từ object metadata
 * do API /internal-engagement/custom-posts/debug-fetch trả về (backend cào OG tag
 * bằng UA crawler của Meta — xem fetch_threads_post_raw_metadata).
 */

export interface ThreadsMetadataResult {
  author_name: string;
  content: string;
  image: string;
}

const THREADS_POST_PATH_RE = /^\/(@[^/]+)\/post\/([A-Za-z0-9_-]+)/i;

/**
 * Chuẩn hoá link bài Threads về https://www.threads.com/@user/post/CODE (bỏ query
 * tracking, slug sau mã bài, đổi threads.net -> threads.com). Giữ nguyên link nếu
 * không nhận ra dạng link bài viết.
 */
export function sanitizeThreadsUrl(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const match = parsed.pathname.match(THREADS_POST_PATH_RE);
    if (!match) return withProtocol;
    return `https://www.threads.com/${match[1]}/post/${match[2]}`;
  } catch {
    return withProtocol;
  }
}

export function extractThreadsMetadata(input: any): ThreadsMetadataResult {
  if (!input) return { author_name: "", content: "", image: "" };

  const content = String(input?.metadata?.description || input?.description || "").trim();
  const image = String(input?.metadata?.image || input?.image || "").trim();

  // og:title dạng "Tên người đăng (@handle) on Threads" / "... trên Threads"
  const title = String(input?.metadata?.title || input?.page_title || input?.title || "").trim();
  let authorName = "";
  for (const marker of [" on Threads", " trên Threads"]) {
    if (title.includes(marker)) {
      authorName = title.split(marker)[0].trim();
      break;
    }
  }
  if (authorName.includes("(@")) authorName = authorName.split("(@")[0].trim();

  return { author_name: authorName, content, image };
}
