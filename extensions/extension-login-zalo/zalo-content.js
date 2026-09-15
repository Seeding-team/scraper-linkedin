(() => {
  if (window.__markeeZaloContentLoaded) return;
  window.__markeeZaloContentLoaded = true;

  const INVALID_CONVERSATION_IDS = new Set([
    "",
    "div_TabMsg_ThrdChItem",
    "div_Main_TabMsg",
    "btn_Main_TabMsg",
  ]);

  const CONVERSATION_ITEM_SELECTOR = [
    "#conversationListId .msg-item[data-id='div_TabMsg_ThrdChItem']",
    "#conversationListId .msg-item",
    "#conversationListId .conv-item",
    "#conversationListId [role='listitem']",
    "#conversationListId [role='button']",
    ".msg-item[data-id='div_TabMsg_ThrdChItem']",
    ".conv-item",
  ].join(",");

  const MESSAGE_CANDIDATE_SELECTOR = [
    "#messageViewScroll [data-qid]",
    "#messageViewScroll [id^='bb_msg_id_']",
    "#messageViewScroll .text-message__container[data-id*='ReceivedMsg']",
    "#messageViewScroll .text-message__container[data-id*='SentMsg']",
    "#messageViewScroll .img-msg-v2[data-id*='ReceivedMsg']",
    "#messageViewScroll .img-msg-v2[data-id*='SentMsg']",
    "#messageViewScroll .photo-message-v2",
    "#messageViewScroll .chat-message[data-component='bubble-message']",
    "#messageViewScroll .chat-message",
  ].join(",");

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .trim();
  }

  function uniqueLines(value) {
    const lines = normalizeText(value)
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
    const out = [];
    for (const line of lines) {
      if (out[out.length - 1] !== line) out.push(line);
    }
    return out.join("\n");
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity || "1") <= 0) return false;
    if (element.closest("[hidden], [aria-hidden='true']")) return false;
    return true;
  }

  function hashStable(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function firstAttr(element, names) {
    if (!element) return "";
    for (const name of names) {
      const value = element.getAttribute(name);
      if (value && value.trim()) return value.trim();
    }
    return "";
  }

  function cleanConversationId(value) {
    const raw = String(value || "").trim();
    if (!raw || INVALID_CONVERSATION_IDS.has(raw)) return "";
    if (/^div_|^btn_/.test(raw)) return "";
    return raw;
  }

  function comparableConversationId(value) {
    const raw = cleanConversationId(value).toLowerCase();
    if (/^g\d+$/.test(raw)) return raw.slice(1);
    return raw;
  }

  function parseQid(qid) {
    const value = String(qid || "").trim();
    if (!value || !value.includes("@")) {
      return { sender_id: null, timestamp: null, user_id: null, group_id: null };
    }
    const at = value.indexOf("@");
    const senderId = value.slice(0, at).trim() || null;
    const parts = value
      .slice(at + 1)
      .split("_")
      .map((part) => part.trim())
      .filter(Boolean);
    const timestamp = parts[0] && /^\d{10,}$/.test(parts[0]) ? parts[0] : null;
    const userId = parts[1] || null;
    const groupId = parts.length >= 3 ? parts[parts.length - 1] : null;
    return {
      sender_id: senderId,
      timestamp,
      user_id: userId,
      group_id: groupId,
    };
  }

  function qidFromElement(element) {
    if (!element) return "";
    if (element.getAttribute("data-qid")) return element.getAttribute("data-qid") || "";
    return element.querySelector("[data-qid]")?.getAttribute("data-qid") || "";
  }

  function messageIdFromElement(element) {
    if (!element) return "";
    const roots = [];
    let cursor = element;
    while (cursor && cursor instanceof Element && cursor !== document.body && roots.length < 8) {
      roots.push(cursor);
      cursor = cursor.parentElement;
    }
    for (const root of roots) {
      const id = root.id || "";
      const match = id.match(/^bb_msg_id_(\d+)/);
      if (match) return match[1];
      const child = root.querySelector("[id^='bb_msg_id_']");
      const childMatch = child?.id?.match(/^bb_msg_id_(\d+)/);
      if (childMatch) return childMatch[1];
    }
    const attrNames = ["data-msg-id", "data-message-id", "data-real-msg-id", "msgid", "message-id"];
    for (const root of roots) {
      const value = firstAttr(root, attrNames);
      if (value && !/^div_/.test(value)) return value;
    }
    const qid = qidFromElement(element);
    if (qid) return qid;
    return "";
  }

  function findDateText(element) {
    const item = element.closest(".chat-item") || element;
    let cursor = item.previousElementSibling;
    while (cursor) {
      if (cursor.matches(".block-date, .chat-date, [class*='date']")) {
        const text = normalizeText(cursor.textContent || "");
        if (text) return text;
      }
      cursor = cursor.previousElementSibling;
    }
    return "";
  }

  function findTimeText(root) {
    const nodes = root.querySelectorAll(".card-send-time__sendTime, .send-time, [class*='sendTime']");
    for (const node of nodes) {
      const value = normalizeText(node.textContent || "");
      if (/^\d{1,2}:\d{2}$/.test(value)) return value;
    }
    return "";
  }

  function findSenderName(root, isSent) {
    if (isSent) return "__me__";
    const node = root.querySelector(".message-sender-name-content .truncate, .message-sender-name-content");
    return normalizeText(node?.textContent || "") || null;
  }

  function isSentMessage(root) {
    const dataIdSignals = [
      "[data-id='div_SentMsg_Text']",
      "[data-id='div_LastSentMsg_Text']",
      "[data-id='div_SentMsg_Photo']",
      "[data-id='div_LastSentMsg_Photo']",
      "[data-id='btn_SentMsg_React']",
      "[data-id='btn_LastSentMsg_React']",
    ];
    if (dataIdSignals.some((selector) => root.matches(selector) || root.querySelector(selector))) return true;
    const classSignals = [
      root.className || "",
      root.closest(".chat-message")?.className || "",
      root.closest(".chat-item")?.className || "",
    ].join(" ");
    if (/\b(me|send-msg|msg-send|msg--out|msg-item--out|own-msg|message-wrapper--me)\b/i.test(classSignals)) {
      return true;
    }
    const rect = root.getBoundingClientRect();
    return rect.width > 40 && rect.left > window.innerWidth * 0.55 && !root.querySelector(".message-sender-name-content");
  }

  function textContentFromMessage(root) {
    const textNodes = Array.from(
      root.querySelectorAll(
        "span[data-component='text-container'] .text, " +
          "[data-component='text-container'] .text, " +
          "[data-component='text-container'], " +
          "[data-component='message-text-content'], " +
          ".text-message__container .text",
      ),
    ).filter((node) => !node.closest(".message-quote-fragment"));

    if (textNodes.length > 0) {
      return uniqueLines(textNodes.map((node) => node.innerText || node.textContent || "").join("\n"));
    }

    const caption = normalizeText(root.querySelector(".img-msg-v2__cap")?.textContent || "");
    if (caption) return caption;

    const linkTitle = normalizeText(root.querySelector(".link-message__link-title")?.textContent || "");
    const linkUrl =
      root.querySelector(".link-message .text-is-link")?.getAttribute("data-content") ||
      root.querySelector(".link-message .text-is-link")?.getAttribute("href") ||
      "";
    if (linkTitle || linkUrl) return [linkTitle, linkUrl].filter(Boolean).join(" | ");

    const fileName = normalizeText(root.querySelector(".file-message__content-title")?.textContent || "");
    if (fileName) return fileName;

    return "";
  }

  function imageUrlsFromMessage(root) {
    const selector = [
      ".img-msg-v2 img[src]",
      ".img-msg-v2 img[data-src]",
      ".photo-message-v2 img[src]",
      ".photo-message-v2 img[data-src]",
      "[id^='image-mCntr_'] img[src]",
      "[id^='image-mCntr_'] img[data-src]",
      "[data-component='message-content-view'] img[src]",
      "[data-component='message-content-view'] img[data-src]",
    ].join(",");
    const urls = [];
    const add = (value) => {
      const url = String(value || "").trim();
      if (!url || urls.includes(url)) return;
      if (/avatar|profile|sticker|emoji|reaction/i.test(url)) return;
      urls.push(url);
    };
    for (const img of root.querySelectorAll(selector)) {
      const rect = img.getBoundingClientRect();
      const classSignals = `${img.className || ""} ${img.parentElement?.className || ""}`;
      if (rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32)) continue;
      if (/avatar|profile|sticker|emoji|reaction/i.test(classSignals)) continue;
      add(img.currentSrc);
      add(img.getAttribute("src"));
      add(img.getAttribute("data-src"));
      add(img.closest("a")?.getAttribute("href"));
      const carrier = img.closest("[data-href], [data-url], [data-original], [data-full-src], [data-preview-src]");
      add(carrier?.getAttribute("data-href"));
      add(carrier?.getAttribute("data-url"));
      add(carrier?.getAttribute("data-original"));
      add(carrier?.getAttribute("data-full-src"));
      add(carrier?.getAttribute("data-preview-src"));
    }
    for (const node of root.querySelectorAll("[style*='background-image']")) {
      const value = window.getComputedStyle(node).backgroundImage || "";
      const match = value.match(/url\(["']?(.+?)["']?\)/);
      if (match) add(match[1]);
    }
    return urls;
  }

  function normalizeMessageRoot(node) {
    if (!node || !(node instanceof Element)) return null;
    if (node.matches("[data-qid], [id^='bb_msg_id_'], .text-message__container, .img-msg-v2, .photo-message-v2")) {
      return node;
    }
    return (
      node.closest("[data-qid]") ||
      node.closest("[id^='bb_msg_id_']") ||
      node.closest(".text-message__container") ||
      node.closest(".img-msg-v2") ||
      node.closest(".photo-message-v2") ||
      node.closest(".chat-message") ||
      node
    );
  }

  function parseMessage(root, activeGroupId) {
    const qid = qidFromElement(root);
    const qidParts = parseQid(qid);
    const isSent = isSentMessage(root);
    const imageUrls = imageUrlsFromMessage(root);
    const content = textContentFromMessage(root);
    const quoteText = normalizeText(root.querySelector(".message-quote-fragment__description")?.textContent || "");
    const timeText = findTimeText(root);
    const dateText = findDateText(root);
    const type = imageUrls.length > 0 ? "image" : root.querySelector(".file-message__container") ? "file" : "webchat";
    const fullText = normalizeText(root.textContent || "");
    const searchableFullText = fullText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const isDeleted = /tin nhan da bi thu hoi|message was unsent|this message was deleted/i.test(searchableFullText);

    if (!content && imageUrls.length === 0 && !isDeleted) return null;

    const rawMessageId = messageIdFromElement(root);
    const sourceMessageId =
      rawMessageId ||
      `dom-${hashStable([activeGroupId, qidParts.sender_id, qidParts.timestamp, timeText, content, imageUrls.join(",")].join("|"))}`;

    return {
      message_id: sourceMessageId,
      source_message_id: sourceMessageId,
      sender_id: isSent ? null : qidParts.sender_id,
      sender_name: findSenderName(root, isSent),
      timestamp: qidParts.timestamp || null,
      timestamp_text: qidParts.timestamp || null,
      time_text: timeText || dateText || null,
      type: isDeleted ? "system" : type,
      content: isDeleted ? "Tin nhan da bi thu hoi" : content || null,
      image_urls: imageUrls,
      quote_text: quoteText || null,
      is_sent: isSent,
      is_deleted: isDeleted,
    };
  }

  function visibleMessageRoots() {
    const scrollRoot = document.querySelector("#messageViewScroll") || document.querySelector("#messageView") || document;
    const seen = new Set();
    const roots = [];
    for (const node of scrollRoot.querySelectorAll(MESSAGE_CANDIDATE_SELECTOR)) {
      const root = normalizeMessageRoot(node);
      if (!root || !isVisible(root)) continue;
      const key = root.getAttribute("data-qid") || root.id || `${root.tagName}:${roots.length}:${normalizeText(root.textContent || "").slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(root);
    }
    return roots;
  }

  function activeConversationMeta(fallback = {}) {
    const headerName =
      normalizeText(document.querySelector("#header .header-title, .header-title")?.textContent || "") ||
      fallback.group_name ||
      "";
    const selected =
      document.querySelector("#conversationListId .conv-item.selected") ||
      document.querySelector("#conversationListId .msg-item.selected") ||
      document.querySelector(".conv-item.selected") ||
      fallback.element ||
      null;
    const selectedId = selected ? conversationIdFromElement(selected) : "";
    const avatarUrl = selected?.querySelector?.("img[src]")?.getAttribute("src") || fallback.avatar_url || null;
    const unreadText = normalizeText(selected?.querySelector?.(".z-noti-badge")?.textContent || "");
    return {
      group_id: selectedId || fallback.group_id || "",
      group_name: headerName || fallback.group_name || selectedId || "",
      avatar_url: avatarUrl,
      unread_count: /^\d+$/.test(unreadText) ? Number(unreadText) : fallback.unread_count ?? null,
    };
  }

  function scrapeActiveConversation(limit, fallback = {}) {
    const roots = visibleMessageRoots();
    const messages = [];
    let groupIdFromQid = "";
    for (const root of roots) {
      const qidParts = parseQid(qidFromElement(root));
      if (qidParts.group_id) groupIdFromQid = qidParts.group_id;
    }
    const meta = activeConversationMeta(fallback);
    const groupId = cleanConversationId(groupIdFromQid) || cleanConversationId(meta.group_id) || `dom-conv-${hashStable(meta.group_name || location.href)}`;
    const seen = new Set();
    for (const root of roots) {
      const message = parseMessage(root, groupId);
      if (!message) continue;
      if (seen.has(message.source_message_id)) continue;
      seen.add(message.source_message_id);
      messages.push(message);
    }
    const safeLimit = Math.max(1, Math.min(Number(limit || 50), 500));
    return {
      group_id: groupId,
      group_name: meta.group_name || groupId,
      avatar_url: meta.avatar_url || null,
      unread_count: meta.unread_count,
      messages: messages.slice(-safeLimit),
    };
  }

  function conversationIdFromElement(item) {
    if (!item) return "";
    const attrNames = [
      "anim-data-id",
      "data-convid",
      "data-thread-id",
      "data-threadid",
      "data-conversation-id",
      "data-cid",
      "data-uid",
      "data-zid",
      "id",
      "data-id",
    ];
    const direct = cleanConversationId(firstAttr(item, attrNames));
    if (direct) return direct;
    const child = item.querySelector("[anim-data-id], [data-convid], [data-thread-id], [data-conversation-id], [data-uid], [id]");
    const nested = child ? cleanConversationId(firstAttr(child, attrNames)) : "";
    if (nested) return nested;
    const href = item.querySelector("a[href]")?.getAttribute("href") || "";
    const hrefId = href ? cleanConversationId(href.replace(/[#?].*$/, "").split("/").filter(Boolean).pop() || "") : "";
    return hrefId;
  }

  function conversationNameFromElement(item) {
    const node =
      item.querySelector(".conv-item-title__name .truncate") ||
      item.querySelector(".conv-item-title__name") ||
      item.querySelector(".truncate") ||
      item;
    const lines = normalizeText(node.textContent || item.textContent || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
    return lines[0] || "";
  }

  function collectConversationRows() {
    const rows = [];
    const seen = new Set();
    for (const item of document.querySelectorAll(CONVERSATION_ITEM_SELECTOR)) {
      if (!isVisible(item)) continue;
      const name = conversationNameFromElement(item);
      if (!name) continue;
      const groupId = conversationIdFromElement(item);
      const key = `${groupId}|${name}|${rows.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const unreadText = normalizeText(item.querySelector(".z-noti-badge")?.textContent || "");
      rows.push({
        element: item,
        group_id: groupId || "",
        group_name: name,
        avatar_url: item.querySelector("img[src]")?.getAttribute("src") || null,
        unread_count: /^\d+$/.test(unreadText) ? Number(unreadText) : null,
        is_selected: item.matches(".selected, .conv-item.selected") || Boolean(item.querySelector(".conv-item.selected")),
      });
    }
    return rows;
  }

  async function waitAfterConversationClick(previousTitle) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const title = normalizeText(document.querySelector("#header .header-title, .header-title")?.textContent || "");
      if (title && title !== previousTitle) break;
      if (visibleMessageRoots().length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  function matchesRequestedConversation(row, requested) {
    if (!requested) return true;
    const needle = comparableConversationId(requested);
    if (!needle) return true;
    return (
      comparableConversationId(row.group_id || "") === needle ||
      String(row.group_name || "").toLowerCase() === needle
    );
  }

  async function scrapeDomMessages(params = {}) {
    const limit = Math.max(1, Math.min(Number(params.limit || 50), 500));
    const conversationLimit = Math.max(1, Math.min(Number(params.conversation_limit || 10), 50));
    const requested = params.conversation_id || "";
    const rows = collectConversationRows();
    let targets = rows.filter((row) => matchesRequestedConversation(row, requested));
    if (!requested) {
      targets = [
        ...targets.filter((row) => row.is_selected),
        ...targets.filter((row) => !row.is_selected),
      ].slice(0, conversationLimit);
    } else {
      targets = targets.slice(0, 1);
    }

    const conversations = [];
    if (targets.length === 0) {
      const active = scrapeActiveConversation(limit);
      if (requested && comparableConversationId(active.group_id) !== comparableConversationId(requested)) {
        throw new Error(
          `Requested conversation ${requested} was not found in the Zalo Web sidebar; active DOM conversation is ${active.group_id || "unknown"}.`,
        );
      }
      return {
        conversations: active.messages.length || active.avatar_url ? [active] : [],
        active_group_id: active.group_id,
        active_group_name: active.group_name,
      };
    }

    for (const row of targets) {
      const previousTitle = normalizeText(document.querySelector("#header .header-title, .header-title")?.textContent || "");
      if (!row.is_selected) {
        row.element.scrollIntoView({ block: "center", inline: "nearest" });
        row.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        row.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        row.element.click();
        await waitAfterConversationClick(previousTitle);
      }
      const scraped = scrapeActiveConversation(limit, row);
      if (scraped.messages.length > 0 || scraped.avatar_url || scraped.unread_count !== null) {
        conversations.push(scraped);
      }
    }

    const active = conversations[conversations.length - 1] || null;
    return {
      conversations,
      active_group_id: active?.group_id || null,
      active_group_name: active?.group_name || null,
    };
  }

  function findImeiCandidate() {
    // ƯU TIÊN đọc đúng key "z_uuid" — đây LÀ device id thật mà chính Zalo Web
    // lưu trong localStorage và gắn với session/cookie hiện tại (xác nhận qua
    // extension tham chiếu của module gốc — đọc thẳng `localStorage.getItem
    // ("z_uuid")`, không dò mò). Trước đây hàm này dò TOÀN BỘ localStorage/
    // sessionStorage theo pattern mơ hồ (bất kỳ chuỗi hex 16+ ký tự nào) — Zalo
    // Web lưu rất nhiều token/hash không liên quan (session token, feature
    // flag, analytics id...) cũng khớp pattern đó, nên dễ lấy NHẦM giá trị —
    // gửi sai imei lên khiến Zalo từ chối cookie đúng 100% với lỗi "session key
    // improperly submitted", hiển thị nhầm thành "phiên đăng nhập hết hạn".
    try {
      const zUuid = window.localStorage ? window.localStorage.getItem("z_uuid") : "";
      if (zUuid && /^[0-9a-f-]{16,}$/i.test(zUuid)) return zUuid;
    } catch (_) {
      // localStorage bị chặn — rơi xuống fallback dò mò bên dưới.
    }

    // Fallback: dò mò như cũ, CHỈ dùng khi không tìm được đúng "z_uuid" ở trên
    // (vd Zalo đổi tên key trong tương lai) — giữ lại để không mất khả năng
    // hoạt động hoàn toàn, nhưng đây không còn là đường đi chính.
    const candidates = [];
    try {
      for (const store of [window.localStorage, window.sessionStorage]) {
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index) || "";
          const value = store.getItem(key) || "";
          if (/imei|device|z_uuid|uuid/i.test(key) || /[0-9a-f-]{16,}/i.test(value)) {
            candidates.push(value);
          }
        }
      }
    } catch (_) {
      // Storage can be blocked; backend can generate an IMEI fallback.
    }
    return candidates.find((value) => /^[0-9a-f-]{16,}$/i.test(String(value))) || "";
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message?.action;
    const data = message?.data || {};
    (async () => {
      if (action === "PING_ZALO_CONTENT") return { ok: true };
      if (action === "GET_ZALO_CONTEXT") {
        return {
          user_agent: navigator.userAgent || "",
          imei: findImeiCandidate(),
          url: location.href,
        };
      }
      if (action === "GET_DOCUMENT_COOKIES") {
        // Đọc cookies từ document.cookie — có thể thấy cookies mà chrome.cookies.getAll
        // không trả về (session cookies, httpOnly được set bởi JS thay vì server header).
        const raw = String(document.cookie || "");
        const cookies = raw
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((pair) => {
            const eq = pair.indexOf("=");
            return eq >= 0
              ? { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
              : null;
          })
          .filter(Boolean)
          .filter((c) => /zalo|zppsid|zppwsid|zpsid|zphpsid/i.test(c.name));
        return { cookies: raw ? cookies : [], raw: raw };
      }
      if (action === "SCRAPE_ZALO_DOM_MESSAGES") return await scrapeDomMessages(data);
      throw new Error(`Unknown Zalo content action: ${action}`);
    })()
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  });
})();
