// -----------------------------------------------------------------------------
// THREADS AUTOMATION CONTENT SCRIPT (platforms/threads/content.js)
// Xu ly Auto-Comment cho Threads (threads.com / threads.net).
//
// 2 cach, chay theo thu tu:
//   1. API noi bo cua Threads (giong Facebook goi GraphQL) - xem postReplyViaApi.
//   2. Fallback bam DOM (Reply -> nhap -> Post) neu API bi tu choi.
//
// !!! CANH BAO: CA 2 CACH DEU CHUA TEST VOI TAI KHOAN THREADS THAT (may build
// khong dang nhap Threads). Neu API bao "API Threads tu choi" -> xem log console
// cua tab Threads de sua tham so; neu DOM bao "Khong tim thay..." -> chi can sua
// cac mang *_SELECTORS ngay duoi day.
// -----------------------------------------------------------------------------

(function () {
  if (window.__threadsCommentInjected) return;
  window.__threadsCommentInjected = true;

  console.log("[Threads Extension] Threads Comment Content Script loaded.");

  // Container 1 bai post/thread tren feed hoac trang permalink.
  const POST_SELECTORS = [
    'div[data-pressable-container="true"]',
    'div[role="article"]',
    "article",
  ];

  // Nut mo o binh luan tren thanh hanh dong cua bai. DOM that (kiem tra threads.com
  // 2026-09-27): div[role="button"] boc <svg><title>Comment</title>...</svg> - ten icon
  // nam trong <title> (KHONG phai aria-label), tieng Anh la "Comment" (khong phai
  // "Reply"). Doi chieu khong phan biet hoa thuong voi <title> hoac aria-label.
  const THREADS_REPLY_TRIGGER_LABELS = ["comment", "reply", "bình luận", "trả lời"];

  // O nhap binh luan (contenteditable) - thuong nam trong 1 dialog moi mo ra
  // sau khi bam Reply.
  const THREADS_COMMENT_BOX_SELECTORS = [
    'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  // Nut submit - Threads khong co aria-label/class on dinh cong khai, phai do
  // theo text hien thi cua nut ("Post" / "Đăng" / "Reply" / "Trả lời").
  const THREADS_SUBMIT_BUTTON_TEXT = ["post", "đăng", "reply", "trả lời"];

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findPostBlocks() {
    for (const sel of POST_SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > 0) return els;
    }
    return [];
  }

  function extractPostId(url) {
    if (!url) return null;
    // Link Threads dang: https://www.threads.net/@user/post/C1a2B3c4D5e
    const m = String(url).match(/\/post\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function resolvePostUrl(block) {
    const a = block.querySelector('a[href*="/post/"]');
    return a ? a.href : null;
  }

  function findMatchingBlock(targetUrl) {
    const blocks = findPostBlocks();
    if (blocks.length === 0) return null;
    const targetId = extractPostId(targetUrl);
    if (targetId) {
      for (const block of blocks) {
        const blockUrl = resolvePostUrl(block);
        if (blockUrl && extractPostId(blockUrl) === targetId) return block;
      }
    }
    return blocks[0];
  }

  function queryFirst(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = (root || document).querySelector(sel);
        if (el) return el;
      } catch (e) {
        // :has() co the khong duoc ho tro o Chrome cu - bo qua selector loi, thu cai tiep theo.
      }
    }
    return null;
  }

  function waitForElementIn(root, selectors, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        const el = queryFirst(root, selectors);
        if (el) return resolve(el);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 300);
      })();
    });
  }

  function findButtonByText(root, textList, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        const candidates = Array.from((root || document).querySelectorAll('div[role="button"], button'));
        const match = candidates.find((el) => {
          const label = (el.textContent || "").trim().toLowerCase();
          return label && textList.some((t) => label === t || label.includes(t));
        });
        if (match) return resolve(match);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 300);
      })();
    });
  }

  async function waitForFeed(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (findPostBlocks().length > 0) return true;
      await sleep(500);
    }
    return false;
  }

  function iconLabel(svg) {
    const title = svg.querySelector("title");
    return ((title && title.textContent) || svg.getAttribute("aria-label") || "").trim().toLowerCase();
  }

  function findReplyTrigger(block, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        const svgs = Array.from(block.querySelectorAll("svg"));
        const icon = svgs.find((svg) => THREADS_REPLY_TRIGGER_LABELS.includes(iconLabel(svg)));
        if (icon) return resolve(icon);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 300);
      })();
    });
  }

  function clickReplyTrigger(trigger) {
    // Trigger la <svg> - click vao div[role="button"] cha gan nhat de kich hoat dung.
    const clickable = trigger.closest('div[role="button"], button') || trigger;
    clickable.click();
  }

  // ---------------------------------------------------------------------------
  // CACH 1 (UU TIEN): GOI THANG API NOI BO CUA THREADS - giong cach Facebook
  // (content.js goc goi GraphQL bang fb_dtsg lay tu trang). Threads cung la Meta
  // (nen tang Instagram): dang reply = POST /api/v1/media/configure_text_only_post/
  // kem reply_id = media pk cua bai goc, xac thuc bang cookie phien dang nhap san
  // co trong trinh duyet + header x-csrftoken / x-ig-app-id. Neu API bi tu choi
  // (Meta doi tham so/endpoint) -> tu dong fallback sang CACH 2 (bam DOM) ben duoi.
  // ---------------------------------------------------------------------------
  const THREADS_WEB_APP_ID = "238260118697367";
  const THREADS_ASBD_ID = "129477";
  const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  // Ma bai trong link (/post/C-srcchPpp7) la shortcode base64 cua media pk (giong
  // Instagram) - da doi chieu voi pk that trong HTML threads.com.
  function shortcodeToMediaPk(code) {
    let n = BigInt(0);
    for (const ch of code) {
      const idx = SHORTCODE_ALPHABET.indexOf(ch);
      if (idx < 0) return null;
      n = n * BigInt(64) + BigInt(idx);
    }
    return n.toString();
  }

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function readPageToken(patterns) {
    const html = document.documentElement.innerHTML;
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return m[1];
    }
    return "";
  }

  function getThreadsSessionTokens() {
    const csrftoken =
      readCookie("csrftoken") || readPageToken([/"csrf_token":"([^"]+)"/, /"csrftoken":"([^"]+)"/]);
    const lsd = readPageToken([/"LSD",\[\],\{"token":"([^"]+)"/, /"lsd":"([^"]+)"/]);
    const viewerId = readCookie("ds_user_id") || readPageToken([/"viewerId":"(\d+)"/, /"user_id":"(\d+)"/]);
    return { csrftoken, lsd, viewerId };
  }

  // Tai khoan Threads dang dang nhap (username) - lay tu link "Profile" tren thanh
  // dieu huong (href="/@username"). Dung de ghi KPI dung danh tinh nguoi comment.
  function getLoggedInUsername() {
    const navLinks = Array.from(document.querySelectorAll('nav a[href^="/@"], a[role="link"][href^="/@"]'));
    const profileLink = navLinks.find((a) =>
      Array.from(a.querySelectorAll("svg")).some((svg) => ["profile", "trang cá nhân"].includes(iconLabel(svg))),
    );
    const href = (profileLink || navLinks[0])?.getAttribute("href") || "";
    const m = href.match(/^\/@([^/?#]+)/);
    return m ? m[1] : "";
  }

  async function postReplyViaApi(url, text) {
    // Link chia se (/share/XXX) khong co ma bai - tab da tu chuyen huong ve link bai
    // that nen lay ma tu dia chi hien tai cua tab.
    const code = extractPostId(url) || extractPostId(location.href);
    if (!code) return { success: false, error: "Link Threads không có mã bài (/post/...).", platform: "threads" };
    const replyId = shortcodeToMediaPk(code);
    if (!replyId) return { success: false, error: "Mã bài Threads không hợp lệ.", platform: "threads" };

    const tokens = getThreadsSessionTokens();
    if (!tokens.csrftoken) {
      return {
        success: false,
        error: "Không lấy được phiên đăng nhập Threads (csrftoken) — hãy đăng nhập threads.com trên trình duyệt này.",
        platform: "threads",
      };
    }

    const body = new URLSearchParams({
      audience: "default",
      caption: text,
      publish_mode: "text_post",
      text_post_app_info: JSON.stringify({ reply_control: 0, reply_id: replyId }),
      upload_id: String(Date.now()),
    });

    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrftoken": tokens.csrftoken,
      "x-ig-app-id": THREADS_WEB_APP_ID,
      "x-asbd-id": THREADS_ASBD_ID,
      "x-requested-with": "XMLHttpRequest",
    };
    if (tokens.lsd) headers["x-fb-lsd"] = tokens.lsd;

    let resp;
    try {
      resp = await fetch(`${location.origin}/api/v1/media/configure_text_only_post/`, {
        method: "POST",
        credentials: "include",
        headers,
        body: body.toString(),
      });
    } catch (e) {
      return { success: false, error: `Lỗi mạng khi gọi API Threads: ${e.message}`, platform: "threads" };
    }

    const raw = await resp.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(raw); } catch (e) { /* Threads tra HTML khi bi chan */ }

    if (!resp.ok || !json || json.status !== "ok" || !json.media) {
      const reason = (json && (json.message || json.error_title)) || `HTTP ${resp.status}`;
      console.warn("[Threads Extension] API reply bị từ chối:", resp.status, raw.slice(0, 300));
      return { success: false, error: `API Threads từ chối: ${reason}`, platform: "threads", apiRejected: true };
    }

    const username = json.media.user?.username || getLoggedInUsername();
    const replyUrl = json.media.code && username
      ? `https://www.threads.com/@${username}/post/${json.media.code}`
      : url;
    return {
      success: true,
      url: replyUrl,
      platform: "threads",
      method: "api",
      uid: json.media.user?.pk ? String(json.media.user.pk) : tokens.viewerId || undefined,
      account_name: username || undefined,
      account_url: username ? `https://www.threads.com/@${username}` : undefined,
    };
  }

  async function doPostComment(url, text) {
    console.log("[Threads Extension] Bắt đầu Auto-Comment cho Threads (thử API trước)...");
    const apiResult = await postReplyViaApi(url, text);
    if (apiResult.success) {
      console.log("[Threads Extension] Đã comment qua API:", apiResult.url);
      return apiResult;
    }
    // Chua dang nhap thi DOM cung khong lam duoc gi -> tra loi ro rang luon.
    if (!apiResult.apiRejected && /đăng nhập/i.test(apiResult.error || "")) return apiResult;
    console.warn("[Threads Extension] API thất bại, chuyển sang bấm giao diện:", apiResult.error);
    const domResult = await doPostCommentViaDom(url, text);
    if (!domResult.success) {
      domResult.error = `${domResult.error} (API trước đó: ${apiResult.error})`;
    }
    return domResult;
  }

  async function doPostCommentViaDom(url, text) {
    const found = await waitForFeed(10000);
    if (!found) {
      return { success: false, error: "Không tìm thấy bài viết trên trang Threads.", platform: "threads" };
    }

    const block = findMatchingBlock(extractPostId(url) ? url : location.href);
    if (!block) {
      return { success: false, error: "Không tìm thấy bài viết để comment.", platform: "threads" };
    }

    // 1. Click trigger "Reply" de mo dialog/o nhap binh luan.
    const trigger = await findReplyTrigger(block, 5000);
    if (!trigger) {
      return {
        success: false,
        error: "Không tìm thấy nút Reply trên Threads (selector có thể đã thay đổi, cần cập nhật THREADS_REPLY_TRIGGER_LABELS).",
        platform: "threads",
      };
    }
    clickReplyTrigger(trigger);
    await sleep(1200);

    // 2. Tim o nhap contenteditable (uu tien trong dialog vua mo).
    const box =
      (await waitForElementIn(document, THREADS_COMMENT_BOX_SELECTORS, 7000)) ||
      (await waitForElementIn(block, THREADS_COMMENT_BOX_SELECTORS, 3000));

    if (!box) {
      return {
        success: false,
        error: "Không tìm thấy ô nhập bình luận trên Threads (selector có thể đã thay đổi, cần cập nhật THREADS_COMMENT_BOX_SELECTORS).",
        platform: "threads",
      };
    }

    box.focus();
    await sleep(300);

    // Nhap van ban comment.
    document.execCommand("insertText", false, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(800);

    // 3. Tim va bam nut submit (do theo text vi Threads khong co class/aria-label on dinh).
    const dialog = box.closest('div[role="dialog"]') || document;
    const submitBtn = await findButtonByText(dialog, THREADS_SUBMIT_BUTTON_TEXT, 3000);
    if (submitBtn) {
      submitBtn.click();
    } else {
      // Fallback Enter - nhieu kha nang KHONG hoat dong vi o nhap Threads
      // thuong xuong dong bang Enter thay vi submit, nhung van thu nhu 1
      // phuong an cuoi truoc khi bao loi.
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
      await sleep(1000);
      return {
        success: false,
        error: "Không tìm thấy nút Post/Đăng trên Threads (selector có thể đã thay đổi, cần cập nhật THREADS_SUBMIT_BUTTON_TEXT). Đã thử Enter nhưng chưa xác nhận được kết quả.",
        platform: "threads",
      };
    }

    await sleep(2500);
    console.log("[Threads Extension] Đã gửi comment Threads thành công (qua giao diện)!");
    const username = getLoggedInUsername();
    return {
      success: true,
      url,
      platform: "threads",
      method: "dom",
      account_name: username || undefined,
      account_url: username ? `https://www.threads.com/@${username}` : undefined,
    };
  }

  // Bo lang nghe tin nhan EXECUTE_COMMENT tu Background Script - cung contract
  // voi platforms/linkedin/content.js.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXECUTE_COMMENT" || request.type === "EXECUTE_COMMENT") {
      const payload = request.payload || {};
      const text = request.text || payload.text;
      const url = request.url || payload.url || window.location.href;

      if (!text || !text.trim()) {
        sendResponse({ success: false, error: "Nội dung comment trống.", platform: "threads" });
        return false;
      }

      doPostComment(url, text.trim()).then((res) => sendResponse(res));
      return true; // Giu kenh giao tiep Asynchronous mo
    }
  });
})();
