// Cào bài Group Facebook theo lệnh từ trang web (port từ api-facebook-get-extension/background.js).
// CHỈ giữ luồng cào thủ công startAutoCrawl — KHÔNG mang theo "worker mode" của bản gốc
// (tự poll job hàng đợi mỗi phút + tự xin tài khoản FB từ pool rồi GHI ĐÈ cookie đăng nhập):
// extension này cài trên máy nhân viên, chạy worker mode ở đây sẽ thay tài khoản Facebook
// đang đăng nhập của họ bằng acc trong pool. Worker mode vẫn nằm nguyên ở api-facebook-get-extension.
// Bọc IIFE: background.js importScripts file này vào CHUNG global scope của service worker.
(function () {
    const API_KEY = "markee-extension-key-2024";
    const DEFAULT_API_BASE = "https://seeding.markeeai.com";

    let isRunning = false;
    let shouldStop = false;
    let crawlTabId = null;
    let crawlWindowId = null;
    let dashboardTabId = null;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function notifyApp(message) {
        if (dashboardTabId != null) {
            chrome.tabs.sendMessage(dashboardTabId, message).catch(() => {});
            return;
        }
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {}));
        });
    }

    function log(message, level = "info") {
        if (level === "error") console.error("[FB Crawl]", message);
        else console.log("[FB Crawl]", message);
        notifyApp({ action: "MK_FB_CRAWL_LOG", level, message });
    }

    async function injectCrawlScript(tabId) {
        const inject = () => chrome.scripting.executeScript({ target: { tabId }, files: ["platforms/facebook/crawl.js"] });
        try {
            return await inject();
        } catch (e) {
            log(`Lỗi tiêm script: ${e.message}. Tải lại tab và thử lại...`, "warn");
            await chrome.tabs.reload(tabId);
            await sleep(5000);
            try {
                return await inject();
            } catch (e2) {
                log(`Lỗi tiêm script lần 2: ${e2.message}`, "error");
                return null;
            }
        }
    }

    async function saveToBackend(apiBase, group, posts, idMember) {
        let lastErr = null;
        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                const res = await fetch(`${apiBase}/api/all-platform/extension/save-posts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
                    body: JSON.stringify({
                        posts,
                        group_id: group.id || "",
                        group_url: group.url,
                        group_name: group.name || null,
                        id_member: idMember,
                        extension_version: "Markee-Seeding-Extension-2.0",
                        keywords: group.keywords || null,
                        post_limit: group.post_limit ?? null,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return { success: false, message: data.detail || `HTTP ${res.status}` };
                return { success: true, count: data.count || 0 };
            } catch (err) {
                lastErr = err;
                if (attempt < 2) {
                    log(`Backend mất kết nối, thử lại lần ${attempt + 1}/2...`, "warn");
                    await sleep(2000);
                }
            }
        }
        return { success: false, message: String(lastErr) };
    }

    async function startCrawl(groups, config) {
        isRunning = true;
        shouldStop = false;
        // Khi bg/rotation-crawl.js goi TRUC TIEP (khong qua chrome.runtime.onMessage),
        // dashboardTabId KHONG duoc gan tu sender.tab - thieu dong nay thi notifyApp()
        // se fallback broadcast cho TAT CA tab dang mo (ca tab Seeding cua tai khoan
        // KHAC dang mo chung trinh duyet/VPS) - dung dashboardTabId rotation-crawl.js
        // truyen xuong de thong bao dung TOI DUNG tab so huu lich cao nay (bug 2026-10-01).
        if (config.dashboardTabId != null) dashboardTabId = config.dashboardTabId;
        const idMember = config.idMember || null;
        const apiBase = config.apiBase || DEFAULT_API_BASE;
        const fetchCount = Math.max(1, Math.min(200, parseInt(config.fetchCount, 10) || 100));
        let totalSaved = 0;
        let totalFetched = 0;
        let wasStopped = false;

        log(`Bắt đầu cào ${groups.length} nhóm Facebook...`);
        try {
            // Mo 1 CUA SO RIENG, thu nho/khong focus - khong cuop focus cua tab/cua so
            // nguoi dung dang dung (acc he thong cao xoay vong khong duoc dung cham tab
            // cua acc/nguoi khac dang lam viec cung may/trinh duyet).
            const win = await chrome.windows.create({ url: "https://www.facebook.com/", focused: false, state: "minimized", type: "normal" });
            crawlWindowId = win.id;
            crawlTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;

            // Bao tien do chi tiet cho rotation-crawl.js (neu dang chay qua lich xoay vong)
            // theo doi va hien thi ro rang len UI - xem self.__mkFbProgressHook.
            const reportProgress = (groupIndex) => {
                if (typeof self.__mkFbProgressHook === "function") {
                    self.__mkFbProgressHook({ groupIndex, totalGroups: groups.length, savedSoFar: totalSaved });
                }
            };

            for (let i = 0; i < groups.length; i++) {
                if (shouldStop) break;
                const group = groups[i];
                notifyApp({ action: "MK_FB_CRAWL_PROGRESS", groupIndex: i, totalGroups: groups.length, groupUrl: group.url });
                reportProgress(i);
                log(`[${i + 1}/${groups.length}] Đang mở nhóm: ${group.name || group.url}`);

                await chrome.tabs.update(crawlTabId, { url: group.url });
                await sleep(5000);
                if (shouldStop) break;
                // Giữ nguyên quy trình bản gốc: reload 2 lần để làm sạch session/state trang nhóm.
                await chrome.tabs.reload(crawlTabId);
                await sleep(5000);
                await chrome.tabs.reload(crawlTabId);
                await sleep(6000);
                if (shouldStop) break;

                const injected = await injectCrawlScript(crawlTabId);
                if (!injected || !injected[0]) {
                    log(`Không chạy được script cào ở nhóm này, bỏ qua.`, "error");
                    continue;
                }
                await sleep(1000);

                let response;
                try {
                    response = await chrome.tabs.sendMessage(crawlTabId, { action: "MK_FB_FETCH_API_POSTS", count: fetchCount });
                } catch (err) {
                    log(`Lỗi giao tiếp với tab cào: ${err.message}`, "error");
                    continue;
                }

                if (!response || !response.success || !response.data) {
                    log(`Không lấy được bài: ${(response && response.error) || "không có phản hồi"}`, "warn");
                    continue;
                }

                totalFetched += response.data.length;
                log(`API trả về ${response.data.length} bài, đang lưu lên hệ thống...`);
                const saved = await saveToBackend(apiBase, group, response.data, idMember);
                if (saved.success) {
                    totalSaved += saved.count;
                    log(`Đã lưu ${saved.count} bài mới từ nhóm này.`, "success");
                    notifyApp({ action: "MK_FB_CRAWL_SAVED", count: saved.count, groupId: group.id || "", groupUrl: group.url });
                } else {
                    log(`Lỗi lưu bài: ${saved.message}`, "error");
                }
                reportProgress(i + 1);

                await sleep(3000);
            }
            log(shouldStop ? "Đã dừng theo yêu cầu." : "Hoàn tất toàn bộ tiến trình cào!", "success");
        } catch (e) {
            log(`Lỗi nghiêm trọng: ${e.message}`, "error");
        } finally {
            wasStopped = shouldStop;
            isRunning = false;
            shouldStop = false;
            if (crawlWindowId != null) chrome.windows.remove(crawlWindowId).catch(() => {});
            crawlTabId = null;
            crawlWindowId = null;
            notifyApp({ action: "MK_FB_CRAWL_DONE", totalGroups: groups.length, totalFetched, totalSaved, stopped: wasStopped });
        }
        return { totalGroups: groups.length, totalFetched, totalSaved, stopped: wasStopped };
    }

    // Cho phep bg/rotation-crawl.js goi TRUC TIEP (cung 1 global scope qua importScripts,
    // khong qua chrome.runtime.sendMessage) va await den khi cao HET tat ca group xong -
    // startCrawl() da la 1 async function tra ve promise dung nhu vay san, khong can sua gi
    // them ngoai dong export nay.
    self.__mkStartFbCrawl = startCrawl;
    self.__mkStopFbCrawl = () => { if (isRunning) shouldStop = true; };
    self.__mkFbCrawlStatus = () => isRunning;

    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === crawlTabId && isRunning) {
            shouldStop = true;
            log("Tab cào bị đóng — dừng tiến trình.", "warn");
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "MK_FB_CRAWL_START") {
            const groups = Array.isArray(request.groups) ? request.groups.filter((g) => g && g.url) : [];
            if (isRunning) {
                sendResponse({ success: false, error: "Đang có một tiến trình cào Facebook chạy." });
                return;
            }
            if (groups.length === 0) {
                sendResponse({ success: false, error: "Không có nhóm nào để cào." });
                return;
            }
            dashboardTabId = sender.tab ? sender.tab.id : null;
            sendResponse({ success: true, total: groups.length });
            startCrawl(groups, request.config || {});
        } else if (request.action === "MK_FB_CRAWL_STOP") {
            if (isRunning) shouldStop = true;
            sendResponse({ success: true });
        } else if (request.action === "MK_FB_CRAWL_STATUS") {
            sendResponse({ running: isRunning });
        }
    });
})();
