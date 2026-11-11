// platforms/threads/crawl.js - cào bài Threads (world cô lập), KẾT HỢP DOM + bắt API:
//   1. API: response GraphQL / route-definition do crawl-sniffer.js (MAIN world) bắt được khi trang tự gọi
//      lúc cuộn (chỉ có khi đã đăng nhập) -> "dịch ngược" JSON ra bài viết GỐC (loại bỏ hoàn toàn reply/comment).
//   2. JSON nhúng sẵn trong HTML (<script type="application/json">) - trang kết quả đầu tiên.
//   3. DOM: vừa là "tay lái" (cuộn tới bài cuối để trang tự gọi API trang sau, giống người
//      thật — không tự bắn request), vừa là nguồn dữ liệu: đọc mỗi vòng cuộn, lấy được bài
//      mà API/JSON không có + bổ sung số like/bình luận/đăng lại đọc từ nút tương tác.
// Gộp 3 nguồn theo post_url: dữ liệu API/JSON (chính xác) ghi đè dữ liệu DOM (ước lượng),
// DOM chỉ điền vào chỗ còn trống. Mọi post được xác định là reply/comment (is_reply === true,
// reply_to_author != null, root_post_author != null, hoặc nằm ở thread_items[1..N]) đều bị
// đưa vào danh sách chặn knownReplyUrls để DOM không bao giờ cào nhầm comment thành bài viết.
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
    // Danh sách post_url đã xác định là bình luận/reply để chặn cả ở API, JSON và DOM.
    const knownReplyUrls = new Set();
    // Danh sách post_url đã xác định là quá hạn maxAgeDays để không đếm vào store.size làm dừng cuộn sớm.
    const knownOldUrls = new Set();
    let activeMaxAgeDays = 7;
    const stats = { domEnriched: 0, apiResponses: 0 };
    const apiNames = new Map();
    let parsedScripts = new WeakSet();
    // post_url của bài mới/vừa cập nhật, chưa đẩy về background.
    const pendingStream = new Set();
    let activityWaiter = null;
    let stopRequested = false;
    let collecting = false;
    let lastTrackedHref = window.location.href;

    // Các query GraphQL chỉ trả về bình luận hoặc dữ liệu phụ, không phải bài viết kết quả tìm kiếm.
    const IGNORED_API_NAMES = /^(BarcelonaPostPageDirectRepliesRefetchQuery|BarcelonaPostPageDownwardQuery|BarcelonaPostPageRefetchableDirectRepliesQuery|useBarcelonaBatchedPolls)$/i;
    // Các nhánh con trong JSON chứa bài trích dẫn hoặc danh sách bình luận -> tuyệt đối không đệ quy vào.
    const SKIP_WALK_KEYS = new Set([
        'quoted_post',
        'reposted_post',
        'share_info',
        'direct_replies',
        'reply_threads',
        'reply_to_author',
        'root_post_author',
        'pinned_post_info',
    ]);

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

    function normalizeTakenAtIso(rawTakenAt) {
        if (rawTakenAt == null || rawTakenAt === '') return null;
        const num = Number(rawTakenAt);
        if (!Number.isFinite(num) || num <= 0) return null;
        // Hỗ trợ cả unix seconds (10 chữ số) và milliseconds (13 chữ số)
        const ms = num > 1e12 ? num : num * 1000;
        // Chỉ nhận mốc thời gian hợp lý (từ năm 2023 đến hiện tại + 1 ngày)
        if (ms < 1672531200000 || ms > Date.now() + 86400000) return null;
        return new Date(ms).toISOString();
    }

    function isPostTooOld(postTimeIso) {
        if (!activeMaxAgeDays || activeMaxAgeDays <= 0) return false;
        if (!postTimeIso) return false;
        const ts = new Date(postTimeIso).getTime();
        if (!Number.isFinite(ts)) return false;
        const cutoffMs = Date.now() - activeMaxAgeDays * 86400000;
        return ts < cutoffMs;
    }

    function parseThreadsDomTime(timeEl, fallbackLabel) {
        if (timeEl) {
            const dtAttr = (timeEl.getAttribute('datetime') || '').trim();
            if (dtAttr) {
                const parsed = new Date(dtAttr);
                if (!isNaN(parsed.getTime())) return parsed.toISOString();
            }
        }
        const raw = String(
            (timeEl && (timeEl.getAttribute('title') || timeEl.getAttribute('aria-label') || timeEl.innerText || timeEl.textContent)) ||
            fallbackLabel ||
            ''
        ).trim();
        if (!raw) return null;

        const direct = new Date(raw);
        if (!isNaN(direct.getTime()) && raw.length >= 8 && /\d{4}/.test(raw)) {
            return direct.toISOString();
        }

        const lower = raw.toLowerCase();
        const now = Date.now();
        if (/^(vừa xong|bây giờ|just now|now)$/i.test(lower)) {
            return new Date(now).toISOString();
        }
        if (/^(hôm qua|yesterday)$/i.test(lower)) {
            return new Date(now - 86400000).toISOString();
        }

        // Khớp tương đối: "5s", "10 giây", "15m", "15 phút", "2h", "2 giờ", "3d", "3 ngày", "1w", "1 tuần"
        let m = lower.match(/^(\d+)\s*(s|sec|secs|giây|giay)\b/i);
        if (m) return new Date(now - Number(m[1]) * 1000).toISOString();

        m = lower.match(/^(\d+)\s*(m|min|mins|minute|minutes|phút|phut|ph)\b/i);
        if (m) return new Date(now - Number(m[1]) * 60000).toISOString();

        m = lower.match(/^(\d+)\s*(h|hr|hrs|hour|hours|giờ|gio|g)\b/i);
        if (m) return new Date(now - Number(m[1]) * 3600000).toISOString();

        m = lower.match(/^(\d+)\s*(d|day|days|ngày|ngay|ng)\b/i);
        if (m) return new Date(now - Number(m[1]) * 86400000).toISOString();

        m = lower.match(/^(\d+)\s*(w|wk|wks|week|weeks|tuần|tuan)\b/i);
        if (m) return new Date(now - Number(m[1]) * 7 * 86400000).toISOString();

        // Định dạng dd/MM/yyyy hoặc dd-MM-yyyy (hoặc dd/MM trong năm hiện tại)
        m = lower.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
        if (m) {
            const day = Number(m[1]);
            const month = Number(m[2]) - 1;
            let year = m[3] ? Number(m[3]) : new Date(now).getFullYear();
            if (year < 100) year += 2000;
            const constructed = new Date(year, month, day, 12, 0, 0);
            if (!isNaN(constructed.getTime())) return constructed.toISOString();
        }

        return null;
    }

    function upsert(post, source) {
        if (!post || !post.post_url || knownReplyUrls.has(post.post_url) || knownOldUrls.has(post.post_url)) return;
        if (post.post_time && isPostTooOld(post.post_time)) {
            knownOldUrls.add(post.post_url);
            if (store.has(post.post_url)) {
                store.delete(post.post_url);
                pendingStream.delete(post.post_url);
            }
            return;
        }
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
        if (!o || typeof o !== 'object') return false;
        const takenAtIso = normalizeTakenAtIso(o.taken_at);
        return (
            typeof o.code === 'string' &&
            takenAtIso !== null &&
            o.user && typeof o.user === 'object' &&
            typeof o.user.username === 'string'
        );
    }

    // Kiểm tra xem post object của Threads có phải là bình luận / trả lời (reply) hay không.
    function isReplyPostObject(o) {
        if (!o || typeof o !== 'object') return false;
        const info = o.text_post_app_info;
        if (info && typeof info === 'object') {
            if (info.is_reply === true) return true;
            if (info.reply_to_author != null) return true;
            if (info.root_post_author != null) return true;
            if (info.show_reply_context === true) return true;
            if (info.has_parent_post === true) return true;
        }
        if (o.is_reply === true || o.reply_to_post_id != null) return true;
        if (o.has_parent_post === true || o.parent_post_id != null || o.reply_to_author != null) return true;
        
        // Bắt đầu bằng mention @username trong caption hoặc text fragments
        const captionText = (o.caption && typeof o.caption.text === 'string') ? o.caption.text.trim() : '';
        if (captionText.startsWith('@') || /^(?:đang trả lời|replying to|trả lời)\s+@/i.test(captionText)) return true;
        
        return false;
    }

    function markReplyPostObject(o) {
        if (!o || typeof o !== 'object') return;
        const username = o.user && typeof o.user.username === 'string' ? o.user.username : '';
        const code = typeof o.code === 'string' ? o.code : '';
        if (USERNAME_RE.test(username) && CODE_RE.test(code)) {
            const url = `https://www.threads.com/@${username}/post/${code}`;
            knownReplyUrls.add(url);
            if (store.has(url)) {
                store.delete(url);
                pendingStream.delete(url);
            }
        }
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

        const postTimeIso = normalizeTakenAtIso(o.taken_at);
        if (!postTimeIso) return null;

        return {
            post_url: `https://www.threads.com/@${username}/post/${code}`,
            author_username: username,
            author_name: typeof o.user.full_name === 'string' ? o.user.full_name : '',
            author_avatar: (o.user && typeof o.user.profile_pic_url === 'string') ? o.user.profile_pic_url : null,
            content: content,
            post_time: postTimeIso,
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
        // Trong cấu trúc Threads: thread_items[0] là bài gốc (hoặc bài chính của luồng),
        // còn thread_items[1..N] là các bình luận trả lời nối tiếp bên dưới -> đưa vào blacklist.
        if (Array.isArray(node.thread_items) && node.thread_items.length > 0) {
            for (let i = 1; i < node.thread_items.length; i++) {
                const replyItem = node.thread_items[i];
                if (replyItem && replyItem.post) markReplyPostObject(replyItem.post);
            }
            const firstItem = node.thread_items[0];
            if (firstItem && firstItem.post) {
                if (isReplyPostObject(firstItem.post)) {
                    markReplyPostObject(firstItem.post);
                } else if (isPostObject(firstItem.post)) {
                    upsert(toPost(firstItem.post), source);
                }
            } else if (firstItem) {
                walk(firstItem, depth + 1, source);
            }
        }
        if (isPostObject(node)) {
            if (isReplyPostObject(node)) {
                markReplyPostObject(node);
                return;
            }
            upsert(toPost(node), source);
            // Không đi tiếp vào bên trong: bài được trích dẫn/đăng lại (quoted_post,
            // reposted_post) nằm lồng trong đây KHÔNG phải kết quả tìm kiếm.
            return;
        }
        for (const key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            if (key === 'thread_items' || SKIP_WALK_KEYS.has(key)) continue;
            walk(node[key], depth + 1, source);
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

    // Bài chính của 1 khung: thẻ <time> đầu tiên nằm trong link /@user/post/code thuộc đúng khung `box`
    // (loại trừ bài trích dẫn / quoted post nằm trong khung con `[data-pressable-container]` lồng bên dưới).
    function mainPostLink(box) {
        for (const time of box.querySelectorAll('time')) {
            if (time.closest('[data-pressable-container]') !== box) continue;
            const a = time.closest('a[href*="/post/"]');
            if (a && POST_HREF_RE.test(a.getAttribute('href') || '')) return { link: a, time };
        }
        const a = Array.from(box.querySelectorAll('a[href*="/post/"]')).find(
            (el) => el.closest('[data-pressable-container]') === box && POST_HREF_RE.test(el.getAttribute('href') || '')
        );
        if (!a) return null;
        const innerTime = a.querySelector('time') || Array.from(box.querySelectorAll('time')).find((t) => t.closest('[data-pressable-container]') === box) || null;
        return { link: a, time: innerTime };
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
        const currentPath = window.location.pathname || '';
        const isPostDetailPage = POST_HREF_RE.test(currentPath);

        document.querySelectorAll('[data-pressable-container]').forEach((box) => {
            // Khung con (bài trích dẫn) nằm trong khung khác -> để khung cha xử lý.
            if (box.parentElement && box.parentElement.closest('[data-pressable-container]')) return;
            const found = mainPostLink(box);
            if (!found) return;
            const href = found.link.getAttribute('href') || '';
            const m = href.match(POST_HREF_RE);
            if (!m) return;
            const postUrl = `https://www.threads.com/@${m[1]}/post/${m[2]}`;

            // 1. Nếu URL đã nằm trong danh sách bình luận/reply từ GraphQL/JSON -> bỏ qua ngay.
            if (knownReplyUrls.has(postUrl)) return;

            // 2. Nếu đang ở trang chi tiết 1 bài viết (/post/CODE), mọi khối khác CODE của trang đều là comment.
            if (isPostDetailPage && currentPath.indexOf(`/post/${m[2]}`) === -1) {
                knownReplyUrls.add(postUrl);
                return;
            }

            // 3. Nếu khối DOM hiển thị chỉ báo trả lời hoặc bắt đầu bằng @username -> là comment.
            const rawBoxText = (box.innerText || '').trim();
            if (/^(?:đang trả lời|replying to|trả lời)\s+@?[A-Za-z0-9._]+/im.test(rawBoxText) || /^@[A-Za-z0-9._]+\s+/i.test(rawBoxText)) {
                knownReplyUrls.add(postUrl);
                if (store.has(postUrl)) {
                    store.delete(postUrl);
                    pendingStream.delete(postUrl);
                }
                return;
            }

            // 4. Nếu trong box có thẻ liên kết trả lời hoặc connector line nối lên bài cha
            const hasReplySignal = !!box.querySelector('a[href^="/@"][role="link"][tabindex="-1"], [data-connector], [class*="connector"]');
            if (hasReplySignal && !isPostDetailPage) {
                knownReplyUrls.add(postUrl);
                return;
            }

            const timeLabel = found.time ? (found.time.innerText || found.time.textContent || '').trim() : (found.link.innerText || '').trim();
            const parsedDomTime = parseThreadsDomTime(found.time, timeLabel);
            // DOM không thấy tên hiển thị tách biệt với username -> để trống, finalize() điền.
            const counts = readActionCounts(box);
            const video = box.querySelector('video[src]');
            const avatarImg = box.querySelector('img[alt*="profile picture"], img[alt*="ảnh đại diện"]');
            const avatarUrl = avatarImg ? (avatarImg.currentSrc || avatarImg.src) : null;
            posts.push({
                post_url: postUrl,
                author_username: m[1],
                author_name: '',
                author_avatar: avatarUrl || null,
                content: readContent(box, m[1], timeLabel),
                post_time: parsedDomTime,
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
            if (knownReplyUrls.has(url)) continue;
            const rec = store.get(url);
            if (rec) posts.push({ ...finalize(rec.post), _sources: Array.from(rec.sources) });
        }
        pendingStream.clear();
        if (posts.length === 0) return;
        try {
            chrome.runtime.sendMessage({ action: 'MK_TH_COLLECT_BATCH', posts, total: store.size }).catch(() => {});
        } catch (e) {}
    }

    function resetStoreIfNavigated() {
        if (window.location.href !== lastTrackedHref) {
            lastTrackedHref = window.location.href;
            store.clear();
            knownReplyUrls.clear();
            knownOldUrls.clear();
            pendingStream.clear();
            parsedScripts = new WeakSet();
            stats.domEnriched = 0;
            stats.apiResponses = 0;
            apiNames.clear();
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== SNIFFER_SOURCE) return;
        resetStoreIfNavigated();
        if (data.name && IGNORED_API_NAMES.test(data.name)) return;
        // Chỉ thu thập khi đang ở trang /search hoặc đang trong phiên collect chủ động.
        if (!collecting && !(window.location.pathname || '').startsWith('/search')) return;
        stats.apiResponses++;
        if (data.name) apiNames.set(data.name, (apiNames.get(data.name) || 0) + 1);
        ingestText(data.text, 'api');
        if (collecting) flushStream();
        if (activityWaiter) activityWaiter();
    });

        function checkSecurityInterception() {
        const href = window.location.href;
        if (/\/challenge\//i.test(href) || /\/login/i.test(href) || /checkpoint/i.test(href)) {
            return { blocked: true, reason: "Trình duyệt bị chuyển hướng tới trang xác minh/challenge của Threads: " + href };
        }
        const bodyText = (document.body && document.body.innerText) || "";
        const alertPatterns = [
            /help us confirm that you're human/i,
            /action blocked/i,
            /try again later/i,
            /chúng tôi nhận thấy hoạt động bất thường/i,
            /vui lòng xác minh bạn là người thật/i,
            /thao tác này đã bị chặn/i,
        ];
        for (const pattern of alertPatterns) {
            if (pattern.test(bodyText)) {
                return { blocked: true, reason: "Phát hiện thông báo chặn/thử thách người thật từ Threads trên trang" };
            }
        }
        return { blocked: false };
    }

        function generateBezierCurve(p0, p1, p2, p3, steps = 15) {
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const u = 1 - t;
            const tt = t * t;
            const uu = u * u;
            const uuu = uu * u;
            const ttt = tt * t;

            const x = Math.round(uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x);
            const y = Math.round(uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y);
            points.push({ x, y });
        }
        return points;
    }

    let lastThreadsMousePos = { x: 300, y: 250 };
    async function humanErraticMouseMove(stepsCount = 14) {
        const targetX = Math.floor(window.innerWidth * (0.15 + Math.random() * 0.7));
        const targetY = Math.floor(window.innerHeight * (0.15 + Math.random() * 0.7));

        const ctrl1 = {
            x: Math.round(lastThreadsMousePos.x + (targetX - lastThreadsMousePos.x) * 0.3 + (Math.random() - 0.5) * 160),
            y: Math.round(lastThreadsMousePos.y + (targetY - lastThreadsMousePos.y) * 0.1 + (Math.random() - 0.5) * 120)
        };
        const ctrl2 = {
            x: Math.round(lastThreadsMousePos.x + (targetX - lastThreadsMousePos.x) * 0.7 + (Math.random() - 0.5) * 160),
            y: Math.round(lastThreadsMousePos.y + (targetY - lastThreadsMousePos.y) * 0.9 + (Math.random() - 0.5) * 120)
        };

        const curve = generateBezierCurve(lastThreadsMousePos, ctrl1, ctrl2, { x: targetX, y: targetY }, stepsCount);
        for (const pt of curve) {
            const jitterX = Math.max(10, Math.min(window.innerWidth - 10, pt.x + Math.floor((Math.random() - 0.5) * 4)));
            const jitterY = Math.max(10, Math.min(window.innerHeight - 10, pt.y + Math.floor((Math.random() - 0.5) * 4)));
            lastThreadsMousePos = { x: jitterX, y: jitterY };

            try {
                const targetEl = document.elementFromPoint(jitterX, jitterY) || document.body;
                targetEl.dispatchEvent(new MouseEvent("mousemove", {
                    bubbles: true,
                    cancelable: true,
                    clientX: jitterX,
                    clientY: jitterY,
                    screenX: jitterX + 40,
                    screenY: jitterY + 80
                }));
            } catch (e) {}
            await new Promise((r) => setTimeout(r, 12 + Math.floor(Math.random() * 16)));
        }

        if (Math.random() < 0.2) {
            await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 600)));
        }
    }

function humanSmoothScroll(targetDelta, durationMs = 800) {
        return new Promise((resolve) => {
            const startY = window.scrollY;
            const startTime = performance.now();
            const easeOutCubic = (t) => (--t) * t * t + 1;

            function step(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(1, elapsed / durationMs);
                const easedProgress = easeOutCubic(progress);
                const currentY = startY + targetDelta * easedProgress;
                window.scrollTo(0, currentY);

                if (Math.random() < 0.25) {
                    humanErraticMouseMove(5).catch(() => {});
                }

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            }
            requestAnimationFrame(step);
        });
    }

    async function scrollStep() {
        const scrollDistance = Math.round(window.innerHeight * (0.65 + Math.random() * 0.35));
        await humanSmoothScroll(scrollDistance, 750 + Math.floor(Math.random() * 300));
        await humanErraticMouseMove(10).catch(() => {});
        if (Math.random() < 0.15) {
            await sleep(500);
            await humanSmoothScroll(-120 - Math.floor(Math.random() * 80), 400);
            await humanErraticMouseMove(6).catch(() => {});
        }
    }


    function hasLoginWall() {
        return !!document.querySelector('a[href^="/login"], a[href*="threads.com/login"]');
    }

    async function collect(targetCount, maxScrolls) {
        resetStoreIfNavigated();
        collecting = true;
        stopRequested = false;

        const initialCheck = checkSecurityInterception();
        if (initialCheck.blocked) {
            collecting = false;
            return { success: false, circuitBreaker: true, error: initialCheck.reason };
        }
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
            const liveCheck = checkSecurityInterception();
            if (liveCheck.blocked) {
                collecting = false;
                return { success: false, circuitBreaker: true, error: liveCheck.reason };
            }
            const before = store.size;
            await scrollStep();
            scrolls++;
            const gotApi = await waitForActivity(3000);
            // Có response API: chờ thêm chút cho DOM render xong + các response nối tiếp.
            const humanReadPause = 2400 + Math.floor(Math.random() * 2200);
            await sleep(humanReadPause);
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

        // Dọn dẹp lần cuối: loại bỏ mọi bài nằm trong knownReplyUrls trước khi trả về.
        for (const replyUrl of knownReplyUrls) {
            store.delete(replyUrl);
        }

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
            activeMaxAgeDays = Number(msg.maxAgeDays) > 0 ? Math.floor(Number(msg.maxAgeDays)) : 7;
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

    // Cho test tự động / debug từ DevTools khi có cờ bật chủ động (world cô lập, an toàn).
    if (typeof window !== 'undefined' && window.__MK_DEV_DEBUG__) {
        window.__mkThreadsCrawlDebug = { parseCount, readDomPosts, store, knownReplyUrls, stats };
    }
})();
