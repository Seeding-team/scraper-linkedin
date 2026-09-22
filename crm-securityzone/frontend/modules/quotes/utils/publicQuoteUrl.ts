/**
 * Link báo giá công khai (khách hàng bấm vào) - yêu cầu đổi từ dạng cũ
 * "<origin dang dung>/public/quotes/{token}" (vd crm.markee.vn - domain noi
 * bo CRM, khach ngoai co the khong load duoc do DNS/tuong lua/CDN chi cho
 * phep truy cap CRM) sang domain cong khai rieng, than thien voi khach hang:
 * "<domain cua workspace>/baogia/{token}". Route "/baogia/[token]"
 * (app/baogia/[token]/page.tsx) render lai DUNG PublicQuotePage nhu
 * "/public/quotes/[token]" - khong trung logic, chi la 1 duong dan khac cho
 * cung 1 trang, va KHONG doi hoi dang nhap (giong het /public/quotes cu).
 *
 * Domain phai theo TUNG WORKSPACE/CRM_INSTANCE - Markee dung markee.vn,
 * CloudGate dung domain CloudGate, SecurityZone dung domain SecurityZone -
 * KHONG hardcode 1 domain chung cho ca 4 deployment (MAIN/crm-module/
 * crm-cloudgate/crm-securityzone). Kien truc HIEN TAI (da xac nhan qua
 * linkedin_group_crawler/app/core/config.py:321 `crm_instance` + endpoint
 * GET /debug/instance trong app/main.py) la 4 deployment CO DINH, MOI
 * deployment 1 instance duy nhat trong suot vong doi (chua phai 1 app xoay
 * theo Host header nhu ke hoach unify o crm-module) - nen chi can 1 bien
 * build-time NEXT_PUBLIC_CRM_INSTANCE (khong can goi API luc runtime), tra
 * trong map duoi day 1 lan la du, dung san khi sau nay MAIN gop 1 app.
 *
 * QUAN TRONG: key cua map PHAI dung dung casing voi `crm_instance`/
 * WORKSPACE_LABELS da dung san khap repo (markee/cloudgate/SECURITYZONE -
 * xem components/all-platform/admin/MemberManagementContent.tsx) - KHONG
 * normalize lai casing khac di.
 */
// Domain xac nhan THAT boi nguoi phu trach ha tang (2026-09-22): CloudGate =
// getcloudgate.com/baogia/, SecurityZone = securityzone.vn/baogia/ - dung
// chinh xac 2 domain nay, KHONG con la suy doan. Van con 1 buoc ha tang rieng
// (ngoai pham vi sua code): DNS/reverse-proxy cho 3 domain "tran" (markee.vn/
// getcloudgate.com/securityzone.vn) hien CHUA duoc xac nhan da tro toi cung
// port dang phuc vu crm.markee.vn/crm.getcloudgate.com/crm.securityzone.vn
// (18090/18091/18092, xem docs/CRM_UNIFY_MULTITENANT_2026-09-08.md) - can
// nguoi quan ly ha tang tro DNS truoc khi link nay thuc su mo duoc tu ben
// ngoai.
const INSTANCE_PUBLIC_DOMAIN: Record<string, string> = {
  markee: "https://markee.vn",
  cloudgate: "https://getcloudgate.com",
  SECURITYZONE: "https://securityzone.vn",
};

const DEFAULT_INSTANCE = "markee";

/** Instance CRM cua deployment nay, co dinh luc build (giong CRM_INSTANCE ben backend). */
export const CRM_INSTANCE = process.env.NEXT_PUBLIC_CRM_INSTANCE || DEFAULT_INSTANCE;

/** Domain cong khai (khong co dau "/" cuoi) cua workspace dang chay deployment nay. */
export const PUBLIC_QUOTE_BASE_URL = (
  INSTANCE_PUBLIC_DOMAIN[CRM_INSTANCE] || INSTANCE_PUBLIC_DOMAIN[DEFAULT_INSTANCE]
).replace(/\/+$/, "");

/** Lay token tu publicUrl dang "/public/quotes/{token}" (backend tra ve field nay tren Quote). */
export function extractPublicQuoteToken(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const match = publicUrl.match(/\/public\/quotes\/([^/?#]+)/);
  return match ? match[1] : null;
}

// BUG THAT DA GAP ("bấm Sao chép link/In PDF ở local mà lại ra domain
// markee.vn"): PUBLIC_QUOTE_BASE_URL o tren la 1 hang so co dinh luc BUILD
// (doc NEXT_PUBLIC_CRM_INSTANCE), KHONG phan biet dang chay o dau - local
// dev VA production deu tra ve CUNG 1 gia tri (vd "markee.vn"), khien Sale
// test tren localhost:3000 bam "Sao chep link"/"In PDF" cung ra link
// production that (khong the dung de tu test luong local, con neu bam
// nham gui that cho khach thi lai dung production - dung y muon, chi SAI o
// moi truong dev). Sua: chi dung domain cong khai da cau hinh khi THAT SU
// dang chay production (khong phai localhost/mang noi bo) - kiem tra ngay
// luc GOI HAM (khong phai hang so module-level, vi `window` chi co o
// client va can gia tri THOI DIEM BAM nut, khong phai luc module duoc
// import). Dev/local (localhost, 127.0.0.1, *.local, cac dai IP noi bo
// 10.x/172.16-31.x/192.168.x hay dung de test tu may khac trong mang LAN)
// -> dung nguyen window.location.origin (giu dung hanh vi CU truoc khi co
// yeu cau doi domain, chi khac o cho GIU /baogia/{token} thay vi
// /public/quotes/{token} de test dung route moi). Production that (domain
// that duoc deploy) -> dung domain da cau hinh trong INSTANCE_PUBLIC_DOMAIN
// nhu cu.
function isLocalOrPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.endsWith(".local")) return true;
  // IPv4 private ranges dung khi test tu may khac trong cung mang LAN
  // (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) - khop dung quy uoc da
  // dung cho "Network: http://192.168.x.x:3000" ma `next dev` tu in ra.
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)) return true;
  return false;
}

function resolvePublicQuoteBaseUrl(): string {
  if (typeof window !== "undefined" && isLocalOrPrivateHost(window.location.hostname)) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return PUBLIC_QUOTE_BASE_URL;
}

/**
 * Build link cong khai dang moi tu publicUrl backend tra ve, dung dung domain
 * cua workspace/CRM_INSTANCE dang chay deployment nay (production that) -
 * hoac dung nguyen origin hien tai neu dang chay local/mang noi bo (xem
 * resolvePublicQuoteBaseUrl). Tra ve null neu khong lay duoc token (chua
 * publish public link).
 */
export function buildPublicQuoteUrl(
  publicUrl: string | null | undefined,
  opts?: { print?: boolean }
): string | null {
  const token = extractPublicQuoteToken(publicUrl);
  if (!token) return null;
  const base = `${resolvePublicQuoteBaseUrl()}/baogia/${token}`;
  return opts?.print ? `${base}?print=true` : base;
}
