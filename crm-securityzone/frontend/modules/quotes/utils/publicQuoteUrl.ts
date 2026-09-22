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

/**
 * Build link cong khai dang moi tu publicUrl backend tra ve, dung dung domain
 * cua workspace/CRM_INSTANCE dang chay deployment nay. Tra ve null neu khong
 * lay duoc token (chua publish public link).
 */
export function buildPublicQuoteUrl(
  publicUrl: string | null | undefined,
  opts?: { print?: boolean }
): string | null {
  const token = extractPublicQuoteToken(publicUrl);
  if (!token) return null;
  const base = `${PUBLIC_QUOTE_BASE_URL}/baogia/${token}`;
  return opts?.print ? `${base}?print=true` : base;
}
