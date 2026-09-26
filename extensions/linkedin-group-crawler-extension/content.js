// LinkedIn Group Post Crawler — content script (DOM-scraping).
// Selector port trực tiếp từ linkedin_group_crawler/app/modules/linkedin/services/parser_service.py
// (đã kiểm chứng thật qua pipeline Playwright hiện có).

(function () {
  if (window.__liCrawlerInjected) return;
  window.__liCrawlerInjected = true;

  const POST_SELECTORS = [
    'div[componentkey^="update-card-focus"]',
    'div[data-id^="urn:li:activity"]',
    'article[data-urn*="urn:li:activity"]',
    "article.feed-shared-update-v2",
    "div.feed-shared-update-v2",
    "div.occludable-update",
  ];
  const AUTHOR_SELECTORS = [
    '.update-components-actor__name span[aria-hidden="true"]',
    ".feed-shared-actor__name",
    'a[href*="/in/"] span[aria-hidden="true"]',
  ];
  // "[data-testid=expandable-text-box]" đã xác minh thật (2026-09-26, HTML người dùng gửi)
  // là testid LinkedIn dùng chung cho cả nội dung bài viết LẪN nội dung từng comment —
  // ưu tiên selector này, các class cũ (đã xác nhận chết ở comment-extension) giữ làm fallback.
  const CONTENT_SELECTORS = [
    '[data-testid="expandable-text-box"]',
    ".update-components-text",
    ".feed-shared-text",
    '[data-test-id="main-feed-activity-card__commentary"]',
  ];
  const TIME_SELECTORS = [
    ".update-components-actor__sub-description span[aria-hidden='true']",
    ".feed-shared-actor__sub-description",
    'span[aria-label*="ago"]',
  ];
  const REACTION_SELECTORS = [
    ".social-details-social-counts__reactions-count",
    'button[aria-label*="reaction"]',
    'a[aria-label*="reaction"]',
    'span[aria-label*="reaction"]',
    'button[aria-label*="lượt thích"]',
    'a[aria-label*="lượt thích"]',
    '[data-test-id="social-details-social-counts__reactions-count"]',
    ".reactions-count",
  ];
  const COMMENT_SELECTORS = [
    'button[aria-label*="comment"]',
    'a[aria-label*="comment"]',
    'span[aria-label*="comment"]',
    'button[aria-label*="bình luận"]',
    'a[aria-label*="bình luận"]',
    ".social-details-social-counts__comments",
    ".social-details-social-counts__comments button",
    '[data-test-id="social-details-social-counts__comments-count"]',
    ".comments-count",
  ];
  const REPOST_SELECTORS = ['button[aria-label*="repost"]', 'button[aria-label*="share"]'];
  const LINK_SELECTORS = [
    'a[href*="/feed/update/"]',
    'a[href*="/posts/"]',
    'a[href*="/activity-"]',
    'a[aria-label="Original Post"]',
  ];
  const SEE_MORE_RE = /^(…|\.\.\.)?\s*(see more|xem thêm)$/i;

  // --- Bình luận + danh sách người react (xác minh 1 phần qua HTML thật 2026-09-26) ---
  // Đã xác minh thật: mỗi khối comment có id dạng
  // "replaceableComment_urn:li:comment:(activity:...,commentId:...)".
  const COMMENT_BLOCK_SELECTOR = 'div[id^="replaceableComment_urn:li:comment:"]';
  // Đã xác minh thật: ảnh đại diện luôn có alt="View <Tên>'s profile..." — dùng chung
  // cho cả tên tác giả bài viết, tác giả comment, và (best-effort) người react.
  const PROFILE_NAME_RE = /^View (.+?)(?:&#39;|'|’)s profile/i;
  const MAX_COMMENTS_PER_POST = 20;
  const MAX_LIKERS_PER_POST = 30;

  function nameFromProfileImg(root) {
    try {
      const imgs = root.querySelectorAll('img[alt^="View "]');
      for (const img of imgs) {
        const m = (img.getAttribute("alt") || "").match(PROFILE_NAME_RE);
        if (m) return m[1].trim();
      }
    } catch (e) {}
    return "";
  }

  function extractCommentLikes(commentNode) {
    try {
      const icon = commentNode.querySelector('svg[id*="thumbs-up" i], svg[class*="thumbs-up" i]');
      if (icon) {
        const container = icon.closest("button") || icon.parentElement;
        if (container) return extractNumber((container.innerText || container.textContent || "").trim());
      }
    } catch (e) {}
    return 0;
  }

  // Chỉ đọc các khối comment ĐANG có sẵn trong DOM (đã mở qua expandComments()) —
  // không tự suy đoán cấu trúc container bọc ngoài (chưa có HTML mẫu), chỉ dựa vào
  // pattern id đã xác minh của từng khối comment riêng lẻ.
  function extractComments(block) {
    const out = [];
    try {
      const nodes = Array.from(block.querySelectorAll(COMMENT_BLOCK_SELECTOR));
      for (const node of nodes) {
        if (out.length >= MAX_COMMENTS_PER_POST) break;
        const author_name = nameFromProfileImg(node);
        const linkEl = node.querySelector('a[href*="/in/"]');
        const author_url = linkEl && linkEl.href ? linkEl.href.split("?")[0] : "";
        const contentEl = node.querySelector('[data-testid="expandable-text-box"]');
        const content = contentEl ? (contentEl.innerText || contentEl.textContent || "").trim() : "";
        const likes = extractCommentLikes(node);
        if (author_name || content) {
          out.push({ author_name, author_url, content, likes });
        }
      }
    } catch (e) {}
    return out;
  }

  // Mở khung bình luận nếu chưa mở (bấm đúng 1 lần vào nút/đếm số comment đã có sẵn
  // trong COMMENT_SELECTORS) rồi đợi khối comment đầu tiên xuất hiện. Best-effort —
  // im lặng bỏ qua nếu không tìm được nút hoặc không có comment nào để mở.
  async function expandComments(block, commentsCount) {
    if (!commentsCount || commentsCount <= 0) return;
    if (block.querySelector(COMMENT_BLOCK_SELECTOR)) return;
    let trigger = null;
    for (const sel of COMMENT_SELECTORS) {
      try {
        const el = block.querySelector(sel);
        if (el) {
          trigger = el;
          break;
        }
      } catch (e) {}
    }
    if (!trigger) return;
    try {
      trigger.click();
    } catch (e) {
      return;
    }
    const start = Date.now();
    while (Date.now() - start < 4000) {
      if (block.querySelector(COMMENT_BLOCK_SELECTOR)) return;
      await sleep(300);
    }
  }

  // CHƯA xác minh bằng HTML thật của popup "ai đã react" (đang chờ người dùng gửi thêm) —
  // best-effort: bấm vào phần tử đếm reaction (REACTION_SELECTORS, đã xác minh), tìm
  // dialog mở ra bằng thuộc tính chuẩn ARIA role="dialog" (không đoán class hash), rồi
  // đọc tên qua đúng pattern alt ảnh đại diện đã xác minh ở trên. Luôn đóng lại popup và
  // không bao giờ throw — nếu cấu trúc thật khác, chỉ đơn giản trả về mảng rỗng.
  async function extractLikersBestEffort(block) {
    const names = [];
    let trigger = null;
    for (const sel of REACTION_SELECTORS) {
      try {
        const el = block.querySelector(sel);
        if (el) {
          trigger = el;
          break;
        }
      } catch (e) {}
    }
    if (!trigger) return names;
    try {
      trigger.click();
    } catch (e) {
      return names;
    }

    let dialog = null;
    const start = Date.now();
    while (Date.now() - start < 3000) {
      dialog = document.querySelector('div[role="dialog"]');
      if (dialog) break;
      await sleep(200);
    }

    if (dialog) {
      try {
        const imgs = Array.from(dialog.querySelectorAll('img[alt^="View "]'));
        for (const img of imgs) {
          if (names.length >= MAX_LIKERS_PER_POST) break;
          const m = (img.getAttribute("alt") || "").match(PROFILE_NAME_RE);
          if (m) {
            const name = m[1].trim();
            if (name && !names.includes(name)) names.push(name);
          }
        }
      } catch (e) {}
      try {
        const closeBtn = dialog.querySelector(
          'button[aria-label*="dismiss" i], button[aria-label*="close" i], button[aria-label*="đóng" i]'
        );
        if (closeBtn) closeBtn.click();
        else
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true })
          );
      } catch (e) {}
    }
    return names;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randomBetween(min, max) {
    return Math.floor(min + Math.random() * (max - min));
  }

  function firstMatchText(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          const text = (el.innerText || el.textContent || "").trim();
          if (text) return text;
        }
      } catch (e) {
        // selector không hợp lệ trên phiên bản DOM hiện tại — bỏ qua, thử selector kế tiếp
      }
    }
    return "";
  }

  function firstMatchAriaLabel(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          const label = el.getAttribute("aria-label") || "";
          if (label) return label;
        }
      } catch (e) {}
    }
    return "";
  }

  function extractNumber(text) {
    if (!text) return 0;
    const cleaned = String(text).replace(/,/g, "");
    const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([kKmM]?)/);
    if (!match) return 0;
    let value = parseFloat(match[1]);
    const suffix = match[2].toLowerCase();
    if (suffix === "k") value *= 1000;
    else if (suffix === "m") value *= 1000000;
    return Math.round(value);
  }

  function extractStatNumber(root, selectors) {
    const text = firstMatchText(root, selectors);
    if (text) {
      const n = extractNumber(text);
      if (n > 0 || /\d/.test(text)) return n;
    }
    const label = firstMatchAriaLabel(root, selectors);
    return extractNumber(label);
  }

  async function trySeeMore(root) {
    try {
      const contentEl = CONTENT_SELECTORS.map((sel) => root.querySelector(sel)).find(Boolean);
      if (!contentEl) return;
      const candidates = contentEl.querySelectorAll("button, span[role='button'], span");
      for (const el of candidates) {
        const text = (el.innerText || el.textContent || "").trim();
        if (SEE_MORE_RE.test(text)) {
          el.click();
          await sleep(600);
          return;
        }
      }
    } catch (e) {
      // best-effort — không throw nếu không tìm được nút "xem thêm"
    }
  }

  function resolvePostUrl(block) {
    const attrCandidates = [block.getAttribute("data-id"), block.getAttribute("data-urn")];
    for (const attr of attrCandidates) {
      if (attr) {
        const m = attr.match(/urn:li:activity:(\d+)/);
        if (m) return `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`;
      }
    }
    for (const sel of LINK_SELECTORS) {
      try {
        const el = block.querySelector(sel);
        if (el && el.href) return el.href;
      } catch (e) {}
    }
    return null;
  }

  async function extractPost(block, groupUrl, groupName) {
    await trySeeMore(block);
    const post_url = resolvePostUrl(block);
    if (!post_url) return null;

    // Đọc nội dung/tác giả bài viết TRƯỚC khi mở khung comment — tránh trường hợp
    // querySelector CONTENT_SELECTORS (dùng chung testid với comment) lỡ khớp nhầm
    // vào 1 comment thay vì nội dung bài viết sau khi khung comment đã mở ra.
    const author = firstMatchText(block, AUTHOR_SELECTORS) || "";
    const content = firstMatchText(block, CONTENT_SELECTORS) || "";
    const posted_at_raw = firstMatchText(block, TIME_SELECTORS) || "";
    const likes = extractStatNumber(block, REACTION_SELECTORS);
    const commentsCount = extractStatNumber(block, COMMENT_SELECTORS);
    const reposts = extractStatNumber(block, REPOST_SELECTORS);

    await expandComments(block, commentsCount);
    const comments_list = extractComments(block);
    const likers = await extractLikersBestEffort(block);

    return {
      post_url,
      author,
      content,
      posted_at_raw,
      likes,
      comments: commentsCount,
      reposts,
      comments_list,
      likers,
      group_url: groupUrl,
      group_name: groupName,
      crawled_at: new Date().toISOString(),
    };
  }

  function findPostBlocks() {
    for (const sel of POST_SELECTORS) {
      try {
        const nodes = Array.from(document.querySelectorAll(sel));
        if (nodes.length) return nodes;
      } catch (e) {}
    }
    return [];
  }

  function detectGroupName() {
    const selectors = ["h1", '[data-test-id*="group-name"]', '[data-test-id*="groups-name"]', ".groups-hero__main-title"];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const text = el && (el.innerText || el.textContent || "").trim();
        if (text) return text;
      } catch (e) {}
    }
    return (document.title || "").split("|")[0].trim();
  }

  function isNearBottom() {
    return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < 300;
  }

  function waitForNewContent(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const observer = new MutationObserver(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  async function waitForFeed(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (findPostBlocks().length > 0) return true;
      await sleep(500);
    }
    return false;
  }

  // --- Single-post fetch/comment (dùng cho dashboard, khác với luồng cào cả group) ---

  function extractActivityId(url) {
    if (!url) return null;
    const m = String(url).match(/activity[:-](\d{6,})/);
    return m ? m[1] : null;
  }

  // Trang permalink 1 bài viết có thể vẫn hiện thêm carousel "bài liên quan" dùng
  // cùng selector — không thể lấy blocks[0] một cách mù quáng, phải so khớp activity id.
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

  async function doFetchPostInfo(url) {
    const found = await waitForFeed(10000);
    if (!found) {
      return { success: false, error: "Không tìm thấy bài viết trên trang (cần đăng nhập LinkedIn hoặc bài đã bị xóa/riêng tư)." };
    }
    await sleep(1000);
    const block = findMatchingBlock(url);
    if (!block) {
      return { success: false, error: "Không tìm thấy bài viết trên trang (cần đăng nhập LinkedIn hoặc bài đã bị xóa/riêng tư)." };
    }
    const post = await extractPost(block, null, null);
    if (!post) return { success: false, error: "Không trích xuất được nội dung bài viết." };
    return {
      success: true,
      author: post.author,
      content: post.content,
      likes: post.likes,
      comments: post.comments,
      shares: post.reposts,
      comments_list: post.comments_list,
      likers: post.likers,
      permalink_url: post.post_url,
    };
  }

  function waitForElementIn(root, selectors, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        for (const sel of selectors) {
          try {
            const el = root.querySelector(sel);
            if (el) return resolve(el);
          } catch (e) {}
        }
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 300);
      })();
    });
  }

  // Đã xác minh qua inspect DOM thật (2026-08-13): nút gửi thật có class
  // "comments-comment-box__submit-button--cr" (LinkedIn gắn hậu tố kiểu "--cr" theo
  // A/B test, có thể đổi khác sau này) — dùng [class*=] để khớp dù hậu tố có đổi.
  const LI_COMMENT_TRIGGER_SELECTORS = ['button[aria-label*="Comment" i]', 'button[aria-label*="bình luận" i]'];
  const LI_COMMENT_BOX_SELECTORS = ['div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'];
  const LI_COMMENT_SUBMIT_SELECTORS = [
    'button[class*="comments-comment-box__submit-button"]',
    'button.artdeco-button--primary',
    'button[type="submit"]',
  ];

  async function doPostComment(url, text) {
    const found = await waitForFeed(10000);
    if (!found) return { success: false, error: "Không tìm thấy bài viết trên trang." };
    const block = findMatchingBlock(url);
    if (!block) return { success: false, error: "Không tìm thấy bài viết để comment." };

    const trigger = await waitForElementIn(block, LI_COMMENT_TRIGGER_SELECTORS, 5000);
    if (trigger) {
      trigger.click();
      await sleep(1200);
    }

    const box =
      (await waitForElementIn(block, LI_COMMENT_BOX_SELECTORS, 7000)) ||
      (await waitForElementIn(document, LI_COMMENT_BOX_SELECTORS, 3000));
    if (!box) return { success: false, error: "Không tìm thấy ô nhập bình luận." };

    box.focus();
    await sleep(300);
    document.execCommand("insertText", false, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(500);

    // Ưu tiên bấm nút gửi; LinkedIn (khác Facebook) nhiều khả năng KHÔNG submit chỉ bằng
    // Enter — Enter chỉ dùng làm fallback cuối cùng nếu không tìm thấy nút gửi.
    const submitBtn = await waitForElementIn(box.closest("form") || document, LI_COMMENT_SUBMIT_SELECTORS, 3000);
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click();
    } else {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }
    await sleep(2000);
    return { success: true, url };
  }

  function send(message) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (e) {
      // extension context có thể đã bị invalidate (reload) — bỏ qua, không throw
    }
  }

  class Crawler {
    constructor() {
      this.running = false;
      this.postsCount = 0;
      this.scrollCount = 0;
      this.seenUrls = new Set();
      this.maxPosts = 40;
      this.scrollDelayMinMs = 2500;
      this.scrollDelayMaxMs = 5000;
    }

    configure(config) {
      config = config || {};
      this.maxPosts = config.maxPosts || 40;
      this.scrollDelayMinMs = config.scrollDelayMinMs || 2500;
      this.scrollDelayMaxMs = config.scrollDelayMaxMs || 5000;
    }

    stop() {
      this.running = false;
    }

    status() {
      return this.running ? "running" : "idle";
    }

    async start() {
      if (this.running) return;
      this.running = true;
      this.postsCount = 0;
      this.scrollCount = 0;
      this.seenUrls = new Set();

      const groupUrl = window.location.href.split("?")[0];
      const groupName = detectGroupName();

      send({ type: "LI_CRAWL_LOG", level: "info", message: `Đang tìm feed bài viết trên ${groupUrl}...` });
      const feedFound = await waitForFeed(10000);
      if (!this.running) return;
      if (!feedFound) {
        send({ type: "LI_CRAWL_ERROR", groupUrl, message: "Không tìm thấy feed bài viết. Kiểm tra đăng nhập LinkedIn / URL group." });
        this.running = false;
        return;
      }

      let idleScrolls = 0;
      const posts = [];

      while (this.running) {
        const blocks = findPostBlocks();
        let newFound = 0;
        for (const block of blocks) {
          if (!this.running || this.postsCount >= this.maxPosts) break;
          // Lọc nhanh theo post_url TRƯỚC khi gọi extractPost (giờ có thao tác nặng:
          // bấm mở khung comment + popup reaction) — tránh bấm lặp lại vào 1 bài đã
          // cào rồi mỗi lần nó còn nằm trong viewport qua các vòng lặp cuộn tiếp theo.
          const quickUrl = resolvePostUrl(block);
          if (!quickUrl || this.seenUrls.has(quickUrl)) continue;
          const post = await extractPost(block, groupUrl, groupName);
          if (!post || this.seenUrls.has(post.post_url)) continue;
          this.seenUrls.add(post.post_url);
          posts.push(post);
          this.postsCount++;
          newFound++;
          send({ type: "LI_CRAWL_POST", post });
        }

        send({
          type: "LI_CRAWL_PROGRESS",
          postsCount: this.postsCount,
          scrollCount: this.scrollCount,
          progressText: `Đã cào ${this.postsCount} bài, cuộn ${this.scrollCount} lần`,
        });

        if (newFound === 0) idleScrolls++;
        else idleScrolls = 0;

        if (this.postsCount >= this.maxPosts) {
          send({ type: "LI_CRAWL_LOG", level: "success", message: `Đã đạt số bài tối đa (${this.maxPosts}).` });
          break;
        }
        if (idleScrolls >= 4) {
          send({ type: "LI_CRAWL_LOG", level: "warn", message: "Cuộn 4 lần liên tiếp không thấy bài mới — dừng." });
          break;
        }
        if (isNearBottom() && this.scrollCount > 3) {
          send({ type: "LI_CRAWL_LOG", level: "warn", message: "Đã gần cuối trang — dừng." });
          break;
        }

        const scrollAmount = randomBetween(500, 900);
        window.scrollBy(0, scrollAmount);
        this.scrollCount++;

        const baseDelay = randomBetween(this.scrollDelayMinMs, this.scrollDelayMaxMs);
        const jitter = baseDelay * (Math.random() * 0.4 - 0.2); // ±20%
        await waitForNewContent(Math.max(800, baseDelay + jitter));

        if (this.scrollCount % 5 === 0) {
          await sleep(randomBetween(1000, 3000));
        }
      }

      const wasStopped = !this.running;
      this.running = false;
      send({
        type: "LI_CRAWL_GROUP_DONE",
        groupUrl,
        groupName,
        posts,
        stopped: wasStopped,
      });
    }
  }

  const crawler = new Crawler();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "LI_CRAWL_RUN") {
      crawler.configure(msg.config);
      crawler.start();
      sendResponse({ ok: true });
    } else if (msg.type === "LI_CRAWL_HALT") {
      crawler.stop();
      sendResponse({ ok: true });
    } else if (msg.type === "LI_CRAWL_STATUS_QUERY") {
      sendResponse({ status: crawler.status(), postsCount: crawler.postsCount, scrollCount: crawler.scrollCount });
    } else if (msg.type === "LI_POST_FETCH_ONE") {
      doFetchPostInfo(msg.url).then(sendResponse);
      return true;
    } else if (msg.type === "LI_POST_COMMENT_ONE") {
      doPostComment(msg.url, msg.text).then(sendResponse);
      return true;
    }
  });

  send({ type: "LI_CRAWL_CONTENT_READY", url: window.location.href });
})();
