// Đọc dữ liệu YouTube cho "Seeding bên ngoài" (lệnh từ bg/youtube-crawl.js):
//   MK_YT_COLLECT_SEARCH  — gom video trên trang youtube.com/results (JSON ytInitialData + cuộn thêm đọc DOM)
//   MK_YT_COLLECT_VIDEO   — đọc thông tin chuẩn của 1 video (ytInitialPlayerResponse)
//   MK_YT_DETECT_ACCOUNT  — kênh YouTube đang đăng nhập trên trình duyệt (channel_id + @handle + tên)
// Hàm mkYtDetectAccount dùng chung với platforms/youtube/assist.js (cùng isolated world).
(function () {
    if (window.__mkYtCrawlLoaded) return;
    window.__mkYtCrawlLoaded = true;

    const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function textOf(node) {
        if (!node) return "";
        if (typeof node === "string") return node;
        if (node.simpleText) return node.simpleText;
        if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
        if (node.content) return node.content;
        return "";
    }

    // "1,2 N lượt xem" / "12K views" / "1.234.567 lượt xem" / "Chưa có lượt xem" -> số.
    function parseCount(raw) {
        const text = String(raw || "").trim().toLowerCase();
        if (!text) return 0;
        const m = text.match(/(\d+(?:[.,]\d+)*)\s*(k|n|nghìn|ngàn|m|tr|triệu|b|t|tỷ)?(?=\s|$|[^\wà-ỹ])/i);
        if (!m) return 0;
        const suffix = (m[2] || "").toLowerCase();
        if (!suffix) return parseInt(m[1].replace(/[.,]/g, ""), 10) || 0;
        const num = parseFloat(m[1].replace(",", "."));
        if (!isFinite(num)) return 0;
        const mult = ["k", "n", "nghìn", "ngàn"].includes(suffix) ? 1e3 : ["m", "tr", "triệu"].includes(suffix) ? 1e6 : 1e9;
        return Math.round(num * mult);
    }

    const UNIT_SECONDS = {
        second: 1, giây: 1,
        minute: 60, phút: 60,
        hour: 3600, giờ: 3600,
        day: 86400, ngày: 86400,
        week: 604800, tuần: 604800,
        month: 2592000, tháng: 2592000,
        year: 31536000, năm: 31536000,
        // Dạng viết tắt YouTube đang dùng ở trang tìm kiếm: "2w ago", "3d ago", "1mo ago", "5h ago".
        s: 1, sec: 1, m: 60, min: 60, h: 3600, hr: 3600, d: 86400, w: 604800, wk: 604800, mo: 2592000, y: 31536000, yr: 31536000,
    };

    // "2 ngày trước" / "Đã phát trực tiếp 3 giờ trước" / "5 days ago" / "2w ago" -> ISO (ước lượng).
    function relativeToIso(raw) {
        const text = String(raw || "").toLowerCase();
        const m = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year|giây|phút|giờ|ngày|tuần|tháng|năm|sec|min|hr|wk|mo|yr|[smhdwy])(?![a-z])/)
            || text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s/);
        if (!m) return null;
        const secs = UNIT_SECONDS[m[2]];
        if (!secs) return null;
        return new Date(Date.now() - Number(m[1]) * secs * 1000).toISOString();
    }

    function handleFromUrl(url) {
        const m = String(url || "").match(/\/(@[^/?#]+)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function absolute(url) {
        if (!url) return null;
        try {
            return new URL(url, "https://www.youtube.com").href;
        } catch (e) {
            return null;
        }
    }

    // Lấy JSON gán sau `marker` trong script inline của trang (vd "var ytInitialData = {...};").
    function extractJsonAfter(source, marker) {
        const idx = source.indexOf(marker);
        if (idx < 0) return null;
        const start = source.indexOf("{", idx + marker.length);
        if (start < 0) return null;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(source.slice(start, i + 1));
                    } catch (e) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    function readInlineJson(marker) {
        for (const script of document.querySelectorAll("script")) {
            const text = script.textContent || "";
            if (text.includes(marker)) {
                const data = extractJsonAfter(text, marker);
                if (data) return data;
            }
        }
        return null;
    }

    function walk(node, visit, depth = 0) {
        if (!node || typeof node !== "object" || depth > 60) return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item, visit, depth + 1);
            return;
        }
        if (visit(node) === false) return;
        for (const key of Object.keys(node)) walk(node[key], visit, depth + 1);
    }

    // ── Trang tìm kiếm ───────────────────────────────────────────────────────

    function fromVideoRenderer(v) {
        const owner = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0]) || (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0]) || {};
        const browse = (owner.navigationEndpoint && owner.navigationEndpoint.browseEndpoint) || {};
        const path = (v.navigationEndpoint && v.navigationEndpoint.commandMetadata && v.navigationEndpoint.commandMetadata.webCommandMetadata && v.navigationEndpoint.commandMetadata.webCommandMetadata.url) || "";
        const isShort = path.startsWith("/shorts/");
        const snippet = (v.detailedMetadataSnippets && v.detailedMetadataSnippets[0] && textOf(v.detailedMetadataSnippets[0].snippetText)) || textOf(v.descriptionSnippet);
        const thumbs = (v.thumbnail && v.thumbnail.thumbnails) || [];
        const published = textOf(v.publishedTimeText);
        return {
            video_id: v.videoId,
            post_url: isShort ? `https://www.youtube.com/shorts/${v.videoId}` : `https://www.youtube.com/watch?v=${v.videoId}`,
            is_short: isShort,
            title: textOf(v.title),
            description: snippet,
            author_name: owner.text || "",
            channel_id: CHANNEL_ID_RE.test(browse.browseId || "") ? browse.browseId : null,
            channel_handle: handleFromUrl(browse.canonicalBaseUrl),
            author_url: absolute(browse.canonicalBaseUrl),
            published_text: published,
            post_time: relativeToIso(published),
            duration_text: textOf(v.lengthText),
            view_count: parseCount(textOf(v.viewCountText)),
            image_urls: thumbs.length ? [thumbs[thumbs.length - 1].url.split("?")[0]] : [],
        };
    }

    function fromShortsLockup(s) {
        const cmd = s.onTap && s.onTap.innertubeCommand;
        const videoId = (cmd && cmd.reelWatchEndpoint && cmd.reelWatchEndpoint.videoId) || (s.entityId || "").replace(/^shorts-shelf-item-/, "");
        if (!/^[\w-]{11}$/.test(videoId || "")) return null;
        const meta = s.overlayMetadata || {};
        return {
            video_id: videoId,
            post_url: `https://www.youtube.com/shorts/${videoId}`,
            is_short: true,
            title: textOf(meta.primaryText),
            view_count: parseCount(textOf(meta.secondaryText)),
        };
    }

    function collectFromInitialData() {
        const data = readInlineJson("ytInitialData = ") || readInlineJson("ytInitialData");
        const out = [];
        if (!data) return out;
        walk(data, (node) => {
            if (node.videoRenderer && node.videoRenderer.videoId) {
                out.push(fromVideoRenderer(node.videoRenderer));
                return false;
            }
            if (node.reelItemRenderer && node.reelItemRenderer.videoId) {
                const r = node.reelItemRenderer;
                out.push({
                    video_id: r.videoId,
                    post_url: `https://www.youtube.com/shorts/${r.videoId}`,
                    is_short: true,
                    title: textOf(r.headline),
                    view_count: parseCount(textOf(r.viewCountText)),
                });
                return false;
            }
            if (node.shortsLockupViewModel) {
                const v = fromShortsLockup(node.shortsLockupViewModel);
                if (v) out.push(v);
                return false;
            }
            return true;
        });
        return out;
    }

    // Video tải thêm khi cuộn không có trong ytInitialData -> đọc từ giao diện.
    function collectFromDom() {
        const out = [];
        document.querySelectorAll("ytd-video-renderer").forEach((el) => {
            const link = el.querySelector("a#video-title, a#thumbnail");
            const href = link && link.getAttribute("href");
            if (!href) return;
            const url = absolute(href);
            let videoId = null;
            let isShort = false;
            try {
                const u = new URL(url);
                if (u.pathname.startsWith("/shorts/")) {
                    videoId = u.pathname.split("/")[2];
                    isShort = true;
                } else {
                    videoId = u.searchParams.get("v");
                }
            } catch (e) {
                return;
            }
            if (!/^[\w-]{11}$/.test(videoId || "")) return;
            const channelLink = el.querySelector("ytd-channel-name a, #channel-info a[href^='/@'], #channel-info a[href^='/channel/']");
            const channelHref = channelLink && channelLink.getAttribute("href");
            const metaSpans = Array.from(el.querySelectorAll("#metadata-line span.inline-metadata-item, #metadata-line span")).map((s) => s.textContent.trim()).filter(Boolean);
            // Ô thời gian luôn có "trước"/"ago" ("2 tuần trước", "2w ago"); ô còn lại là lượt xem —
            // giao diện có lúc chỉ hiện con số trần ("50"), và "1.2M" không được hiểu nhầm thành "2 phút".
            const published = metaSpans.find((t) => /trước|ago/i.test(t) && relativeToIso(t)) || "";
            const views = metaSpans.find((t) => t !== published && parseCount(t) > 0) || "";
            const titleEl = el.querySelector("#video-title");
            const snippetEl = el.querySelector(".metadata-snippet-text, #description-text");
            const durationEl = el.querySelector("ytd-thumbnail-overlay-time-status-renderer #text, badge-shape .badge-shape-wiz__text");
            out.push({
                video_id: videoId,
                post_url: isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
                is_short: isShort,
                title: ((titleEl && (titleEl.getAttribute("title") || titleEl.textContent)) || "").trim(),
                description: ((snippetEl && snippetEl.textContent) || "").trim(),
                author_name: ((channelLink && channelLink.textContent) || "").trim(),
                channel_id: (channelHref && (channelHref.match(/\/channel\/(UC[\w-]{22})/) || [])[1]) || null,
                channel_handle: handleFromUrl(channelHref),
                author_url: absolute(channelHref),
                published_text: published,
                post_time: relativeToIso(published),
                duration_text: ((durationEl && durationEl.textContent) || "").trim(),
                view_count: parseCount(views),
            });
        });
        return out;
    }

    async function collectSearch(targetCount, maxScrolls) {
        const byId = new Map();
        const merge = (list) => {
            for (const v of list) {
                if (!v || !v.video_id) continue;
                const prev = byId.get(v.video_id);
                // Giữ bản đầy đủ hơn (JSON có channel_id/thumbnail; DOM chỉ có phần hiển thị).
                byId.set(v.video_id, prev ? { ...v, ...Object.fromEntries(Object.entries(prev).filter(([, val]) => val)) } : v);
            }
        };

        merge(collectFromInitialData());
        merge(collectFromDom());

        let stagnant = 0;
        for (let i = 0; i < maxScrolls && byId.size < targetCount && stagnant < 2; i++) {
            const before = byId.size;
            window.scrollTo(0, document.documentElement.scrollHeight);
            await sleep(1800);
            merge(collectFromDom());
            stagnant = byId.size > before ? 0 : stagnant + 1;
        }
        return Array.from(byId.values());
    }

    // ── Trang video ──────────────────────────────────────────────────────────

    function collectVideo() {
        const player = readInlineJson("ytInitialPlayerResponse = ") || readInlineJson("ytInitialPlayerResponse");
        const details = (player && player.videoDetails) || {};
        const micro = (player && player.microformat && player.microformat.playerMicroformatRenderer) || {};
        let videoId = details.videoId;
        let isShort = location.pathname.startsWith("/shorts/");
        if (!videoId) {
            const m = location.href.match(/(?:v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
            videoId = m ? m[1] : null;
        }
        if (!videoId) return null;

        const meta = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.getAttribute("content") || el.getAttribute("href") || "" : "";
        };
        const ownerUrl = micro.ownerProfileUrl || meta("span[itemprop='author'] link[itemprop='url']");
        const thumbs = (details.thumbnail && details.thumbnail.thumbnails) || [];
        const published = micro.publishDate || micro.uploadDate || meta("meta[itemprop='datePublished']") || meta("meta[itemprop='uploadDate']");
        let postTime = null;
        if (published) {
            const d = new Date(published);
            if (!isNaN(d.getTime())) postTime = d.toISOString();
        }
        return {
            video_id: videoId,
            post_url: isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
            is_short: isShort,
            title: details.title || meta("meta[name='title']") || document.title.replace(/\s*-\s*YouTube$/, ""),
            description: (details.shortDescription || meta("meta[name='description']") || "").slice(0, 2000),
            author_name: details.author || "",
            channel_id: details.channelId || micro.externalChannelId || null,
            channel_handle: handleFromUrl(ownerUrl),
            author_url: absolute(ownerUrl),
            post_time: postTime,
            published_text: published || null,
            duration_text: details.lengthSeconds ? formatDuration(Number(details.lengthSeconds)) : null,
            view_count: Number(details.viewCount) || parseCount(meta("meta[itemprop='interactionCount']")),
            image_urls: thumbs.length ? [thumbs[thumbs.length - 1].url.split("?")[0]] : [],
        };
    }

    function formatDuration(total) {
        if (!total) return null;
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (n) => String(n).padStart(2, "0");
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    }

    // ── Kênh đang đăng nhập ──────────────────────────────────────────────────

    function findSelectedAccount(json) {
        let found = null;
        let first = null;
        walk(json, (node) => {
            if (node.accountItem) {
                const item = node.accountItem;
                if (!first) first = item;
                if (item.isSelected) {
                    found = item;
                    return false;
                }
            }
            return true;
        });
        return found || first;
    }

    async function fetchChannelIdForHandle(handle) {
        try {
            const res = await fetch(`/${encodeURIComponent(handle).replace(/^%40/, "@")}`, { credentials: "include" });
            const html = await res.text();
            const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
                || html.match(/"externalId":"(UC[\w-]{22})"/)
                || html.match(/"browseId":"(UC[\w-]{22})"/);
            return m ? m[1] : null;
        } catch (e) {
            return null;
        }
    }

    // Trả về { success, loggedIn, channel_id, handle, name }.
    async function mkYtDetectAccount() {
        let name = null;
        let handle = null;
        let channelId = null;
        try {
            const res = await fetch("/getAccountSwitcherEndpoint", { credentials: "include" });
            const text = await res.text();
            const json = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
            const item = findSelectedAccount(json);
            if (item) {
                name = textOf(item.accountName) || null;
                const byline = textOf(item.channelHandle) || textOf(item.accountByline);
                if (byline && byline.trim().startsWith("@")) handle = byline.trim();
            }
        } catch (e) {
            // Chưa đăng nhập hoặc YouTube đổi API -> thử cách dự phòng bên dưới.
        }
        if (handle) channelId = await fetchChannelIdForHandle(handle);
        if (!handle && !channelId) {
            // Dự phòng: youtube.com/profile chuyển hướng về kênh của người đang đăng nhập.
            try {
                const res = await fetch("/profile", { credentials: "include" });
                const finalUrl = res.url || "";
                handle = handleFromUrl(finalUrl);
                const m = finalUrl.match(/\/channel\/(UC[\w-]{22})/);
                if (m) channelId = m[1];
                if (!channelId) {
                    const html = await res.text();
                    const idMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
                    if (idMatch) channelId = idMatch[1];
                    if (!name) {
                        const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
                        if (nameMatch) name = nameMatch[1];
                    }
                }
            } catch (e) {
                // bỏ qua
            }
        }
        const loggedIn = !!(handle || channelId);
        return { success: true, loggedIn, channel_id: channelId, handle, name };
    }
    window.mkYtDetectAccount = mkYtDetectAccount;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request) return false;
        if (request.action === "MK_YT_COLLECT_SEARCH") {
            collectSearch(Number(request.targetCount) || 40, Number(request.maxScrolls) || 10)
                .then((data) => sendResponse({ success: true, data }))
                .catch((e) => sendResponse({ success: false, error: e.message }));
            return true;
        }
        if (request.action === "MK_YT_COLLECT_VIDEO") {
            try {
                const data = collectVideo();
                sendResponse(data ? { success: true, data } : { success: false, error: "Không đọc được thông tin video." });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
            return false;
        }
        if (request.action === "MK_YT_DETECT_ACCOUNT") {
            mkYtDetectAccount()
                .then(sendResponse)
                .catch((e) => sendResponse({ success: false, error: e.message }));
            return true;
        }
        return false;
    });
})();
