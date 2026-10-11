import type { CrawlSessionGroup } from "@/types/api";

export function pickStr(
  record: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

export function pickNum(
  record: Record<string, unknown>,
  keys: string[],
): number {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

const ROW_NUMBER_KEYS = [
  "row_number",
  "rowNumber",
  "STT",
  "stt",
  "Stt",
] as const;

export function hasMeaningfulRowNumber(
  record: Record<string, unknown>,
): boolean {
  for (const key of ROW_NUMBER_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value == null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isNaN(parsed) && parsed > 0) return true;
  }
  return false;
}

const POST_URL_KEYS = [
  "URL_Bài_Viết",
  "URL_Bai_Viet",
  "post_url",
  "postUrl",
  "urlbaiviet",
] as const;

export function pickPostUrlFromRecord(
  record: Record<string, unknown>,
): string {
  return pickStr(record, [...POST_URL_KEYS]);
}

function linkedinActivityIdFromUrl(url: string): string {
  const match = url.match(/urn:li:activity:(\d+)/i);
  return match?.[1] ?? "";
}

export function postsShareSameLinkedInUrl(left: string, right: string): boolean {
  const first = left.trim();
  const second = right.trim();
  if (!first || !second) return false;
  const firstId = linkedinActivityIdFromUrl(first);
  const secondId = linkedinActivityIdFromUrl(second);
  if (firstId && secondId && firstId === secondId) return true;
  return first.replace(/\/$/, "") === second.replace(/\/$/, "");
}

export function pickPositiveRowNumberFromPost(
  record: Record<string, unknown>,
): number | undefined {
  for (const key of ROW_NUMBER_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value == null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isNaN(parsed) && parsed >= 1) return Math.trunc(parsed);
  }
  return undefined;
}

export function enrichPostRowNumberIfMissing(
  record: Record<string, unknown>,
  fallbackOrdinalInSession: number,
): Record<string, unknown> {
  if (hasMeaningfulRowNumber(record)) return record;
  return {
    ...record,
    row_number: fallbackOrdinalInSession,
    rowNumber: fallbackOrdinalInSession,
    STT: fallbackOrdinalInSession,
    stt: fallbackOrdinalInSession,
  };
}

function isEmptySheetCell(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && !value.trim()) return true;
  return false;
}

export function buildReactionWebhookSheetRow(
  post: Record<string, unknown>,
  session: CrawlSessionGroup,
): Record<string, unknown> {
  const out = { ...post };
  const sessionId = session.id_session_crawl?.trim();
  const crawlEmail = session.email_crawl?.trim();
  const groupUrl = session.group_url?.trim();
  const groupName = session.group_name?.trim();

  const fill = (key: string, value: string | undefined) => {
    if (!value) return;
    if (!isEmptySheetCell(out[key])) return;
    out[key] = value;
  };

  fill("ID_session_crawl", sessionId);
  fill("id_session_crawl", sessionId);
  fill("Email_crawl", crawlEmail);
  fill("email_crawl", crawlEmail);
  fill("group_url", groupUrl);
  fill("groupUrl", groupUrl);
  fill("URL_Nhóm", groupUrl);
  fill("URL_Nhom", groupUrl);
  fill("group_name", groupName);
  fill("groupName", groupName);
  fill("Tên nhóm", groupName);
  fill("Ten nhom", groupName);

  const postsCount = session.posts_count;
  if (
    typeof postsCount === "number" &&
    Number.isFinite(postsCount) &&
    postsCount >= 0
  ) {
    out.posts_count = postsCount;
    out["Tổng số bài lấy được mỗi lần cào"] = postsCount;
    out["Tong so bai lay duoc moi lan cao"] = postsCount;
  }

  return out;
}

export function shortenSessionId(id: string, head = 14, tail = 8): string {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

function formatDateDdMm(raw: string): string {
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return raw || "-";
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function sessionLatestDateLabel(session: CrawlSessionGroup): string {
  let best = "";
  for (const post of session.posts) {
    const date = pickStr(post, ["Ngày", "Ngay", "date", "targetDate"])
      .slice(0, 10)
      .trim();
    if (date && date > best) best = date;

    const raw = pickStr(post, [
      "Đăng vào",
      "Dang vao",
      "posted_at",
      "created_at",
    ]);
    if (raw.length >= 10) {
      const head = raw.slice(0, 10);
      if (head > best) best = head;
    }
  }
  return best ? formatDateDdMm(best) : "-";
}

export function formatCellValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function sortedRecordEntries(
  record: Record<string, unknown>,
): [string, unknown][] {
  return Object.entries(record).sort(([left], [right]) =>
    left.localeCompare(right, "vi", { sensitivity: "base" }),
  );
}

export function getPostCrawlError(
  post: Record<string, unknown>,
): string | null {
  const errorKeys = [
    "error",
    "errorMessage",
    "error_message",
    "Lỗi",
    "Loi",
    "loi",
    "Reason",
    "reason",
    "ghi_chu",
    "Ghi chú",
    "Ghi chu",
    "note",
    "status",
    "Trạng thái",
    "Trang thai",
  ];

  for (const key of errorKeys) {
    const value = String(post[key] ?? "").trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    if (
      lower.includes("lỗi") ||
      lower.includes("loi") ||
      lower.includes("error") ||
      lower.includes("failed") ||
      lower.includes("thất bại") ||
      lower.includes("that bai") ||
      lower.includes("hong") ||
      lower.includes("không thể") ||
      lower.includes("khong the") ||
      lower.includes("cannot") ||
      lower.includes("missing")
    ) {
      return value;
    }
  }

  return null;
}
