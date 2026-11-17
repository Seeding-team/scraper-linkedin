/** Xu ly chung khi API tra 401 (het phien/khong co cookie hop le) - dung tu
 * MOI `apiFetch` trong cac repository (truoc day moi file tu throw Error roi
 * phan lon noi goi chi `window.alert(err.message)`, hien nguyen van message
 * ky thuat tu backend vd "Missing or invalid authorization header" thay vi
 * bao nguoi dung dang nhap lai - xem thao/CRM_KNOWN_BUGS_FIXED.md).
 *
 * Chi redirect 1 LAN du nhieu request cung luc 401 (vd page vua load goi
 * song song nhieu API) - khong de nhieu lan `window.location` tranh nhau. */
let redirecting = false;

export const SESSION_EXPIRED_MESSAGE = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.';

export function handleSessionExpired(): void {
  if (redirecting || typeof window === 'undefined') return;
  redirecting = true;
  if (window.location.pathname.startsWith('/auth/login')) return;
  window.location.href = '/auth/login';
}
