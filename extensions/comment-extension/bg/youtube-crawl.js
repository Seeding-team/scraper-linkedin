// YouTube cho "Seeding bên ngoài" (cùng khuôn bg/threads-crawl.js):
//
// 1. Cào video — MK_YT_CRAWL_START / STOP / STATUS. Mỗi mục người dùng nhập là 1 TỪ KHOÁ
//    (mở youtube.com/results?search_query=..., platforms/youtube/crawl.js gom video từ JSON
//    của trang + cuộn thêm) hoặc 1 LINK video (mở thẳng video, đọc thông tin chuẩn của video).
//    Gửi lên POST /api/all-platform/extension/youtube/save-videos. Báo về trang web:
//    MK_YT_CRAWL_LOG / PROGRESS / SAVED / DONE.
// 2. Nhận diện kênh YouTube đang đăng nhập — MK_YT_DETECT_ACCOUNT (để liên kết với tài khoản Markee).
// 3. Mở tab comment — MK_YT_COMMENT_OPEN: mở video trong tab mới, platforms/youtube/assist.js điền
//    sẵn nội dung; nhân viên tự bấm "Bình luận", assist.js báo lại (MK_YT_ASSIST_POSTED) -> gửi
//    POST /api/all-platform/youtube/comment-report kèm token phiên comment -> báo kết quả về trang
//    web (MK_YT_COMMENT_RESULT).
// Bọc IIFE: background.js importScripts file này vào CHUNG global scope của service worker.
(function () {
    const API_KEY = "markee-extension-key-2024";
    const DEFAULT_API_BASE = "https://seeding.markeeai.com";
    const TAB_LOAD_TIMEOUT_MS = 30000;
    const SETTLE_DELAY_MS = 2500;
    const INTER_ITEM_DELAY_MS = 1500;
    const SESSION_KEY_PREFIX = "mk_yt_comment_session_";
    const CONTENT_SCRIPTS = [
        "platforms/youtube/youtube-handler.js",
        "platforms/youtube/crawl.js",
        "platforms/youtube/assist.js",
    ];

    let running = false;
    let shouldStop = false;
    let crawlTabId = null;
    let dashboardTabId = null;

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function notifyTab(tabId, message) {
        if (tabId != null) chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }

    function notifyApp(message) {
        if (dashboardTabId != null) {
            notifyTab(dashboardTabId, message);
            return;
        }
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
                if (tab.id !== crawlTabId) notifyTab(tab.id, message);
            });
        });
    }

    function log(message, level = "info") {
        console.log("[YouTube Crawl]", message);
        notifyApp({ action: "MK_YT_CRAWL_LOG", level, message });
    }

    function waitForTabLoad(tabId, timeoutMs) {
        return new Promise((resolve) => {
            let done = false;
            function finish(ok) {
                if (done) return;
                done = true;
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timer);
                resolve(ok);
            }
            function listener(updatedTabId, changeInfo) {
                if (updatedTabId === tabId && changeInfo.status === "complete") finish(true);
            }
            chrome.tabs.onUpdated.addListener(listener);
            const timer = setTimeout(() => finish(false), timeoutMs);
        });
    }

    async function sendToTab(tabId, message) {
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (e) {
            // Content script chưa có trong tab (vd extension vừa cài/cập nhật) -> tiêm tay rồi thử lại.
            await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
            await sleep(500);
            return chrome.tabs.sendMessage(tabId, message);
        }
    }

    // ── 1. Cào video ─────────────────────────────────────────────────────────

    const VIDEO_URL_RE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)/i;

    function isVideoUrl(item) {
        return VIDEO_URL_RE.test(item);
    }

    // sp= của trang tìm kiếm là protobuf base64: field 1 = sắp xếp (2 = ngày tải lên),
    // field 2 = bộ lọc {1: ngày tải lên (1 giờ/2 hôm nay/3 tuần/4 tháng/5 năm), 2: loại (1 = video)}.
    function buildSearchParams(maxAgeDays, sortRecent) {
        let uploadDate = 0;
        if (maxAgeDays) {
            if (maxAgeDays <= 1) uploadDate = 2;
            else if (maxAgeDays <= 7) uploadDate = 3;
            else if (maxAgeDays <= 31) uploadDate = 4;
            else if (maxAgeDays <= 366) uploadDate = 5;
        }
        const filter = uploadDate ? [0x08, uploadDate, 0x10, 0x01] : [0x10, 0x01];
        const bytes = [...(sortRecent ? [0x08, 0x02] : []), 0x12, filter.length, ...filter];
        return btoa(String.fromCharCode(...bytes));
    }

    function buildSearchUrl(keyword, maxAgeDays, sortRecent) {
        const params = new URLSearchParams({ search_query: keyword, sp: buildSearchParams(maxAgeDays, sortRecent) });
        return `https://www.youtube.com/results?${params.toString()}`;
    }

    function normalizeInputUrl(item) {
        return /^https?:\/\//i.test(item) ? item : `https://${item}`;
    }

    async function openInCrawlTab(url) {
        if (crawlTabId == null) {
            const tab = await chrome.tabs.create({ url, active: true });
            crawlTabId = tab.id;
        } else {
            await chrome.tabs.update(crawlTabId, { url });
        }
        if (!(await waitForTabLoad(crawlTabId, TAB_LOAD_TIMEOUT_MS))) log("Tab YouTube tải chậm, vẫn thử tiếp.", "warn");
        await sleep(SETTLE_DELAY_MS);
    }

    async function postToBackend(apiBase, body) {
        let lastError = null;
        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                const res = await fetch(`${apiBase}/api/all-platform/extension/youtube/save-videos`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.detail ? String(data.detail) : `HTTP ${res.status}`);
                return data;
            } catch (e) {
                lastError = e;
                if (attempt < 2) {
                    log(`Gửi hệ thống lỗi (${e.message}), thử lại lần ${attempt + 1}/2...`, "warn");
                    await sleep(2000);
                }
            }
        }
        throw lastError;
    }

    function describeSkips(saved) {
        const notes = [];
        if (saved.skipped_existing) notes.push(`${saved.skipped_existing} video đã có`);
        if (saved.skipped_old) notes.push(`${saved.skipped_old} video quá cũ`);
        if (saved.skipped_invalid) notes.push(`${saved.skipped_invalid} link không hợp lệ`);
        return notes.length ? ` (bỏ qua ${notes.join(", ")})` : "";
    }

    async function runCrawl(items, config) {
        const apiBase = config.apiBase || DEFAULT_API_BASE;
        const postLimit = Number(config.postLimit) > 0 ? Math.min(100, Math.floor(Number(config.postLimit))) : 20;
        const maxAgeDays = Number(config.maxAgeDays) > 0 ? Math.floor(Number(config.maxAgeDays)) : null;
        const sortRecent = config.sortRecent !== false;
        // Gom dư ra vì backend còn lọc video trùng/cũ rồi mới cắt theo post_limit.
        const targetCount = Math.min(Math.max(postLimit * 2, 30), 150);
        const keywords = items.filter((i) => !isVideoUrl(i));
        const links = items.filter((i) => isVideoUrl(i));
        const total = keywords.length + (links.length ? 1 : 0);

        let totalPosts = 0;
        let totalSaved = 0;
        let step = 0;

        try {
            log(`Bắt đầu: ${keywords.length} từ khoá${links.length ? ` + ${links.length} link video` : ""} (tối đa ${postLimit} video mới/từ khoá)...`);

            for (const keyword of keywords) {
                if (shouldStop) break;
                notifyApp({ action: "MK_YT_CRAWL_PROGRESS", groupIndex: step, totalGroups: total, keyword, posts: totalPosts });
                log(`[${step + 1}/${total}] Đang tìm: "${keyword}"`);
                await openInCrawlTab(buildSearchUrl(keyword, maxAgeDays, sortRecent));
                if (shouldStop || crawlTabId == null) break;

                let result;
                try {
                    result = await sendToTab(crawlTabId, { action: "MK_YT_COLLECT_SEARCH", targetCount, maxScrolls: 12 });
                } catch (e) {
                    log(`Không đọc được trang kết quả: ${e.message}`, "error");
                    step++;
                    continue;
                }
                if (!result || !result.success) {
                    log(`Lỗi gom video: ${(result && result.error) || "không có phản hồi"}`, "error");
                    step++;
                    continue;
                }

                const posts = result.data || [];
                totalPosts += posts.length;
                notifyApp({ action: "MK_YT_CRAWL_PROGRESS", groupIndex: step, totalGroups: total, keyword, posts: totalPosts });
                log(`Tìm thấy ${posts.length} video cho "${keyword}".`);
                if (posts.length > 0) {
                    try {
                        const saved = await postToBackend(apiBase, {
                            posts,
                            keyword,
                            id_member: config.idMember || null,
                            post_limit: postLimit,
                            max_age_days: maxAgeDays,
                            extension_version: "Markee-Seeding-Extension-2.2",
                        });
                        const count = saved.count || 0;
                        totalSaved += count;
                        log(`Đã lưu ${count} video mới cho "${keyword}"${describeSkips(saved)}.`, "success");
                        notifyApp({ action: "MK_YT_CRAWL_SAVED", count, groupUrl: keyword, groupId: "" });
                    } catch (e) {
                        log(`Lỗi lưu video cho "${keyword}": ${e.message}`, "error");
                    }
                }
                step++;
                await sleep(INTER_ITEM_DELAY_MS);
            }

            if (links.length && !shouldStop) {
                notifyApp({ action: "MK_YT_CRAWL_PROGRESS", groupIndex: step, totalGroups: total, keyword: "Link video", posts: totalPosts });
                log(`[${step + 1}/${total}] Đang đọc ${links.length} link video...`);
                const videos = [];
                for (const link of links) {
                    if (shouldStop) break;
                    const url = normalizeInputUrl(link);
                    let video = null;
                    try {
                        await openInCrawlTab(url);
                        if (crawlTabId == null) break;
                        const res = await sendToTab(crawlTabId, { action: "MK_YT_COLLECT_VIDEO" });
                        if (res && res.success && res.data) video = res.data;
                    } catch (e) {
                        log(`Không đọc được ${link}: ${e.message}`, "warn");
                    }
                    if (!video) {
                        // Không đọc được trang video: vẫn gửi link để backend chuẩn hoá + lưu (thiếu tiêu đề).
                        log(`Không lấy được thông tin chi tiết của ${link}, chỉ lưu link.`, "warn");
                        video = { post_url: url };
                    }
                    videos.push(video);
                }
                totalPosts += videos.length;
                if (videos.length) {
                    try {
                        const saved = await postToBackend(apiBase, {
                            posts: videos,
                            direct_links: true,
                            id_member: config.idMember || null,
                            extension_version: "Markee-Seeding-Extension-2.2",
                        });
                        const count = saved.count || 0;
                        totalSaved += count;
                        log(`Đã lưu ${count} video từ link${describeSkips(saved)}.`, "success");
                        notifyApp({ action: "MK_YT_CRAWL_SAVED", count, groupUrl: "links", groupId: "" });
                    } catch (e) {
                        log(`Lỗi lưu link video: ${e.message}`, "error");
                    }
                }
            }
            log(shouldStop ? `Đã dừng. Tổng đã lưu: ${totalSaved} video mới.` : `Hoàn tất! Tổng đã lưu: ${totalSaved} video mới.`, "success");
        } catch (e) {
            log(`Lỗi nghiêm trọng: ${e.message}`, "error");
        } finally {
            const stopped = shouldStop;
            const tabId = crawlTabId;
            running = false;
            shouldStop = false;
            crawlTabId = null;
            if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
            notifyApp({ action: "MK_YT_CRAWL_DONE", totalGroups: total, totalPosts, totalSaved, stopped });
        }
    }

    chrome.tabs.onRemoved.addListener((tabId) => {
        if (running && tabId === crawlTabId) {
            crawlTabId = null;
            shouldStop = true;
            log("Tab cào YouTube bị đóng — đã dừng.", "warn");
        }
        chrome.storage.session.remove(SESSION_KEY_PREFIX + tabId).catch(() => {});
    });

    // ── 2. Nhận diện kênh đang đăng nhập ─────────────────────────────────────

    async function detectAccount() {
        const existing = await chrome.tabs.query({ url: ["*://www.youtube.com/*", "*://m.youtube.com/*"] });
        const usable = existing.find((t) => t.status === "complete" && !t.discarded);
        if (usable) {
            try {
                return await sendToTab(usable.id, { action: "MK_YT_DETECT_ACCOUNT" });
            } catch (e) {
                // Tab đang mở không trả lời (vd bị treo) -> mở tab riêng bên dưới.
            }
        }
        const tab = await chrome.tabs.create({ url: "https://www.youtube.com/", active: false });
        try {
            await waitForTabLoad(tab.id, TAB_LOAD_TIMEOUT_MS);
            await sleep(1500);
            return await sendToTab(tab.id, { action: "MK_YT_DETECT_ACCOUNT" });
        } finally {
            chrome.tabs.remove(tab.id).catch(() => {});
        }
    }

    // ── 3. Mở tab comment + ghi nhận KPI ─────────────────────────────────────

    async function openCommentTab(payload, senderTabId) {
        const tab = await chrome.tabs.create({ url: payload.url, active: true });
        const session = {
            url: payload.url,
            text: payload.text || "",
            token: payload.token,
            apiBase: payload.apiBase || DEFAULT_API_BASE,
            postId: payload.postId || "",
            expectedChannel: payload.expectedChannel || null,
            dashboardTabId: senderTabId,
            createdAt: Date.now(),
        };
        // storage.session thay vì biến trong bộ nhớ: service worker có thể bị Chrome cho "ngủ"
        // trong lúc nhân viên còn đang đọc video / sửa lại nội dung comment.
        await chrome.storage.session.set({ [SESSION_KEY_PREFIX + tab.id]: session });
        return tab.id;
    }

    async function getSession(tabId) {
        const key = SESSION_KEY_PREFIX + tabId;
        const data = await chrome.storage.session.get(key);
        return data[key] || null;
    }

    async function reportPosted(tabId, report) {
        const session = await getSession(tabId);
        if (!session) return { success: false, message: "Tab này không còn phiên comment của Markee (đã đóng/hết hạn)." };

        let result;
        try {
            const res = await fetch(`${session.apiBase}/api/all-platform/youtube/comment-report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: session.token,
                    content: report.content || session.text,
                    link_comment: report.link_comment || null,
                    detected_channel_id: report.detected_channel_id || null,
                    detected_handle: report.detected_handle || null,
                    detected_name: report.detected_name || null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            result = res.ok ? data : { success: false, message: data.detail || data.message || `HTTP ${res.status}` };
        } catch (e) {
            result = { success: false, message: `Không gửi được kết quả về Markee: ${e.message}` };
        }

        if (result.success) {
            // Mỗi phiên chỉ tính 1 lần: comment thêm lần nữa trên cùng tab không cộng KPI nữa.
            await chrome.storage.session.remove(SESSION_KEY_PREFIX + tabId);
        }
        notifyTab(session.dashboardTabId, {
            action: "MK_YT_COMMENT_RESULT",
            success: !!result.success,
            message: result.message || "",
            postId: session.postId,
            linkComment: report.link_comment || null,
        });
        return { success: !!result.success, message: result.message || "" };
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;
        if (msg.action === "MK_YT_CRAWL_START") {
            if (running) {
                sendResponse({ success: false, error: "Đang có một tiến trình cào YouTube chạy." });
                return;
            }
            const seen = new Set();
            const items = (msg.keywords || [])
                .map((k) => String(k || "").trim())
                .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
            if (items.length === 0) {
                sendResponse({ success: false, error: "Chưa có từ khoá hoặc link video nào." });
                return;
            }
            running = true;
            shouldStop = false;
            dashboardTabId = sender.tab ? sender.tab.id : null;
            sendResponse({ success: true, total: items.length });
            runCrawl(items, msg.config || {});
            return;
        }
        if (msg.action === "MK_YT_CRAWL_STOP") {
            if (running) {
                shouldStop = true;
                log("Đã nhận lệnh dừng, sẽ dừng sau bước hiện tại...", "warn");
            }
            sendResponse({ success: true });
            return;
        }
        if (msg.action === "MK_YT_CRAWL_STATUS") {
            sendResponse({ running });
            return;
        }
        if (msg.action === "MK_YT_DETECT_ACCOUNT") {
            detectAccount()
                .then((res) => sendResponse(res || { success: false, error: "Không nhận được phản hồi từ trang YouTube." }))
                .catch((e) => sendResponse({ success: false, error: e.message }));
            return true;
        }
        if (msg.action === "MK_YT_COMMENT_OPEN") {
            const p = msg.payload || {};
            if (!p.url || !p.token) {
                sendResponse({ success: false, error: "Thiếu link video hoặc phiên comment." });
                return;
            }
            openCommentTab(p, sender.tab ? sender.tab.id : null)
                .then((tabId) => sendResponse({ success: true, tabId }))
                .catch((e) => sendResponse({ success: false, error: e.message }));
            return true;
        }
        if (msg.action === "MK_YT_ASSIST_GET") {
            const tabId = sender.tab ? sender.tab.id : null;
            if (tabId == null) {
                sendResponse({ session: null });
                return;
            }
            getSession(tabId)
                .then((session) => sendResponse({
                    session: session && {
                        url: session.url,
                        text: session.text,
                        expectedChannel: session.expectedChannel,
                    },
                }))
                .catch(() => sendResponse({ session: null }));
            return true;
        }
        if (msg.action === "MK_YT_ASSIST_POSTED") {
            const tabId = sender.tab ? sender.tab.id : null;
            reportPosted(tabId, msg.report || {})
                .then(sendResponse)
                .catch((e) => sendResponse({ success: false, message: e.message }));
            return true;
        }
    });
})();
