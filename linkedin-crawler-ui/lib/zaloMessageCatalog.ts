/**
 * Danh mục chuẩn hóa đầy đủ cho toàn bộ loại tin nhắn, hành động, sự kiện nhóm/bạn bè,
 * mã BIN ngân hàng Việt Nam và nhãn xem trước tiếng Việt của Zalo PC (v26.11.12).
 *
 * Trích xuất trực tiếp từ `app.asar` (module `1pet`, `lang-vi`, `GroupEventRenderer`,
 * `SidebarPreview`, `getPlainText`, `getPreviewMsgInfoChat`, `r6Qt`) + `zca-js`.
 */

import {
  formatZaloSidebarPreview,
  isSendBubblePlaceholder,
  parseZaloCallMessage,
  type ZaloCallParseInput,
} from "./zaloCallMessage";

export interface VietnamBankInfo {
  bin: string;
  code: string;
  shortName: string;
  fullName: string;
  aliases: readonly string[];
}

/** Toàn bộ 57 mã BIN ngân hàng Việt Nam trích từ `zca-js` `BinBankCard`. */
export const VIETNAM_BANK_BINS: readonly VietnamBankInfo[] = [
  { bin: "970436", code: "VCB", shortName: "Vietcombank", fullName: "Ngân hàng TMCP Ngoại thương Việt Nam", aliases: ["vcb", "vietcombank", "ngoai thuong"] },
  { bin: "970415", code: "CTG", shortName: "VietinBank", fullName: "Ngân hàng TMCP Công thương Việt Nam", aliases: ["vietinbank", "vietin", "ctg", "cong thuong"] },
  { bin: "970418", code: "BIDV", shortName: "BIDV", fullName: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", aliases: ["bidv", "dau tu va phat trien"] },
  { bin: "970405", code: "AGRIBANK", shortName: "Agribank", fullName: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", aliases: ["agribank", "agri", "nong nghiep"] },
  { bin: "970407", code: "TCB", shortName: "Techcombank", fullName: "Ngân hàng TMCP Kỹ thương Việt Nam", aliases: ["tcb", "techcombank", "techcom", "ky thuong"] },
  { bin: "970422", code: "MB", shortName: "MB Bank", fullName: "Ngân hàng TMCP Quân đội", aliases: ["mb", "mbbank", "mb bank", "quan doi"] },
  { bin: "970416", code: "ACB", shortName: "ACB", fullName: "Ngân hàng TMCP Á Châu", aliases: ["acb", "a chau"] },
  { bin: "970432", code: "VPB", shortName: "VPBank", fullName: "Ngân hàng TMCP Việt Nam Thịnh Vượng", aliases: ["vpbank", "vp bank", "vpb"] },
  { bin: "970423", code: "TPB", shortName: "TPBank", fullName: "Ngân hàng TMCP Tiên Phong", aliases: ["tpbank", "tp bank", "tpb", "tien phong"] },
  { bin: "970403", code: "STB", shortName: "Sacombank", fullName: "Ngân hàng TMCP Sài Gòn Thương Tín", aliases: ["sacombank", "sacom", "stb"] },
  { bin: "970437", code: "HDB", shortName: "HDBank", fullName: "Ngân hàng TMCP Phát triển TP.HCM", aliases: ["hdbank", "hd bank", "hdb"] },
  { bin: "970441", code: "VIB", shortName: "VIB", fullName: "Ngân hàng TMCP Quốc tế Việt Nam", aliases: ["vib"] },
  { bin: "970443", code: "SHB", shortName: "SHB", fullName: "Ngân hàng TMCP Sài Gòn - Hà Nội", aliases: ["shb"] },
  { bin: "970448", code: "OCB", shortName: "OCB", fullName: "Ngân hàng TMCP Phương Đông", aliases: ["ocb", "phuong dong"] },
  { bin: "970426", code: "MSB", shortName: "MSB", fullName: "Ngân hàng TMCP Hàng Hải Việt Nam", aliases: ["msb", "maritime bank", "hang hai"] },
  { bin: "970449", code: "LPB", shortName: "LPBank", fullName: "Ngân hàng TMCP Lộc Phát Việt Nam", aliases: ["lpbank", "lien viet", "lienvietpostbank", "lpb"] },
  { bin: "970431", code: "EIB", shortName: "Eximbank", fullName: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam", aliases: ["eximbank", "exim", "eib"] },
  { bin: "970440", code: "SEAB", shortName: "SeABank", fullName: "Ngân hàng TMCP Đông Nam Á", aliases: ["seabank", "sea bank", "seab"] },
  { bin: "970428", code: "NAB", shortName: "Nam A Bank", fullName: "Ngân hàng TMCP Nam Á", aliases: ["namabank", "nam a bank", "nam a", "nab"] },
  { bin: "970409", code: "BAB", shortName: "Bac A Bank", fullName: "Ngân hàng TMCP Bắc Á", aliases: ["bacabank", "bac a bank", "bac a"] },
  { bin: "970412", code: "PVCB", shortName: "PVcomBank", fullName: "Ngân hàng TMCP Đại Chúng Việt Nam", aliases: ["pvcombank", "pvcom", "pvcb"] },
  { bin: "970425", code: "ABB", shortName: "ABBank", fullName: "Ngân hàng TMCP An Bình", aliases: ["abbank", "an binh"] },
  { bin: "970419", code: "NCB", shortName: "NCB", fullName: "Ngân hàng TMCP Quốc Dân", aliases: ["ncb", "quoc dan"] },
  { bin: "970454", code: "BVB", shortName: "BVBank", fullName: "Ngân hàng TMCP Bản Việt (VietCapital)", aliases: ["bvbank", "ban viet", "vietcapital", "viet capital"] },
  { bin: "970452", code: "KLB", shortName: "KienlongBank", fullName: "Ngân hàng TMCP Kiên Long", aliases: ["kienlongbank", "kien long", "klb"] },
  { bin: "970438", code: "BVBANK", shortName: "BaoViet Bank", fullName: "Ngân hàng TMCP Bảo Việt", aliases: ["baovietbank", "bao viet bank", "baoviet"] },
  { bin: "970433", code: "VIETBANK", shortName: "VietBank", fullName: "Ngân hàng TMCP Việt Nam Thương Tín", aliases: ["vietbank", "viet bank"] },
  { bin: "970427", code: "VAB", shortName: "VietABank", fullName: "Ngân hàng TMCP Việt Á", aliases: ["vietabank", "viet a bank", "viet a"] },
  { bin: "970430", code: "PGB", shortName: "PGBank", fullName: "Ngân hàng TMCP Thịnh vượng và Phát triển", aliases: ["pgbank", "pg bank"] },
  { bin: "970414", code: "OCEANBANK", shortName: "OceanBank", fullName: "Ngân hàng Thương mại TNHH MTV Đại Dương", aliases: ["oceanbank", "ocean bank", "mbv"] },
  { bin: "970444", code: "CBBANK", shortName: "CBBank", fullName: "Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam", aliases: ["cbbank", "cb bank", "vcbneo"] },
  { bin: "970408", code: "GPBANK", shortName: "GPBank", fullName: "Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu", aliases: ["gpbank", "gp bank"] },
  { bin: "970406", code: "DAB", shortName: "DongA Bank", fullName: "Ngân hàng TMCP Đông Á", aliases: ["dongabank", "dong a bank", "dong a", "vikki"] },
  { bin: "970400", code: "SGB", shortName: "SaigonBank", fullName: "Ngân hàng TMCP Sài Gòn Công Thương", aliases: ["saigonbank", "saigon bank"] },
  { bin: "970429", code: "SCB", shortName: "SCB", fullName: "Ngân hàng TMCP Sài Gòn", aliases: ["scb"] },
  { bin: "970446", code: "COOPBANK", shortName: "Co-opBank", fullName: "Ngân hàng Hợp tác xã Việt Nam", aliases: ["coopbank", "co-opbank", "coop bank"] },
  { bin: "970421", code: "VRB", shortName: "VRB", fullName: "Ngân hàng Liên doanh Việt - Nga", aliases: ["vrb", "viet nga"] },
  { bin: "970434", code: "IVB", shortName: "Indovina Bank", fullName: "Ngân hàng TNHH Indovina", aliases: ["indovina", "ivb"] },
  { bin: "970439", code: "PBVN", shortName: "Public Bank", fullName: "Ngân hàng TNHH MTV Public Việt Nam", aliases: ["public bank", "pbvn"] },
  { bin: "970442", code: "HLBVN", shortName: "Hong Leong Bank", fullName: "Ngân hàng TNHH MTV Hong Leong Việt Nam", aliases: ["hong leong", "hlb"] },
  { bin: "970424", code: "SHBVN", shortName: "Shinhan Bank", fullName: "Ngân hàng TNHH MTV Shinhan Việt Nam", aliases: ["shinhan", "shinhan bank"] },
  { bin: "970457", code: "WVN", shortName: "Woori Bank", fullName: "Ngân hàng TNHH MTV Woori Việt Nam", aliases: ["woori", "woori bank"] },
  { bin: "458761", code: "HSBC", shortName: "HSBC", fullName: "Ngân hàng TNHH MTV HSBC Việt Nam", aliases: ["hsbc"] },
  { bin: "970410", code: "SCVN", shortName: "Standard Chartered", fullName: "Ngân hàng TNHH MTV Standard Chartered Việt Nam", aliases: ["standard chartered"] },
  { bin: "970458", code: "UOB", shortName: "UOB", fullName: "Ngân hàng TNHH MTV United Overseas Bank Việt Nam", aliases: ["uob"] },
  { bin: "796500", code: "DBS", shortName: "DBS Bank", fullName: "Ngân hàng DBS - Chi nhánh TP.HCM", aliases: ["dbs", "dbs bank"] },
  { bin: "422589", code: "CIMB", shortName: "CIMB Bank", fullName: "Ngân hàng TNHH MTV CIMB Việt Nam", aliases: ["cimb"] },
  { bin: "668888", code: "KBANK", shortName: "KBank", fullName: "Ngân hàng Đại chúng TNHH Kasikornbank", aliases: ["kbank", "kasikorn"] },
  { bin: "970455", code: "IBK_HN", shortName: "IBK Hà Nội", fullName: "Ngân hàng Công nghiệp Hàn Quốc - CN Hà Nội", aliases: ["ibk ha noi", "ibk hn"] },
  { bin: "970456", code: "IBK_HCM", shortName: "IBK TP.HCM", fullName: "Ngân hàng Công nghiệp Hàn Quốc - CN TP.HCM", aliases: ["ibk hcm", "ibk"] },
  { bin: "970462", code: "KB_HN", shortName: "Kookmin Hà Nội", fullName: "Ngân hàng Kookmin - CN Hà Nội", aliases: ["kookmin ha noi", "kookmin hn"] },
  { bin: "970463", code: "KB_HCM", shortName: "Kookmin TP.HCM", fullName: "Ngân hàng Kookmin - CN TP.HCM", aliases: ["kookmin hcm", "kookmin"] },
  { bin: "801011", code: "NHB", shortName: "NongHyup Bank", fullName: "Ngân hàng NongHyup - CN Hà Nội", aliases: ["nonghyup"] },
  { bin: "546034", code: "CAKE", shortName: "CAKE by VPBank", fullName: "Ngân hàng số CAKE by VPBank", aliases: ["cake", "cake by vpbank"] },
  { bin: "546035", code: "UBANK", shortName: "Ubank by VPBank", fullName: "Ngân hàng số Ubank by VPBank", aliases: ["ubank"] },
  { bin: "963388", code: "TIMO", shortName: "Timo", fullName: "Ngân hàng số Timo by Bản Việt", aliases: ["timo"] },
  { bin: "9704261", code: "TNEX", shortName: "TNEX", fullName: "Ngân hàng số TNEX by MSB", aliases: ["tnex"] },
] as const;

const BANK_BY_BIN = new Map<string, VietnamBankInfo>();
for (const bank of VIETNAM_BANK_BINS) {
  BANK_BY_BIN.set(bank.bin, bank);
}

/** Bỏ dấu tiếng Việt và đưa về chữ thường để đối chiếu từ khóa chính xác. */
function foldVietnamese(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

export function lookupVietnamBankByBin(bin?: string | number | null): VietnamBankInfo | null {
  if (bin === null || bin === undefined) return null;
  const cleaned = String(bin).replace(/\D/g, "");
  if (!cleaned) return null;
  return BANK_BY_BIN.get(cleaned) || null;
}

/** Sắp xếp alias dài trước để "vpbank" khớp trước "vpb", "mb bank" trước "mb". */
const BANK_ALIAS_ENTRIES: Array<{ alias: string; regex: RegExp; bank: VietnamBankInfo }> = [];
for (const bank of VIETNAM_BANK_BINS) {
  for (const alias of bank.aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    BANK_ALIAS_ENTRIES.push({
      alias,
      regex: new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i"),
      bank,
    });
  }
}
BANK_ALIAS_ENTRIES.sort((a, b) => b.alias.length - a.alias.length);

export function lookupVietnamBankByKeyword(text?: string | null): VietnamBankInfo | null {
  if (!text) return null;
  const folded = foldVietnamese(text);
  for (const entry of BANK_ALIAS_ENTRIES) {
    if (entry.regex.test(folded)) {
      return entry.bank;
    }
  }
  return null;
}

/** Toàn bộ 31 nhãn bracket `[...]` native của Zalo PC + `[Thẻ ngân hàng]`. */
export const ZALO_SIDEBAR_BRACKET_LABELS: Readonly<Record<string, string>> = {
  STR_ALBUM_MSG: "[Album]",
  STR_ARTICLE_MSG: "[Bài viết]",
  STR_CARD_MSG: "[Thiệp]",
  STR_CONTACT_MSG: "[Danh thiếp]",
  STR_DEL_MSG: "[Tin nhắn đã xóa]",
  STR_DOODLE_MSG: "[Vẽ hình]",
  STR_FILE_MSG: "[File]",
  STR_FOLDER_MSG: "[Thư mục]",
  STR_GIF: "[GIF]",
  STR_IMPORTANT_PREFIX: "[Quan trọng]",
  STR_INCALL_MSG: "[Cuộc gọi đến]",
  STR_LINK_MSG: "[Link]",
  STR_LOC_MSG: "[Vị trí]",
  STR_MISS_CALL_MSG: "[Cuộc gọi nhỡ]",
  STR_MSG_MEDIA: "[Tin nhắn Media]",
  STR_MSG_NOT_SUPPORTED: "[Tin nhắn chưa hỗ trợ ở phiên bản hiện tại]",
  STR_NO_RECENT_MESSAGES: "[Không có tin nhắn gần đây]",
  STR_OUTCALL_MSG: "[Cuộc gọi đi]",
  STR_PHOTO_MSG: "[Hình ảnh]",
  STR_POLL_MSG: "[Bình chọn]",
  STR_PREVIEW_SYNC_FAILED_W_BRACKET: "[Tin nhắn chưa đồng bộ]",
  STR_PREVIEW_SYNCING_OUT_OF_RANGE_W_BRACKET: "[Không có tin nhắn gần đây]",
  STR_PREVIEW_SYNCING_W_BRACKET: "[Tin nhắn đang đồng bộ]",
  STR_RECALL_MSG_2: "[Tin nhắn đã thu hồi]",
  STR_REPLY_MSG_BRACKET: "[Trả lời]",
  STR_STICKER: "[Sticker]",
  STR_STICKERSET_MSG: "[Bộ sticker]",
  STR_URGENT_PREFIX: "[Khẩn cấp]",
  STR_VANISH_MSG: "[Tin nhắn đã tự xóa]",
  STR_VIDEO_MSG: "[Video]",
  STR_VOICE_MSG: "[Tin nhắn thoại]",
  ZINSTANT_BANKCARD: "[Thẻ ngân hàng]",
};

/** Toàn bộ 28 wire `msgType` chuẩn từ Zalo PC `_normalizeMessageType` + `module 1pet`. */
export const ZALO_MSG_TYPE_LABELS: Readonly<
  Record<string, { labelVi: string; bracketVi: string; category: string }>
> = {
  webchat: { labelVi: "Tin nhắn văn bản", bracketVi: "", category: "text" },
  "chat.photo": { labelVi: "Hình ảnh", bracketVi: "[Hình ảnh]", category: "image" },
  "chat.gif": { labelVi: "GIF", bracketVi: "[GIF]", category: "gif" },
  "chat.video.msg": { labelVi: "Video", bracketVi: "[Video]", category: "video" },
  "chat.voice": { labelVi: "Tin nhắn thoại", bracketVi: "[Tin nhắn thoại]", category: "voice" },
  "share.file": { labelVi: "File", bracketVi: "[File]", category: "file" },
  "chat.sticker": { labelVi: "Sticker", bracketVi: "[Sticker]", category: "sticker" },
  "chat.doodle": { labelVi: "Vẽ hình", bracketVi: "[Vẽ hình]", category: "doodle" },
  "chat.location.new": { labelVi: "Vị trí", bracketVi: "[Vị trí]", category: "location" },
  "chat.recommended": { labelVi: "Thẻ nội dung", bracketVi: "[Liên kết]", category: "recommended" },
  "chat.link": { labelVi: "Link", bracketVi: "[Link]", category: "link" },
  "chat.ecard": { labelVi: "Thiệp", bracketVi: "[Thiệp]", category: "ecard" },
  "chat.webcontent": { labelVi: "Thẻ ZInstant", bracketVi: "[Thẻ ngân hàng]", category: "bankcard" },
  "chat.webcontent.v2": { labelVi: "Thẻ ZInstant v2", bracketVi: "[Thẻ ngân hàng]", category: "bankcard" },
  "chat.undo": { labelVi: "Tin nhắn đã được thu hồi", bracketVi: "[Tin nhắn đã thu hồi]", category: "undo" },
  "chat.delete": { labelVi: "Tin nhắn đã xóa", bracketVi: "[Tin nhắn đã xóa]", category: "undo" },
  "chat.delete.everyone": { labelVi: "Tin nhắn đã bị xóa", bracketVi: "[Tin nhắn đã xóa]", category: "undo" },
  "chat.vanish": { labelVi: "Tin nhắn đã tự xóa", bracketVi: "[Tin nhắn đã tự xóa]", category: "system_notice" },
  "chat.list.action": { labelVi: "Thẻ OA", bracketVi: "[Bài viết]", category: "link" },
  "group.poll": { labelVi: "Bình chọn", bracketVi: "[Bình chọn]", category: "poll" },
  "chat.todo": { labelVi: "Công việc", bracketVi: "[Công việc]", category: "todo" },
  "chat.reaction": { labelVi: "Cảm xúc", bracketVi: "", category: "reaction" },
  "chat.zalo.me": { labelVi: "Trang cá nhân Zalo", bracketVi: "[Link]", category: "link" },
  "chat.e2ee.replace": { labelVi: "Tin nhắn mã hóa đầu cuối", bracketVi: "[Đang chờ tin nhắn]", category: "system_notice" },
  "group.leave": { labelVi: "Đã rời khỏi nhóm", bracketVi: "Đã rời khỏi nhóm", category: "system_notice" },
  "group.event": { labelVi: "Thông báo nhóm", bracketVi: "[Thông báo nhóm]", category: "system_notice" },
  group: { labelVi: "Danh thiếp", bracketVi: "[Danh thiếp]", category: "contact" },
  "chat._jumpToMessage": { labelVi: "Chuyển tới tin nhắn", bracketVi: "", category: "internal" },
};

/** Toàn bộ 22 chuỗi `action` trong `content.action` (Zalo PC + mobile/protocol). */
export const ZALO_ACTION_LABELS: Readonly<
  Record<string, { labelVi: string; bracketVi: string; parentMsgType: string }>
> = {
  "recommened.link": { labelVi: "Liên kết", bracketVi: "[Link]", parentMsgType: "chat.recommended" },
  "recommened.user": { labelVi: "Danh thiếp", bracketVi: "[Danh thiếp]", parentMsgType: "chat.recommended" },
  "recommened.vip": { labelVi: "Danh thiếp OA", bracketVi: "[Danh thiếp]", parentMsgType: "chat.recommended" },
  "recommend.gif": { labelVi: "GIF", bracketVi: "[GIF]", parentMsgType: "chat.gif" },
  "recommened.stickerset": { labelVi: "Bộ sticker", bracketVi: "[Bộ sticker]", parentMsgType: "chat.recommended" },
  "recommened.calling": { labelVi: "Cuộc gọi đi", bracketVi: "[Cuộc gọi đi]", parentMsgType: "chat.recommended" },
  "recommened.receivecall": { labelVi: "Cuộc gọi đến", bracketVi: "[Cuộc gọi đến]", parentMsgType: "chat.recommended" },
  "recommened.calltime": { labelVi: "Cuộc gọi", bracketVi: "[Cuộc gọi]", parentMsgType: "chat.recommended" },
  "recommened.misscall": { labelVi: "Cuộc gọi nhỡ", bracketVi: "[Cuộc gọi nhỡ]", parentMsgType: "chat.recommended" },
  "msginfo.actionlist": { labelVi: "Thông báo hệ thống", bracketVi: "[Thông báo]", parentMsgType: "webchat" },
  rtf: { labelVi: "Văn bản định dạng", bracketVi: "", parentMsgType: "webchat" },
  "show.profile": { labelVi: "Hồ sơ / Lời chào kết bạn", bracketVi: "[Thiệp]", parentMsgType: "chat.ecard" },
  "todo.remind": { labelVi: "Nhắc nhở công việc", bracketVi: "[Công việc]", parentMsgType: "chat.todo" },
  "todo.remind2": { labelVi: "Tổng hợp công việc", bracketVi: "[Công việc]", parentMsgType: "chat.todo" },
  "recommened.friend": { labelVi: "Gợi ý kết bạn", bracketVi: "[Gợi ý kết bạn]", parentMsgType: "chat.recommended" },
  "recommened.oa": { labelVi: "Tài khoản OA", bracketVi: "[Danh thiếp OA]", parentMsgType: "chat.recommended" },
  "recommened.miniapp": { labelVi: "Mini App", bracketVi: "[Mini App]", parentMsgType: "chat.recommended" },
  "recommened.minisite": { labelVi: "Trang web", bracketVi: "[Link]", parentMsgType: "chat.recommended" },
  "recommened.article": { labelVi: "Bài viết", bracketVi: "[Bài viết]", parentMsgType: "chat.recommended" },
  "recommened.post": { labelVi: "Bài đăng", bracketVi: "[Bài đăng]", parentMsgType: "chat.recommended" },
  "recommened.location": { labelVi: "Vị trí", bracketVi: "[Vị trí]", parentMsgType: "chat.recommended" },
  "recommened.zvideo": { labelVi: "Zalo Video", bracketVi: "[Video]", parentMsgType: "chat.recommended" },
};

export type ZaloSystemEventIconKind =
  | "friend_request"
  | "friend_accept"
  | "friend_remove"
  | "friend_block"
  | "stranger"
  | "ecard"
  | "birthday"
  | "group_join"
  | "group_leave"
  | "group_remove"
  | "group_admin"
  | "group_rename"
  | "group_avatar"
  | "group_link"
  | "group_setting"
  | "group_disband"
  | "pin"
  | "unpin"
  | "poll"
  | "reminder"
  | "todo"
  | "note"
  | "vanish"
  | "e2ee"
  | "recall"
  | "info";

export interface FormattedZaloGroupEvent {
  act: string;
  title: string;
  subtitle?: string;
  iconKind: ZaloSystemEventIconKind;
}

export interface FormattedZaloFriendEvent {
  act: string;
  title: string;
  subtitle?: string;
  iconKind: ZaloSystemEventIconKind;
  ecardType?: number;
  thumb?: string;
  bannerUrl?: string;
}

/** Toàn bộ 25 nhóm sự kiện nhóm & hệ thống (40+ `act` code native của Zalo PC). */
export const ZALO_GROUP_EVENT_TEMPLATES: Readonly<
  Record<string, { vi: string; iconKind: ZaloSystemEventIconKind; description: string }>
> = {
  join: { vi: "đã tham gia nhóm", iconKind: "group_join", description: "Thành viên tham gia / được thêm vào nhóm" },
  join_group: { vi: "đã tham gia nhóm", iconKind: "group_join", description: "Thành viên tham gia nhóm" },
  leave: { vi: "đã rời khỏi nhóm", iconKind: "group_leave", description: "Thành viên rời khỏi nhóm" },
  "group.leave": { vi: "đã rời khỏi nhóm", iconKind: "group_leave", description: "Thành viên rời khỏi nhóm" },
  remove_member: { vi: "đã bị xóa khỏi nhóm", iconKind: "group_remove", description: "Quản trị viên xóa thành viên" },
  kick_group: { vi: "Bạn đã được xoá khỏi nhóm", iconKind: "group_remove", description: "Bị xóa khỏi nhóm" },
  block_member: { vi: "đã bị chặn khỏi nhóm này", iconKind: "group_remove", description: "Thành viên bị chặn khỏi nhóm" },
  disband_group: { vi: "Trưởng nhóm đã giải tán nhóm", iconKind: "group_disband", description: "Giải tán nhóm" },
  update: { vi: "đã đổi tên nhóm", iconKind: "group_rename", description: "Đổi tên / thông tin nhóm" },
  update_avatar: { vi: "đã đổi ảnh đại diện nhóm", iconKind: "group_avatar", description: "Đổi ảnh đại diện nhóm" },
  add_admin: { vi: "đã được bổ nhiệm thành phó nhóm", iconKind: "group_admin", description: "Bổ nhiệm phó nhóm" },
  remove_admin: { vi: "đã không còn là phó nhóm", iconKind: "group_admin", description: "Gỡ quyền phó nhóm" },
  change_owner: { vi: "trở thành trưởng nhóm", iconKind: "group_admin", description: "Chuyển quyền trưởng nhóm" },
  new_link: { vi: "Link mời tham gia nhóm đã được cập nhật", iconKind: "group_link", description: "Tạo link mời nhóm mới" },
  join_request: { vi: "cần được phê duyệt bởi trưởng/phó nhóm để tham gia", iconKind: "group_join", description: "Yêu cầu tham gia nhóm" },
  request_join: { vi: "cần được phê duyệt bởi trưởng/phó nhóm để tham gia", iconKind: "group_join", description: "Yêu cầu tham gia nhóm" },
  request_join_existed: { vi: "đang chờ phê duyệt tham gia nhóm", iconKind: "group_join", description: "Yêu cầu tham gia đang chờ" },
  join_accept: { vi: "đã được phê duyệt tham gia nhóm", iconKind: "group_join", description: "Duyệt yêu cầu tham gia" },
  join_reject: { vi: "đã bị từ chối yêu cầu tham gia nhóm", iconKind: "group_remove", description: "Từ chối yêu cầu tham gia" },
  update_setting: { vi: "đã cập nhật cài đặt nhóm", iconKind: "group_setting", description: "Thay đổi cài đặt nhóm" },
  group_type: { vi: "Nhóm đã được nâng cấp lên cộng đồng", iconKind: "group_setting", description: "Nâng cấp lên cộng đồng" },
  update_board: { vi: "đã cập nhật bảng tin nhóm", iconKind: "note", description: "Cập nhật ghi chú/nhắc hẹn/ghim" },
  update_topic: { vi: "đã cập nhật thông báo nhóm", iconKind: "pin", description: "Cập nhật thông báo nhóm" },
  new_pin_topic: { vi: "đã ghim một tin nhắn thành thông báo nhóm", iconKind: "pin", description: "Ghim tin nhắn" },
  update_pin_topic: { vi: "đã cập nhật tin nhắn đã ghim", iconKind: "pin", description: "Cập nhật tin ghim" },
  reorder_pin_topic: { vi: "đã sắp xếp lại tin nhắn ghim", iconKind: "pin", description: "Sắp xếp lại tin ghim" },
  pin_message: { vi: "đã ghim một tin nhắn thành thông báo nhóm", iconKind: "pin", description: "Ghim tin nhắn" },
  pin_notice: { vi: "đã ghim thông báo nhóm", iconKind: "pin", description: "Ghim ghi chú/bình chọn/nhắc hẹn" },
  remove_topic: { vi: "đã bỏ ghim một tin nhắn", iconKind: "unpin", description: "Bỏ ghim tin nhắn/chủ đề" },
  unpin_topic: { vi: "đã bỏ ghim một tin nhắn", iconKind: "unpin", description: "Bỏ ghim tin nhắn" },
  remove_board: { vi: "đã xóa ghi chú/nhắc hẹn", iconKind: "note", description: "Xóa mục trên bảng tin nhóm" },
  remind_topic: { vi: "Nhắc hẹn nhóm", iconKind: "reminder", description: "Thông báo đến giờ nhắc hẹn" },
  accept_remind: { vi: "đã xác nhận tham gia nhắc hẹn", iconKind: "reminder", description: "Đồng ý nhắc hẹn" },
  reject_remind: { vi: "đã từ chối nhắc hẹn", iconKind: "reminder", description: "Từ chối nhắc hẹn" },
  create_reminder11: { vi: "đã tạo nhắc hẹn mới", iconKind: "reminder", description: "Tạo nhắc hẹn 1-1" },
  update_reminder11: { vi: "đã sửa nhắc hẹn", iconKind: "reminder", description: "Sửa nhắc hẹn 1-1" },
  remind_reminder11: { vi: "Nhắc hẹn", iconKind: "reminder", description: "Đến giờ nhắc hẹn 1-1" },
  remove_reminder11: { vi: "đã xóa nhắc hẹn", iconKind: "reminder", description: "Xóa nhắc hẹn 1-1" },
  update_ttl: { vi: "đã thay đổi cài đặt tin nhắn tự xóa", iconKind: "vanish", description: "Cập nhật tin nhắn tự xóa" },
  update_block_sharing: { vi: "đã thay đổi cài đặt chặn chia sẻ", iconKind: "group_setting", description: "Cập nhật chặn chia sẻ" },
  update_e2ee: { vi: "đã cập nhật trạng thái mã hóa đầu cuối", iconKind: "e2ee", description: "Cập nhật E2EE" },
  send_to_block: { vi: "Không thể gửi tin nhắn vì người này đã chặn bạn", iconKind: "friend_block", description: "Gửi tin tới người đã chặn" },
  add_member_summary: { vi: "đã cập nhật danh sách thành viên nhóm", iconKind: "group_join", description: "Tổng hợp thêm thành viên" },
  create_group_summary: { vi: "Nhóm mới đã được tạo", iconKind: "group_join", description: "Tổng hợp tạo nhóm mới" },
  "todo.remind2": { vi: "Nhắc nhở công việc Zalo To-Do", iconKind: "todo", description: "Tổng hợp công việc đến/quá hạn" },
  "group.poll": { vi: "Bình chọn trong nhóm", iconKind: "poll", description: "Tạo / tham gia / đóng bình chọn" },
  remove_multi: { vi: "đã xóa nhiều thành viên khỏi nhóm", iconKind: "group_remove", description: "Xóa nhiều thành viên" },
  invite_multi: { vi: "đã mời nhiều thành viên vào nhóm", iconKind: "group_join", description: "Mời nhiều thành viên" },
};

/** Toàn bộ 13 nhóm sự kiện bạn bè, eCard & cảnh báo người lạ. */
export const ZALO_FRIEND_EVENT_TEMPLATES: Readonly<
  Record<string, { vi: string; iconKind: ZaloSystemEventIconKind; description: string }>
> = {
  add: { vi: "Hai bạn đã trở thành bạn bè", iconKind: "friend_accept", description: "Đã đồng ý kết bạn" },
  req_v2: { vi: "Đã gửi lời mời kết bạn", iconKind: "friend_request", description: "Gửi/nhận lời mời kết bạn" },
  req: { vi: "Đã gửi lời mời kết bạn", iconKind: "friend_request", description: "Lời mời kết bạn (legacy)" },
  sent_request: { vi: "Đã gửi lời mời kết bạn", iconKind: "friend_request", description: "Thẻ đã gửi lời mời kết bạn" },
  undo_req: { vi: "Đã thu hồi lời mời kết bạn", iconKind: "friend_remove", description: "Thu hồi lời mời kết bạn" },
  reject: { vi: "Đã từ chối lời mời kết bạn", iconKind: "friend_remove", description: "Từ chối kết bạn" },
  seen_fr_req: { vi: "Đã xem lời mời kết bạn", iconKind: "info", description: "Đã xem lời mời kết bạn" },
  remove: { vi: "Đã hủy kết bạn", iconKind: "friend_remove", description: "Xóa bạn bè" },
  block: { vi: "Đã chặn tin nhắn từ người này", iconKind: "friend_block", description: "Chặn người dùng" },
  unblock: { vi: "Đã bỏ chặn người này", iconKind: "friend_accept", description: "Bỏ chặn người dùng" },
  block_call: { vi: "Đã chặn cuộc gọi từ người này", iconKind: "friend_block", description: "Chặn cuộc gọi" },
  unblock_call: { vi: "Đã bỏ chặn cuộc gọi từ người này", iconKind: "friend_accept", description: "Bỏ chặn cuộc gọi" },
  pin_create: { vi: "Đã ghim một tin nhắn", iconKind: "pin", description: "Ghim tin nhắn 1-1" },
  pin_unpin: { vi: "Đã bỏ ghim một tin nhắn", iconKind: "unpin", description: "Bỏ ghim tin nhắn 1-1" },
  "show.profile": { vi: "Đã đồng ý kết bạn", iconKind: "friend_accept", description: "Thiệp chào bạn mới" },
  ecard_birthday: { vi: "Chúc mừng sinh nhật", iconKind: "birthday", description: "Thiệp chúc mừng sinh nhật (ECARD_TYPE=1)" },
  ecard_friend_accept: { vi: "Hai bạn đã trở thành bạn bè", iconKind: "friend_accept", description: "Thiệp kết bạn thành công (ECARD_TYPE=2/3)" },
  ecard_group_join: { vi: "Chào mừng tham gia nhóm", iconKind: "group_join", description: "Thiệp chào mừng vào nhóm (ECARD_TYPE=6)" },
  ecard_generic: { vi: "Thiệp chúc mừng", iconKind: "ecard", description: "Thiệp Zalo (ECARD_TYPE=0/4/5)" },
  stranger_warning: { vi: "Người này chưa là bạn. Lưu ý rủi ro lừa đảo từ người lạ.", iconKind: "stranger", description: "Cảnh báo người lạ" },
};

type RawRecord = Record<string, unknown>;

function safeParseJsonObject(value: unknown): RawRecord | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as RawRecord;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as RawRecord;
        }
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
          return parsed[0] as RawRecord;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cleanStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrapRawObject(raw: unknown): {
  root: RawRecord | null;
  data: RawRecord | null;
  content: RawRecord | null;
} {
  const root = safeParseJsonObject(raw);
  if (!root) return { root: null, data: null, content: null };
  const data = safeParseJsonObject(root.data) || root;
  const contentFromData = safeParseJsonObject(data.content);
  const content = contentFromData || (data !== root ? data : root);
  return { root, data, content };
}

function extractMemberNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      names.push(item.trim());
    } else if (item && typeof item === "object") {
      const rec = item as RawRecord;
      const n = cleanStr(rec.dName) || cleanStr(rec.displayName) || cleanStr(rec.name) || cleanStr(rec.dpn);
      if (n) names.push(n);
    }
  }
  return names;
}

function joinMemberNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} và ${names.length - 2} người khác`;
}

/**
 * Giải mã payload `webchat` có `action === "msginfo.actionlist"` (`MSG_INFO_CHAT = -1909`).
 * Đọc `params.msg.vi` (hoặc `en`) và thay thế các placeholder `%1$s`, `%2$s`, ... từ `highLightsV2`.
 */
export function formatMsgInfoActionList(rawContentOrParams: unknown): string | null {
  const { data, content } = unwrapRawObject(rawContentOrParams);
  if (!content) return null;

  const action = cleanStr(content.action || data?.action).toLowerCase();
  const paramsObj = safeParseJsonObject(content.params) || (content.msg ? content : null);

  // Chỉ giải mã nếu là msginfo.actionlist HOẶC params có đúng khuôn msg.{vi,en} + highLightsV2
  const hasMsgTemplate =
    paramsObj &&
    paramsObj.msg &&
    typeof paramsObj.msg === "object" &&
    !Array.isArray(paramsObj.msg);

  if (action && action !== "msginfo.actionlist" && !hasMsgTemplate) {
    return null;
  }

  if (hasMsgTemplate) {
    const msgObj = paramsObj.msg as RawRecord;
    let template = cleanStr(msgObj.vi) || cleanStr(msgObj.en);
    if (template) {
      const highlights = Array.isArray(paramsObj.highLightsV2)
        ? paramsObj.highLightsV2
        : Array.isArray(paramsObj.highLights)
          ? paramsObj.highLights
          : [];
      const fallbackActor =
        cleanStr(paramsObj.dName) || cleanStr(data?.dName) || cleanStr(content.dName) || "";

      for (let i = 0; i < highlights.length; i += 1) {
        const hl = highlights[i];
        let replacement = "";
        if (typeof hl === "string") {
          replacement = hl.trim();
        } else if (hl && typeof hl === "object") {
          const rec = hl as RawRecord;
          replacement =
            cleanStr(rec.dpn) ||
            cleanStr(rec.dName) ||
            cleanStr(rec.displayName) ||
            cleanStr(rec.name) ||
            cleanStr(rec.title);
        }
        const token = `%${i + 1}$s`;
        if (template.includes(token)) {
          template = template.replace(token, replacement || fallbackActor || "Một thành viên");
        }
      }

      // Xử lý nốt %1$s / %2$s nếu highLightsV2 trống
      if (template.includes("%1$s")) {
        template = template.replace("%1$s", fallbackActor || "Một thành viên");
      }
      if (template.includes("%2$s")) {
        const question = cleanStr(paramsObj.question) || cleanStr(paramsObj.title);
        template = template.replace("%2$s", question);
      }

      const cleaned = template.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
      if (cleaned && !isSendBubblePlaceholder(cleaned)) return cleaned;
    }
  }

  if (action === "msginfo.actionlist") {
    const title = cleanStr(content.title);
    if (title && !isSendBubblePlaceholder(title)) return title;
  }

  return null;
}

/**
 * Chuẩn hóa sự kiện nhóm/hệ thống Zalo (`group.event`, `group_event`, `eventInfo`) thành câu tiếng Việt tự nhiên.
 */
export function formatZaloGroupEvent(raw: unknown): FormattedZaloGroupEvent | null {
  const { root, data, content } = unwrapRawObject(raw);
  if (!root || !data) return null;

  const eventInfo = safeParseJsonObject(data.eventInfo) || safeParseJsonObject(content?.eventInfo) || data;
  const updateInfo = safeParseJsonObject(eventInfo.updateInfo) || safeParseJsonObject(data.updateInfo);
  const rawType = cleanStr(root.type || data.msgType || data.type).toLowerCase();

  let act = cleanStr(
    eventInfo.act ||
      data.act ||
      root.act ||
      content?.act ||
      eventInfo.eventType ||
      data.eventType ||
      root.eventType,
  ).toLowerCase();

  // Map zca-js GroupEventType uppercase names (JOIN, REMOVE_MEMBER, UPDATE_AVATAR, ...)
  if (act === "group.leave") act = "leave";
  if (!act && rawType === "group.leave") act = "leave";
  if (!act && rawType === "group.poll") act = "group.poll";

  // Kiểm tra action msginfo.actionlist nhúng trong group event
  if (!act) {
    const actionListText = formatMsgInfoActionList(raw);
    if (actionListText) {
      const lower = actionListText.toLowerCase();
      const iconKind: ZaloSystemEventIconKind = lower.includes("bỏ ghim")
        ? "unpin"
        : lower.includes("ghim")
          ? "pin"
          : lower.includes("bình chọn")
            ? "poll"
            : lower.includes("nhắc hẹn")
              ? "reminder"
              : lower.includes("kết bạn") || lower.includes("bạn bè")
                ? "friend_accept"
                : "info";
      return { act: "msginfo.actionlist", title: actionListText, iconKind };
    }
    return null;
  }

  const template = ZALO_GROUP_EVENT_TEMPLATES[act];
  if (!template && rawType !== "group.event" && rawType !== "group_event") {
    return null;
  }

  const sourceObj = safeParseJsonObject(eventInfo.source);
  const actor =
    cleanStr(sourceObj?.dName) ||
    cleanStr(sourceObj?.displayName) ||
    cleanStr(eventInfo.actorName) ||
    cleanStr(data.actorName) ||
    cleanStr(data.dName) ||
    "";

  const members = extractMemberNames(
    eventInfo.updateMembers || data.updateMembers || root.updateMembers || data.members,
  );
  const membersLabel = joinMemberNames(members);
  const newContent =
    cleanStr(updateInfo?.content) ||
    cleanStr(data.groupName) ||
    cleanStr(eventInfo.groupName) ||
    cleanStr(content?.title);
  const subType = cleanStr(updateInfo?.type || updateInfo?.subAct).toLowerCase();

  let title = "";
  let subtitle: string | undefined;

  switch (act) {
    case "join":
    case "join_group": {
      if (membersLabel && actor && !members.includes(actor)) {
        title = `${membersLabel} được ${actor} thêm vào nhóm`;
      } else if (membersLabel) {
        title = `${membersLabel} đã tham gia nhóm`;
      } else if (actor) {
        title = `${actor} đã tham gia nhóm`;
      } else {
        title = "Thành viên mới đã tham gia nhóm";
      }
      break;
    }
    case "leave": {
      const who = membersLabel || actor;
      title = who ? `${who} đã rời khỏi nhóm` : "Một thành viên đã rời khỏi nhóm";
      if (updateInfo && cleanStr(updateInfo.dName)) {
        subtitle = `${cleanStr(updateInfo.dName)} trở thành trưởng nhóm`;
      }
      break;
    }
    case "remove_member": {
      if (membersLabel && actor) {
        title = `${membersLabel} được ${actor} xóa khỏi nhóm`;
      } else if (membersLabel) {
        title = `${membersLabel} đã bị xóa khỏi nhóm`;
      } else {
        title = "Một thành viên đã bị xóa khỏi nhóm";
      }
      break;
    }
    case "block_member": {
      if (membersLabel && actor) {
        title = `${membersLabel} bị ${actor} chặn khỏi nhóm này`;
      } else if (membersLabel) {
        title = `${membersLabel} đã bị chặn khỏi nhóm này`;
      } else {
        title = "Một thành viên đã bị chặn khỏi nhóm";
      }
      break;
    }
    case "update": {
      if (newContent) {
        title = actor ? `${actor} đổi tên nhóm thành "${newContent}"` : `Tên nhóm đã đổi thành "${newContent}"`;
      } else {
        title = actor ? `${actor} đã cập nhật thông tin nhóm` : "Thông tin nhóm đã được cập nhật";
      }
      break;
    }
    case "update_avatar": {
      title = actor ? `${actor} đã đổi ảnh đại diện nhóm` : "Ảnh đại diện nhóm đã thay đổi";
      break;
    }
    case "add_admin": {
      title = membersLabel
        ? `${membersLabel} đã được bổ nhiệm thành phó nhóm`
        : "Đã bổ nhiệm phó nhóm mới";
      break;
    }
    case "remove_admin": {
      title = membersLabel
        ? `${membersLabel} đã không còn là phó nhóm`
        : "Đã gỡ quyền phó nhóm";
      break;
    }
    case "new_link": {
      const link = cleanStr(updateInfo?.link) || cleanStr(data.link);
      title = link ? `Link mời tham gia nhóm: ${link}` : "Link mời tham gia nhóm đã được cập nhật";
      break;
    }
    case "join_request":
    case "request_join": {
      title = membersLabel
        ? `${membersLabel} yêu cầu tham gia nhóm`
        : "Có yêu cầu tham gia nhóm cần phê duyệt";
      break;
    }
    case "update_board":
    case "update_topic": {
      const prefix = actor ? `${actor} ` : "";
      if (subType === "pin_message") {
        title = `${prefix}đã ghim một tin nhắn thành thông báo nhóm`.trim();
      } else if (subType === "pin_notice") {
        title = newContent
          ? `${prefix}đã ghim thông báo "${newContent}"`.trim()
          : `${prefix}đã ghim một thông báo nhóm`.trim();
      } else if (subType === "create_notice") {
        title = newContent
          ? `${prefix}đã tạo ghi chú mới "${newContent}"`.trim()
          : `${prefix}đã tạo ghi chú mới`.trim();
      } else if (subType === "update_notice") {
        title = newContent
          ? `${prefix}đã cập nhật ghi chú "${newContent}"`.trim()
          : `${prefix}đã sửa ghi chú`.trim();
      } else {
        title = newContent
          ? `${prefix}đã cập nhật bảng tin nhóm: "${newContent}"`.trim()
          : `${prefix}đã cập nhật bảng tin nhóm`.trim();
      }
      break;
    }
    case "remove_topic":
    case "unpin_topic": {
      title = actor ? `${actor} đã bỏ ghim một tin nhắn` : "Đã bỏ ghim một tin nhắn";
      break;
    }
    case "remind_topic":
    case "remind_reminder11": {
      const prefix =
        subType === "before_30"
          ? "Nhắc hẹn - 30 phút nữa"
          : subType === "before_1_day"
            ? "Nhắc hẹn - 1 ngày nữa"
            : "Nhắc hẹn";
      title = newContent ? `${prefix}: "${newContent}"` : prefix;
      break;
    }
    case "group.poll": {
      const paramsObj = safeParseJsonObject(content?.params);
      const question = cleanStr(paramsObj?.question) || cleanStr(content?.title);
      title = question ? `Bình chọn: ${question}` : "Bình chọn trong nhóm";
      break;
    }
    default: {
      const base = template?.vi || "Thông báo nhóm";
      if (actor && !base.toLowerCase().startsWith("bạn ") && !base.toLowerCase().startsWith("trưởng nhóm") && !base.toLowerCase().startsWith("nhóm ")) {
        title = `${actor} ${base}`;
      } else {
        title = base.charAt(0).toUpperCase() + base.slice(1);
      }
      break;
    }
  }

  return {
    act,
    title: title.trim(),
    ...(subtitle ? { subtitle } : {}),
    iconKind: template?.iconKind || "info",
  };
}

/**
 * Chuẩn hóa sự kiện bạn bè (`friend.event` / `friend_event`), thiệp chào (`chat.ecard` `ECARD_TYPE 0..6`,
 * `action="show.profile"`), và cảnh báo người lạ thành dữ liệu banner thống nhất.
 */
export function formatZaloFriendEvent(raw: unknown): FormattedZaloFriendEvent | null {
  const { root, data, content } = unwrapRawObject(raw);
  if (!root || !data) return null;

  const rawMsgType = cleanStr(data.msgType || root.msgType || root.type).toLowerCase();
  const action = cleanStr(content?.action || data.action || root.action).toLowerCase();
  const act = cleanStr(data.act || root.act || data.eventType || root.eventType).toLowerCase();
  const paramsObj = safeParseJsonObject(content?.params) || safeParseJsonObject(data.params);

  // 1. Trường hợp `chat.ecard` (kể cả `action="show.profile"` và `ECARD_TYPE 0..6`)
  if (rawMsgType === "chat.ecard" || (action === "show.profile" && content?.type !== undefined && content?.type !== "")) {
    const rawEcardType = cleanStr(content?.type);
    const ecardNum = /^\d+$/.test(rawEcardType) ? Number(rawEcardType) : undefined;
    const notifyTxt = cleanStr(paramsObj?.notifyTxt);
    const previewTxt = cleanStr(paramsObj?.previewTxt);
    const desc = cleanStr(content?.description);
    const titleField = cleanStr(content?.title);
    const dName = cleanStr(data.dName || root.dName);
    const thumb = cleanStr(content?.thumb) || undefined;
    const bannerUrl = cleanStr(content?.href) || undefined;

    // Kiểm tra ecard nhắc hẹn (`action.open.reminder`)
    const actionsArr = Array.isArray(paramsObj?.actions) ? paramsObj.actions : [];
    const firstAction = actionsArr[0] && typeof actionsArr[0] === "object" ? (actionsArr[0] as RawRecord) : null;
    if (cleanStr(firstAction?.actionId) === "action.open.reminder") {
      const remTitle =
        (previewTxt ? previewTxt.replace(/^\[.*?\]\s*/, "").trim() : "") ||
        titleField ||
        desc ||
        "Nhắc hẹn";
      return {
        act: "ecard_reminder",
        title: remTitle,
        subtitle: desc && desc !== remTitle ? desc : undefined,
        iconKind: "reminder",
        ecardType: ecardNum,
        thumb,
        bannerUrl,
      };
    }

    if (ecardNum === 1) {
      return {
        act: "ecard_birthday",
        title: notifyTxt || titleField || desc || (dName ? `Hôm nay là sinh nhật của ${dName}` : "Chúc mừng sinh nhật"),
        subtitle: desc && desc !== titleField ? desc : undefined,
        iconKind: "birthday",
        ecardType: 1,
        thumb,
        bannerUrl,
      };
    }

    if (ecardNum === 2 || ecardNum === 3 || action === "show.profile") {
      const resolvedTitle =
        notifyTxt ||
        desc ||
        titleField ||
        (dName ? `${dName} đã đồng ý kết bạn` : "Hai bạn đã trở thành bạn bè");
      return {
        act: "ecard_friend_accept",
        title: resolvedTitle,
        subtitle:
          previewTxt && !previewTxt.includes(resolvedTitle)
            ? previewTxt.replace(/^\[Thiệp\]\s*/i, "").trim()
            : undefined,
        iconKind: "friend_accept",
        ecardType: ecardNum ?? 2,
        thumb,
        bannerUrl,
      };
    }

    if (ecardNum === 6) {
      return {
        act: "ecard_group_join",
        title: notifyTxt || titleField || desc || "Chào mừng tham gia nhóm",
        subtitle: desc && desc !== titleField ? desc : undefined,
        iconKind: "group_join",
        ecardType: 6,
        thumb,
        bannerUrl,
      };
    }

    return {
      act: "ecard_generic",
      title: notifyTxt || titleField || desc || (previewTxt ? previewTxt.replace(/^\[Thiệp\]\s*/i, "").trim() : "Thiệp chúc mừng"),
      subtitle: desc && desc !== titleField ? desc : undefined,
      iconKind: "ecard",
      ecardType: ecardNum,
      thumb,
      bannerUrl,
    };
  }

  // 2. Trường hợp `recommened.friend` (gợi ý kết bạn)
  if (action === "recommened.friend") {
    const titleField = cleanStr(content?.title);
    const desc = cleanStr(content?.description);
    return {
      act: "recommened.friend",
      title: titleField || desc || "Gợi ý kết bạn",
      subtitle: desc && desc !== titleField ? desc : undefined,
      iconKind: "friend_request",
      thumb: cleanStr(content?.thumb) || undefined,
    };
  }

  // 3. Trường hợp `friend.event` / `friend_event` theo `act`
  if (!act) return null;
  const tpl = ZALO_FRIEND_EVENT_TEMPLATES[act];
  if (!tpl && rawMsgType !== "friend.event" && rawMsgType !== "friend_event") {
    return null;
  }

  const friendName =
    cleanStr(data.dName) ||
    cleanStr(data.displayName) ||
    cleanStr(data.name) ||
    cleanStr(content?.dpn) ||
    cleanStr(root.dName);
  const greetingMsg = cleanStr(data.message || content?.desc || content?.description || data.desc);

  let title = tpl?.vi || "Thông báo kết bạn";
  let subtitle: string | undefined;

  if (act === "add") {
    title = friendName ? `Bạn và ${friendName} đã trở thành bạn bè` : "Hai bạn đã trở thành bạn bè";
  } else if (act === "req_v2" || act === "req" || act === "sent_request") {
    const isSelf = root.isSelf === true || data.isSelf === true;
    if (isSelf) {
      title = friendName ? `Đã gửi lời mời kết bạn tới ${friendName}` : "Đã gửi lời mời kết bạn";
    } else {
      title = friendName ? `${friendName} đã gửi yêu cầu kết bạn đến bạn` : "Đã nhận lời mời kết bạn";
    }
    if (greetingMsg && !isSendBubblePlaceholder(greetingMsg)) {
      subtitle = greetingMsg;
    }
  } else if (act === "undo_req") {
    title = friendName ? `${friendName} đã thu hồi lời mời kết bạn` : "Đã thu hồi lời mời kết bạn";
  } else if (act === "reject") {
    title = friendName ? `Đã từ chối lời mời kết bạn từ ${friendName}` : "Đã từ chối lời mời kết bạn";
  } else if (act === "remove") {
    title = friendName ? `Đã hủy kết bạn với ${friendName}` : "Đã hủy kết bạn";
  } else if (act === "block") {
    title = friendName ? `Đã chặn tin nhắn từ ${friendName}` : "Đã chặn tin nhắn từ người này";
  } else if (act === "unblock") {
    title = friendName ? `Đã bỏ chặn ${friendName}` : "Đã bỏ chặn người này";
  }

  return {
    act,
    title,
    ...(subtitle ? { subtitle } : {}),
    iconKind: tpl?.iconKind || "info",
  };
}

// ── Trích xuất thông minh trong tin nhắn văn bản tự do ────────────────────────

export interface ExtractedVietnamesePhone {
  raw: string;
  normalized: string;
  display: string;
}

export interface ExtractedFreeTextBankAccount {
  accountNo: string;
  bankShortName?: string;
  bankFullName?: string;
  bin?: string;
  accountName?: string;
}

const URL_EXTRACT_RE = /https?:\/\/[^\s<>"'`\u3000]+/gi;

export function extractUrlsFromText(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.match(URL_EXTRACT_RE);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)\]}'"»”]+$/g, "");
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        if (!seen.has(cleaned)) {
          seen.add(cleaned);
          out.push(cleaned);
        }
      }
    } catch {
      // ignore invalid URL
    }
  }
  return out;
}

/**
 * Loại bỏ các URL trước khi quét SĐT/STK để tránh bắt nhầm số ID dài trong đường dẫn.
 */
function stripUrls(text: string): string {
  return text.replace(URL_EXTRACT_RE, " ");
}

function formatVietnamesePhoneDisplay(normalized: string): string {
  if (normalized.length === 10) {
    return `${normalized.slice(0, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
  }
  if (normalized.length === 11 && normalized.startsWith("02")) {
    return `${normalized.slice(0, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
  }
  return normalized;
}

function isValidVietnamesePhoneDigits(digits: string): boolean {
  // Di động VN: 10 số bắt đầu 03 / 05 / 07 / 08 / 09
  if (/^0(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/.test(digits)) {
    return true;
  }
  // Máy bàn VN: 024/028 + 8 số (11 số) hoặc 02xx + 7 số (11 số)
  if (/^02\d{9}$/.test(digits)) {
    return true;
  }
  return false;
}

const VN_PHONE_CANDIDATE_RE =
  /(?<![\d/:-])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\d/:-])/g;

/**
 * Nhận diện số điện thoại Việt Nam (03/05/07/08/09, máy bàn 02x, +84) trong văn bản,
 * lọc sạch ngày tháng (25/11/2026), timestamp 13 số và mã ID dài.
 */
export function extractVietnamesePhones(text?: string | null): ExtractedVietnamesePhone[] {
  if (!text) return [];
  const cleanedText = stripUrls(text);
  const out: ExtractedVietnamesePhone[] = [];
  const seen = new Set<string>();

  for (const match of cleanedText.matchAll(VN_PHONE_CANDIDATE_RE)) {
    const raw = match[0].trim();
    // Chặn mẫu ngày/tháng kiểu 08-11-2026 hoặc 09.12.2025
    if (/^\d{2}[.-]\d{2}[.-]\d{4}$/.test(raw)) continue;

    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("84") && (digits.length === 11 || digits.length === 12)) {
      digits = `0${digits.slice(2)}`;
    }
    if (!isValidVietnamesePhoneDigits(digits)) continue;
    if (seen.has(digits)) continue;

    seen.add(digits);
    out.push({
      raw,
      normalized: digits,
      display: formatVietnamesePhoneDisplay(digits),
    });
  }
  return out;
}

const STK_KEYWORD_RE =
  /(?:^|[^a-z0-9])(?:stk|so\s*tk|so\s*tai\s*khoan|tai\s*khoan|chuyen\s*khoan|ck\b|ctk|chu\s*tk|chu\s*tai\s*khoan|ngan\s*hang|vietqr|momo|zalopay)(?:$|[^a-z0-9])/i;

const EWALLET_KEYWORDS: ReadonlyArray<{ regex: RegExp; shortName: string; fullName: string }> = [
  { regex: /(?:^|[^a-z0-9])momo(?:$|[^a-z0-9])/i, shortName: "MoMo", fullName: "Ví điện tử MoMo" },
  { regex: /(?:^|[^a-z0-9])zalopay(?:$|[^a-z0-9])/i, shortName: "ZaloPay", fullName: "Ví điện tử ZaloPay" },
];

function extractHolderNameFromText(text: string): string | undefined {
  // Ưu tiên mẫu tường minh: "CTK: NGUYEN VAN A" / "Chủ TK: TRAN THI B" / "Tên: ..."
  const explicit = text.match(
    /(?:ctk|chủ\s*tk|chu\s*tk|chủ\s*tài\s*khoản|chu\s*tai\s*khoan|tên\s*tk|ten\s*tk)\s*[:\-]?\s*([A-ZÀ-Ỹ][A-ZÀ-Ỹa-zà-ỹ\s]{3,48})/i,
  );
  if (explicit) {
    const candidate = explicit[1].split(/[\n,;()]/)[0].trim();
    if (candidate.split(/\s+/).length >= 2 && candidate.length >= 5) {
      return candidate.toUpperCase();
    }
  }
  // Hoặc dòng riêng viết HOA không dấu kiểu "NGUYEN VAN ANH"
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^[A-Z]{2,}(?:\s+[A-Z]{2,}){1,5}$/.test(trimmed) && !lookupVietnamBankByKeyword(trimmed)) {
      if (!/^(STK|CTK|NGAN HANG|CHUYEN KHOAN|SO TAI KHOAN)$/.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return undefined;
}

/**
 * Nhận diện số tài khoản ngân hàng người dùng gõ tay trong tin nhắn văn bản tự do
 * (theo chuẩn `zalo-message-normalization` SKILL.md §3), không đụng độ SĐT thường,
 * ngày tháng, timestamp 13 số hay URL.
 */
export function extractFreeTextBankAccounts(text?: string | null): ExtractedFreeTextBankAccount[] {
  if (!text) return [];
  const cleanedText = stripUrls(text).trim();
  if (!cleanedText) return [];

  const foldedAll = foldVietnamese(cleanedText);
  const phones = new Set(extractVietnamesePhones(cleanedText).map((p) => p.normalized));

  // Case 1: Tin nhắn CHỈ chứa 1 dãy số 6–19 chữ số (có thể có khoảng trắng phân nhóm)
  const standaloneDigits = cleanedText.replace(/\s+/g, "");
  if (/^\d{6,19}$/.test(standaloneDigits)) {
    // Không nhận nhầm SĐT VN (trừ khi dài >= 11 số khác máy bàn hoặc không hợp lệ SĐT)
    if (phones.has(standaloneDigits)) return [];
    // Không nhận nhầm timestamp Unix ms (13 chữ số đầu 16/17/18/19)
    if (standaloneDigits.length === 13 && /^1[6-9]\d{11}$/.test(standaloneDigits)) return [];
    // Không nhận nhầm mã OTP 6 số khi không có ngữ cảnh ngân hàng? (SKILL.md ghi rõ 6-19 số)
    return [{ accountNo: standaloneDigits }];
  }

  // Case 2: Tin nhắn có từ khóa ngân hàng / STK / ví điện tử
  const globalBank = lookupVietnamBankByKeyword(cleanedText);
  const globalWallet = !globalBank ? EWALLET_KEYWORDS.find((w) => w.regex.test(foldedAll)) : undefined;
  const hasStkKeyword = STK_KEYWORD_RE.test(foldedAll);

  if (!globalBank && !globalWallet && !hasStkKeyword) {
    return [];
  }

  const results: ExtractedFreeTextBankAccount[] = [];
  const seen = new Set<string>();
  const holderName = extractHolderNameFromText(cleanedText);

  const lines = cleanedText.split(/\r?\n/);
  const numberRe = /(?<![\d/:-])(\d(?:[\s.-]?\d){5,18})(?![\d/:-])/g;

  for (const line of lines) {
    const lineTrim = line.trim();
    if (!lineTrim) continue;
    const lineFolded = foldVietnamese(lineTrim);
    const lineBank = lookupVietnamBankByKeyword(lineTrim);
    const lineWallet = !lineBank ? EWALLET_KEYWORDS.find((w) => w.regex.test(lineFolded)) : undefined;
    const lineHasStk = STK_KEYWORD_RE.test(lineFolded);

    // Nếu dòng có chữ "sđt / điện thoại / hotline / liên hệ" rõ ràng và KHÔNG có bank/stk -> bỏ qua SĐT trên dòng đó
    const lineIsPhoneLabel =
      /(?:^|[^a-z])(?:sdt|so\s*dt|dien\s*thoai|hotline|lien\s*he|tel|phone)(?:$|[^a-z])/i.test(lineFolded) &&
      !lineBank &&
      !lineHasStk;
    if (lineIsPhoneLabel) continue;

    const effectiveBank = lineBank || globalBank;
    const effectiveWallet = !effectiveBank ? lineWallet || globalWallet : undefined;

    for (const m of lineTrim.matchAll(numberRe)) {
      const rawToken = m[1].trim();
      // Bỏ qua định dạng ngày/tháng (25-11-2026, 25.11.2026)
      if (/^\d{1,2}[.-]\d{1,2}[.-]\d{2,4}$/.test(rawToken)) continue;
      // Bỏ qua tiền tệ (vd 500.000 hoặc 1.500.000 đi kèm k/đ/vnd/triệu)
      const afterIdx = (m.index ?? 0) + m[0].length;
      const tail = lineTrim.slice(afterIdx, afterIdx + 8).toLowerCase();
      if (/^\s*(?:k\b|đ\b|d\b|vnd\b|vnđ\b|tr\b|triệu|trieu|nghìn|nghin)/i.test(tail)) continue;
      if (/^\d{1,3}(?:[.,]\d{3})+$/.test(rawToken) && !lineHasStk && !lineBank) continue;

      const digits = rawToken.replace(/\D/g, "");
      if (digits.length < 6 || digits.length > 19) continue;
      // Bỏ qua timestamp ms
      if (digits.length === 13 && /^1[6-9]\d{11}$/.test(digits)) continue;
      // Nếu là SĐT VN: chỉ chấp nhận là STK khi CÙNG DÒNG có tên ngân hàng hoặc từ khóa STK (vd "MB 0909369898" / "STK: 0909369898")
      if (phones.has(digits) && !lineBank && !lineWallet && !lineHasStk) continue;
      if (seen.has(digits)) continue;

      seen.add(digits);
      results.push({
        accountNo: digits,
        ...(effectiveBank
          ? {
              bankShortName: effectiveBank.shortName,
              bankFullName: effectiveBank.fullName,
              bin: effectiveBank.bin,
            }
          : effectiveWallet
            ? {
                bankShortName: effectiveWallet.shortName,
                bankFullName: effectiveWallet.fullName,
              }
            : {}),
        ...(holderName ? { accountName: holderName } : {}),
      });
    }
  }

  return results;
}

// ── Bộ định dạng preview duy nhất cho Sidebar & Quote Reply ───────────────────

const UGLY_FALLBACK_RE = /—\s*mở\s*zalo\s*để\s*xem|tin\s*nhắn\s*dạng\s*đặc\s*biệt/i;

function isRawJsonString(text: string): boolean {
  const t = text.trim();
  if (!((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")))) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(t);
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

export interface ZaloSidebarPreviewInput {
  content?: string | null;
  type?: string | null;
  msg_kind?: string | null;
  raw_content?: unknown;
  attachments?: unknown;
  is_sent?: boolean | null;
  is_deleted?: boolean | null;
}

/**
 * Hàm duy nhất (authoritative) tạo dòng xem trước cho Sidebar danh sách hội thoại
 * và khung Quote Reply trên toàn bộ ứng dụng.
 *
 * Bảo đảm tuyệt đối KHÔNG BAO GIỜ trả về `"sendBubbleMessage"`, JSON thô `{...}`,
 * hay `"— mở Zalo để xem"`.
 */
export function formatZaloAnySidebarPreview(input: ZaloSidebarPreviewInput | null | undefined): string {
  if (!input) return "";

  const typeLower = cleanStr(input.type).toLowerCase();
  const kindLower = cleanStr(input.msg_kind).toLowerCase();
  const contentText = cleanStr(input.content);

  // 1. Tin đã thu hồi / đã xóa
  if (input.is_deleted || typeLower === "chat.undo" || kindLower === "undo") {
    return "Tin nhắn đã được thu hồi";
  }
  if (typeLower === "chat.delete.everyone" || typeLower === "chat.delete") {
    return "Tin nhắn đã bị xóa";
  }

  // 2. Ủy quyền tin nhắn cuộc gọi cho `zaloCallMessage.ts` (LOCKED native r6Qt)
  const callInput: ZaloCallParseInput = {
    type: input.type,
    msg_kind: input.msg_kind,
    content: input.content,
    is_sent: input.is_sent,
    raw_content: input.raw_content,
  };
  const parsedCall = parseZaloCallMessage(callInput);
  if (parsedCall) {
    return formatZaloSidebarPreview(input.content, {
      isSelf: Boolean(input.is_sent),
      fallbackMessage: callInput,
    });
  }

  // 3. Giải nén `raw_content` (hỗ trợ cả JSON string & envelope `{ data: { msgType, content } }`)
  const { root, data, content: inner } = unwrapRawObject(input.raw_content);
  const rawMsgType = cleanStr(data?.msgType || root?.msgType).toLowerCase();
  const effectiveType = rawMsgType || typeLower;
  const action = cleanStr(inner?.action || data?.action || root?.action).toLowerCase();
  const paramsObj = safeParseJsonObject(inner?.params);

  // 3a. Thẻ ngân hàng ZInstant / VietQR
  const rawStrForProbe =
    typeof input.raw_content === "string"
      ? input.raw_content
      : inner
        ? (() => {
            try {
              return JSON.stringify(inner);
            } catch {
              return "";
            }
          })()
        : "";
  const isBankcard =
    kindLower === "bankcard" ||
    effectiveType === "chat.webcontent" ||
    effectiveType === "chat.webcontent.v2" ||
    action.includes("bankcard") ||
    rawStrForProbe.includes("zinstant.bankcard") ||
    rawStrForProbe.includes("templateId=11845") ||
    rawStrForProbe.includes("zinst-stc.zadn.vn") ||
    /^\[?tài khoản ngân hàng\]?$/i.test(contentText);

  if (isBankcard) {
    return ZALO_SIDEBAR_BRACKET_LABELS.ZINSTANT_BANKCARD;
  }

  // 3b. Thông báo `msginfo.actionlist`
  if (action === "msginfo.actionlist") {
    const formatted = formatMsgInfoActionList(input.raw_content);
    if (formatted) return formatted;
  }

  // 3c. eCard / sự kiện kết bạn
  if (
    effectiveType === "chat.ecard" ||
    effectiveType === "friend.event" ||
    effectiveType === "friend_event" ||
    action === "recommened.friend"
  ) {
    const fe = formatZaloFriendEvent(input.raw_content);
    if (fe) return fe.title;
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_CARD_MSG;
  }

  // 3d. Sự kiện nhóm / bình chọn / nhắc hẹn
  if (
    effectiveType === "group.event" ||
    effectiveType === "group_event" ||
    effectiveType === "group.leave" ||
    effectiveType === "group.poll" ||
    kindLower === "poll"
  ) {
    if (effectiveType === "group.poll" || kindLower === "poll" || paramsObj?.pollId !== undefined) {
      const q = cleanStr(paramsObj?.question) || cleanStr(inner?.title);
      return q ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_POLL_MSG} ${q}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_POLL_MSG;
    }
    const ge = formatZaloGroupEvent(input.raw_content);
    if (ge) return ge.title;
  }

  // 3e. Danh thiếp (`recommened.user`, `recommened.vip`, `show.profile`, `type="group"` legacy)
  if (
    kindLower === "contact" ||
    action === "recommened.user" ||
    action === "recommened.vip" ||
    action === "show.profile" ||
    action === "chat.contact"
  ) {
    const name = cleanStr(inner?.title || paramsObj?.name || paramsObj?.displayName);
    return name
      ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_CONTACT_MSG} ${name}`
      : ZALO_SIDEBAR_BRACKET_LABELS.STR_CONTACT_MSG;
  }

  // 3f. Tệp / Thư mục (`share.file`)
  if (effectiveType === "share.file" || kindLower === "file" || kindLower === "folder") {
    const fdata = safeParseJsonObject(paramsObj?.fdata);
    const isFolder =
      kindLower === "folder" ||
      Number(paramsObj?.fType) === 2 ||
      Number(fdata?.fType) === 2 ||
      paramsObj?.isFolder === true;
    const label = isFolder ? ZALO_SIDEBAR_BRACKET_LABELS.STR_FOLDER_MSG : ZALO_SIDEBAR_BRACKET_LABELS.STR_FILE_MSG;
    let fileName = cleanStr(inner?.title || paramsObj?.fileName || contentText);
    const ext = cleanStr(paramsObj?.fileExt).toLowerCase().replace(/^\./, "");
    if (fileName && ext && !isFolder && !fileName.toLowerCase().endsWith(`.${ext}`)) {
      fileName = `${fileName}.${ext}`;
    }
    return fileName && !isRawJsonString(fileName) ? `${label} ${fileName}` : label;
  }

  // 3g. Rich Link (`recommened.link`, `chat.link`, ...)
  if (
    action === "recommened.link" ||
    action === "recommened.minisite" ||
    action === "recommened.miniapp" ||
    action === "recommened.oa" ||
    action === "recommened.article" ||
    action === "recommened.post" ||
    action === "recommened.zvideo" ||
    effectiveType === "chat.link" ||
    kindLower === "link"
  ) {
    const prefix =
      action === "recommened.miniapp"
        ? "[Mini App]"
        : action === "recommened.article"
          ? ZALO_SIDEBAR_BRACKET_LABELS.STR_ARTICLE_MSG
          : action === "recommened.zvideo"
            ? ZALO_SIDEBAR_BRACKET_LABELS.STR_VIDEO_MSG
            : ZALO_SIDEBAR_BRACKET_LABELS.STR_LINK_MSG;
    const linkTitle = cleanStr(paramsObj?.mediaTitle) || cleanStr(inner?.title) || cleanStr(inner?.href);
    return linkTitle && !isRawJsonString(linkTitle) ? `${prefix} ${linkTitle.split(/\r?\n/)[0]}` : prefix;
  }

  // 3h. Ảnh / Album / GIF / Video / Voice / Sticker / Doodle / Location / Todo / Vanish
  if (effectiveType === "chat.gif" || action === "recommend.gif" || kindLower === "gif") {
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_GIF;
  }
  if (effectiveType === "chat.sticker" || kindLower === "sticker" || inner?.stickerUrl || inner?.stickerWebpUrl) {
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_STICKER;
  }
  if (action === "recommened.stickerset") {
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_STICKERSET_MSG;
  }
  if (effectiveType === "chat.video.msg" || kindLower === "video") {
    const cap = cleanStr(inner?.title);
    return cap ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_VIDEO_MSG} ${cap}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_VIDEO_MSG;
  }
  if (effectiveType === "chat.voice" || kindLower === "voice") {
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_VOICE_MSG;
  }
  if (effectiveType === "chat.doodle" || kindLower === "doodle") {
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_DOODLE_MSG;
  }
  if (effectiveType === "chat.location.new" || action === "recommened.location" || kindLower === "location") {
    const locTitle = cleanStr(inner?.title || inner?.description || inner?.desc);
    return locTitle ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_LOC_MSG} ${locTitle}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_LOC_MSG;
  }
  if (effectiveType === "chat.photo" || kindLower === "image" || typeLower === "image") {
    const isAlbum = Boolean(paramsObj?.is_group_layout && Number(paramsObj?.total_item_in_group) > 1);
    const label = isAlbum ? ZALO_SIDEBAR_BRACKET_LABELS.STR_ALBUM_MSG : ZALO_SIDEBAR_BRACKET_LABELS.STR_PHOTO_MSG;
    const cap = cleanStr(inner?.title);
    return cap && !isRawJsonString(cap) ? `${label} ${cap}` : label;
  }
  if (effectiveType === "chat.todo" || kindLower === "todo") {
    const todoText = cleanStr(inner?.message || inner?.title || contentText);
    return todoText && !isRawJsonString(todoText) ? `[Công việc] ${todoText}` : "[Công việc]";
  }
  if (effectiveType === "chat.vanish") {
    return ZALO_SIDEBAR_BRACKET_LABELS.STR_VANISH_MSG;
  }

  // 4. RTF hoặc văn bản sạch (chặn sendBubbleMessage / JSON thô / fallback xấu)
  if (action === "rtf") {
    const rtfText = cleanStr(inner?.title) || contentText;
    if (rtfText) return rtfText.replace(/\s+/g, " ").trim();
  }

  // Nếu cột `attachments` đã chuẩn hóa có sẵn phần tử đầu tiên
  if (Array.isArray(input.attachments) && input.attachments.length > 0) {
    const first = input.attachments[0] as RawRecord | undefined;
    const aKind = cleanStr(first?.kind).toLowerCase();
    if (aKind === "bankcard") return ZALO_SIDEBAR_BRACKET_LABELS.ZINSTANT_BANKCARD;
    if (aKind === "contact") {
      const n = cleanStr(first?.name);
      return n ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_CONTACT_MSG} ${n}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_CONTACT_MSG;
    }
    if (aKind === "file") {
      const n = cleanStr(first?.name);
      return n ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_FILE_MSG} ${n}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_FILE_MSG;
    }
    if (aKind === "folder") {
      const n = cleanStr(first?.name);
      return n ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_FOLDER_MSG} ${n}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_FOLDER_MSG;
    }
    if (aKind === "link") {
      const t = cleanStr(first?.title || first?.url);
      return t ? `${ZALO_SIDEBAR_BRACKET_LABELS.STR_LINK_MSG} ${t}` : ZALO_SIDEBAR_BRACKET_LABELS.STR_LINK_MSG;
    }
    if (aKind === "image") return ZALO_SIDEBAR_BRACKET_LABELS.STR_PHOTO_MSG;
    if (aKind === "gif") return ZALO_SIDEBAR_BRACKET_LABELS.STR_GIF;
    if (aKind === "video") return ZALO_SIDEBAR_BRACKET_LABELS.STR_VIDEO_MSG;
    if (aKind === "voice") return ZALO_SIDEBAR_BRACKET_LABELS.STR_VOICE_MSG;
    if (aKind === "sticker") return ZALO_SIDEBAR_BRACKET_LABELS.STR_STICKER;
    if (aKind === "doodle") return ZALO_SIDEBAR_BRACKET_LABELS.STR_DOODLE_MSG;
    if (aKind === "location") return ZALO_SIDEBAR_BRACKET_LABELS.STR_LOC_MSG;
  }

  if (contentText) {
    if (isSendBubblePlaceholder(contentText)) {
      return formatZaloSidebarPreview(contentText, { isSelf: Boolean(input.is_sent) });
    }
    if (UGLY_FALLBACK_RE.test(contentText)) {
      const meta = ZALO_MSG_TYPE_LABELS[effectiveType];
      return meta?.bracketVi || "[Tin nhắn]";
    }
    if (isRawJsonString(contentText)) {
      // Thử đệ quy 1 lần với chính JSON đó làm raw_content
      const nested = formatZaloAnySidebarPreview({
        type: input.type,
        msg_kind: input.msg_kind,
        raw_content: contentText,
        is_sent: input.is_sent,
      });
      if (nested) return nested;
      const meta = ZALO_MSG_TYPE_LABELS[effectiveType];
      return meta?.bracketVi || "[Tin nhắn]";
    }
    return contentText;
  }

  const meta = ZALO_MSG_TYPE_LABELS[effectiveType];
  if (meta?.bracketVi) return meta.bracketVi;
  return "";
}
