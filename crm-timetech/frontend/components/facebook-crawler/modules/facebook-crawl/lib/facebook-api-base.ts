/** Base URL API Facebook (khớp ``axiosClient``). */
export function getFacebookApiRoot(): string {
  const raw = (process.env.NEXT_PUBLIC_API_FACEBOOK_BASE_URL || "http://127.0.0.1:8000").trim();
  return raw.replace(/\/$/, "");
}

/** ``http://host:8000/facebook`` */
export function getFacebookHttpBase(): string {
  return `${getFacebookApiRoot()}/facebook`;
}

/** ``ws://host:8000/facebook/api/v1/ws/CrawlFbForFE/{email}`` */
export function getFacebookCrawlWsUrl(email: string): string {
  const httpBase = getFacebookHttpBase();
  const wsRoot = httpBase.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${wsRoot}/api/v1/ws/CrawlFbForFE/${encodeURIComponent(email)}`;
}
