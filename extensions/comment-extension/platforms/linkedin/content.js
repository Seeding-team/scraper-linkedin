// -----------------------------------------------------------------------------
// LINKEDIN AUTOMATION CONTENT SCRIPT (platforms/linkedin/content.js)
// Xử lý Auto-Comment cho LinkedIn (Permalinks / Posts / Activity)
// -----------------------------------------------------------------------------

(function () {
  if (window.__liCommentInjected) return;
  window.__liCommentInjected = true;

  console.log("[LinkedIn Extension] LinkedIn Comment Content Script loaded.");

  const POST_SELECTORS = [
    'div[data-id^="urn:li:activity"]',
    'article[data-urn*="urn:li:activity"]',
    "article.feed-shared-update-v2",
    "div.feed-shared-update-v2",
    "div.occludable-update",
  ];

  const LI_COMMENT_TRIGGER_SELECTORS = [
    'button[aria-label*="Comment" i]',
    'button[aria-label*="bình luận" i]',
    'button[aria-label*="Bình luận" i]'
  ];

  const LI_COMMENT_BOX_SELECTORS = [
    'div.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]'
  ];

  const LI_COMMENT_SUBMIT_SELECTORS = [
    'button[class*="comments-comment-box__submit-button"]',
    // LinkedIn hay doi ten class theo tung dot A/B test (2026-09-24: phat hien
    // 1 luong comment moi dung kien truc "server-driven UI" noi bo hoan toan
    // khac voi ban DOM cu — xem ghi chu o doPostComment). aria-label on dinh
    // hon class name qua cac ban UI khac nhau vi phuc vu accessibility, nen
    // uu tien cac selector nay truoc class-based.
    'button[aria-label*="Post comment" i]',
    'button[aria-label*="Đăng bình luận" i]',
    'button[aria-label*="Gửi bình luận" i]',
    'button.artdeco-button--primary',
    'button[type="submit"]',
  ];

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

  function extractActivityId(url) {
    if (!url) return null;
    const m = String(url).match(/activity[:-](\d{6,})/);
    return m ? m[1] : null;
  }

  function resolvePostUrl(block) {
    const a = block.querySelector('a[href*="/posts/"], a[href*="/feed/update/"], a[href*="/activity-"]');
    return a ? a.href : null;
  }

  function findMatchingBlock(targetUrl) {
    const blocks = findPostBlocks();
    if (blocks.length === 0) return null;
    const targetId = extractActivityId(targetUrl);
    if (targetId) {
      for (const block of blocks) {
        const blockUrl = resolvePostUrl(block);
        if (blockUrl && extractActivityId(blockUrl) === targetId) return block;
      }
    }
    return blocks[0];
  }

  function waitForElementIn(root, selectors, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        for (const sel of selectors) {
          try {
            const el = (root || document).querySelector(sel);
            if (el) return resolve(el);
          } catch (e) {}
        }
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

  // Doi nut Submit het "disabled" - LinkedIn (dac biet ban UI moi "server-driven
  // UI" phat hien 2026-09-24 qua sniffer, xem api-sniffer-*.json) validate noi
  // dung o phia client truoc khi mo khoa nut Gui, co the can vai trăm ms sau khi
  // dispatch event insertText moi cap nhat xong state noi bo cua no.
  function waitUntilEnabled(el, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (!el) return resolve(false);
        if (!el.disabled) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(poll, 200);
      })();
    });
  }

  // Xac nhan bang duoc THAT SU dang (khong chi "da bam nut") - truoc day ham
  // nay LUON tra success:true bat ke submitBtn co tim thay/bam duoc hay khong,
  // khien UI bao "Da gui thanh cong" ca khi khong dang duoc gi (phat hien khi
  // doc lai code sau khi user bao "van khong an gi" nhieu lan). Tin hieu dang
  // thanh cong dang tin cay nhat: o nhap contenteditable TRO VE RONG sau khi
  // submit (moi rich-text editor cua LinkedIn tu clear sau khi dang thanh cong).
  function waitUntilBoxCleared(box, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (!box || !box.isConnected) return resolve(true); // form da dong/box bi go khoi DOM = coi nhu thanh cong
        const current = (box.innerText || box.textContent || "").trim();
        if (!current) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(poll, 250);
      })();
    });
  }

  async function doPostComment(url, text) {
    console.log("[LinkedIn Extension] Bắt đầu Auto-Comment cho LinkedIn...");
    const found = await waitForFeed(10000);
    if (!found) {
      return { success: false, error: "Không tìm thấy bài viết trên trang LinkedIn.", platform: "linkedin" };
    }

    const block = findMatchingBlock(url);
    if (!block) {
      return { success: false, error: "Không tìm thấy bài viết để comment.", platform: "linkedin" };
    }

    // 1. Click Trigger nút Comment nếu ô nhập chưa mở
    const trigger = await waitForElementIn(block, LI_COMMENT_TRIGGER_SELECTORS, 5000);
    if (trigger) {
      trigger.click();
      await sleep(1200);
    }

    // 2. Tìm ô nhập liệu contenteditable
    const box =
      (await waitForElementIn(block, LI_COMMENT_BOX_SELECTORS, 7000)) ||
      (await waitForElementIn(document, LI_COMMENT_BOX_SELECTORS, 3000));

    if (!box) {
      return { success: false, error: "Không tìm thấy ô nhập bình luận (LinkedIn có thể đã đổi giao diện — cần cập nhật extension).", platform: "linkedin" };
    }

    box.focus();
    await sleep(300);

    // Nhap van ban comment. execCommand("insertText") kich hoat native
    // "input"/"beforeinput" event ma hau het framework (bao gom React) lang
    // nghe qua event delegation o root — nhung mot so trinh soan thao "kiem
    // soat" rieng (nhu ban SDUI moi cua LinkedIn) co the can them event
    // beforeinput voi inputType ro rang moi nhan dung. Dispatch ca 2 de tang
    // kha nang tuong thich, khong chi dua vao execCommand nhu ban cu.
    try {
      box.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    } catch (e) {
      // InputEvent voi inputType co the khong duoc ho tro o vai trinh duyet cu — bo qua, khong chan luong chinh
    }
    document.execCommand("insertText", false, text);
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    await sleep(800);

    // Neu sau khi nhap ma box van rong (execCommand khong an thua voi trinh
    // soan thao nay) thi bao loi ro rang ngay, khong lam tiep vo ich.
    const typedText = (box.innerText || box.textContent || "").trim();
    if (!typedText) {
      return {
        success: false,
        error: "Không nhập được nội dung vào ô bình luận (LinkedIn có thể dùng trình soạn thảo mới không tương thích execCommand — cần cập nhật extension).",
        platform: "linkedin",
      };
    }

    // 3. Tìm nút Submit, đợi nó hết "disabled" (LinkedIn tự validate nội dung
    // trước khi mở khóa nút — xem waitUntilEnabled), rồi mới bấm.
    const submitBtn = await waitForElementIn(box.closest("form") || document, LI_COMMENT_SUBMIT_SELECTORS, 3000);
    let clickedSubmit = false;

    if (submitBtn) {
      const becameEnabled = await waitUntilEnabled(submitBtn, 3000);
      if (becameEnabled) {
        submitBtn.click();
        clickedSubmit = true;
      } else {
        console.warn("[LinkedIn Extension] Nút Gửi vẫn bị disabled sau khi nhập nội dung — LinkedIn có thể chưa nhận diện được nội dung đã nhập.");
      }
    }

    if (!clickedSubmit) {
      // Fallback cuoi cung — CHI dung khi khong tim/bam duoc nut That, va KHONG
      // con coi day la "chac chan thanh cong" nhu ban cu nua (xem verify ben duoi).
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }

    // 4. XAC NHAN that su dang thanh cong bang tin hieu quan sat duoc (box
    // rong lai / bi go khoi DOM) — khong con "cu the la thanh cong" mu quang.
    const confirmed = await waitUntilBoxCleared(box, 4000);
    if (!confirmed) {
      return {
        success: false,
        error: clickedSubmit
          ? "Đã bấm nút Gửi nhưng không xác nhận được bình luận đã đăng thành công (ô nhập vẫn còn nội dung) — LinkedIn có thể đã đổi giao diện, cần kiểm tra lại extension."
          : "Không tìm thấy nút Gửi bình luận và cách gửi dự phòng (phím Enter) không xác nhận được đã đăng thành công — LinkedIn có thể đã đổi giao diện, cần cập nhật extension.",
        platform: "linkedin",
      };
    }

    console.log("[LinkedIn Extension] Đã gửi comment LinkedIn thành công (đã xác nhận ô nhập được reset)!");
    return { success: true, url, platform: "linkedin" };
  }

  // Bộ lắng nghe tin nhắn EXECUTE_COMMENT từ Background Script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXECUTE_COMMENT" || request.type === "EXECUTE_COMMENT" || request.type === "LI_POST_COMMENT_ONE") {
      const payload = request.payload || {};
      const text = request.text || payload.text;
      const url = request.url || payload.url || window.location.href;

      if (!text || !text.trim()) {
        sendResponse({ success: false, error: "Nội dung comment trống.", platform: "linkedin" });
        return false;
      }

      doPostComment(url, text.trim()).then((res) => sendResponse(res));
      return true; // Giữ kênh giao tiếp Asynchronous mở
    }
  });
})();
