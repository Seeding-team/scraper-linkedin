/**
 * Helpers cho tính năng "gõ @ để tag thành viên nhóm" ở khung soạn tin nhắn —
 * bắt chước đúng UI Zalo thật: gõ "@" giữa lúc soạn tin → popup hiện "Báo cho
 * cả nhóm · @All" + danh sách thành viên nhóm (avatar + tên), gõ tiếp để lọc
 * theo tên, chọn xong chèn "@Tên " vào tin nhắn.
 *
 * QUAN TRỌNG: đây phải là MENTION THẬT (Zalo tag đúng người, có thông báo),
 * không chỉ chèn chữ "@Tên" như text thường. Zalo yêu cầu gửi kèm toạ độ
 * mention `{pos, uid, len}` trong tin nhắn cuối — xem handleMentions() ở
 * zca-js/dist/apis/sendMessage.js: `uid` là id thành viên (uid="-1" là
 * sentinel "@All" — cùng quy ước đã dùng ở forwardEngine.js cho tag-all khi
 * chuyển tiếp), `pos`/`len` là offset ký tự (JS string, không phải byte) của
 * đúng đoạn "@Tên"/"@All" trong text gửi đi.
 */

export const ALL_MENTION_UID = "-1";
export const ALL_MENTION_TOKEN = "@All";

export type MentionCandidate = {
  uid: string;
  display_name: string | null;
  avatar: string | null;
};

/**
 * 1 mention đã chèn vào ô soạn tin, CHỜ resolve lại thành {pos,len} lúc gửi
 * (xem resolvePendingMentions) — KHÔNG lưu vị trí sống ngay lúc chèn, vì
 * người dùng có thể gõ thêm/xoá text ở bất kỳ đâu sau đó làm lệch offset.
 */
export type PendingMention = { uid: string; token: string };

/**
 * Bỏ dấu tiếng Việt để so khớp không phân biệt dấu/hoa-thường. `đ`/`Đ` không
 * tự decompose qua NFD (không phải chữ Latin + dấu kết hợp) nên phải thay tay,
 * nếu không tên như "Đức", "Đạt" sẽ không khớp khi gõ "duc", "dat" bỏ dấu.
 */
export function foldAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Tìm đoạn "@<đang gõ>" ngay trước con trỏ trong ô soạn tin — gọi lại mỗi lần
 * nội dung/con trỏ đổi để quyết định có mở popup mention hay không.
 *
 * Điều kiện hợp lệ (khớp hành vi Zalo thật):
 *   - "@" đứng đầu tin nhắn HOẶC ngay sau khoảng trắng/xuống dòng (không phải
 *     email, không phải giữa 1 từ như "a@b").
 *   - Từ "@" tới con trỏ KHÔNG chứa khoảng trắng/xuống dòng — gõ thêm dấu
 *     cách coi như huỷ ý định tag, đúng hành vi Zalo thật.
 */
export function findActiveMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  if (cursor < 0 || cursor > text.length) return null;
  const uptoCursor = text.slice(0, cursor);
  const at = uptoCursor.lastIndexOf("@");
  if (at < 0) return null;
  const before = at > 0 ? uptoCursor[at - 1] : "\n";
  if (!/[\s\n]/.test(before) && at !== 0) return null;
  const query = uptoCursor.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;
  return { start: at, query };
}

/** true nếu tên thành viên (không dấu) chứa `query` (không dấu). */
export function matchesQuery(name: string | null | undefined, query: string): boolean {
  if (!query) return true;
  return foldAccents(name || "").includes(foldAccents(query));
}

/**
 * Hàng "Báo cho cả nhóm" hiện khi query rỗng hoặc là tiền tố của "all"/
 * "tat ca"/"bao cho ca nhom" — cho gõ tắt kiểu Zalo thật ("@all") lẫn gõ theo
 * tiếng Việt không dấu.
 */
export function matchesAllMention(query: string): boolean {
  if (!query) return true;
  const q = foldAccents(query);
  return ["all", "tat ca", "bao cho ca nhom"].some((candidate) => candidate.startsWith(q));
}

const MAX_MENTION_RESULTS = 40;

/** Lọc + giới hạn số thành viên hiện trong popup (nhóm rất đông không nên render hết). */
export function filterMentionCandidates(members: MentionCandidate[], query: string): MentionCandidate[] {
  return members.filter((m) => matchesQuery(m.display_name, query)).slice(0, MAX_MENTION_RESULTS);
}

/**
 * Chèn 1 mention đã chọn vào text, thay thế đúng đoạn "@<query đang gõ>" bằng
 * "<token> " (token = "@Tên thật" hoặc "@All"). Trả về text mới + vị trí con
 * trỏ mới (ngay sau khoảng trắng cuối token, để gõ tiếp không dính vào mention).
 */
export function insertMentionToken(
  text: string,
  range: { start: number; query: string },
  token: string
): { text: string; cursor: number } {
  const end = range.start + 1 + range.query.length;
  const inserted = `${token} `;
  const nextText = text.slice(0, range.start) + inserted + text.slice(end);
  return { text: nextText, cursor: range.start + inserted.length };
}

/**
 * Quy đổi các mention đã chèn (theo token text) thành {pos,uid,len} theo vị
 * trí THẬT trong text lúc gửi — KHÔNG track offset sống qua từng lần gõ (người
 * dùng có thể sửa tự do phần text phía trước mention), mà tìm lại đúng token
 * theo THỨ TỰ ĐÃ CHÈN, mỗi lần tìm bắt đầu ngay sau vị trí tìm thấy trước đó
 * (xử lý đúng khi trùng tên hoặc chèn "@All" nhiều lần).
 *
 * Mention nào bị người dùng xoá/sửa mất token gốc thì tự động bị bỏ qua
 * (không tìm thấy nữa) — quay lại thành chữ thường, không còn tag, đúng hành
 * vi Zalo thật khi xoá dở một mention.
 */
export function resolvePendingMentions(
  text: string,
  pending: PendingMention[]
): Array<{ uid: string; pos: number; len: number }> {
  const out: Array<{ uid: string; pos: number; len: number }> = [];
  let searchFrom = 0;
  for (const { uid, token } of pending) {
    const idx = text.indexOf(token, searchFrom);
    if (idx < 0) continue;
    out.push({ uid, pos: idx, len: token.length });
    searchFrom = idx + token.length;
  }
  return out;
}
