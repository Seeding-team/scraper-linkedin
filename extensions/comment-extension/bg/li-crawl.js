// Cào bài LinkedIn Group theo lệnh từ trang web (port từ linkedin-group-crawler-extension/background.js).
// Mở 1 tab riêng, đi lần lượt từng group, platforms/linkedin/crawler.js cuộn + trích bài rồi
// báo LI_CRAWL_GROUP_DONE, module này lưu lên backend ngay sau mỗi group.
// Trạng thái hàng đợi lưu vào chrome.storage.local: service worker MV3 có thể bị Chrome cho
// "ngủ" giữa 2 group (content script cuộn hàng phút), khi thức dậy phải đọc lại được.
// Bọc IIFE: background.js importScripts file này vào CHUNG global scope của service worker
// (background.js cũng có persistState()/delay()... — không được đè lên nhau).
(function () {
    const API_KEY = "markee-extension-key-2024";
    const DEFAULT_API_BASE = "https://seeding.markeeai.com";
    const STATE_KEY = "mk_li_crawl_state";
    const TAB_LOAD_TIMEOUT_MS = 30000;
    const SETTLE_DELAY_MS = 4000;
    const INTER_GROUP_COOLDOWN_MS = 6000;

    let crawlState = null;

    function defaultState() {
        return {
            running: false,
            groupQueue: [],
            currentIndex: -1,
            config: { maxPosts: 40, scrollDelayMinMs: 2500, scrollDelayMaxMs: 5000 },
            apiBase: DEFAULT_API_BASE,
            idMember: null,
            tabId: null,
            dashboardTabId: null,
            totalPosts: 0,
            totalSaved: 0,
        };
    }

    async function getState() {
        if (crawlState) return crawlState;
        const stored = await chrome.storage.local.get(STATE_KEY);
        crawlState = stored[STATE_KEY] || defaultState();
        return crawlState;
    }

    async function saveState() {
        await chrome.storage.local.set({ [STATE_KEY]: crawlState });
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    async function notifyApp(message) {
        const state = await getState();
        if (state.dashboardTabId != null) {
            chrome.tabs.sendMessage(state.dashboardTabId, message).catch(() => {});
            return;
        }
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {}));
        });
    }

    function log(message, level = "info") {
        console.log("[LI Crawl]", message);
        notifyApp({ action: "MK_LI_CRAWL_LOG", level, message });
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
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) return finish(false);
                if (tab && tab.status === "complete") return finish(true);
                chrome.tabs.onUpdated.addListener(listener);
            });
            const timer = setTimeout(() => finish(false), timeoutMs);
        });
    }

    async function sendToContentWithRetry(tabId, message) {
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (e) {
            await chrome.tabs.reload(tabId);
            await waitForTabLoad(tabId, TAB_LOAD_TIMEOUT_MS);
            await sleep(SETTLE_DELAY_MS);
            return await chrome.tabs.sendMessage(tabId, message);
        }
    }

    async function postToBackend(state, groupUrl, groupName, posts) {
        if (!posts.length) return { success: true, saved_count: 0, skipped_duplicates: 0 };
        try {
            const res = await fetch(`${state.apiBase}/api/all-platform/extension/linkedin/save-posts`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
                body: JSON.stringify({
                    group_url: groupUrl,
                    group_name: groupName,
                    id_member: state.idMember || null,
                    extension_version: "Markee-Seeding-Extension-2.0",
                    posts,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return { success: false, message: data.detail || `HTTP ${res.status}` };
            return data;
        } catch (e) {
            return { success: false, message: String(e) };
        }
    }

    async function runQueue() {
        const state = await getState();
        while (state.running) {
            const item = state.groupQueue[state.currentIndex];
            if (!item) break;

            item.status = "running";
            await saveState();
            notifyApp({ action: "MK_LI_CRAWL_PROGRESS", groupIndex: state.currentIndex, totalGroups: state.groupQueue.length, groupUrl: item.url, posts: 0 });
            log(`[${state.currentIndex + 1}/${state.groupQueue.length}] Đang mở nhóm: ${item.name || item.url}`);

            try {
                if (state.tabId == null) {
                    const tab = await chrome.tabs.create({ url: item.url, active: true });
                    state.tabId = tab.id;
                } else {
                    await chrome.tabs.update(state.tabId, { url: item.url });
                }
                await saveState();

                const loaded = await waitForTabLoad(state.tabId, TAB_LOAD_TIMEOUT_MS);
                if (!loaded) log(`Tab tải chậm cho ${item.url}, vẫn thử tiếp.`, "warn");
                await sleep(SETTLE_DELAY_MS);
                if (!state.running) break;
                await sendToContentWithRetry(state.tabId, { type: "LI_CRAWL_RUN", config: state.config });
            } catch (e) {
                item.status = "error";
                item.error = String(e);
                await saveState();
                log(`Lỗi ở nhóm ${item.url}: ${e}`, "error");
                if (!(await advanceQueue(state))) break;
                continue;
            }
            // Chờ crawler.js báo LI_CRAWL_GROUP_DONE / LI_CRAWL_ERROR (xử lý ở onMessage bên dưới).
            return;
        }
        await finishCrawl();
    }

    async function advanceQueue(state) {
        const nextIndex = state.groupQueue.findIndex((g, i) => i > state.currentIndex && g.status === "pending");
        if (nextIndex === -1) return false;
        await sleep(INTER_GROUP_COOLDOWN_MS);
        state.currentIndex = nextIndex;
        await saveState();
        return true;
    }

    async function finishCrawl(stopped = false) {
        const state = await getState();
        const wasTabId = state.tabId;
        state.running = false;
        state.tabId = null;
        await saveState();
        if (wasTabId != null) chrome.tabs.remove(wasTabId).catch(() => {});
        const summary = {
            totalGroups: state.groupQueue.length,
            totalPosts: state.totalPosts,
            totalSaved: state.totalSaved,
            stopped,
        };
        notifyApp({ action: "MK_LI_CRAWL_DONE", ...summary });
        // bg/rotation-crawl.js cho (neu co) - xem giai thich o fb-crawl.js. LI-crawl la
        // state machine event-driven (cho content script trong tab LinkedIn bao ve) nen
        // KHONG the await truc tiep startCrawl() nhu FB/Threads - phai qua hook nay.
        if (typeof self.__mkLiDoneHook === "function") {
            const hook = self.__mkLiDoneHook;
            self.__mkLiDoneHook = null;
            hook(summary);
        }
    }

    async function handleGroupDone(msg, sender) {
        const state = await getState();
        if (!sender.tab || sender.tab.id !== state.tabId) return;
        const item = state.groupQueue[state.currentIndex];
        if (!item) return;

        const posts = msg.posts || [];
        item.status = msg.stopped ? "stopped" : "done";
        state.totalPosts += posts.length;
        await saveState();
        log(`Nhóm "${msg.groupName || msg.groupUrl}" xong: ${posts.length} bài. Đang lưu lên hệ thống...`);

        const saveResult = await postToBackend(state, msg.groupUrl, msg.groupName, posts);
        const savedCount = saveResult.saved_count || 0;
        item.savedCount = savedCount;
        state.totalSaved += savedCount;
        await saveState();

        if (saveResult.success) {
            log(`Đã lưu ${savedCount} bài mới (bỏ qua ${saveResult.skipped_duplicates || 0} bài trùng).`, "success");
            notifyApp({ action: "MK_LI_CRAWL_SAVED", count: savedCount, groupUrl: msg.groupUrl });
        } else {
            log(`Lỗi lưu bài: ${saveResult.message}`, "error");
        }

        if (!state.running) return finishCrawl(true);
        if (await advanceQueue(state)) runQueue();
        else await finishCrawl();
    }

    async function handleError(msg, sender) {
        const state = await getState();
        if (!sender.tab || sender.tab.id !== state.tabId) return;
        const item = state.groupQueue[state.currentIndex];
        if (item) {
            item.status = "error";
            item.error = msg.message;
        }
        await saveState();
        log(`Nhóm ${msg.groupUrl || ""} lỗi: ${msg.message}`, "error");

        if (!state.running) return finishCrawl(true);
        if (await advanceQueue(state)) runQueue();
        else await finishCrawl();
    }

    async function startCrawl(request, dashboardTabId) {
        const state = defaultState();
        state.groupQueue = (request.groups || [])
            .filter((g) => g && g.url)
            .map((g) => ({ url: String(g.url).trim(), name: g.name || null, status: "pending", savedCount: 0, error: null }));
        const cfg = request.config || {};
        if (cfg.maxPosts) state.config.maxPosts = Math.max(1, Math.min(200, parseInt(cfg.maxPosts, 10) || 40));
        state.apiBase = cfg.apiBase || DEFAULT_API_BASE;
        state.idMember = cfg.idMember || null;
        state.dashboardTabId = dashboardTabId;
        state.running = state.groupQueue.length > 0;
        state.currentIndex = state.running ? 0 : -1;
        crawlState = state;
        await saveState();
        if (state.running) {
            log(`Bắt đầu cào ${state.groupQueue.length} nhóm LinkedIn (tối đa ${state.config.maxPosts} bài/nhóm)...`);
            runQueue();
        }
    }

    async function stopCrawl() {
        const state = await getState();
        if (!state.running) return;
        state.running = false;
        await saveState();
        if (state.tabId != null) {
            // crawler.js dừng cuộn và vẫn gửi LI_CRAWL_GROUP_DONE (stopped) cho phần đã cào -> lưu nốt rồi finish.
            try {
                await chrome.tabs.sendMessage(state.tabId, { type: "LI_CRAWL_HALT" });
                return;
            } catch (e) {}
        }
        await finishCrawl(true);
    }

    // --- Lấy info 1 bài LinkedIn (trang Tương tác nội bộ, luồng "Thêm bài viết") ---
    async function fetchOnePostInfo(url) {
        let windowId = null;
        try {
            const win = await chrome.windows.create({ url, type: "popup", state: "minimized", focused: false });
            windowId = win.id;
            const tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
            if (tabId == null) return { success: false, error: "Không mở được cửa sổ ẩn để lấy bài viết." };
            const loaded = await waitForTabLoad(tabId, TAB_LOAD_TIMEOUT_MS);
            if (!loaded) return { success: false, error: "Tab LinkedIn tải quá lâu, vui lòng thử lại." };
            await sleep(SETTLE_DELAY_MS);
            const resp = await sendToContentWithRetry(tabId, { type: "LI_POST_FETCH_ONE", url });
            return resp || { success: false, error: "Không nhận được phản hồi từ content script." };
        } catch (e) {
            return { success: false, error: String(e) };
        } finally {
            if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
        }
    }

    chrome.tabs.onRemoved.addListener(async (tabId) => {
        const state = await getState();
        if (state.running && state.tabId === tabId) {
            state.running = false;
            state.tabId = null;
            await saveState();
            log("Tab cào LinkedIn bị đóng — đã dừng.", "warn");
            await finishCrawl(true);
        }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;

        if (msg.action === "MK_LI_CRAWL_START") {
            getState().then((state) => {
                if (state.running) {
                    sendResponse({ success: false, error: "Đang có một tiến trình cào LinkedIn chạy." });
                    return;
                }
                const count = (msg.groups || []).filter((g) => g && g.url).length;
                if (count === 0) {
                    sendResponse({ success: false, error: "Không có nhóm nào để cào." });
                    return;
                }
                sendResponse({ success: true, total: count });
                startCrawl(msg, sender.tab ? sender.tab.id : null);
            });
            return true;
        }
        if (msg.action === "MK_LI_CRAWL_STOP") {
            stopCrawl().then(() => sendResponse({ success: true }));
            return true;
        }
        if (msg.action === "MK_LI_CRAWL_STATUS") {
            getState().then((state) => sendResponse({ running: !!state.running }));
            return true;
        }
        if (msg.type === "LI_FETCH_POST_INFO") {
            fetchOnePostInfo(msg.url).then(sendResponse);
            return true;
        }

        // Message từ crawler.js trong tab LinkedIn của hàng đợi.
        if (sender.tab && msg.type) {
            if (msg.type === "LI_CRAWL_GROUP_DONE") handleGroupDone(msg, sender);
            else if (msg.type === "LI_CRAWL_ERROR") handleError(msg, sender);
            else if (msg.type === "LI_CRAWL_PROGRESS") {
                getState().then((state) => {
                    if (sender.tab.id !== state.tabId) return;
                    notifyApp({
                        action: "MK_LI_CRAWL_PROGRESS",
                        groupIndex: state.currentIndex,
                        totalGroups: state.groupQueue.length,
                        posts: msg.postsCount || 0,
                        scrolls: msg.scrollCount || 0,
                    });
                });
            } else if (msg.type === "LI_CRAWL_LOG") {
                getState().then((state) => {
                    if (sender.tab.id === state.tabId) notifyApp({ action: "MK_LI_CRAWL_LOG", level: msg.level || "info", message: msg.message });
                });
            }
        }
    });

    // Cho phep bg/rotation-crawl.js goi truc tiep va await den khi cao HET hang doi -
    // LI-crawl la event-driven (xem finishCrawl()) nen phai boc lai bang 1 Promise qua
    // hook __mkLiDoneHook thay vi await thang startCrawl() nhu FB/Threads.
    self.__mkStartLiCrawl = (groups, config) => new Promise((resolve) => {
        self.__mkLiDoneHook = resolve;
        startCrawl({ groups, config }, null);
    });
    self.__mkStopLiCrawl = stopCrawl;
    self.__mkLiCrawlStatus = async () => (await getState()).running;
})();
