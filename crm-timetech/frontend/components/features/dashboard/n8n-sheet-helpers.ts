import type { CrawlSessionGroup } from "@/types/api";

/** GiÃ¡ trá»‹ string tá»« báº£n ghi sheet/webhook (key thÆ°á»ng gáº·p). */
export function pickStr(
  record: Record<string, unknown>,
  keys: string[],
): string {
  for (const k of keys) {
    if (!(k in record)) continue;
    const v = record[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

export function pickNum(
  record: Record<string, unknown>,
  keys: string[],
): number {
  for (const k of keys) {
    if (!(k in record)) continue;
    const v = record[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

/** CÃ¡c key thÆ°á»ng dÃ¹ng cho sá»‘ dÃ²ng sheet / STT. */
const ROW_NUMBER_KEYS = [
  "row_number",
  "rowNumber",
  "STT",
  "stt",
  "Stt",
] as const;

/** CÃ³ sá»‘ dÃ²ng thá»±c sá»± (>0) tá»« sheet/webhook â€” khÃ´ng tÃ­nh Ã´ trá»‘ng / 0. */
export function hasMeaningfulRowNumber(record: Record<string, unknown>): boolean {
  for (const k of ROW_NUMBER_KEYS) {
    if (!(k in record)) continue;
    const v = record[k];
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isNaN(n) && n > 0) return true;
  }
  return false;
}

/** ``row_number`` / ``STT`` â€¦ Ä‘Ãºng nhÆ° báº£n ghi tá»« API (get-all-posts); khÃ´ng Ã©p sá»‘ cá»™t Â«#Â». Chá»‰ fallback khi khÃ´ng cÃ³ sá»‘ â‰¥ 1. */
const POST_URL_KEYS = [
  "URL_BÃ i_Viáº¿t",
  "post_url",
  "postUrl",
  "urlbaiviet",
] as const;

/** URL bÃ i tá»« báº£n ghi sheet/API. */
export function pickPostUrlFromRecord(
  record: Record<string, unknown>,
): string {
  return pickStr(record, [...POST_URL_KEYS]);
}

function linkedinActivityIdFromUrl(url: string): string {
  const match = url.match(/urn:li:activity:(\d+)/i);
  return match?.[1] ?? "";
}

/** So khá»›p cÃ¹ng bÃ i LinkedIn (Æ°u tiÃªn activity id). */
export function postsShareSameLinkedInUrl(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  const idA = linkedinActivityIdFromUrl(a);
  const idB = linkedinActivityIdFromUrl(b);
  if (idA && idB && idA === idB) return true;
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

export function pickPositiveRowNumberFromPost(
  record: Record<string, unknown>,
): number | undefined {
  for (const k of ROW_NUMBER_KEYS) {
    if (!(k in record)) continue;
    const v = record[k];
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isNaN(n) && n >= 1) return Math.trunc(n);
  }
  return undefined;
}

/**
 * Khi sheet/n8n khÃ´ng tráº£ ``row_number``/``STT``, gÃ¡n fallback lÃ  **thá»© tá»± bÃ i trong phiÃªn** (1â€¦n)
 * Ä‘á»ƒ UI vÃ  ``sheet_row`` gá»­i webhook khÃ´ng bá»‹ trá»‘ng.
 *
 * LÆ°u Ã½: ÄÃ¢y lÃ  ordinal trong phiÃªn, khÃ´ng pháº£i tá»± Ä‘á»™ng báº±ng **sá»‘ hÃ ng Google Sheet** â€” 
 * Ä‘á»ƒ khá»›p Ä‘Ãºng hÃ ng sheet cáº§n map STT trong workflow n8n.
 */
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

function isEmptySheetCell(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string" && !v.trim()) return true;
  return false;
}

/**
 * Gá»™p meta phiÃªn (email, id phiÃªn, nhÃ³m, **tá»•ng sá»‘ bÃ i trong phiÃªn**) vÃ o báº£n ghi bÃ i trÆ°á»›c khi gá»­i ``sheet_row``.
 *
 * - Email / nhÃ³m / id phiÃªn: chá»‰ Ä‘iá»n khi Ã´ trÃªn dÃ²ng Ä‘ang trá»‘ng (khÃ´ng ghi Ä‘Ã¨ ``NgÃ y``, ná»™i dung, â€¦).
 * - ``posts_count`` vÃ  cá»™t Â«Tá»•ng sá»‘ bÃ i láº¥y Ä‘Æ°á»£c má»—i láº§n cÃ oÂ»: **luÃ´n** gÃ¡n theo báº£ng phiÃªn (khá»›p UI).
 * - ``row_number`` / ``STT``: giá»¯ nguyÃªn nhÆ° object ``post`` (dá»¯ liá»‡u GET); khÃ´ng ghi Ä‘Ã¨ ordinal báº£ng.
 */
export function buildReactionWebhookSheetRow(
  post: Record<string, unknown>,
  session: CrawlSessionGroup,
): Record<string, unknown> {
  const out = { ...post };
  const sid = session.id_session_crawl?.trim();
  const ec = session.email_crawl?.trim();
  const gu = session.group_url?.trim();
  const gn = session.group_name?.trim();

  const fill = (key: string, val: string | undefined) => {
    if (!val) return;
    if (!isEmptySheetCell(out[key])) return;
    out[key] = val;
  };

  fill("ID_session_crawl", sid);
  fill("id_session_crawl", sid);
  fill("Email_crawl", ec);
  fill("email_crawl", ec);
  fill("group_url", gu);
  fill("groupUrl", gu);
  fill("URL_NhÃ³m", gu);
  fill("URL_nhom", gu);
  fill("group_name", gn);
  fill("groupName", gn);
  fill("TÃªn nhÃ³m", gn);

  const pc = session.posts_count;
  if (typeof pc === "number" && Number.isFinite(pc) && pc >= 0) {
    out["posts_count"] = pc;
    out["Tá»•ng sá»‘ bÃ i láº¥y Ä‘Æ°á»£c má»—i láº§n cÃ o"] = pc;
  }

  return out;
}

export function shortenSessionId(id: string, head = 14, tail = 8): string {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}â€¦${id.slice(-tail)}`;
}

function formatDateDdMm(raw: string): string {
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return raw || "â€”";
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** NgÃ y Ä‘áº¡i diá»‡n cá»§a phiÃªn (max ``NgÃ y`` / ``date`` trong cÃ¡c bÃ i). */
export function sessionLatestDateLabel(session: CrawlSessionGroup): string {
  let best = "";
  for (const p of session.posts) {
    const d = pickStr(p, ["NgÃ y", "date", "targetDate"])
      .slice(0, 10)
      .trim();
    if (d && d > best) best = d;
    const raw = pickStr(p, ["ÄÄƒng vÃ o", "posted_at", "created_at"]);
    if (raw.length >= 10) {
      const head = raw.slice(0, 10);
      if (head > best) best = head;
    }
  }
  return best ? formatDateDdMm(best) : "â€”";
}

export function formatCellValue(v: unknown): string {
  if (v == null) return "â€”";
  if (typeof v === "object")
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  return String(v);
}

export function sortedRecordEntries(
  record: Record<string, unknown>,
): [string, unknown][] {
  return Object.entries(record).sort(([a], [b]) =>
    a.localeCompare(b, "vi", { sensitivity: "base" }),
  );
}
