// Cào bài Threads theo TỪ KHOÁ (Threads không có "group" như Facebook/LinkedIn).
// Với mỗi từ khoá: mở trang threads.com/search?q=<từ khoá> trong 1 tab riêng, nhờ
// platforms/threads/crawl.js gom bài (JSON của trang + GraphQL khi cuộn), rồi gửi lên
// POST /api/all-platform/extension/threads/save-posts để backend lọc (trùng, quá cũ),
// ưu tiên tương tác và lưu. Lệnh từ trang web: MK_TH_CRAWL_START / STOP / STATUS;
// báo về trang web: MK_TH_CRAWL_LOG / PROGRESS / SAVED / DONE (cùng khuôn MK_LI_CRAWL_*).
// Bọc IIFE: background.js importScripts file này vào CHUNG global scope của service worker.
(function () {
    const API_KEY = "markee-extension-key-2024";
    const DEFAULT_API_BASE = "https://seeding.markeeai.com";
    const TAB_LOAD_TIMEOUT_MS = 30000;
    const SETTLE_DELAY_MS = 2500;
    const INTER_KEYWORD_DELAY_MS = 1500;

    let running = false;
    let shouldStop = false;
    let crawlTabId = null;
    let dashboardTabId = null;

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function notifyApp(message) {
        if (dashboardTabId != null) {
            chrome.tabs.sendMessage(dashboardTabId, message).catch(() => {});
            return;
        }
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
                if (tab.id !== crawlTabId) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
            });
        });
    }

    function log(message, level = "info") {
        console.log("[Threads Crawl]", message);
        notifyApp({ action: "MK_TH_CRAWL_LOG", level, message });
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

    function buildSearchUrl(keyword, sortRecent) {
        const params = new URLSearchParams({ q: keyword, serp_type: "default" });
        // Tab "Gần đây" của trang tìm kiếm - chỉ có tác dụng khi đã đăng nhập Threads.
        if (sortRecent) params.set("filter", "recent");
        return `https://www.threads.com/search?${params.toString()}`;
    }

    async function collectFromTab(tabId, targetCount) {
        const message = { action: "MK_TH_COLLECT_POSTS", targetCount, maxScrolls: 15 };
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (e) {
            // crawl.js chưa có trong tab (vd extension vừa cài/cập nhật) -> tiêm tay rồi thử lại.
            await chrome.scripting.executeScript({ target: { tabId }, files: ["platforms/threads/crawl.js"] });
            await sleep(500);
            return chrome.tabs.sendMessage(tabId, message);
        }
    }

    async function postToBackend(apiBase, body) {
        let lastError = null;
        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                const res = await fetch(`${apiBase}/api/all-platform/extension/threads/save-posts`, {
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

    async function runCrawl(keywords, config) {
        const apiBase = config.apiBase || DEFAULT_API_BASE;
        const postLimit = Number(config.postLimit) > 0 ? Math.min(100, Math.floor(Number(config.postLimit))) : 20;
        const maxAgeDays = Number(config.maxAgeDays) > 0 ? Math.floor(Number(config.maxAgeDays)) : null;
        const sortRecent = config.sortRecent !== false;
        // Gom dư ra (x3) vì backend còn lọc bài trùng/bài cũ rồi mới cắt theo post_limit.
        const targetCount = Math.min(Math.max(postLimit * 3, 30), 150);

        let totalPosts = 0;
        let totalSaved = 0;
        let loginHintShown = false;
        let wasStopped = false;

        try {
            log(`Bắt đầu tìm bài Threads cho ${keywords.length} từ khoá (tối đa ${postLimit} bài mới/từ khoá)...`);
            for (let i = 0; i < keywords.length; i++) {
                if (shouldStop) break;
                const keyword = keywords[i];
                notifyApp({ action: "MK_TH_CRAWL_PROGRESS", groupIndex: i, totalGroups: keywords.length, keyword, posts: totalPosts });
                log(`[${i + 1}/${keywords.length}] Đang tìm: "${keyword}"`);

                const url = buildSearchUrl(keyword, sortRecent);
                if (crawlTabId == null) {
                    const tab = await chrome.tabs.create({ url, active: true });
                    crawlTabId = tab.id;
                } else {
                    await chrome.tabs.update(crawlTabId, { url });
                }
                if (!(await waitForTabLoad(crawlTabId, TAB_LOAD_TIMEOUT_MS))) log("Tab Threads tải chậm, vẫn thử tiếp.", "warn");
                await sleep(SETTLE_DELAY_MS);
                if (shouldStop || crawlTabId == null) break;

                let result;
                try {
                    result = await collectFromTab(crawlTabId, targetCount);
                } catch (e) {
                    log(`Không đọc được trang kết quả: ${e.message}`, "error");
                    continue;
                }
                if (!result || !result.success) {
                    log(`Lỗi gom bài: ${(result && result.error) || "không có phản hồi"}`, "error");
                    continue;
                }
                if (result.loginWall && !loginHintShown) {
                    loginHintShown = true;
                    log('Chrome chưa đăng nhập Threads: mỗi từ khoá chỉ lấy được ~20 bài "nổi bật" đầu tiên (không cuộn thêm, không lọc được "Gần đây"). Đăng nhập threads.com để lấy nhiều bài mới hơn.', "warn");
                }

                const posts = result.data || [];
                totalPosts += posts.length;
                notifyApp({ action: "MK_TH_CRAWL_PROGRESS", groupIndex: i, totalGroups: keywords.length, keyword, posts: totalPosts });
                log(`Tìm thấy ${posts.length} bài cho "${keyword}"${result.fromDom ? ` (${result.fromDom} bài lấy từ giao diện, thiếu số tương tác)` : ""}.`);
                if (posts.length === 0) continue;

                try {
                    const saved = await postToBackend(apiBase, {
                        posts,
                        keyword,
                        id_member: config.idMember || null,
                        post_limit: postLimit,
                        max_age_days: maxAgeDays,
                        extension_version: "Markee-Seeding-Extension-2.1",
                    });
                    const count = saved.count || 0;
                    totalSaved += count;
                    const notes = [];
                    if (saved.skipped_existing) notes.push(`${saved.skipped_existing} bài đã có`);
                    if (saved.skipped_old) notes.push(`${saved.skipped_old} bài quá cũ`);
                    log(`Đã lưu ${count} bài mới cho "${keyword}"${notes.length ? ` (bỏ qua ${notes.join(", ")})` : ""}.`, "success");
                    notifyApp({ action: "MK_TH_CRAWL_SAVED", count, groupUrl: keyword, groupId: "" });
                } catch (e) {
                    log(`Lỗi lưu bài cho "${keyword}": ${e.message}`, "error");
                }
                await sleep(INTER_KEYWORD_DELAY_MS);
            }
            log(shouldStop ? `Đã dừng. Tổng đã lưu: ${totalSaved} bài mới.` : `Hoàn tất! Tổng đã lưu: ${totalSaved} bài mới.`, "success");
        } catch (e) {
            log(`Lỗi nghiêm trọng: ${e.message}`, "error");
        } finally {
            wasStopped = shouldStop;
            const tabId = crawlTabId;
            running = false;
            shouldStop = false;
            crawlTabId = null;
            if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
            notifyApp({ action: "MK_TH_CRAWL_DONE", totalGroups: keywords.length, totalPosts, totalSaved, stopped: wasStopped });
        }
        return { totalGroups: keywords.length, totalPosts, totalSaved, stopped: wasStopped };
    }

    // Cho phep bg/rotation-crawl.js goi truc tiep va await - xem giai thich o fb-crawl.js.
    self.__mkStartThreadsCrawl = runCrawl;
    self.__mkStopThreadsCrawl = () => { if (running) shouldStop = true; };
    self.__mkThreadsCrawlStatus = () => running;

    chrome.tabs.onRemoved.addListener((tabId) => {
        if (running && tabId === crawlTabId) {
            crawlTabId = null;
            shouldStop = true;
            log("Tab cào Threads bị đóng — đã dừng.", "warn");
        }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;
        if (msg.action === "MK_TH_CRAWL_START") {
            if (running) {
                sendResponse({ success: false, error: "Đang có một tiến trình cào Threads chạy." });
                return;
            }
            const seen = new Set();
            const keywords = (msg.keywords || [])
                .map((k) => String(k || "").trim())
                .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
            if (keywords.length === 0) {
                sendResponse({ success: false, error: "Chưa có từ khoá nào để tìm." });
                return;
            }
            running = true;
            shouldStop = false;
            dashboardTabId = sender.tab ? sender.tab.id : null;
            sendResponse({ success: true, total: keywords.length });
            runCrawl(keywords, msg.config || {});
            return;
        }
        if (msg.action === "MK_TH_CRAWL_STOP") {
            if (running) {
                shouldStop = true;
                log("Đã nhận lệnh dừng, sẽ dừng sau bước hiện tại...", "warn");
            }
            sendResponse({ success: true });
            return;
        }
        if (msg.action === "MK_TH_CRAWL_STATUS") {
            sendResponse({ running });
        }
    });
})();
