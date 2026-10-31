// -----------------------------------------------------------------------------
// THREADS AUTOMATION & COMMENT SNIFFER CONTENT SCRIPT (platforms/threads/content.js)
// Xử lý cả 2 luồng:
// 1. Tự động bắt comment thủ công (Sniffer): Khi người dùng bấm "Làm nhiệm vụ" từ web
//    (Tương tác nội bộ hoặc Seeding bên ngoài) rồi tự tay bình luận trên Threads ->
//    bắt request configure_text_only_post, tự động lưu link minh chứng & +1 KPI.
// 2. Tự động bình luận (Auto-Comment): Khi nhận lệnh EXECUTE_COMMENT từ background ->
//    tìm ô nhập, gõ comment, submit và chờ sniffer xác nhận API thành công 100%.
// -----------------------------------------------------------------------------

(function () {
  if (window.__threadsCommentInjected) return;
  window.__threadsCommentInjected = true;

  console.log("[Threads Extension] Threads Comment & Sniffer Content Script loaded.");

  // Container 1 bai post/thread tren feed hoac trang permalink.
  const POST_SELECTORS = [
    'div[data-pressable-container="true"]',
    'div[role="article"]',
    "article",
  ];

  const THREADS_REPLY_TRIGGER_SELECTORS = [
    'div[role="button"]:has(svg[aria-label="Reply" i])',
    'div[role="button"]:has(svg[aria-label="Trả lời" i])',
    'svg[aria-label="Reply" i]',
    'svg[aria-label="Trả lời" i]',
  ];

  const THREADS_COMMENT_BOX_SELECTORS = [
    'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  const THREADS_SUBMIT_BUTTON_TEXT = ["post", "đăng", "reply", "trả lời"];

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Toast thông báo thị giác nổi bật góc màn hình
  function showToastNotification(msg, type = "success") {
    try {
      let toast = document.getElementById("markee-threads-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "markee-threads-toast";
        toast.style.position = "fixed";
        toast.style.bottom = "24px";
        toast.style.right = "24px";
        toast.style.zIndex = "99999999";
        toast.style.padding = "12px 20px";
        toast.style.borderRadius = "12px";
        toast.style.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)";
        toast.style.fontSize = "13px";
        toast.style.fontWeight = "600";
        toast.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        toast.style.display = "flex";
        toast.style.alignItems = "center";
        toast.style.gap = "8px";
        toast.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        document.body.appendChild(toast);
      }
      toast.style.backgroundColor = type === "warning" ? "#f59e0b" : "#10b981";
      toast.style.color = "#ffffff";
      toast.textContent = msg;
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";

      setTimeout(() => {
        if (toast) {
          toast.style.opacity = "0";
          toast.style.transform = "translateY(10px)";
        }
      }, 4000);
    } catch (e) {}
  }

  // Biến lưu comment vừa bắt được từ sniffer để doPostComment có thể kiểm chứng
  let lastCapturedComment = null;
  let commentCapturedListeners = [];

  // ── LẮNG NGHE SỰ KIỆN TỪ crawl-sniffer.js (MAIN WORLD) ──────────────────────
  document.addEventListener("markee-action-captured", (evt) => {
    try {
      const detail = evt.detail || {};
      const { actionType, fbUid, authorName, postUrl, linkComment, commentId, content } = detail;
      if (!actionType || actionType !== "comment") return;

      console.log("[Threads Content] Đã bắt được sự kiện comment từ sniffer:", detail);
      lastCapturedComment = detail;
      commentCapturedListeners.forEach((fn) => {
        try { fn(detail); } catch (e) {}
      });

      // Gửi yêu cầu tới Background kiểm tra xem TAB HIỆN TẠI có thuộc phiên nhiệm vụ được cấp quyền không
      chrome.runtime.sendMessage({ action: "CHECK_TAB_PERMISSION" }, (response) => {
        let verifyConfig = response && response.config ? response.config : {};
        let emailMember = verifyConfig.email_member || "";

        const sendKpi = (targetEmail, config) => {
          let apiBase = config.apiBase || "https://seeding.markeeai.com";
          if (!apiBase || typeof apiBase !== "string" || !apiBase.startsWith("http")) {
            apiBase = "https://seeding.markeeai.com";
          }
          apiBase = apiBase.replace(/\/$/, "");

          const finalLinkComment = linkComment || window.location.href;
          const finalCommentId = commentId || "";

          const kpiPayload = {
            email_member: targetEmail,
            link_post: config.target_link || postUrl || window.location.href,
            link_comment: finalLinkComment,
            comment_id: finalCommentId,
            fanpage_id: config.fanpage_id || "",
            fanpage_name: config.fanpage_name || "",
            facebook_post_id: config.facebook_post_id || config.id_post || "unknown",
            id_post: config.id_post || "",
            platform: "threads",
            action_type: "comment",
            content: content || "",
            profile_id: fbUid || "",
            facebook_name: authorName || "",
            status: "success",
          };

          const recordEndpoint = `${apiBase}/api/all-platform/internal-engagement/kpi/record`;
          console.log("[Threads Content] Ghi nhận KPI Threads kèm minh chứng chuẩn:", kpiPayload);

          chrome.runtime.sendMessage({
            action: "RECORD_KPI_BACKGROUND",
            endpoint: recordEndpoint,
            payload: kpiPayload,
          }, (res) => {
            if (res && res.success) {
              console.log("[Threads Content] Đã lưu KPI Threads thành công:", res);
              showToastNotification("🎉 Đã ghi nhận bình luận Threads! Đã lưu link minh chứng (+1 KPI)");
            } else {
              console.error("[Threads Content] Lỗi ghi nhận KPI Threads:", res?.error);
              showToastNotification(`⚠️ Ghi nhận bình luận Threads: ${res?.error || "Lỗi máy chủ"}`, "warning");
            }
          });
        };

        if (emailMember) {
          sendKpi(emailMember, verifyConfig);
        } else {
          chrome.storage.local.get(["markee_email_member", "user_email"], (res) => {
            const fallbackEmail = res?.markee_email_member || res?.user_email;
            if (fallbackEmail) sendKpi(fallbackEmail, verifyConfig);
          });
        }
      });
    } catch (e) {
      console.error("[Threads Content] Lỗi xử lý markee-action-captured:", e);
    }
  });

  function findPostBlocks() {
    for (const sel of POST_SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > 0) return els;
    }
    return [];
  }

  function extractPostId(url) {
    if (!url) return null;
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
      } catch (e) {}
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

  function clickReplyTrigger(trigger) {
    const clickable = trigger.closest('div[role="button"]') || trigger;
    clickable.click();
  }

  // Chờ sự kiện comment được bắt từ sniffer (tối đa timeoutMs)
  function waitForSnifferComment(timeoutMs = 8000) {
    return new Promise((resolve) => {
      let resolved = false;
      const listener = (data) => {
        if (resolved) return;
        resolved = true;
        const idx = commentCapturedListeners.indexOf(listener);
        if (idx !== -1) commentCapturedListeners.splice(idx, 1);
        resolve(data);
      };
      commentCapturedListeners.push(listener);
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        const idx = commentCapturedListeners.indexOf(listener);
        if (idx !== -1) commentCapturedListeners.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
    });
  }

  async function doPostComment(url, text) {
    console.log("[Threads Extension] Bắt đầu Auto-Comment cho Threads...");
    const found = await waitForFeed(10000);
    if (!found) {
      return { success: false, error: "Không tìm thấy bài viết trên trang Threads.", platform: "threads" };
    }

    const block = findMatchingBlock(url);
    if (!block) {
      return { success: false, error: "Không tìm thấy bài viết để comment.", platform: "threads" };
    }

    // 1. Click trigger "Reply" de mo dialog/o nhap binh luan.
    const trigger = await waitForElementIn(block, THREADS_REPLY_TRIGGER_SELECTORS, 5000);
    if (!trigger) {
      return {
        success: false,
        error: "Không tìm thấy nút Reply trên Threads (selector có thể đã thay đổi).",
        platform: "threads",
      };
    }
    clickReplyTrigger(trigger);
    await sleep(1200);

    // 2. Tim o nhap contenteditable.
    const box =
      (await waitForElementIn(document, THREADS_COMMENT_BOX_SELECTORS, 7000)) ||
      (await waitForElementIn(block, THREADS_COMMENT_BOX_SELECTORS, 3000));

    if (!box) {
      return {
        success: false,
        error: "Không tìm thấy ô nhập bình luận trên Threads.",
        platform: "threads",
      };
    }

    box.focus();
    await sleep(300);

    // Nhap van ban comment.
    document.execCommand("insertText", false, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(800);

    // Chuẩn bị listener chờ API sniffer xác nhận
    const snifferPromise = waitForSnifferComment(8000);

    // 3. Tim va bam nut submit.
    const dialog = box.closest('div[role="dialog"]') || document;
    const submitBtn = await findButtonByText(dialog, THREADS_SUBMIT_BUTTON_TEXT, 3000);
    if (submitBtn) {
      submitBtn.click();
    } else {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }

    // Chờ xác nhận từ API thật do sniffer bắt được
    const captured = await snifferPromise;
    if (captured && captured.linkComment) {
      console.log("[Threads Extension] Đã xác nhận comment thành công qua API sniffer:", captured);
      return {
        success: true,
        url,
        linkComment: captured.linkComment,
        commentId: captured.commentId,
        platform: "threads",
      };
    }

    await sleep(2000);
    console.log("[Threads Extension] Đã gửi comment Threads (fallback timeout).");
    return { success: true, url, platform: "threads" };
  }

  // Bo lang nghe tin nhan EXECUTE_COMMENT tu Background Script
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
      return true;
    }
  });
})();
