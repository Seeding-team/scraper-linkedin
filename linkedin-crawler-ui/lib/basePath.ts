/**
 * Không còn dùng Next.js basePath (module deploy ở domain root qua subdomain
 * riêng, không phải path-prefix nữa) — giữ lại apiUrl() làm no-op passthrough
 * để không phải sửa lại mọi call site đã dùng helper này.
 */
export const BASE_PATH = "";

export function apiUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
