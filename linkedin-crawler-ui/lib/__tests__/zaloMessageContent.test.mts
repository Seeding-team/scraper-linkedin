/**
 * Comprehensive unit test suite for `lib/zaloMessageCatalog.ts` and `lib/zaloMessageContent.ts`.
 * Run directly with:
 *   node --experimental-strip-types d:\CrawlDataLinkedin\linkedin-crawler-ui\lib\__tests__\zaloMessageContent.test.mts
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// Allow Node ESM (`--experimental-strip-types`) to resolve extensionless relative `.ts` imports
// used by Next.js / TypeScript `moduleResolution: "bundler"`.
const tsResolveHook = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\\.(?:[cm]?js|[cm]?ts|json)$/i.test(specifier) &&
    context.parentURL
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const tsCandidate = path.resolve(parentDir, specifier + ".ts");
    if (existsSync(tsCandidate)) {
      return nextResolve(pathToFileURL(tsCandidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(tsResolveHook).toString("base64")}`);

const catalog = await import("../zaloMessageCatalog");
const contentMod = await import("../zaloMessageContent");

const {
  VIETNAM_BANK_BINS,
  ZALO_ACTION_LABELS,
  ZALO_FRIEND_EVENT_TEMPLATES,
  ZALO_GROUP_EVENT_TEMPLATES,
  ZALO_MSG_TYPE_LABELS,
  ZALO_SIDEBAR_BRACKET_LABELS,
  extractFreeTextBankAccounts,
  extractUrlsFromText,
  extractVietnamesePhones,
  formatMsgInfoActionList,
  formatZaloAnySidebarPreview,
  formatZaloFriendEvent,
  formatZaloGroupEvent,
  lookupVietnamBankByBin,
  lookupVietnamBankByKeyword,
} = catalog;

const {
  MSG_TYPE_KIND,
  extractContactPhone,
  formatBytes,
  formatDuration,
  kindLabel,
  normalizeStoredMessage,
  previewText,
} = contentMod;

// ── 1. Catalog Completeness Assertions ────────────────────────────────────────

test("Catalog dictionaries contain all 57 VN banks, 28 wire msgTypes, 22 actions, 31+ bracket labels", () => {
  assert.equal(VIETNAM_BANK_BINS.length, 57);
  assert.equal(Object.keys(ZALO_MSG_TYPE_LABELS).length, 28);
  assert.equal(Object.keys(ZALO_ACTION_LABELS).length, 22);
  assert.ok(Object.keys(ZALO_SIDEBAR_BRACKET_LABELS).length >= 32);
  assert.ok(Object.keys(ZALO_GROUP_EVENT_TEMPLATES).length >= 25);
  assert.ok(Object.keys(ZALO_FRIEND_EVENT_TEMPLATES).length >= 13);
  assert.ok(Object.keys(MSG_TYPE_KIND).length >= 28);

  assert.equal(lookupVietnamBankByBin("970436")?.shortName, "Vietcombank");
  assert.equal(lookupVietnamBankByBin(970422)?.shortName, "MB Bank");
  assert.equal(lookupVietnamBankByBin("9704261")?.shortName, "TNEX");
  assert.equal(lookupVietnamBankByKeyword("Chuyển qua Techcombank giúp em")?.bin, "970407");
  assert.equal(lookupVietnamBankByKeyword("VCB 0123456789")?.shortName, "Vietcombank");
  // Word-boundary negative test: "member" must NOT match "mb"
  assert.equal(lookupVietnamBankByKeyword("Add new member to combo"), null);
});

// ── 2. All 13 Real Production Shapes from prod_zalo_messages_audit.json ───────

test("Prod shape 1: webchat plain text (both JSON string envelope & object envelope)", () => {
  const stringRaw = JSON.stringify({
    data: {
      cmd: 521,
      dName: "Ngô Thị Mỹ Lành",
      content: "@Nguyễn Thanh add xong rồi nha",
      msgType: "webchat",
    },
    type: 1,
    isSelf: false,
  });
  const res = normalizeStoredMessage({
    type: "webchat",
    msg_kind: "webchat",
    content: "@Nguyễn Thanh add xong rồi nha",
    raw_content: stringRaw,
  });
  assert.equal(res.kind, "text");
  assert.equal(res.text, "@Nguyễn Thanh add xong rồi nha");
  assert.equal(res.attachments.length, 0);
  assert.equal(res.previewText, "@Nguyễn Thanh add xong rồi nha");
});

test("Prod shape 2: staff text row with staff metadata raw_content", () => {
  const res = normalizeStoredMessage({
    type: "text",
    msg_kind: "text",
    content: "bạn muốn triển khai blog trên naver",
    raw_content: {
      staff_name: "Minh",
      staff_email: "minhuit911@gmail.com",
      sender_staff: { name: "Minh", email: "minhuit911@gmail.com", avatar: null },
    },
  });
  assert.equal(res.kind, "text");
  assert.equal(res.text, "bạn muốn triển khai blog trên naver");
});

test("Prod shape 3: chat.photo envelope with hd/width/height params", () => {
  const res = normalizeStoredMessage({
    type: "image",
    msg_kind: "image",
    content: "",
    raw_content: {
      data: {
        msgType: "chat.photo",
        content: {
          href: "https://photo-stal-10.zdn.vn/gr/jpg/abc/photo.jpg",
          thumb: "https://photo-stal-10.zdn.vn/gr/jpg/abc/photo.jpg",
          title: "",
          action: "",
          params: JSON.stringify({
            width: 1881,
            height: 1083,
            hd: "https://photo-stal-10.zdn.vn/gr/jpg/abc/hd.jpg",
          }),
        },
      },
      type: 1,
      isSelf: false,
    },
  });
  assert.equal(res.kind, "image");
  assert.equal(res.attachments.length, 1);
  assert.equal(res.attachments[0].url, "https://photo-stal-10.zdn.vn/gr/jpg/abc/hd.jpg");
  assert.equal(res.attachments[0].width, 1881);
  assert.equal(res.attachments[0].height, 1083);
  assert.equal(res.previewText, "[Hình ảnh]");
});

test("Prod shape 4a & 4b: chat.recommended|recommened.link (with caption & mis-typed as image in DB)", () => {
  const markeeLink = normalizeStoredMessage({
    type: "chat.recommended",
    msg_kind: "chat.recommended",
    content: "https://app.markeeai.com/groups/abc/studio/def\n@Mylife dạ e mới làm prototype",
    raw_content: {
      data: {
        msgType: "chat.recommended",
        content: {
          href: "https://app.markeeai.com/groups/abc/studio/def",
          thumb: "",
          title: "https://app.markeeai.com/groups/abc/studio/def\n@Mylife dạ e mới làm prototype",
          action: "recommened.link",
          params: JSON.stringify({ mediaTitle: "Marketing Agents", src: "app.markeeai.com", type: 0 }),
          description: "Smart AI assistant to automate tasks",
        },
      },
    },
  });
  assert.equal(markeeLink.kind, "link");
  assert.equal(markeeLink.attachments[0].title, "Marketing Agents");
  assert.equal(markeeLink.attachments[0].domain, "app.markeeai.com");
  assert.equal(markeeLink.text, "@Mylife dạ e mới làm prototype");

  // Prod row mis-classified as type="image", msg_kind="image" in DB
  const meetLink = normalizeStoredMessage({
    type: "image",
    msg_kind: "image",
    content: "https://meet.google.com/ocg-rjsj-uma",
    raw_content: {
      data: {
        msgType: "chat.recommended",
        content: {
          href: "https://meet.google.com/ocg-rjsj-uma",
          thumb: "https://photo-stal-26.zdn.vn/gr/abc/thumb.jpg",
          title: "https://meet.google.com/ocg-rjsj-uma",
          action: "recommened.link",
          params: JSON.stringify({ mediaTitle: "Meet", src: "meet.google.com", type: 0 }),
          description: "Cuộc gọi trong thời gian thực của Google.",
        },
      },
    },
  });
  assert.equal(meetLink.kind, "link");
  assert.equal(meetLink.attachments[0].title, "Meet");
  assert.equal(meetLink.attachments[0].thumb_url, "https://photo-stal-26.zdn.vn/gr/abc/thumb.jpg");
  assert.equal(meetLink.previewText, "[Link] Meet");
});

test("Prod shape 5: share.file envelope (+ auto-append missing .fileExt + folder + expired)", () => {
  const res = normalizeStoredMessage({
    type: "share.file",
    msg_kind: "share.file",
    content: "Markee_Ads_AI_Copilot.html",
    raw_content: {
      data: {
        msgType: "share.file",
        content: {
          href: "https://file-stal-1.dlfl.vn/gr/abc/file123",
          title: "Markee_Ads_AI_Copilot",
          params: JSON.stringify({
            fileSize: "286344",
            checksum: "b1966626857d3dea292cf28b12b728e5",
            fileExt: "html",
            fdata: "{}",
            fType: 1,
          }),
        },
      },
    },
  });
  assert.equal(res.kind, "file");
  assert.equal(res.attachments[0].name, "Markee_Ads_AI_Copilot.html");
  assert.equal(res.attachments[0].ext, "html");
  assert.equal(res.attachments[0].size_bytes, 286344);
  assert.equal(res.attachments[0].checksum, "b1966626857d3dea292cf28b12b728e5");
  assert.equal(res.previewText, "[File] Markee_Ads_AI_Copilot.html");

  // Folder (FILE_FTYPE.FOLDER = 2) + expired (no href)
  const folder = normalizeStoredMessage({
    type: "share.file",
    raw_content: {
      data: {
        msgType: "share.file",
        content: {
          href: "",
          title: "Tai_Lieu_Du_An",
          params: JSON.stringify({ fType: 2, fileSize: "1024000" }),
        },
      },
    },
  });
  assert.equal(folder.kind, "folder");
  assert.equal(folder.attachments[0].is_folder, true);
  assert.equal(folder.attachments[0].expired, true);
  assert.equal(folder.previewText, "[Thư mục] Tai_Lieu_Du_An");
});

test("Prod shape 6: legacy type='group' with JSON-string raw_content contact share (recommened.user)", () => {
  const rawString = JSON.stringify({
    href: "https://zaloapp.com",
    type: "",
    thumb: "https://s160-26-ava-talk.zadn.vn/avatar.jpg",
    title: "Tdhgiang",
    action: "recommened.user",
    params: "519110756",
    childnumber: 0,
    description: JSON.stringify({
      phone: "0909369898",
      cardBackground: "https://res-zalo.zadn.vn/bg.png",
      qrCodeUrl: "https://qr-talk.zdn.vn/17/519110756/qr.jpg",
    }),
  });
  const res = normalizeStoredMessage({
    type: "group",
    msg_kind: "contact",
    content: "",
    raw_content: rawString,
  });
  assert.equal(res.kind, "contact");
  assert.equal(res.attachments[0].name, "Tdhgiang");
  assert.equal(res.attachments[0].phone, "0909369898");
  assert.equal(res.attachments[0].user_id, "519110756");
  assert.equal(res.attachments[0].qr_code_url, "https://qr-talk.zdn.vn/17/519110756/qr.jpg");
  assert.equal(res.previewText, "[Danh thiếp] Tdhgiang");
});

test("Prod shape 7: chat.sticker (catId field) & staff stickerUrl object", () => {
  const s1 = normalizeStoredMessage({
    type: "chat.sticker",
    msg_kind: "chat.sticker",
    content: "",
    raw_content: {
      data: {
        msgType: "chat.sticker",
        content: { id: 101213, type: 7, catId: 12832 },
      },
    },
  });
  assert.equal(s1.kind, "sticker");
  assert.equal(s1.attachments[0].sticker_id, 101213);
  assert.equal(s1.attachments[0].cate_id, 12832);
  assert.equal(s1.previewText, "[Sticker]");

  const s2 = normalizeStoredMessage({
    type: "image",
    msg_kind: "image",
    content: "",
    raw_content: {
      staff_name: "Nguyễn Minh Hoàng",
      stickerUrl: "https://zalo-api.zadn.vn/sticker.png",
      stickerWebpUrl: "https://zalo-api.zadn.vn/sticker.webp",
    },
  });
  assert.equal(s2.kind, "sticker");
  assert.equal(s2.attachments[0].url, "https://zalo-api.zadn.vn/sticker.webp");
});

test("Prod shape 8: chat.gif with double-m action='recommend.gif'", () => {
  const res = normalizeStoredMessage({
    type: "image",
    msg_kind: "image",
    content: "",
    raw_content: {
      data: {
        msgType: "chat.gif",
        content: {
          href: "https://zalo-gif.zadn.vn/anim/cat.gif",
          thumb: "https://zalo-gif.zadn.vn/anim/cat.gif",
          action: "recommend.gif",
          params: JSON.stringify({ width: 498, height: 372 }),
        },
      },
    },
  });
  assert.equal(res.kind, "gif");
  assert.equal(res.attachments[0].kind, "gif");
  assert.equal(res.attachments[0].width, 498);
  assert.equal(res.previewText, "[GIF]");
});

test("Prod shape 9: webchat|rtf recovers full rich text title and extracts inline URLs", () => {
  const fullText = "🔥 SALE CUỐI THÁNG tại https://lzd.co/Tram-Voucher ngay hôm nay!";
  const res = normalizeStoredMessage({
    type: "webchat",
    msg_kind: "webchat",
    content: "🔥 SALE CUỐI THÁNG...",
    raw_content: {
      data: {
        msgType: "webchat",
        content: {
          title: fullText,
          action: "rtf",
          params: JSON.stringify({ styles: [{ start: 0, len: 10, st: "b" }], ver: 0 }),
        },
      },
    },
  });
  assert.equal(res.kind, "text");
  assert.equal(res.text, fullText);
  assert.deepEqual(res.inlineUrls, ["https://lzd.co/Tram-Voucher"]);
});

test("Prod shape 10: chat.undo recalled message", () => {
  const res = normalizeStoredMessage({
    type: "chat.undo",
    msg_kind: null,
    content: "",
    raw_content: { data: { msgType: "chat.undo" } },
  });
  assert.equal(res.kind, "undo");
  assert.equal(res.isRecalled, true);
  assert.equal(res.text, "Tin nhắn đã được thu hồi");
  assert.equal(res.systemEvent?.category, "undo");
  assert.equal(res.previewText, "Tin nhắn đã được thu hồi");
});

test("Prod shape 11: chat.video.msg envelope", () => {
  const res = normalizeStoredMessage({
    type: "chat.video.msg",
    msg_kind: "chat.video.msg",
    content: "",
    raw_content: {
      data: {
        msgType: "chat.video.msg",
        content: {
          href: "https://video-stal.zdn.vn/clip.mp4",
          thumb: "https://photo-stal.zdn.vn/poster.jpg",
          title: "Demo sản phẩm",
          params: JSON.stringify({ duration: 42000, fileSize: 5242880 }),
        },
      },
    },
  });
  assert.equal(res.kind, "video");
  assert.equal(res.attachments[0].duration_ms, 42000);
  assert.equal(formatDuration(res.attachments[0].duration_ms), "0:42");
  assert.equal(formatBytes(res.attachments[0].size_bytes), "5,0 MB");
  assert.equal(res.text, "Demo sản phẩm");
});

test("Prod shape 12: chat.ecard|show.profile (ECARD_TYPE=2 friend accept, mis-typed as image in DB)", () => {
  const res = normalizeStoredMessage({
    type: "image",
    msg_kind: "image",
    content: "Lê Thị Sen đã đồng ý kết bạn",
    raw_content: {
      data: {
        dName: "Lê Thị Sen",
        msgType: "chat.ecard",
        content: {
          href: "https://res-zalo.zadn.vn/ecard-bg.png",
          type: "2",
          thumb: "https://s160-ava-talk.zadn.vn/ava.jpg",
          title: "",
          action: "show.profile",
          params: JSON.stringify({
            notifyTxt: "Lê Thị Sen đã đồng ý kết bạn",
            previewTxt: "[Thiệp] Gửi lời chào Lê Thị Sen",
            layoutType: 1,
          }),
          description: "Lê Thị Sen đã đồng ý kết bạn",
        },
      },
      type: 0,
      isSelf: false,
    },
  });
  assert.equal(res.kind, "system_notice");
  assert.equal(res.systemEvent?.category, "friend");
  assert.equal(res.systemEvent?.ecardType, 2);
  assert.equal(res.systemEvent?.title, "Lê Thị Sen đã đồng ý kết bạn");
  assert.equal(res.system_text, "Lê Thị Sen đã đồng ý kết bạn");
  assert.equal(res.previewText, "Lê Thị Sen đã đồng ý kết bạn");
});

test("Prod shape 13a: webchat|msginfo.actionlist (JSON string envelope, pinned photo notice)", () => {
  const rawStr = JSON.stringify({
    data: {
      dName: "Mylife",
      msgType: "webchat",
      content: {
        href: "",
        title: "Mylife đã ghim 1 tin nhắn hình ảnh.",
        action: "msginfo.actionlist",
        params: JSON.stringify({
          msg: {
            vi: "%1$s đã ghim 1 tin nhắn hình ảnh.",
            en: "%1$s pinned a photo message.",
          },
          highLightsV2: [{ uid: "123", dpn: "Mylife", ignoreNickname: 0, type: 0, ts: 0 }],
        }),
      },
    },
    type: 1,
    isSelf: false,
  });
  const res = normalizeStoredMessage({
    type: "image",
    msg_kind: "image",
    content: "Mylife đã ghim 1 tin nhắn hình ảnh.",
    raw_content: rawStr,
  });
  assert.equal(res.kind, "system_notice");
  assert.equal(res.systemEvent?.title, "Mylife đã ghim 1 tin nhắn hình ảnh.");
  assert.equal(res.systemEvent?.iconKind, "pin");
  assert.equal(formatMsgInfoActionList(rawStr), "Mylife đã ghim 1 tin nhắn hình ảnh.");
});

test("Prod shape 13b: chat.recommended|recommened.misscall delegates cleanly to zaloCallMessage (no sendBubbleMessage)", () => {
  const res = normalizeStoredMessage({
    type: "chat.recommended",
    msg_kind: "chat.recommended",
    content: "sendBubbleMessage",
    is_sent: false,
    raw_content: {
      data: {
        msgType: "chat.recommended",
        content: {
          href: "",
          title: "sendBubbleMessage",
          action: "recommened.misscall",
          description: "Cuộc gọi",
          params: JSON.stringify({
            callId: 999888,
            duration: 0,
            reason: 0,
            isCaller: 0,
            isEnableCallback: 1,
            calltype: 0,
          }),
        },
      },
      isSelf: false,
    },
  });
  assert.equal(res.kind, "call");
  assert.equal(res.callInfo?.isMissed, true);
  assert.equal(res.callInfo?.title, "Cuộc gọi thoại nhỡ");
  assert.equal(res.text, "");
  assert.ok(!res.previewText.includes("sendBubbleMessage"));
  assert.ok(res.previewText.includes("Cuộc gọi thoại nhỡ"));
});

// ── 3. Bankcard / ZInstant / VietQR & Group/Friend Events ────────────────────

test("Bankcard: zinstant.bankcard & chat.webcontent.v2 templateId=11845 with BIN enrichment", () => {
  const res = normalizeStoredMessage({
    type: "chat.webcontent.v2",
    content: "[Tài khoản ngân hàng]",
    raw_content: {
      data: {
        msgType: "chat.webcontent.v2",
        content: {
          action: "zinstant.bankcard",
          zinstantdata_id: "templateId=11845",
          params: JSON.stringify({
            item: {
              data_url: "https://zinst-stc.zadn.vn/transfer/11845/abc",
            },
            bin: "970436",
            account_no: "0071001234567",
            account_name: "NGUYEN VAN AN",
          }),
        },
      },
    },
  });
  assert.equal(res.kind, "bankcard");
  assert.equal(res.attachments.length, 1);
  assert.equal(res.attachments[0].bin, "970436");
  assert.equal(res.attachments[0].bank_short_name, "Vietcombank");
  assert.equal(res.attachments[0].account_number, "0071001234567");
  assert.equal(res.attachments[0].account_name, "NGUYEN VAN AN");
  assert.equal(res.attachments[0].data_url, "https://zinst-stc.zadn.vn/transfer/11845/abc?data=html");
  assert.equal(res.previewText, "[Thẻ ngân hàng]");
  assert.ok(!res.text.includes("mở Zalo để xem"));
});

test("Group events & Friend events formatters produce clean Vietnamese notices", () => {
  const joinEvt = formatZaloGroupEvent({
    act: "join",
    source: { id: "1", dName: "Tuấn" },
    updateMembers: [{ id: "2", dName: "Lan" }],
  });
  assert.equal(joinEvt?.title, "Lan được Tuấn thêm vào nhóm");
  assert.equal(joinEvt?.iconKind, "group_join");

  const renameEvt = formatZaloGroupEvent({
    act: "update",
    source: { id: "1", dName: "Minh" },
    updateInfo: { content: "Team Sales Q4" },
  });
  assert.equal(renameEvt?.title, 'Minh đổi tên nhóm thành "Team Sales Q4"');

  const friendReq = formatZaloFriendEvent({
    type: "friend.event",
    act: "req_v2",
    dName: "Trần Hùng",
    message: "Xin chào, mình bên đối tác",
    isSelf: false,
  });
  assert.equal(friendReq?.title, "Trần Hùng đã gửi yêu cầu kết bạn đến bạn");
  assert.equal(friendReq?.subtitle, "Xin chào, mình bên đối tác");
  assert.equal(friendReq?.iconKind, "friend_request");

  const friendAccept = normalizeStoredMessage({
    type: "friend.event",
    raw_content: { type: "friend.event", act: "add", dName: "Hương" },
  });
  assert.equal(friendAccept.kind, "system_notice");
  assert.equal(friendAccept.systemEvent?.title, "Bạn và Hương đã trở thành bạn bè");
});

test("Poll, Reminder, Todo, Location normalization", () => {
  const poll = normalizeStoredMessage({
    type: "group.poll",
    raw_content: {
      data: {
        msgType: "group.poll",
        dName: "An",
        content: {
          action: "create",
          params: JSON.stringify({
            pollId: 77,
            question: "Trưa nay ăn gì?",
            options: [{ content: "Cơm tấm" }, { content: "Bún bò" }],
          }),
        },
      },
    },
  });
  assert.equal(poll.kind, "system_notice");
  assert.equal(poll.systemEvent?.category, "poll");
  assert.deepEqual(poll.systemEvent?.options, ["Cơm tấm", "Bún bò"]);

  const loc = normalizeStoredMessage({
    type: "chat.location.new",
    raw_content: {
      data: {
        msgType: "chat.location.new",
        content: { title: "Landmark 81", description: "Bình Thạnh, TP.HCM", lat: 10.795, lon: 106.7218 },
      },
    },
  });
  assert.equal(loc.kind, "location");
  assert.equal(loc.attachments[0].lat, 10.795);
  assert.equal(loc.attachments[0].lon, 106.7218);
  assert.equal(loc.previewText, "[Vị trí] Landmark 81");
});

// ── 4. Smart Inline Extractors & Negative / Edge Tests ───────────────────────

test("Inline phone & free-text bank account extraction (no false positives on dates/timestamps/URLs)", () => {
  const msg =
    "Anh ck giúp em qua Techcombank 1903 6543 2100 12\nCTK: NGUYEN MINH HOANG\nCó gì gọi SĐT 0909.369.898 hoặc +84 912 345 678 ngày 25-11-2026 nhé https://example.com/order/19036543210012";

  const phones = extractVietnamesePhones(msg);
  assert.deepEqual(
    phones.map((p) => p.normalized),
    ["0909369898", "0912345678"],
  );

  assert.deepEqual(extractUrlsFromText("Xem tại https://example.com/order/19036543210012."), [
    "https://example.com/order/19036543210012",
  ]);

  const banks = extractFreeTextBankAccounts(msg);
  assert.equal(banks.length, 1);
  assert.equal(banks[0].accountNo, "19036543210012");
  assert.equal(banks[0].bankShortName, "Techcombank");
  assert.equal(banks[0].bin, "970407");
  assert.equal(banks[0].accountName, "NGUYEN MINH HOANG");

  // Standalone 12-digit STK -> detected
  assert.deepEqual(extractFreeTextBankAccounts("0071001234567"), [{ accountNo: "0071001234567" }]);
  // Standalone VN phone -> NOT falsely flagged as bank account
  assert.deepEqual(extractFreeTextBankAccounts("0909369898"), []);
  // Standalone 13-digit Unix ms timestamp -> NOT falsely flagged
  assert.deepEqual(extractFreeTextBankAccounts("1764091200000"), []);
  // Phone-as-STK with explicit bank name -> detected!
  const mbPhoneStk = extractFreeTextBankAccounts("MB Bank 0909369898");
  assert.equal(mbPhoneStk.length, 1);
  assert.equal(mbPhoneStk[0].bankShortName, "MB Bank");
  assert.equal(mbPhoneStk[0].accountNo, "0909369898");
});

test("Zero ugly fallbacks across normalizeStoredMessage, previewText, and formatZaloAnySidebarPreview", () => {
  const cases = [
    { content: "sendBubbleMessage", type: "chat.recommended", is_sent: false },
    { content: "Tin nhắn dạng đặc biệt — mở Zalo để xem", type: "chat.recommended" },
    { content: '{"href":"https://zaloapp.com","action":"recommened.user","title":"Nam"}', type: "group" },
  ];
  for (const c of cases) {
    const p = formatZaloAnySidebarPreview(c);
    assert.ok(p.length > 0, `Preview should not be empty for ${JSON.stringify(c)}`);
    assert.ok(!/sendBubbleMessage/i.test(p), `Leaked sendBubbleMessage: ${p}`);
    assert.ok(!/mở Zalo để xem/i.test(p), `Leaked ugly fallback: ${p}`);
    assert.ok(!p.startsWith("{"), `Leaked raw JSON: ${p}`);
  }

  // Backward-compat helpers
  assert.equal(extractContactPhone({ description: '{"phone":"0988111222"}' }), "0988111222");
  assert.equal(kindLabel("bankcard"), "[Thẻ ngân hàng]");
  assert.equal(previewText({ kind: "file", attachments: [{ kind: "file", name: "baogia.pdf" }] }), "[File] baogia.pdf");
});
