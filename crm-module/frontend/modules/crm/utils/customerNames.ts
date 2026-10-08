/** Tên viết tắt tự động (FALLBACK cục bộ - nguồn chính là backend POST /crm/customers/suggest-short-name, cùng quy tắc).
 * Không bịa thương hiệu: bỏ loại hình doanh nghiệp + từ mô tả ngành ở đầu, cắt phần "- Chi nhánh ...", lấy mã trong ngoặc; không lấy chữ cái đầu. */

const MAX_SHORT_LEN = 30;
const LEGAL_PREFIXES = [
  'CONG TY TNHH MOT THANH VIEN', 'CONG TY TRACH NHIEM HUU HAN MOT THANH VIEN', 'CONG TY TRACH NHIEM HUU HAN', 'CONG TY CO PHAN',
  'CONG TY TNHH MTV', 'CONG TY HOP DANH', 'CONG TY TNHH', 'CONG TY CP', 'TONG CONG TY', 'CONG TY', 'DOANH NGHIEP TU NHAN', 'HO KINH DOANH',
  'CHI NHANH', 'VAN PHONG DAI DIEN', 'TAP DOAN', 'DNTN', 'CTCP', 'TNHH', 'MTV', 'JSC', 'CO., LTD', 'CO LTD', 'LTD', 'COMPANY LIMITED', 'CORPORATION', 'CORP', 'INC',
].sort((a, b) => b.length - a.length);
const GENERIC_WORDS = new Set([
  'THUONG', 'MAI', 'VA', 'SAN', 'XUAT', 'DICH', 'VU', 'DAU', 'TU', 'NHAP', 'KHAU', 'CONG', 'NGHE', 'GIAI', 'PHAP', 'TIEP', 'THI', 'PHAT',
  'TRIEN', 'XAY', 'DUNG', 'VAN', 'TAI', 'QUANG', 'CAO', 'TRUYEN', 'THONG', 'KY', 'THUAT', 'PHAN', 'MEM', 'TIN', 'THIET', 'KE',
  'CHUYEN', 'DOI', 'SO', 'GROUP', 'HOLDING', 'TECHNOLOGY', 'SOLUTIONS', 'SERVICES', 'TRADING', 'NOI', 'NGOAI', 'THAT',
]);
const ORG_MARKERS = [
  'CONG TY', 'TRUNG TAM', 'TRUONG', 'BENH VIEN', 'TONG CONG TY', 'TAP DOAN', 'NGAN HANG', 'HO KINH DOANH', 'DOANH NGHIEP', 'CHI NHANH',
  'HOC VIEN', 'VIEN ', 'UBND', 'SO ', 'PHONG ', 'HOP TAC XA', 'DNTN', 'CTCP', 'TNHH', 'JSC', 'LTD',
];
const SEPARATORS = [' - ', ' – ', ' — ', ' | ', ', '];

/** Bo dau tung ky tu (giu do dai) + viet hoa. */
function fold(text: string): string {
  return Array.from(text).map(ch => (ch === 'đ' || ch === 'Đ' ? 'D' : ch.normalize('NFD')[0].toUpperCase())).join('');
}

/** Khach doanh nghiep/to chuc (co cong ty, MST hoac tu khoa to chuc). Khach ca nhan -> false. */
export function looksLikeEnterprise(customerName?: string | null, companyName?: string | null, taxCode?: string | null): boolean {
  if ((companyName || '').trim() || (taxCode || '').trim()) return true;
  const name = `${fold((customerName || '').trim())} `;
  return ORG_MARKERS.some(marker => name.includes(marker));
}

function stripPrefixes(text: string): string {
  let rest = text.trim();
  for (let i = 0; i < 4; i += 1) {
    const f = fold(rest);
    const hit = LEGAL_PREFIXES.find(prefix => f === prefix || f.startsWith(`${prefix} `));
    if (!hit) break;
    rest = rest.slice(hit.length).trim().replace(/^[ ,.-]+|[ ,.-]+$/g, '');
  }
  return rest;
}

export function deriveShortName(company: string | null | undefined): string {
  const original = (company || '').trim().replace(/\s+/g, ' ');
  if (!original) return '';
  const paren = original.match(/\(([A-ZĐ0-9]{2,8})\)/);
  if (paren) return paren[1];

  let text = original;
  for (const sep of SEPARATORS) {
    if (text.includes(sep)) {
      const left = text.split(sep)[0].trim();
      if (left.length >= 6) text = left;
    }
  }
  let stripped = stripPrefixes(text) || text;
  const hadPrefix = stripped !== text;
  const f = fold(stripped);
  for (const suffix of ['VIET NAM', 'VIETNAM']) {
    if (f.endsWith(` ${suffix}`) && stripped.length > suffix.length + 2) stripped = stripped.slice(0, -suffix.length).trim().replace(/[ ,.-]+$/g, '') || stripped;
  }
  let candidate = stripped;
  if (hadPrefix) {   // chi bo tu mo ta nganh khi co loai hinh o dau (khong cat nham ten rieng nhu "Cao Son")
    const words = stripped.split(' ');
    let start = 0;
    while (start < words.length - 1 && GENERIC_WORDS.has(fold(words[start]))) start += 1;
    candidate = words.slice(start).join(' ') || stripped;
  }
  if (candidate.length <= MAX_SHORT_LEN) return candidate;
  const caps = candidate.split(' ').filter(word => /^[A-ZĐ0-9&.-]{2,8}$/.test(word) && !GENERIC_WORDS.has(fold(word)));
  return caps.length ? caps[caps.length - 1] : candidate;
}

/** Ten hien thi cua khach hang: ten viet tat uu tien; ten day du (cong ty/phap ly) la dong phu/tooltip. KHONG dung cho bao gia/PDF/hop dong. */
export function customerDisplay(c: { shortName?: string | null; companyName?: string | null; customerName?: string | null }): { title: string; full: string; sub: string } {
  const full = (c.companyName || c.customerName || '').trim();
  const title = (c.shortName || '').trim() || full || 'Khách hàng chưa tên';
  return { title, full, sub: title !== full ? full : '' };
}
