// ============================================================
// content.js — Core DOM extraction cho Facebook Group Feed
// Dựa trên post_extractor.py đã được kiểm chứng
// ============================================================

// ── Constants & Selectors (giống hệt Python) ────────────────
const SELECTORS = {
  FEED: 'div[role="feed"]',
  POST_BLOCKS: 'div[role="feed"] > div',
  CONTENT_PRIMARY: 'div[data-ad-comet-preview="message"], div[data-ad-rendering-role="story_message"], div[data-ad-preview="message"]',
  CONTENT_FALLBACK: 'div[dir="auto"]',
  SEE_MORE: 'div[role="button"], span[role="button"]',
  LINK: 'a[role="link"], a[href]',
  IMAGE: 'img',
  VIDEO: 'video',
  REACTIONS: '[aria-label]',
};

// ── Regex (giống hệt facebook_regex.py) ──────────────────────
const RE_POST_URL = /\/(posts|permalink|questions)\/|\?story_fbid=/i;
const RE_VIDEO_URL = /\/(videos|reel|watch|permalink\/video|video\/permalink)(\/|$|\?)|[?&]v=\d+|video\.php|video_id=|fb\.watch|fb\.com\/(reel|watch|videos)/i;
const RE_REACTION_NUM = /([\d.,]+\s*[KkMm]?)\s*người/i;
const RE_COMMENT = /([\d.,]+[KkMm]?)\s*bình\s*luận|bình\s*luận.*?([\d.,]+[KkMm]?)/i;
const RE_SHARE = /([\d.,]+\s*[KkMmTtBb]?)\s*(?:lượt\s*chia\s*sẻ|chia\s*sẻ|share)|(?:lượt\s*chia\s*sẻ|chia\s*sẻ|share).*?([\d.,]+\s*[KkMmTtBb]?)/i;
const RE_NON_REACTION = /bình luận|chia sẻ|comment|share|hành động|viết|gửi|xem ai|báo cáo|ẩn|theo dõi|lưu|sao chép|nhúng|thông báo|bạn bè|trang cá nhân|quản trị/i;

const RE_JUST_NOW = /vừa xong|just now/i;
const RE_SECONDS = /\d+\s*(giây|second)/i;
const RE_MINUTES = /\d+\s*(phút|minute|min)/i;
const RE_HOURS = /(\d+)\s*(giờ|hour|hr)/i;
const RE_TODAY = /hôm\s*nay|today/i;
const RE_YESTERDAY = /hôm\s*qua|yesterday/i;
const RE_DAYS_AGO = /\d+\s*(ngày|day)/i;
const RE_WEEKS_AGO = /\d+\s*(tuần|week)/i;
const RE_MONTHS = /tháng|january|february|march|april|may|june|july|august|september|october|november|december/i;

// ── Utility Functions ────────────────────────────────────────
function parseInteractions(raw) {
  if (!raw) return 0;
  raw = raw.trim();

  const suffixMatch = raw.match(/^([\d.]+)\s*([KkMmTt])\b/);
  const mult = { k: 1000, m: 10000000 };
  let num = 0;

  if (suffixMatch) {
    num = parseFloat(suffixMatch[1]);
    if (suffixMatch[2].toLowerCase() === 'm') num *= 1000000;
    else num *= 1000;
  } else {
    const clean = raw.replace(/[.,]/g, (m) => m === ',' ? '' : '.');
    const onlyNum = clean.match(/([\d.]+)/);
    if (onlyNum) {
      num = parseFloat(onlyNum[1]);
    }
  }

  if (raw.includes('K') || raw.includes('k')) num = Math.round(num / 1000) * 1000;
  if (raw.includes('M') || raw.includes('m')) num = Math.round(num / 1000000) * 1000000;

  return Math.max(0, Math.round(num));
}

function extract_ts_hint(raw) {
  if (!raw) return '';
  const patterns = [RE_JUST_NOW, RE_SECONDS, RE_MINUTES, RE_HOURS, RE_TODAY, RE_YESTERDAY, RE_DAYS_AGO, RE_WEEKS_AGO, RE_MONTHS];
  for (const p of patterns) {
    const m = p.exec(raw);
    if (m) return m[0].trim();
  }
  return '';
}

function classify_timestamp(ts) {
  if (!ts) return 'unknown';
  const t = ts.toLowerCase().trim();
  const now = new Date();

  if (t.includes('vừa xong')) return 'recent';
  if (RE_SECONDS.test(t)) return 'recent';
  if (RE_MINUTES.test(t)) {
    const m = t.match(/(\d+)\s*(phút|minute|min)/);
    if (m && parseInt(m[1]) <= 60) return 'recent';
    return 'old';
  }
  if (RE_HOURS.test(t)) {
    const m = t.match(/(\d+)\s*(giờ|hour|hr)/);
    if (m && parseInt(m[1]) <= 24) return 'recent';
    return 'old';
  }
  if (RE_TODAY.test(t)) return 'recent';
  if (RE_YESTERDAY.test(t)) return 'recent';
  if (RE_DAYS_AGO.test(t)) {
    const m = t.match(/(\d+)\s*(ngày|day)/);
    if (m && parseInt(m[1]) <= 1) return 'recent';
    return 'old';
  }
  if (RE_WEEKS_AGO.test(t)) return 'old';
  if (RE_MONTHS.test(t)) return 'old';

  return 'unknown';
}

function clean_post_url(href) {
  if (!href) return '';
  if (href.startsWith('/')) href = 'https://www.facebook.com' + href;
  try {
    const u = new URL(href);
    const KEEP = ['story_fbid', 'id', 'v', 'video_id', 'fbid', 'set'];
    const params = new URLSearchParams();
    KEEP.forEach(k => {
      const v = u.searchParams.get(k);
      if (v) params.set(k, v);
    });
    return u.origin + u.pathname + (params.toString() ? '?' + params.toString() : '');
  } catch {
    return href;
  }
}

// ── 1. Expand "Xem thêm" ───────────────────────────────────
function expandSeeMore(block) {
  try {
    const result = block.evaluate((el) => {
      const commentSection = el.querySelector(
        '[role="article"] [role="article"], '
        + '[aria-label*="Comment"], '
        + '[aria-label*="Bình luận"], '
        + '[data-testid*="comment"]'
      );

      const buttons = el.querySelectorAll('div[role="button"], span[role="button"]');
      let clicked = false;

      for (const btn of buttons) {
        const txt = (btn.innerText || '').trim().toLowerCase();
        if (txt === 'xem thêm' || txt === 'see more' || txt === 'more') {
          if (commentSection && commentSection.contains(btn)) continue;
          if (commentSection && (commentSection.compareDocumentPosition(btn) & 4)) continue;
          btn.click();
          clicked = true;
        }
      }
      return clicked;
    });

    if (result) {
      // Đợi text bung ra
      return new Promise(resolve => setTimeout(resolve, 800));
    }
  } catch {}
  return Promise.resolve();
}

// ── 2. Lấy URL bài viết + timestamp ────────────────────────
function getInfo(block) {
  let url = null;
  let postDate = '';

  try {
    const links = block.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (/([?&])(comment_id|reply_comment_id)=/i.test(href)) continue;

      if (!RE_POST_URL.test(href) && !href.includes('/posts/') && !href.includes('/permalink/') && !href.includes('story_fbid')) {
        continue;
      }

      const candidate = clean_post_url(href);
      if (!candidate) continue;

      if (!url) url = candidate;

      const raw = (link.getAttribute('aria-label') || link.innerText || '').trim();
      if (raw) {
        const ts = extract_ts_hint(raw);
        if (classify_timestamp(ts) !== 'unknown') {
          url = candidate;
          postDate = ts;
          break;
        }
      }
    }
  } catch {}

  return { url, postDate };
}

// ── 3. Lấy nội dung text ───────────────────────────────────
async function getContent(block) {
  // 1. Thử click "Xem thêm" trước
  await expandSeeMore(block);

  // 2. Tầng 1: data-ad-comet-preview
  try {
    const node = block.querySelector('div[data-ad-comet-preview="message"], div[data-ad-rendering-role="story_message"], div[data-ad-preview="message"]');
    if (node) {
      const text = node.innerText?.trim();
      if (text) return text;
    }
  } catch {}

  // 3. Tầng 2: div[dir="auto"] (bỏ qua comment section)
  try {
    const result = block.evaluate((el) => {
      const commentSection = el.querySelector(
        '[role="article"] [role="article"], '
        + '[aria-label*="Comment"], '
        + '[aria-label*="Bình luận"], '
        + '[data-testid*="comment"]'
      );

      const allDirs = el.querySelectorAll('div[dir="auto"]');
      let bestText = '';
      const banWords = ['viết bình luận', 'write a comment', 'xem thêm bình luận', 'view more comments'];

      for (const div of allDirs) {
        if (div.closest('[role=\"article\"] [role=\"article\"], [aria-label*=\"bình luận\" i], [aria-label*=\"comment\" i], [aria-label*=\"trả lời\" i], [aria-label*=\"reply\" i], [data-testid*=\"comment\" i]')) continue;
        if (commentSection && commentSection.contains(div)) continue;
        if (commentSection && (commentSection.compareDocumentPosition(div) & 4)) continue;

        const txt = (div.innerText || '').trim();
        if (txt.length < 20) continue;

        const isBanned = banWords.some(w => txt.toLowerCase().includes(w));
        if (isBanned) continue;

        if (txt.length > bestText.length) {
          bestText = txt;
        }
      }
      return bestText;
    });

    if (result) return result.trim();
  } catch {}

  return '';
}

// ── 4. Lấy reactions/comments/shares ──────────────────────
function getStats(block) {
  let reactions = 0, comments = 0, shares = 0;

  try {
    const seenLabels = new Set();

    // Bước 1: Quét aria-label
    const ariaLabels = block.querySelectorAll('[aria-label]');
    for (const node of ariaLabels) {
      const label = (node.getAttribute('aria-label') || '').trim();
      if (!label || seenLabels.has(label)) continue;
      seenLabels.add(label);
      const ll = label.toLowerCase();

      if (RE_NON_REACTION.test(ll)) continue;

      if (ll.includes('người')) {
        const m = RE_REACTION_NUM.exec(label);
        if (m) reactions += parseInteractions(m[1]);
      }

      if (!comments) {
        const cm = RE_COMMENT.exec(label);
        if (cm) {
          const numStr = cm[1] || cm[2];
          if (numStr) comments = parseInteractions(numStr);
        }
      }

      if (!shares) {
        const sm = RE_SHARE.exec(label);
        if (sm) {
          const numStr = sm[1] || sm[2];
          if (numStr) shares = parseInteractions(numStr);
        }
      }
    }
  } catch {}

  try {
    // Bước 2: Quét nút bấm (số mồ côi)
    const pureNumbers = [];
    let actionBarHit = false;

    const btns = block.querySelectorAll('div[role="button"], span[role="button"], div[role="link"], a[role="link"]');
    for (const btn of btns) {
      const txt = (btn.innerText || '').trim();
      if (!txt) continue;
      const ll = txt.toLowerCase();

      if (['thích', 'like', 'trả lời', 'reply', 'chia sẻ', 'share', 'viết bình luận'].includes(ll)) {
        actionBarHit = true;
      }

      if (!comments) {
        const cm = RE_COMMENT.exec(txt);
        if (cm) {
          const numStr = cm[1] || cm[2];
          if (numStr) comments = parseInteractions(numStr);
          continue;
        }
      }

      if (!shares) {
        const sm = RE_SHARE.exec(txt);
        if (sm) {
          const numStr = sm[1] || sm[2];
          if (numStr) shares = parseInteractions(numStr);
          continue;
        }
      }

      // Số mồ côi
      if (!actionBarHit && !/^\s*[\d.,]+\s*[KkMmTtBb]?\s*$/.test(txt)) {
      } else if (!actionBarHit) {
        const match = txt.match(/^[\d.,]+\s*[KkMmTtBb]?$/);
        if (match) pureNumbers.push(parseInteractions(txt));
      }
    }

    // Smart matching
    if (pureNumbers.length > 0) {
      if (reactions > 0 && pureNumbers[0] === reactions) {
        pureNumbers.shift();
      } else if (reactions === 0) {
        reactions = pureNumbers.shift() || 0;
      }
    }
    if (pureNumbers.length > 0 && comments === 0) comments = pureNumbers.shift() || 0;
    if (pureNumbers.length > 0 && shares === 0) shares = pureNumbers.shift() || 0;
  } catch {}

  return { reactions, comments, shares };
}

// ── 5. Lấy ảnh ────────────────────────────────────────────
function getImages(block) {
  const images = [];
  try {
    const imgs = block.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (!src.includes('scontent')) continue;
      if (src.includes('/emoji/') || src.includes('/images/locales/')) continue;

      const width = parseInt(img.getAttribute('width') || '0');
      if (width > 0 && width < 100) continue;

      images.push(src);
    }
  } catch {}
  return [...new Set(images)];
}

// ── 6. Lấy video URL ───────────────────────────────────────
function getVideoUrl(block, postUrl) {
  try {
    // Bước 1: Tìm link video rõ ràng
    const links = block.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (RE_VIDEO_URL.test(href)) {
        return clean_post_url(href);
      }
    }

    // Bước 2: Có thẻ video trong block
    if (block.querySelector('video')) {
      const result = block.evaluate((el) => {
        const links = el.querySelectorAll('a[href]');
        for (const a of links) {
          if (/video|v=|reel|watch/i.test(a.href)) return a.href || a.getAttribute('href');
        }
        const videoNodes = el.querySelectorAll('[data-video-id]');
        for (const n of videoNodes) {
          const vid = n.getAttribute('data-video-id');
          if (vid) return 'https://www.facebook.com/watch?v=' + vid;
        }
        return null;
      });
      if (result) return clean_post_url(result);
      return clean_post_url(postUrl) || null;
    }
  } catch {}
  return null;
}

// ── 7. Lấy author info ─────────────────────────────────────
function getAuthor(block) {
  let authorName = '';
  let authorUrl = '';

  try {
    // Tìm tên người đăng - thường nằm trong link ở header bài viết
    const authorLink = block.evaluate((el) => {
      // Các pattern tìm link tác giả
      const patterns = [
        'a[href*="/user/"]',
        'a[href*="/people/"]',
        'a[role="link"][aria-label]',
        'h3 a[role="link"]',
        'span > a[role="link"]',
        '[data-ad-preview="message"] ~ div a[role="link"]',
        'div[role="article"] a[role="link"]',
      ];

      for (const sel of patterns) {
        const els = el.querySelectorAll(sel);
        for (const a of els) {
          const href = a.getAttribute('href') || '';
          const text = (a.innerText || '').trim();
          // Lọc: bỏ qua link rác
          if (text.length < 2) continue;
          if (['thích', 'like', 'comment', 'share', 'bình luận', 'chia sẻ'].includes(text.toLowerCase())) continue;
          if (href.includes('facebook.com/like') || href.includes('facebook.com/share')) continue;
          // Ưu tiên link có user ID
          if (href.match(/\/\d+\//) || href.match(/\/user\//) || href.match(/\/people\//)) {
            return { href, text };
          }
        }
      }

      // Fallback: lấy link đầu tiên có chữ dài
      const allLinks = el.querySelectorAll('a[role="link"], a[href]');
      for (const a of allLinks) {
        const href = a.getAttribute('href') || '';
        const text = (a.innerText || '').trim();
        if (text.length > 3 && text.length < 80 && !href.includes('/hashtag/') && !href.includes('/groups/')) {
          return { href, text };
        }
      }
      return null;
    });

    if (authorLink) {
      authorName = authorLink.text;
      authorUrl = clean_post_url(authorLink.href) || authorLink.href;
    }
  } catch {}

  return { authorName, authorUrl };
}

// ── Main: Extract 1 post block ─────────────────────────────
async function extractPost(block) {
  const info = getInfo(block);
  if (!info.url) return null;

  const [content, author] = await Promise.all([
    getContent(block),
    Promise.resolve(getAuthor(block)),
  ]);

  const stats = getStats(block);
  const images = getImages(block);
  const videoUrl = getVideoUrl(block, info.url);

  return {
    post_url: info.url,
    author_name: author.authorName,
    author_url: author.authorUrl,
    timestamp_raw: info.postDate,
    timestamp_class: classify_timestamp(info.postDate),
    content,
    reactions: stats.reactions,
    comments: stats.comments,
    shares: stats.shares,
    images,
    video_url: videoUrl,
    group_url: window.location.href,
    crawled_at: new Date().toISOString(),
  };
}

// ── Scroll & Crawl Loop ─────────────────────────────────────
class Crawler {
  constructor(config) {
    this.config = config;
    this.seenUrls = new Set();
    this.posts = [];
    this.consecutiveOld = 0;
    this.scrollCount = 0;
    this.lastScrollHeight = 0;
    this.stopped = false;
    this.processing = false;
  }

  async wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Random delay giống human behavior
  humanDelay(min, max) {
    const base = min + Math.random() * (max - min);
    const jitter = base * 0.2 * (Math.random() - 0.5);
    return Math.max(100, base + jitter);
  }

  // Đợi feed xuất hiện
  async waitForFeed(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector(SELECTORS.FEED)) return true;
      await this.wait(500);
    }
    return false;
  }

  // Đợi content mới xuất hiện sau scroll
  async waitForNewContent(timeout = 15000) {
    return new Promise(resolve => {
      const maxWait = timeout;
      const start = Date.now();
      const initialCount = document.querySelectorAll(SELECTORS.POST_BLOCKS).length;

      const observer = new MutationObserver(() => {
        const now = Date.now();
        if (now - start > maxWait) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout fallback
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, maxWait);
    });
  }

  // Scroll 1 bước
  async scrollStep() {
    this.scrollCount++;

    const scrollPx = 800 + Math.random() * 400;
    window.scrollBy({ top: scrollPx, behavior: 'smooth' });

    const delay = this.humanDelay(
      this.config.scrollDelay * 0.5,
      this.config.scrollDelay * 1.5
    );
    await this.wait(delay);

    // Thông báo cho popup
    this.sendMessage({ type: 'CRAWL_SCROLL' });
  }

  // Kiểm tra điều kiện dừng
  shouldStop() {
    // Quá số bài tối đa
    if (this.posts.length >= this.config.maxPosts) return true;
    // 5 bài cũ liên tiếp
    if (this.consecutiveOld >= 5) return true;
    // Không scroll được nữa (đã đến cuối)
    const sh = document.body.scrollHeight;
    const st = window.scrollY + window.innerHeight;
    if (sh - st < 50 && this.scrollCount > 3) return true;
    return false;
  }

  // Xử lý 1 vòng scroll
  async processScroll() {
    if (this.processing || this.stopped) return;
    this.processing = true;

    await this.scrollStep();
    await this.waitForNewContent();

    const blocks = document.querySelectorAll(SELECTORS.POST_BLOCKS);
    let newPostsThisScroll = 0;

    for (const block of blocks) {
      if (this.stopped) break;
      if (this.posts.length >= this.config.maxPosts) break;

      try {
        const post = await extractPost(block);
        if (!post) continue;

        if (this.seenUrls.has(post.post_url)) continue;
        this.seenUrls.add(post.post_url);

        const isOld = post.timestamp_class === 'old';
        if (isOld) {
          this.consecutiveOld++;
        } else {
          this.consecutiveOld = 0;
        }

        this.posts.push(post);
        newPostsThisScroll++;

        this.sendMessage({ type: 'CRAWL_POST', post });

        // Progress update
        const progress = Math.min(100, (this.posts.length / this.config.maxPosts) * 100);
        this.sendMessage({
          type: 'CRAWL_PROGRESS',
          progress,
          progressText: `Đã cào ${this.posts.length}/${this.config.maxPosts} bài`,
          groupIndex: 0,
        });
      } catch (e) {
        // Skip lỗi block đơn lẻ
      }
    }

    this.processing = false;

    // Log
    this.sendMessage({
      type: 'CRAWL_LOG',
      level: 'scroll',
      message: `Scroll #${this.scrollCount}: +${newPostsThisScroll} bài mới, tổng ${this.posts.length}`,
    });
  }

  // Main crawl loop
  async start() {
    this.sendMessage({ type: 'CRAWL_LOG', level: 'info', message: 'Bắt đầu cào Group: ' + window.location.href });

    const hasFeed = await this.waitForFeed();
    if (!hasFeed) {
      this.sendMessage({ type: 'CRAWL_ERROR', message: 'Không tìm thấy feed. Kiểm tra đăng nhập Facebook.' });
      return;
    }

    // Scroll vài lần trước khi bắt đầu cào (load initial posts)
    for (let i = 0; i < 3; i++) {
      window.scrollBy({ top: 1000, behavior: 'smooth' });
      await this.wait(1500);
    }

    this.sendMessage({ type: 'CRAWL_LOG', level: 'info', message: 'Bắt đầu bóc tách bài viết...' });

    while (!this.stopped && !this.shouldStop()) {
      await this.processScroll();
      await this.wait(300); // Debounce
    }

    if (this.stopped) {
      this.sendMessage({ type: 'CRAWL_LOG', level: 'warn', message: 'Đã dừng bởi người dùng' });
    } else {
      this.sendMessage({ type: 'CRAWL_LOG', level: 'success', message: `Hoàn tất! Cào được ${this.posts.length} bài viết` });
    }

    this.sendMessage({ type: 'CRAWL_DONE', posts: this.posts });
  }

  stop() {
    this.stopped = true;
  }

  sendMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {}
  }
}

// ── Global crawler instance ──────────────────────────────────
let crawler = null;

// Listen for commands from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START') {
    if (crawler && !crawler.stopped) {
      crawler.stop();
    }
    crawler = new Crawler(msg.config || {});
    crawler.start().catch(e => {
      crawler.sendMessage({ type: 'CRAWL_ERROR', message: e.message });
    });
    sendResponse({ status: 'started' });
  } else if (msg.action === 'STOP') {
    if (crawler) {
      crawler.stop();
    }
    sendResponse({ status: 'stopped' });
  } else if (msg.action === 'GET_STATUS') {
    sendResponse({
      status: crawler ? (crawler.stopped ? 'stopped' : 'running') : 'idle',
      posts: crawler ? crawler.posts : [],
      scrollCount: crawler ? crawler.scrollCount : 0,
    });
  }
  return true;
});

// Signal ready
console.log('[FB Crawler] Content script loaded');
chrome.runtime.sendMessage({ type: 'CONTENT_READY', url: window.location.href });
