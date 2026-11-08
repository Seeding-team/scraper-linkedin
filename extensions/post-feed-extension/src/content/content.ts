/**
 * Content Script chạy trên Facebook
 * Xử lý crawl: START_FEED_CRAWL, GET_CRAWL_STATUS, GET_CRAWL_DATA, STOP_CRAWL
 * Scroll nhẹ nhàng: lướt nhỏ + delay ngẫu nhiên 1-2s
 * Chỉ lấy bài hôm nay, dừng khi gặp bài hôm qua
 */

interface CrawlConfig {
  maxPosts?: number;
  scrollDelay?: number;
  todayOnly?: boolean;
}

// ─── Crawl State ──────────────────────────────────────────────
let _crawlRunning = false;
let _crawlData: any[] = [];
let _crawlScrolls = 0;
let _crawlDone = false;
let _scrollTimer: ReturnType<typeof setTimeout> | null = null;
let _lastScrollY = 0;
let _noNewContentCount = 0; // Đếm số lần scroll mà không có content mới
let _bottomRetries = 0;
let _olderPostsCount = 0;
let _hasNewPost = false;
let _scannedPostsCount = 0;
let _modalCloseAttempts = 0;

// ─── Helper ───────────────────────────────────────────────────
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function safeLog(...args: any[]) {
  const msg = args.join(' ');
  console.log('[Content-Crawl]', msg);
  const debugBox = document.getElementById('fb-crawl-debug');
  if (debugBox) {
    const line = document.createElement('div');
    line.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugBox.appendChild(line);
    debugBox.scrollTop = debugBox.scrollHeight;
  }
}

// Kiểm tra timestamp có phải hôm nay không
function isToday(timestamp: string): boolean {
  if (!timestamp) return false;
  const lower = timestamp.toLowerCase();
  
  if (lower.includes('vừa xong') || lower.includes('just now')) return true;
  if (lower.includes('phút') || lower.includes('min') || /\d+\s*m(?!o)/.test(lower)) return true;
  if (lower.includes('giờ') || lower.includes('hour') || /\d+\s*h(?!o)/.test(lower)) return true;
  if (lower.includes('hôm nay') || lower.includes('today')) return true;
  
  // "1 ngày" = hôm qua → KHÔNG lấy
  const dayMatch = lower.match(/(\d+)\s*(?:ngày|day|d)(?:\s|$)/);
  if (dayMatch) {
    return parseInt(dayMatch[1]) <= 0;
  }

  if (lower.includes('hôm qua') || lower.includes('yesterday')) return false;
  if (lower.includes('tháng') || lower.includes('năm') || lower.includes('thg') || lower.includes('tuần') || lower.includes('week') || lower.includes('month') || lower.includes('year') || /\d+\s*w/.test(lower) || /\d+\s*y/.test(lower)) return false;

  // Không parse được → thử so sánh với ngày hiện tại
  const dateMatch = timestamp.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dateMatch) {
    const now = new Date();
    const postDay = parseInt(dateMatch[1]);
    const postMonth = parseInt(dateMatch[2]);
    const postYear = dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3]);
    
    return postDay === now.getDate() && postMonth === now.getMonth() + 1 && postYear === now.getFullYear();
  }
  
  return false; // Mặc định từ chối nếu không rõ ràng
}

// ─── Crawl Functions ──────────────────────────────────────────

function showBlockingOverlay() {
  // Tạm thời vô hiệu hóa theo yêu cầu user để xem rõ luồng trên Facebook
  return;
  if (document.getElementById('fb-crawl-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'fb-crawl-overlay';
  overlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background-color: rgba(0, 0, 0, 0.85) !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex-direction: column !important;
    color: #fff !important;
    font-family: system-ui, -apple-system, sans-serif !important;
    pointer-events: auto !important;
    backdrop-filter: blur(8px) !important;
  `;

  const icon = document.createElement('div');
  icon.innerHTML = '🤖';
  icon.style.fontSize = '64px';
  icon.style.marginBottom = '24px';
  icon.style.animation = 'pulse 2s infinite';
  
  const text = document.createElement('div');
  text.innerText = '⚠️ ĐANG TỰ ĐỘNG CÀO DỮ LIỆU - VUI LÒNG KHÔNG THAO TÁC ⚠️';
  text.style.fontSize = '24px';
  text.style.fontWeight = 'bold';
  text.style.marginBottom = '12px';
  text.style.textAlign = 'center';
  text.style.textShadow = '0 2px 4px rgba(0,0,0,0.5)';
  
  const subtext = document.createElement('div');
  subtext.innerText = 'Extension đang bóc tách nội dung, thao tác của bạn có thể làm hỏng quá trình này.';
  subtext.style.fontSize = '16px';
  subtext.style.opacity = '0.9';
  subtext.style.textAlign = 'center';

  const prevent = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  overlay.addEventListener('click', prevent, true);
  overlay.addEventListener('mousedown', prevent, true);
  overlay.addEventListener('mouseup', prevent, true);
  overlay.addEventListener('pointerdown', prevent, true);
  
  const debugBox = document.createElement('div');
  debugBox.id = 'fb-crawl-debug';
  debugBox.style.cssText = `
    margin-top: 20px;
    width: 80%;
    max-width: 800px;
    height: 300px;
    background: rgba(0,0,0,0.8);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    font-family: monospace;
    font-size: 14px;
    color: #00ff00;
    overflow-y: auto;
    text-align: left;
    white-space: pre-wrap;
  `;
  
  overlay.appendChild(icon);
  overlay.appendChild(text);
  overlay.appendChild(subtext);
  overlay.appendChild(debugBox);
  
  if (!document.getElementById('fb-crawl-styles')) {
    const style = document.createElement('style');
    style.id = 'fb-crawl-styles';
    style.innerHTML = `@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }`;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
}

function hideBlockingOverlay() {
  const overlay = document.getElementById('fb-crawl-overlay');
  if (overlay) {
    overlay.remove();
  }
}

function startFeedCrawl(config: CrawlConfig = {}) {
  const { maxPosts = 100, scrollDelay = 1500, todayOnly = true } = config;

  safeLog('=== START CRAWL ===', { maxPosts, scrollDelay, todayOnly });
  safeLog('Current scrollY:', window.pageYOffset, 'scrollHeight:', document.body.scrollHeight);

  // Reset state
  _crawlRunning = true;
  _crawlData = [];
  _crawlScrolls = 0;
  _crawlDone = false;
  _lastScrollY = 0;
  _noNewContentCount = 0;
  _bottomRetries = 0;
  _olderPostsCount = 0;
  _hasNewPost = false;
  _scannedPostsCount = 0;
  _modalCloseAttempts = 0;

  showBlockingOverlay();

  // Đợi 2s để DOM sẵn sàng
  _scrollTimer = setTimeout(() => doScroll(maxPosts, scrollDelay, todayOnly), 2000);
}

function doScroll(maxPosts: number, baseDelay: number, todayOnly: boolean) {
  if (!_crawlRunning || _crawlDone) {
    safeLog('Stopped: running=', _crawlRunning, 'done=', _crawlDone);
    return;
  }

  _crawlScrolls++;

  // 1. Tự động giải cứu nếu có Modal/Layer che màn hình (ưu tiên kiểm tra DOM trước)
  const closeSelectors = [
    'div[aria-label="Đóng"][role="button"]',
    'div[aria-label="Close"][role="button"]',
    'div[role="dialog"] [aria-label="Đóng"]',
    'div[role="dialog"] [aria-label="Close"]',
    '[aria-label="Đóng"]',
    '[aria-label="Close"]'
  ];
  
  const currentUrl = window.location.href;
  const isSuspiciousUrl = currentUrl.includes('/posts/') || currentUrl.includes('/permalink/') || currentUrl.includes('multi_permalinks=') || currentUrl.includes('story.php') || currentUrl.includes('/photo/') || currentUrl.includes('/photo.php') || currentUrl.includes('/reel/') || currentUrl.includes('/watch');
  
  // Kiểm tra xem có Modal bài viết nào ĐANG HIỂN THỊ và CHE MÀN HÌNH không (bỏ qua các thẻ div ẩn hoặc hộp chat nhỏ)
  const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
  const hasVisibleLargeDialog = dialogs.some(d => {
    const el = d as HTMLElement;
    // Phải hiển thị và chiếm ít nhất 30% chiều cao màn hình (loại trừ hộp thoại chat nhỏ)
    return el.offsetWidth > 0 && el.offsetHeight > (window.innerHeight * 0.3);
  });
  
  if (isSuspiciousUrl || hasVisibleLargeDialog) {
    _modalCloseAttempts++;
    
    if (_modalCloseAttempts > 3) {
      safeLog('Đã thử đóng nhiều lần nhưng vẫn kẹt! Ép buộc reload về link nhóm...');
      const match = currentUrl.match(/(https:\/\/(?:www\.)?facebook\.com\/groups\/[^\/]+)/);
      if (match) {
          window.location.href = match[1];
      } else {
          window.history.back();
      }
      return;
    }
    
    let clickedModalClose = false;
    for (const sel of closeSelectors) {
      const btns = document.querySelectorAll(sel);
      for (const btn of Array.from(btns)) {
        const el = btn as HTMLElement;
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          safeLog(`Thử click nút Đóng (selector: ${sel}), lần ${_modalCloseAttempts}...`);
          try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })); } catch(e) {}
          el.click();
          clickedModalClose = true;
          break;
        }
      }
      if (clickedModalClose) break;
    }
    
    if (!clickedModalClose) {
      safeLog('Không click được nút Đóng, dùng window.history.back()...');
      window.history.back();
    }
    
    _scrollTimer = setTimeout(() => doScroll(maxPosts, baseDelay, todayOnly), 2000);
    return;
  } else {
    _modalCloseAttempts = 0; // Đã thoát được modal
  }

  // Tính scroll
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = window.innerHeight;
  const maxScroll = scrollHeight - clientHeight;
  const remaining = maxScroll - scrollTop;

  safeLog(`Scroll #${_crawlScrolls}: pos=${Math.round(scrollTop)}, max=${maxScroll}, remaining=${Math.round(remaining)}`);

  // Kiểm tra đáy trang
  if (remaining <= 100) {
    _bottomRetries++;
    safeLog(`Reached page bottom (retry ${_bottomRetries}/5)`);
    if (_bottomRetries >= 5) {
      safeLog('Reached page bottom (no more scroll)');
      finishCrawl('Reached page bottom');
      return;
    }
    // Scroll nhích lên nhích xuống để trigger tải
    window.scrollBy({ top: -150, behavior: 'smooth' });
    setTimeout(() => window.scrollBy({ top: 200, behavior: 'smooth' }), 500);
    // Đợi thêm thời gian để tải
    _scrollTimer = setTimeout(() => doScroll(maxPosts, baseDelay, todayOnly), 2500);
    return;
  } else {
    _bottomRetries = 0;
  }

  // Random scroll 500-900px để lướt dài hơn
  const scrollAmount = Math.min(randomBetween(500, 900), remaining);
  const newScrollY = scrollTop + scrollAmount;
  
  // Scroll
  try {
    window.scrollBy({ top: scrollAmount, behavior: 'instant' });
    _lastScrollY = newScrollY;
  } catch (e) {
    safeLog('Scroll error:', e);
  }

  // Đợi DOM update rồi extract
  _scrollTimer = setTimeout(() => {
    extractAndProcess(maxPosts, baseDelay, todayOnly);
  }, 1000);
}

async function extractAndProcess(maxPosts: number, baseDelay: number, todayOnly: boolean) {
  if (!_crawlRunning || _crawlDone) return;

  // Click 'Xem thêm' / 'See more' để mở rộng bài viết dài
  const expandButtons = document.querySelectorAll('div[role="button"], span[dir="auto"], div[dir="auto"]');
  let clickedAny = false;

  for (const btn of Array.from(expandButtons)) {
    // Không click vào thẻ a hoặc bất kỳ element nào nằm trong thẻ a để tránh bị chuyển trang (vào permalink)
    if (btn.tagName === 'A' || btn.closest('a')) continue;

    const text = (btn.textContent || '').trim().toLowerCase();
    
    // NẾU chứa chữ "bình luận", "comment", "tất cả", "all" -> tuyệt đối không click vì nó sẽ mở Modal/Popup!
    if (text.includes('bình luận') || text.includes('comment') || text.includes('tất cả') || text.includes('all')) {
      continue;
    }

    // Bắt các trường hợp chứa "xem thêm", "see more", "xem thm" và giới hạn độ dài cực ngắn (< 15) để chỉ click text
    if ((text.includes('xem thêm') || text.includes('see more') || text.includes('xem th')) && text.length < 15) {
      try {
        (btn as HTMLElement).click();
        clickedAny = true;
      } catch (e) {}
    }
  }

  if (clickedAny) {
    // Đợi Facebook render text đầy đủ sau khi click. Tăng lên 1500ms vì đôi khi Xem thêm cần call API tải text.
    await new Promise(r => setTimeout(r, 1500));
  }

  // Extract posts
  const newPosts = extractPostsFromDOM();
  let addedCount = 0;
  let oldestTimestamp = '';

  for (const post of newPosts) {
    if (_crawlData.length >= maxPosts) break;
    
    const exists = _crawlData.some(p => 
      p.post_url === post.post_url || p.post_id === post.post_id
    );
    if (!exists) {
      _scannedPostsCount++;
      let isPostToday = true;
      let postTime = '';
      
      if (todayOnly) {
        postTime = post.timestamp_raw || '';
        isPostToday = isToday(postTime);
        
        if (isPostToday) {
          _hasNewPost = true;
          // Loại bỏ việc reset _olderPostsCount để tính TỔNG CỘNG số bài cũ
        } else {
          _olderPostsCount++;
          
          if (_olderPostsCount >= 3) {
            safeLog(`Đã phát hiện tổng cộng 3 bài cũ ("${postTime}"). Dừng crawl.`);
            finishCrawl('Phát hiện 3 bài cũ');
            return;
          } else {
            safeLog(`[Skip] Bài cũ: "${postTime}" (${_olderPostsCount}/3)`);
            continue; // Bỏ qua bài cũ, KHÔNG lưu
          }
        }
      }
      
      _crawlData.push(post);
      safeLog(`Added post #${_crawlData.length}: ${post.post_url}`);
      addedCount++;
      _noNewContentCount = 0; // Reset counter khi có content mới
    }
  }

  // Nếu không có content mới, tăng counter
  if (addedCount === 0 && newPosts.length > 0) {
    _noNewContentCount++;
    safeLog(`No new posts added (${_noNewContentCount} times in a row)`);
    
    // Nếu scroll 5 lần liên tiếp không có content mới → dừng
    if (_noNewContentCount >= 5) {
      safeLog('No new content after 5 scrolls, stopping');
      finishCrawl('No new content');
      return;
    }
  }

  safeLog(`Posts: ${_crawlData.length}/${maxPosts} (+${addedCount} new)`);

  // Điều kiện dừng
  if (_crawlData.length >= maxPosts) {
    safeLog('=== REACHED TARGET ===');
    finishCrawl('Reached target');
    return;
  }

  // Tiếp tục scroll sau delay
  const delay = baseDelay + randomBetween(500, 1000);
  safeLog(`Next scroll in ${delay}ms...`);
  
  _scrollTimer = setTimeout(() => doScroll(maxPosts, baseDelay, todayOnly), delay);
}

function finishCrawl(reason: string) {
  _crawlRunning = false;
  _crawlDone = true;
  hideBlockingOverlay();
  safeLog(`=== CRAWL DONE (${reason}) === Total posts: ${_crawlData.length}, scrolls: ${_crawlScrolls}`);
  
  // Gửi kết quả về background
  sendResultToBackground();
}

function sendResultToBackground() {
  // Gửi message về background để forward về frontend
  chrome.runtime.sendMessage({
    action: 'CRAWL_COMPLETE',
    data: {
      posts: _crawlData,
      totalPosts: _crawlData.length,
      scrolls: _crawlScrolls,
      groupUrl: window.location.href,
      timestamp: new Date().toISOString()
    }
  }).catch(() => {
    safeLog('Could not send result to background');
  });
}

function stopFeedCrawl() {
  safeLog('STOP requested');
  _crawlRunning = false;
  _crawlDone = true;
  hideBlockingOverlay();
  
  if (_scrollTimer) {
    clearTimeout(_scrollTimer);
    _scrollTimer = null;
  }
}

function extractPostsFromDOM(): any[] {
  const posts: any[] = [];

  // Tìm posts với nhiều selectors - ưu tiên selectors cụ thể hơn
  const selectors = [
    // Desktop - Cấu trúc chuẩn xác nhất từ python scraper
    'div[role="feed"] > div',
    'div[data-testid="fbfeed_story"]',
    '[data-pagelet="FeedUnit"]',
    'div[role="article"]',
    '[aria-label*="bài viết"]',
    '.userContentWrapper',
    // Mobile
    '[data-ad-preview="message"]',
    'article'
  ];

  let postElements: Element[] = [];

  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) {
      postElements = Array.from(found);
      safeLog(`Selector "${sel}": ${postElements.length} elements`);
      break;
    }
  }

  if (postElements.length === 0) {
    safeLog('No posts found with any selector');
    return posts;
  }

  // Lọc bỏ comment triệt để
  const topLevelPosts = postElements.filter(el => {
    // 1. Kiểm tra aria-label: Nếu có chữ "bình luận", "comment", "reply", "trả lời" thì vứt ngay
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('bình luận') || ariaLabel.includes('comment') || 
        ariaLabel.includes('trả lời') || ariaLabel.includes('reply')) {
      return false;
    }

    // 2. Lọc bỏ các thẻ bị lồng nhau (trường hợp comment nằm bên trong bài viết chính)
    let parent = el.parentElement;
    while (parent) {
      if (postElements.includes(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });

  safeLog(`Sau khi lọc comment, còn ${topLevelPosts.length} bài viết chính`);

  for (const el of topLevelPosts) {
    try {
      const post = extractPostData(el);
      // Chấp nhận post nếu có content HOẶC có media (image/video)
      const hasContent = post && post.content && post.content.length > 3;
      const hasMedia = post && (post.images?.length > 0 || post.video_url);
      if (post && (hasContent || hasMedia)) {
        posts.push(post);
      }
    } catch (e) {
      // skip
    }
  }

  return posts;
}

function extractPostData(el: Element): any {
  // Content - Ưu tiên selectors chuẩn của Facebook
  const contentSelectors = [
    '[data-ad-rendering-role="story_message"]',  // Facebook Ad format
    'div[data-ad-comet-preview="message"]',
    'div[data-ad-preview="message"]',
    '[data-ad-preview="message"]',
  ];

  let content = '';
  for (const sel of contentSelectors) {
    const el2 = el.querySelector(sel);
    if (el2) {
      // Dùng innerText thay vì textContent để tránh lấy cả text của các thẻ bị ẩn (display: none hoặc visually hidden) gây lặp chữ
      content = (el2 as HTMLElement).innerText?.trim() || '';
      if (content.length > 10) break;
    }
  }

  // Nếu không có, dùng JS để lấy content từ div[dir="auto"] nhưng tránh comments
  if (!content || content.length < 10) {
    const extractContent = (node: Element) => {
      // Tìm ranh giới bình luận
      const commentSection = node.querySelector(
        '[role="article"] [role="article"], ' +
        '[aria-label*="Comment"], ' +
        '[aria-label*="Bình luận"], ' +
        '[data-testid*="comment"]'
      );

      const allDirs = node.querySelectorAll('div[dir="auto"]');
      let bestText = '';
      const banWords = ['viết bình luận', 'write a comment', 'xem thêm bình luận', 'view more comments'];

      for (const div of Array.from(allDirs)) {
        // Bỏ qua nếu nằm trong vùng comments
        if (commentSection && (commentSection.contains(div) || (commentSection.compareDocumentPosition(div) & 4))) {
          continue;
        }

        const txt = ((div as HTMLElement).innerText || '').trim();
        const txtLower = txt.toLowerCase();
        const isBanned = banWords.some(word => txtLower.includes(word));

        if (txt.length > 20 && !isBanned && txt.length > bestText.length) {
          bestText = txt;
        }
      }
      return bestText;
    };
    const jsResult = extractContent(el);
    if (jsResult && jsResult.length > 10) {
      content = jsResult;
    }
  }

  // Dọn dẹp các text thừa thường bị dính ở cuối bài (Xem thêm, See more, Xem bản dịch, Ẩn bớt, See less...)
  if (content) {
    const junkRegex = /\s*(?:xem thêm|see more|xem thm|see translation|xem bản dịch|ẩn bản dịch|hide translation|ẩn bớt|see less)\s*\.*$/gi;
    content = content.replace(junkRegex, '').trim();
    // Chạy thêm 1 lần nữa đề phòng trường hợp dính 2 nút liền nhau (vd: Ẩn bớt \n Xem bản dịch)
    content = content.replace(junkRegex, '').trim();
  }

  // Author - Logic matched with Python Scraper for perfect URL parsing
  let author = 'Ẩn danh';
  let authorUrl = '';

  // Ưu tiên 1: Quét toàn bộ thẻ strong/span/h2/h3/h4 để tìm chữ ẩn danh chính xác
  const possibleAnonymous = Array.from(el.querySelectorAll('strong, span, h2, h3, h4')).find(e => {
    // Chỉ lấy text trực tiếp của node đó, không lấy text của child nodes để tránh bị ghép chuỗi
    const txt = (e.textContent || '').trim().toLowerCase();
    return txt === 'người tham gia ẩn danh' || txt === 'thành viên ẩn danh' || txt === 'anonymous participant' || txt === 'anonymous' || txt === 'group participant';
  });

  if (possibleAnonymous) {
    author = 'Người tham gia ẩn danh';
  }

  if (author === 'Ẩn danh') {
    const exclude = ':not([href*="comment"]):not([href*="/posts/"]):not([href*="/permalink/"]):not([href*="story.php"]):not([href*="stories"])';
    // Tìm a tag chứa tên tác giả, loại bỏ các a tag của timestamp (thường chứa /permalink/ hoặc /posts/ v.v.)
    const authorNode = el.querySelector(`h2 a${exclude}, h3 a${exclude}, h4 a${exclude}, strong a${exclude}`) as HTMLAnchorElement;

    if (authorNode) {
      author = authorNode.innerText.trim();
      const href = authorNode.href || '';
      
      let urlObj;
      try { urlObj = new URL(href); } catch(e) {}
      
      if (urlObj) {
        const cleanUrl = new URL(urlObj.origin + urlObj.pathname);
        if (urlObj.searchParams.has('id')) {
          cleanUrl.searchParams.set('id', urlObj.searchParams.get('id')!);
        }
        authorUrl = cleanUrl.href;
      } else {
        authorUrl = href;
      }
    } else {
      // Xử lý bài ẩn danh (hoặc Facebook Ad format)
      const strongNode = el.querySelector('h2 strong, h3 strong, h4 strong, span > strong, [data-ad-rendering-role="profile_name"]');
      if (strongNode) {
        author = (strongNode as HTMLElement).innerText.trim();
      }
    }
  }

  // Dọn dẹp tác giả nếu dính rác (obfuscated text của FB như oSndtropes...)
  if (author && (
    author.includes(':') || 
    author.length > 30 || 
    author.includes('S p o n s o r e d') ||
    /\d{3,}/.test(author) || // Nếu tên chứa từ 3 chữ số liên tiếp trở lên -> 100% là chuỗi mã hóa rác
    /[a-zA-Z0-9]{15,}/.test(author) // Hoặc 1 chuỗi dài 15 ký tự liền nhau không dấu cách
  )) {
    author = 'Người tham gia ẩn danh';
  }

  // URL & Timestamp - Gộp chung quét như luồng Python (chính xác 100%)
  let postUrl = '';
  let timestamp = '';
  
  const allLinks = Array.from(el.querySelectorAll('a[href]'));
  for (const link of allLinks) {
    const href = (link as HTMLAnchorElement).href || '';
    
    const isPostUrl = href.includes('/posts/') || 
                      href.includes('/permalink/') || 
                      href.includes('/story.php') || 
                      href.includes('/photo.php') || 
                      href.includes('/questions/') || 
                      href.includes('multi_permalinks=') ||
                      href.includes('/videos/') ||
                      href.includes('/reel/') ||
                      href.includes('/watch');
                      
    if (!isPostUrl) {
      continue;
    }
    
    // Lấy link làm ứng viên (bỏ query params rác)
    let candidateUrl = href.split('?')[0];
    
    // Giữ lại query param nếu cần thiết
    if (href.includes('multi_permalinks=')) {
      try {
        const urlObj = new URL(href, window.location.origin);
        if (urlObj.searchParams.has('multi_permalinks')) {
          candidateUrl += `?multi_permalinks=${urlObj.searchParams.get('multi_permalinks')}`;
        }
      } catch(e) {}
    } else if (href.includes('photo.php') || href.includes('story.php')) {
      try {
        const urlObj = new URL(href, window.location.origin);
        if (urlObj.searchParams.has('fbid')) {
          candidateUrl += `?fbid=${urlObj.searchParams.get('fbid')}`;
        } else if (urlObj.searchParams.has('story_fbid')) {
          candidateUrl += `?story_fbid=${urlObj.searchParams.get('story_fbid')}`;
        }
      } catch (e) {}
    }
    
    if (candidateUrl) {
      if (!postUrl) postUrl = candidateUrl; // Giữ lại link đầu tiên đề phòng
      
      // Kiểm tra xem thẻ a này có chứa thời gian không (đặc trưng của link bài viết thật)
      const rawText = link.getAttribute('aria-label') || (link as HTMLElement).innerText || '';
      if (rawText && rawText.trim()) {
        const cleanText = rawText.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
        const timeMatch = cleanText.match(/(\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm|sec|min|hour|day|week|month|year|d|m|h)\w*)|(?:vừa xong|hôm qua|just now|yesterday)/i);
        if (timeMatch) {
          postUrl = candidateUrl; // Chốt link
          timestamp = timeMatch[0]; // Chốt thời gian sạch
          break; // Tìm thấy cặp Link + Time hoàn hảo, thoát vòng lặp
        } else if (cleanText.includes(' tháng ') || cleanText.includes(' năm ') || cleanText.includes(' thg ')) {
          postUrl = candidateUrl;
          timestamp = cleanText;
          if (timestamp.length > 40) timestamp = 'Vừa xong'; // Nếu quá dài -> rác -> chốt Vừa xong
          break;
        }
      }
    }
  }

  // Fallback nếu vẫn không tìm thấy Time
  if (!timestamp) {
    const textContent = el.textContent || '';
    const timeMatch = textContent.match(/(\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm|sec|min|hour|day|week|month|year|d|m|h)\w*)|(?:vừa xong|hôm qua|just now|yesterday)/i);
    if (timeMatch) timestamp = timeMatch[0];
  }

  // ── Bulletproof Fallback: Tìm link qua Timestamp ──
  // Nếu cấu trúc URL quá dị hợm, ta sẽ tìm bất kỳ thẻ <a> nào chứa ngày tháng (đây chắc chắn là link bài viết)
  if (!postUrl) {
    const allA = Array.from(el.querySelectorAll('a[href]'));
    for (const a of allA) {
      const href = (a as HTMLAnchorElement).href || '';
      if (href.includes('/user/') || href.includes('/hashtag/')) continue;
      
      const rawText = a.getAttribute('aria-label') || (a as HTMLElement).innerText || '';
      const cleanText = rawText.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
      const timeMatch = cleanText.match(/(\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm|sec|min|hour|day|week|month|year|d|m|h)\w*)|(?:vừa xong|hôm qua|just now|yesterday)/i);
      
      if (timeMatch) {
        postUrl = href.split('?')[0];
        timestamp = timeMatch[0];
        safeLog(`[MẸO] Đã vớt được link bị giấu qua Timestamp: ${postUrl}`);
        break;
      } else if (cleanText.includes(' tháng ') || cleanText.includes(' năm ') || cleanText.includes(' thg ')) {
        postUrl = href.split('?')[0];
        timestamp = cleanText;
        if (timestamp.length > 40) timestamp = 'Vừa xong';
        safeLog(`[MẸO] Đã vớt được link bị giấu qua Timestamp: ${postUrl}`);
        break;
      }
    }
  }

  // BỎ HOÀN TOÀN FALLBACK VÀO WINDOW.LOCATION.HREF.
  // Nếu không tìm thấy link bài viết thực sự, chúng ta vứt bỏ bài này luôn để tránh bị gán link sai (như khi đang ở trong permalink)
  if (!postUrl) {
    safeLog(`[CẢNH BÁO] Không tìm thấy link bài viết hợp lệ, BỎ QUA bài này để tránh sai lệch data.`);
    return null;
  }

  // Stats - dùng JS để lấy chính xác từ aria-label
  let reactions = 0, comments = 0, shares = 0;

  const extractStats = (node: Element) => {
    let totalReactions = 0, comments = 0, shares = 0;
    const reactionBreakdown: { type: string; count: number }[] = [];

    // Tìm tất cả aria-label chứa số
    const allElements = node.querySelectorAll('[aria-label]');
    for (const elem of allElements) {
      const label = elem.getAttribute('aria-label') || '';
      const ll = label.toLowerCase();

      // Reactions: "Thích/Like: X người/people", "Buồn/Sad: X người", etc.
      // Tiếng Việt & Tiếng Anh
      if (ll.includes('người') || ll.includes('people')) {
        // Extract số từ "Thích: 326 người" hoặc "Like: 326 people"
        const numMatch = label.match(/([\d.,KMB]+)\s*(?:người|people)/i);
        if (numMatch) {
          const numStr = numMatch[1];
          let num = parseFloat(numStr.replace(',', '.'));
          if (numStr.toUpperCase().includes('K')) num *= 1000;
          else if (numStr.toUpperCase().includes('M')) num *= 1e6;

          // Extract loại reaction (Thích, Like, Buồn, Sad, etc.)
          let type = 'Like';
          if (ll.includes('thích') || ll.includes('like')) type = 'Like';
          else if (ll.includes('yêu thích') || ll.includes('love')) type = 'Love';
          else if (ll.includes('thương thương') || ll.includes('sad')) type = 'Sad';
          else if (ll.includes('tức') || ll.includes('angry')) type = 'Angry';
          else if (ll.includes('wow') || ll.includes('kinh ngạc')) type = 'Wow';
          else if (ll.includes('haha')) type = 'Haha';
          else if (ll.includes('buồn') || ll.includes('sad')) type = 'Sad';

          if (num > 0) {
            reactionBreakdown.push({ type, count: num });
            totalReactions += num;
          }
        }
      }

      // Comments: "X bình luận/comment", "X comments"
      if (!comments && (ll.includes('bình luận') || ll.includes('comment'))) {
        const m = label.match(/([\d.,KMB]+)\s*(?:bình luận|comment)/i);
        if (m) {
          const numStr = m[1];
          let num = parseFloat(numStr.replace(',', '.'));
          if (numStr.toUpperCase().includes('K')) num *= 1000;
          else if (numStr.toUpperCase().includes('M')) num *= 1e6;
          comments = num;
        }
      }

      // Shares: "X lượt chia sẻ/shares", "X shares"
      if (!shares && (ll.includes('chia sẻ') || ll.includes('share'))) {
        const m = label.match(/([\d.,KMB]+)\s*(?:chia sẻ|share|lượt)/i);
        if (m) {
          const numStr = m[1];
          let num = parseFloat(numStr.replace(',', '.'));
          if (numStr.toUpperCase().includes('K')) num *= 1000;
          else if (numStr.toUpperCase().includes('M')) num *= 1e6;
          shares = num;
        }
      }
    }

    // Nếu có reaction breakdown, dùng tổng; không thì fallback về 0
    return {
      reactions: totalReactions > 0 ? totalReactions : 0,
      comments,
      shares,
      breakdown: reactionBreakdown
    };
  };

  const statsData = extractStats(el);
  if (statsData) {
    reactions = statsData.reactions || 0;
    comments = statsData.comments || 0;
    shares = statsData.shares || 0;
  }

  // Images - chỉ lấy ảnh từ bài viết chính, không lấy từ comments
  const images: string[] = [];
  const seenSrc = new Set<string>();

  // Dùng JS để lấy ảnh đúng vị trí, tránh comments
  const extractImages = (node: Element): string[] => {
    // Tìm ranh giới comments
    const commentSection = node.querySelector(
      '[role="article"] [role="article"], ' +
      '[aria-label*="Comment"], ' +
      '[aria-label*="Bình luận"], ' +
      '[data-testid*="comment"]'
    );

    // Các selectors cho ảnh
    const selectors = [
      'image',
      'img[src*="scontent"]',
      'img[src*="fbcdn"]',
      'img[src*="instagram"]'
    ];

    const results: string[] = [];
    for (const sel of selectors) {
      const imgs = node.querySelectorAll(sel);
      for (const img of imgs) {
        // Bỏ qua nếu ảnh nằm trong vùng comments
        if (commentSection && commentSection.contains(img)) continue;

        let src = '';
        if (img.tagName === 'IMAGE') {
          src = (img as SVGImageElement).href?.baseVal || '';
        } else {
          src = (img as HTMLImageElement).src || '';
        }

        // Filter: chỉ lấy ảnh FB, loại avatar/icon
        if (src && (src.includes('scontent') || src.includes('fbcdn') || src.includes('instagram'))
            && !src.includes('/emoji/') && !src.includes('/images/locales/')
            && src.length > 50) {
          results.push(src);
        }
      }
    }
    return results;
  };
  
  const imgSrcs = extractImages(el);

  for (const src of imgSrcs) {
    if (!seenSrc.has(src)) {
      seenSrc.add(src);
      images.push(src);
    }
  }

  // Bỏ URL extraction cũ ở đây vì đã được gộp chung với Timestamp ở bên trên

  const postId = postUrl.split('/').pop()?.split('?')[0] || `post-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  return {
    post_id: postId,
    post_url: postUrl,
    author_name: author,
    author_url: authorUrl,
    content,
    timestamp_raw: timestamp,
    timestamp_class: classifyTimestamp(timestamp),
    reactions,
    comments,
    shares,
    images,
    group_url: window.location.href.split('?')[0],
    crawled_at: new Date().toISOString(),
    is_today: isToday(timestamp)
  };
}

function classifyTimestamp(ts: string): string {
  const l = ts.toLowerCase();
  if (l.includes('giờ') || l.includes('hour') || /\d+\s*h(?!o)/.test(l)) return 'now';
  if (l.includes('phút') || l.includes('min') || /\d+\s*m(?!o)/.test(l)) return 'now';
  if (/\d+\s*ngày/.test(l) || /\d+\s*day/.test(l)) {
    const m = l.match(/(\d+)\s*(?:ngày|day)/);
    if (m) {
      const days = parseInt(m[1]);
      if (days === 0) return 'now';
      if (days === 1) return 'day';
      return 'older';
    }
  }
  if (l.includes('tuần') || l.includes('week')) return 'week';
  if (l.includes('tháng') || l.includes('month')) return 'month';
  if (l.includes('năm') || l.includes('year')) return 'year';
  return 'unknown';
}

// ─── Message Handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: any, sender: any, sendResp: any) => {
  safeLog('MSG:', msg.action);

  switch (msg.action) {
    case 'PING':
      sendResp({ pong: true });
      break;

    case 'START_FEED_CRAWL':
      startFeedCrawl(msg.config || {});
      sendResp({ success: true, running: true });
      break;

    case 'GET_CRAWL_STATUS':
      sendResp({
        scrolls: _crawlScrolls,
        posts: _crawlData,
        done: _crawlDone,
        running: _crawlRunning
      });
      break;

    case 'GET_CRAWL_DATA':
      sendResp({
        posts: _crawlData,
        groupUrl: window.location.href
      });
      break;

    case 'STOP_CRAWL':
      stopFeedCrawl();
      sendResp({ success: true });
      break;
  }

  return true;
});

safeLog('Content script ready');
