// platforms/threads/crawl.js - cào bài Threads (world cô lập), gom bài viết từ 3 nguồn:
//   1. JSON nhúng sẵn trong HTML (<script type="application/json">) - trang kết quả đầu tiên.
//   2. Response GraphQL do crawl-sniffer.js (MAIN world) chuyển sang - các trang sau khi cuộn.
//   3. DOM (dự phòng) - chỉ cho những bài hiển thị trên trang mà 2 nguồn trên không có.
// Dữ liệu bài Threads có dạng { code, taken_at, user: { username, full_name }, caption,
// like_count, text_post_app_info: { direct_reply_count, repost_count, quote_count } }.
// Tìm theo "hình dạng" object thay vì đường dẫn cố định để không gãy khi Threads đổi
// cấu trúc bọc ngoài (thread_items / edges / node...).
// Chạy chung tab với platforms/threads/content.js (bình luận) - lệnh riêng MK_TH_COLLECT_POSTS,
// không đụng EXECUTE_COMMENT của file đó.
(function () {
    if (window.__mkThreadsCrawlInstalled) return;
    window.__mkThreadsCrawlInstalled = true;

    const SNIFFER_SOURCE = 'mk-threads-crawl-sniffer';
    const USERNAME_RE = /^[A-Za-z0-9._]+$/;
    const CODE_RE = /^[A-Za-z0-9_-]+$/;

    const postsByUrl = new Map();

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function toInt(v) {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }

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
            author_name: o.user.full_name || username,
            content: content,
            post_time: new Date(o.taken_at * 1000).toISOString(),
            reactions: toInt(o.like_count),
            comments: toInt(info.direct_reply_count),
            shares: toInt(info.repost_count) + toInt(info.quote_count),
            image_urls: images.slice(0, 10),
            media_url: typeof video === 'string' ? video : null,
        };
    }

    function walk(node, depth) {
        if (!node || typeof node !== 'object' || depth > 80) return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item, depth + 1);
            return;
        }
        if (isPostObject(node)) {
            const post = toPost(node);
            if (post && !postsByUrl.has(post.post_url)) postsByUrl.set(post.post_url, post);
            // Không đi tiếp vào bên trong: bài được trích dẫn/đăng lại (quoted_post,
            // reposted_post) nằm lồng trong đây KHÔNG phải kết quả tìm kiếm.
            return;
        }
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) walk(node[key], depth + 1);
        }
    }

    function ingestText(text) {
        if (typeof text !== 'string' || text.indexOf('"taken_at"') === -1) return;
        const clean = text.replace(/^\s*for\s*\(;;\);\s*/, '');
        try {
            walk(JSON.parse(clean), 0);
            return;
        } catch (e) {
            // Response dạng nhiều JSON nối nhau theo dòng (streaming) - parse từng dòng.
        }
        for (const line of clean.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.indexOf('"taken_at"') === -1) continue;
            try {
                walk(JSON.parse(t), 0);
            } catch (e) {}
        }
    }

    function ingestEmbeddedJson() {
        document.querySelectorAll('script[type="application/json"]').forEach((s) => {
            ingestText(s.textContent || '');
        });
    }

    // Dự phòng: bài có trên màn hình nhưng không thấy trong JSON (ví dụ Threads đổi
    // định dạng dữ liệu). Chỉ lấy được URL/tác giả/thời gian/nội dung thô, không có
    // số tương tác chính xác.
    function ingestDom() {
        document.querySelectorAll('[data-pressable-container]').forEach((box) => {
            const link = Array.from(box.querySelectorAll('a[href*="/post/"]')).find((a) => {
                return /^\/@[A-Za-z0-9._]+\/post\/[A-Za-z0-9_-]+\/?$/.test(a.getAttribute('href') || '');
            });
            if (!link) return;
            const m = (link.getAttribute('href') || '').match(/^\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/);
            if (!m) return;
            const url = `https://www.threads.com/@${m[1]}/post/${m[2]}`;
            if (postsByUrl.has(url)) return;
            const timeEl = box.querySelector('time[datetime]');
            const timeLabel = timeEl ? (timeEl.innerText || '').trim() : '';
            const lines = (box.innerText || '')
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l && l !== m[1] && l !== timeLabel && l !== 'Translate' && l !== 'Dịch' && !/^\d+([.,]\d+)?[KkMm]?$/.test(l));
            postsByUrl.set(url, {
                post_url: url,
                author_username: m[1],
                author_name: m[1],
                content: lines.join('\n'),
                post_time: timeEl ? timeEl.getAttribute('datetime') : null,
                reactions: 0,
                comments: 0,
                shares: 0,
                image_urls: [],
                media_url: null,
            });
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (data && data.source === SNIFFER_SOURCE) ingestText(data.text);
    });

    async function collect(targetCount, maxScrolls) {
        // Chờ trang render xong kết quả (tối đa ~10s).
        for (let i = 0; i < 20; i++) {
            if (document.querySelector('[data-pressable-container]')) break;
            await sleep(500);
        }
        ingestEmbeddedJson();

        let idleRounds = 0;
        for (let i = 0; i < maxScrolls && postsByUrl.size < targetCount; i++) {
            const before = postsByUrl.size;
            window.scrollTo(0, document.documentElement.scrollHeight);
            await sleep(2500);
            ingestEmbeddedJson();
            if (postsByUrl.size === before) {
                idleRounds++;
                if (idleRounds >= 3) break; // cuộn 3 lần liền không có bài mới -> hết kết quả
            } else {
                idleRounds = 0;
            }
        }

        const jsonCount = postsByUrl.size;
        ingestDom();

        return {
            success: true,
            data: Array.from(postsByUrl.values()),
            fromJson: jsonCount,
            fromDom: postsByUrl.size - jsonCount,
            loginWall: !!document.querySelector('a[href^="/login"], a[href*="threads.com/login"]'),
        };
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.action === 'MK_TH_COLLECT_POSTS') {
            const target = Math.max(1, Number(msg.targetCount) || 60);
            const maxScrolls = Math.max(0, Number(msg.maxScrolls) || 15);
            collect(target, maxScrolls)
                .then(sendResponse)
                .catch((err) => sendResponse({ success: false, error: err && err.message ? err.message : String(err) }));
            return true; // giữ kênh trả lời cho sendResponse bất đồng bộ
        }
        return false;
    });
})();
