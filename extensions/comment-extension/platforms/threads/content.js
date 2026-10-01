// -----------------------------------------------------------------------------
// THREADS AUTOMATION CONTENT SCRIPT (platforms/threads/content.js)
// Xu ly Auto-Comment cho Threads (threads.net) - mirror cua platforms/linkedin/content.js
//
// !!! CANH BAO: SELECTOR BEN DUOI LA BEST-EFFORT, CHUA TUNG TEST TREN THREADS.NET
// THAT (moi truong build khong co trinh duyet). Threads khong co API comment cong
// khai nen phai automation DOM giong LinkedIn - nhung cau truc DOM cua Threads
// (React/Instagram web) co the da doi so voi luc viet file nay. Sau khi cai
// extension va thu that, neu bam khong ra hoac bao loi "Khong tim thay...", chi
// can sua cac mang *_SELECTORS ngay duoi day, KHONG can dong gi den phan con lai.
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

  // Nut/icon "Tra loi" (Reply) de mo o nhap binh luan - Threads dung div[role="button"]
  // boc 1 svg co aria-label, khong phai <button> nhu LinkedIn.
  const THREADS_REPLY_TRIGGER_SELECTORS = [
    'div[role="button"]:has(svg[aria-label="Reply" i])',
    'div[role="button"]:has(svg[aria-label="Trả lời" i])',
    'svg[aria-label="Reply" i]',
    'svg[aria-label="Trả lời" i]',
  ];

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

  function clickReplyTrigger(trigger) {
    // Trigger co the la <svg> (khi chi svg[aria-label] match) - can click vao
    // div[role="button"] cha gan nhat de kich hoat dung.
    const clickable = trigger.closest('div[role="button"]') || trigger;
    clickable.click();
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
        error: "Không tìm thấy nút Reply trên Threads (selector có thể đã thay đổi, cần cập nhật THREADS_REPLY_TRIGGER_SELECTORS).",
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
    console.log("[Threads Extension] Đã gửi comment Threads thành công!");
    return { success: true, url, platform: "threads" };
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
