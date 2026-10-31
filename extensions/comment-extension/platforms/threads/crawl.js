// platforms/threads/crawl.js - cào bài Threads (world cô lập), KẾT HỢP DOM + bắt API:
//   1. API: response GraphQL do crawl-sniffer.js (MAIN world) bắt được khi trang tự gọi
//      lúc cuộn (chỉ có khi đã đăng nhập) -> "dịch ngược" JSON ra bài viết.
//   2. JSON nhúng sẵn trong HTML (<script type="application/json">) - trang kết quả đầu tiên.
//   3. DOM: vừa là "tay lái" (cuộn tới bài cuối để trang tự gọi API trang sau, giống người
//      thật — không tự bắn request), vừa là nguồn dữ liệu: đọc mỗi vòng cuộn, lấy được bài
//      mà API/JSON không có + bổ sung số like/bình luận/đăng lại đọc từ nút tương tác.
// Gộp 3 nguồn theo post_url: dữ liệu API/JSON (chính xác) ghi đè dữ liệu DOM (ước lượng),
// DOM chỉ điền vào chỗ còn trống. Bài mới/bài được cập nhật được đẩy dần về background
// (MK_TH_COLLECT_BATCH) để trang web hiện danh sách ngay trong lúc cào - cùng tinh thần
// LI_CRAWL_POST của luồng LinkedIn (crawler.js + Voyager sniffer).
// Dữ liệu bài Threads có dạng { code, taken_at, user: { username, full_name }, caption,
// like_count, text_post_app_info: { direct_reply_count, repost_count, quote_count } }.
// Tìm theo "hình dạng" object thay vì đường dẫn cố định để không gãy khi Threads đổi
// cấu trúc bọc ngoài (thread_items / edges / node...).
// Chạy chung tab với platforms/threads/content.js (bình luận) - lệnh riêng MK_TH_COLLECT_*,
// không đụng EXECUTE_COMMENT của file đó.
(function () {
    if (window.__mkThreadsCrawlInstalled) return;
    window.__mkThreadsCrawlInstalled = true;

    const SNIFFER_SOURCE = 'mk-threads-crawl-sniffer';
    const USERNAME_RE = /^[A-Za-z0-9._]+$/;
    const CODE_RE = /^[A-Za-z0-9_-]+$/;
    const POST_HREF_RE = /^\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)\/?$/;
    // Độ tin cậy của từng nguồn: nguồn cao hơn ghi đè, nguồn thấp hơn chỉ điền chỗ trống.
    const SOURCE_RANK = { dom: 1, embedded: 2, api: 3 };
    const COUNT_FIELDS = ['reactions', 'comments', 'shares'];
    // Nhãn SVG của nút tương tác (đã xác minh trên threads.com 2026-10-26, giao diện vi + en).
    const ACTION_LABELS = {
        reactions: /^(thích|bỏ thích|like|unlike)$/i,
        comments: /^(bình luận|trả lời|reply|comment)$/i,
        shares: /^(đăng lại|repost)$/i,
    };

    // post_url -> { post, rank, sources: Set }
    const store = new Map();
    const stats = { domEnriched: 0, apiResponses: 0 };
    const apiNames = new Map();
    const parsedScripts = new WeakSet();
    // post_url của bài mới/vừa cập nhật, chưa đẩy về background.
    const pendingStream = new Set();
    let activityWaiter = null;
    let stopRequested = false;
    let collecting = false;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Chờ tối đa `ms`, xong sớm nếu sniffer báo có response API mới (đỡ phải ngồi chờ đủ giờ).
    function waitForActivity(ms) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                activityWaiter = null;
                resolve(false);
            }, ms);
            activityWaiter = () => {
                clearTimeout(timer);
                activityWaiter = null;
                resolve(true);
            };
        });
    }

    function toInt(v) {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }

    function isBlank(v) {
        return v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
    }

    // "1", "1.234", "1,2K", "12,5 N" (nghìn), "1,5 Tr" (triệu), "3M" -> số nguyên.
    function parseCount(text) {
        const t = String(text || '').trim().replace(/\s+/g, ' ');
        const m = t.match(/^(\d+(?:[.,]\d+)*)\s*(k|n|nghìn|m|tr|triệu|b|t|tỷ)?$/i);
        if (!m) return 0;
        const unit = (m[2] || '').toLowerCase();
        let num = m[1];
        if (unit) {
            num = Number(num.replace(',', '.'));
        } else {
            // Không có đơn vị: dấu . hoặc , chỉ là phân cách hàng nghìn.
            num = Number(num.replace(/[.,]/g, ''));
        }
        if (!Number.isFinite(num)) return 0;
        const mul = { k: 1e3, n: 1e3, 'nghìn': 1e3, m: 1e6, tr: 1e6, 'triệu': 1e6, b: 1e9, t: 1e9, 'tỷ': 1e9 }[unit] || 1;
        return Math.round(num * mul);
    }

    function upsert(post, source) {
        if (!post || !post.post_url) return;
        const rank = SOURCE_RANK[source];
        const cur = store.get(post.post_url);
        if (!cur) {
            store.set(post.post_url, { post, rank, sources: new Set([source]) });
            pendingStream.add(post.post_url);
            return;
        }
        cur.sources.add(source);
        let changed = false;
        if (rank > cur.rank) {
            // Nguồn chính xác hơn (API/JSON) tới sau bài DOM: lấy toàn bộ giá trị có thật
            // của nó, giữ lại phần DOM chỉ khi nguồn mới để trống.
            const merged = { ...cur.post };
            for (const key of Object.keys(post)) {
                if (COUNT_FIELDS.includes(key) || !isBlank(post[key])) merged[key] = post[key];
            }
            cur.post = merged;
            cur.rank = rank;
            changed = true;
        } else {
            let enriched = false;
            for (const key of Object.keys(post)) {
                if (isBlank(post[key]) || !isBlank(cur.post[key])) continue;
                // Số tương tác chỉ lấy từ DOM khi bài CHƯA có dữ liệu API/JSON (số 0 của
                // API là số thật, không phải "thiếu").
                if (COUNT_FIELDS.includes(key) && cur.rank > SOURCE_RANK.dom) continue;
                cur.post[key] = post[key];
                changed = true;
                if (source === 'dom') enriched = true;
            }
            if (enriched && cur.rank > SOURCE_RANK.dom) stats.domEnriched++;
        }
        if (changed) pendingStream.add(post.post_url);
    }

    // ── Nguồn API + JSON nhúng: dịch ngược object bài viết ─────────────────────

    function firstCandidateUrl(imageVersions) {
        const c = imageVersions && Array.isArray(imageVersions.candidates) ? imageVersions.candidates[0] : null;
        return c && typeof c.url === 'string' ? c.url : null;
    }

    function isPostObject(o) {
        return (
            typeof o.code === 'string' &&
            typeof o.taken_at === 'number' &&
            o.user && typeof o.user === 'object' &&
            typeof o.user.username === 'string'
        );
    }

    function toPost(o) {
        const username = o.user.username;
        const code = o.code;
        if (!USERNAME_RE.test(username) || !CODE_RE.test(code)) return null;

        const info = o.text_post_app_info || {};
        let content = (o.caption && typeof o.caption.text === 'string') ? o.caption.text : '';
        if (!content && info.text_fragments && Array.isArray(info.text_fragments.fragments)) {
            content = info.text_fragments.fragments.map((f) => (f && f.plaintext) || '').join('');
        }

        const images = [];
        const mainImage = firstCandidateUrl(o.image_versions2);
        if (mainImage) images.push(mainImage);
        if (Array.isArray(o.carousel_media)) {
            for (const m of o.carousel_media) {
                const u = m && firstCandidateUrl(m.image_versions2);
                if (u && !images.includes(u)) images.push(u);
            }
        }
        const video = Array.isArray(o.video_versions) && o.video_versions[0] && o.video_versions[0].url;

        return {
            post_url: `https://www.threads.com/@${username}/post/${code}`,
            author_username: username,
            author_name: typeof o.user.full_name === 'string' ? o.user.full_name : '',
            author_avatar: (o.user && typeof o.user.profile_pic_url === 'string') ? o.user.profile_pic_url : null,
            content: content,
            post_time: new Date(o.taken_at * 1000).toISOString(),
            reactions: toInt(o.like_count),
            comments: toInt(info.direct_reply_count),
            shares: toInt(info.repost_count) + toInt(info.quote_count),
            image_urls: images.slice(0, 10),
            media_url: typeof video === 'string' ? video : null,
        };
    }

    function walk(node, depth, source) {
        if (!node || typeof node !== 'object' || depth > 80) return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item, depth + 1, source);
            return;
        }
        if (isPostObject(node)) {
            upsert(toPost(node), source);
            // Không đi tiếp vào bên trong: bài được trích dẫn/đăng lại (quoted_post,
            // reposted_post) nằm lồng trong đây KHÔNG phải kết quả tìm kiếm.
            return;
        }
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) walk(node[key], depth + 1, source);
        }
    }

    function ingestText(text, source) {
        if (typeof text !== 'string' || text.indexOf('"taken_at"') === -1) return;
        const clean = text.replace(/^\s*for\s*\(;;\);\s*/, '');
        try {
            walk(JSON.parse(clean), 0, source);
            return;
        } catch (e) {
            // Response dạng nhiều JSON nối nhau theo dòng (streaming) - parse từng dòng.
        }
        for (const line of clean.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.indexOf('"taken_at"') === -1) continue;
            try {
                walk(JSON.parse(t), 0, source);
            } catch (e) {}
        }
    }

    function ingestEmbeddedJson() {
        document.querySelectorAll('script[type="application/json"]').forEach((s) => {
            if (parsedScripts.has(s)) return;
            parsedScripts.add(s);
            ingestText(s.textContent || '', 'embedded');
        });
    }

    // ── Nguồn DOM ────────────────────────────────────────────────────────────

    // Bài chính của 1 khung: thẻ <time> đầu tiên nằm trong link /@user/post/code (bài
    // được trích dẫn lồng bên dưới cũng có link + time riêng nhưng đứng sau).
    function mainPostLink(box) {
        for (const time of box.querySelectorAll('time[datetime]')) {
            const a = time.closest('a[href*="/post/"]');
            if (a && POST_HREF_RE.test(a.getAttribute('href') || '')) return { link: a, time };
        }
        const a = Array.from(box.querySelectorAll('a[href*="/post/"]')).find((el) => POST_HREF_RE.test(el.getAttribute('href') || ''));
        return a ? { link: a, time: null } : null;
    }

    function readActionCounts(box) {
        const counts = { reactions: 0, comments: 0, shares: 0 };
        box.querySelectorAll('[role="button"]').forEach((btn) => {
            // Bỏ nút của bài trích dẫn lồng bên trong (thuộc khung con khác).
            if (btn.closest('[data-pressable-container]') !== box) return;
            // Nhãn nằm ở <svg><title>...</title></svg> (aria-label để dự phòng nếu Threads đổi).
            const svg = btn.querySelector('svg');
            const title = svg && svg.querySelector('title');
            const label = ((title && title.textContent) || (svg && svg.getAttribute('aria-label')) || '').trim();
            if (!label) return;
            for (const field of COUNT_FIELDS) {
                if (ACTION_LABELS[field].test(label)) {
                    counts[field] = parseCount(btn.innerText);
                    break;
                }
            }
        });
        return counts;
    }

    function readImages(box) {
        const urls = [];
        box.querySelectorAll('img[src]').forEach((img) => {
            if (img.closest('[data-pressable-container]') !== box) return;
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            if (alt.includes('ảnh đại diện') || alt.includes('profile picture')) return;
            const src = img.currentSrc || img.src;
            if (src && /^https:/.test(src) && !urls.includes(src)) urls.push(src);
        });
        return urls.slice(0, 10);
    }

    function readContent(box, username, timeLabel) {
        return (box.innerText || '')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => {
                if (!l || l === username || l === timeLabel) return false;
                if (l === 'Translate' || l === 'Dịch' || l === 'Xem bản dịch' || l === 'See translation') return false;
                return !/^\d+([.,]\d+)?\s*(k|n|m|tr)?$/i.test(l);
            })
            .join('\n');
    }

    function readDomPosts() {
        const posts = [];
        document.querySelectorAll('[data-pressable-container]').forEach((box) => {
            // Khung con (bài trích dẫn) nằm trong khung khác -> để khung cha xử lý.
            if (box.parentElement && box.parentElement.closest('[data-pressable-container]')) return;
            const found = mainPostLink(box);
            if (!found) return;
            const m = (found.link.getAttribute('href') || '').match(POST_HREF_RE);
            if (!m) return;
            const timeLabel = found.time ? (found.time.innerText || '').trim() : '';
            // DOM không thấy tên hiển thị tách biệt với username -> để trống, finalize() điền.
            const counts = readActionCounts(box);
            const video = box.querySelector('video[src]');
            const avatarImg = box.querySelector('img[alt*="profile picture"], img[alt*="ảnh đại diện"]');
            const avatarUrl = avatarImg ? (avatarImg.currentSrc || avatarImg.src) : null;
            posts.push({
                post_url: `https://www.threads.com/@${m[1]}/post/${m[2]}`,
                author_username: m[1],
                author_name: '',
                author_avatar: avatarUrl || null,
                content: readContent(box, m[1], timeLabel),
                post_time: found.time ? found.time.getAttribute('datetime') : null,
                reactions: counts.reactions,
                comments: counts.comments,
                shares: counts.shares,
                image_urls: readImages(box),
                media_url: video && /^https:/.test(video.src) ? video.src : null,
            });
        });
        return posts;
    }

    function ingestDom() {
        for (const post of readDomPosts()) upsert(post, 'dom');
    }

    function finalize(post) {
        return { ...post, author_name: post.author_name || post.author_username };
    }

    // Đếm bài theo nguồn TỐT NHẤT của từng bài (API > JSON > DOM) - "DOM" = bài chỉ đọc được
    // từ giao diện, số tương tác là ước lượng.
    function countByBestSource() {
        const counts = { api: 0, embedded: 0, dom: 0 };
        for (const rec of store.values()) {
            if (rec.rank === SOURCE_RANK.api) counts.api++;
            else if (rec.rank === SOURCE_RANK.embedded) counts.embedded++;
            else counts.dom++;
        }
        return counts;
    }

    // ── Đẩy bài dần về background để web hiện danh sách realtime ───────────────

    function flushStream() {
        if (pendingStream.size === 0) return;
        const posts = [];
        for (const url of pendingStream) {
            const rec = store.get(url);
            if (rec) posts.push({ ...finalize(rec.post), _sources: Array.from(rec.sources) });
        }
        pendingStream.clear();
        try {
            chrome.runtime.sendMessage({ action: 'MK_TH_COLLECT_BATCH', posts, total: store.size }).catch(() => {});
        } catch (e) {}
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== SNIFFER_SOURCE) return;
        stats.apiResponses++;
        if (data.name) apiNames.set(data.name, (apiNames.get(data.name) || 0) + 1);
        ingestText(data.text, 'api');
        if (collecting) flushStream();
        if (activityWaiter) activityWaiter();
    });

    function scrollStep() {
        // Cuộn tới khung bài cuối cùng (kích hoạt IntersectionObserver tải trang sau của
        // Threads như người thật kéo xuống), rồi cuộn thêm 1 đoạn cho chắc.
        const boxes = document.querySelectorAll('[data-pressable-container]');
        const last = boxes[boxes.length - 1];
        if (last) last.scrollIntoView({ block: 'end' });
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
    }

    function hasLoginWall() {
        return !!document.querySelector('a[href^="/login"], a[href*="threads.com/login"]');
    }

    async function collect(targetCount, maxScrolls) {
        collecting = true;
        stopRequested = false;
        // Chờ trang render xong kết quả (tối đa ~10s).
        for (let i = 0; i < 20 && !stopRequested; i++) {
            if (document.querySelector('[data-pressable-container]')) break;
            await sleep(500);
        }
        ingestEmbeddedJson();
        ingestDom();
        flushStream();

        // Chưa đăng nhập: Threads không phân trang (đã xác minh - không có request nào
        // chứa bài khi cuộn), chỉ cần chờ 1 vòng để chắc rồi thôi, không cuộn vô ích.
        const loginWall = hasLoginWall();
        const idleLimit = loginWall ? 1 : 3;
        let idleRounds = 0;
        let scrolls = 0;
        while (scrolls < maxScrolls && store.size < targetCount && !stopRequested) {
            const before = store.size;
            scrollStep();
            scrolls++;
            const gotApi = await waitForActivity(3000);
            // Có response API: chờ thêm chút cho DOM render xong + các response nối tiếp.
            await sleep(gotApi ? 900 : 300);
            ingestEmbeddedJson();
            ingestDom();
            flushStream();
            if (store.size === before) {
                idleRounds++;
                if (idleRounds >= idleLimit) break; // cuộn liền mấy lần không có bài mới -> hết kết quả
            } else {
                idleRounds = 0;
            }
        }
        collecting = false;

        const records = Array.from(store.values());
        const bySource = countByBestSource();
        return {
            success: true,
            data: records.map((r) => finalize(r.post)),
            fromApi: bySource.api,
            fromJson: bySource.embedded,
            fromDom: bySource.dom,
            domEnriched: stats.domEnriched,
            apiResponses: stats.apiResponses,
            apiNames: Array.from(apiNames.entries()).map(([name, count]) => ({ name, count })),
            scrolls,
            stopped: stopRequested,
            loginWall,
        };
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.action === 'MK_TH_COLLECT_POSTS') {
            const target = Math.max(1, Number(msg.targetCount) || 60);
            const maxScrolls = Math.max(0, Number(msg.maxScrolls) || 15);
            collect(target, maxScrolls)
                .then(sendResponse)
                .catch((err) => {
                    collecting = false;
                    sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
                });
            return true; // giữ kênh trả lời cho sendResponse bất đồng bộ
        }
        if (msg && msg.action === 'MK_TH_COLLECT_STOP') {
            stopRequested = true;
            if (activityWaiter) activityWaiter();
            sendResponse({ success: true });
            return false;
        }
        return false;
    });

    // Cho test tự động / debug từ DevTools (world cô lập, không lộ ra trang Threads).
    // Cho test tu dong / debug tu DevTools khi co co bat chu dong (world co lap, an toan).
    if (typeof window !== 'undefined' && window.__MK_DEV_DEBUG__) {
        window.__mkThreadsCrawlDebug = { parseCount, readDomPosts, store, stats };
    }
})();
