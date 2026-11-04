/**
 * Utility tạo link chuyển hướng tới Zalo Chat trên hệ thống (App Seeding)
 * theo chuẩn đồng bộ 4 module CRM: Lead, Khách hàng, Deal, Báo giá & Hợp đồng.
 */
export function getZaloChatUrl(phoneOrZalo?: string | null, accountId?: string | null): string {
  if (!phoneOrZalo) return "/all-platform/zalo-inbox";
  const raw = String(phoneOrZalo).trim();
  
  // Neu da la URL Zalo Chat he thong thi giu nguyen
  if (raw.startsWith("/all-platform/zalo-inbox")) return raw;

  // Lay chuoi so dien thoai chuan
  const cleanPhone = raw.replace(/[^\d+]/g, "").replace(/^(\+84|84)/, "0");
  const params = new URLSearchParams();
  
  if (cleanPhone && cleanPhone.length >= 8) {
    params.set("phone", cleanPhone);
  }
  if (accountId) {
    params.set("account", accountId);
  }
  
  const query = params.toString();
  return query ? `/all-platform/zalo-inbox?${query}` : "/all-platform/zalo-inbox";
}

/**
 * Mo chat Zalo tren App Seeding (tab moi hoac tab hien tai)
 */
export function openZaloChat(phoneOrZalo?: string | null, accountId?: string | null, newTab: boolean = true) {
  const url = getZaloChatUrl(phoneOrZalo, accountId);
  if (typeof window !== "undefined") {
    if (newTab) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = url;
    }
  }
}

