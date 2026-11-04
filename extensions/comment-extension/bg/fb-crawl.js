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
            const win = await chrome.windows.create({
                url: "https://www.facebook.com/",
                focused: false,
                width: 1280,
                height: 850,
                left: 100,
                top: 100,
                type: "normal"
            });
            crawlWindowId = win.id;
            crawlTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;

            // Bao tien do chi tiet cho rotation-crawl.js (neu dang chay qua lich xoay vong)
            // theo doi va hien thi ro rang len UI - xem self.__mkFbProgressHook.
            const reportProgress = (groupIndex) => {
                if (typeof self.__mkFbProgressHook === "function") {
                    self.__mkFbProgressHook({ groupIndex, totalGroups: groups.length, savedSoFar: totalSaved });
                }
            };

                    // 1. Phân bổ ngân sách phiên cào (Session Budgeting) & Tách nhóm mồi (Decoy Pool)
        const MAX_GROUPS_PER_ROUND = (config.maxGroupsPerRound && Number(config.maxGroupsPerRound) > 0)
            ? Number(config.maxGroupsPerRound)
            : 50;

        // Xáo trộn ngẫu nhiên toàn bộ danh sách nhóm ban đầu bằng Fisher-Yates
        const shuffledAll = [...groups];
        for (let idx = shuffledAll.length - 1; idx > 0; idx--) {
            const j = Math.floor(Math.random() * (idx + 1));
            [shuffledAll[idx], shuffledAll[j]] = [shuffledAll[j], shuffledAll[idx]];
        }

        let activeGroups = [];
        let decoyPool = [];

        if (shuffledAll.length > MAX_GROUPS_PER_ROUND) {
            // Lấy tối đa 50 nhóm bất kỳ để cào chính trong vòng này
            activeGroups = shuffledAll.slice(0, MAX_GROUPS_PER_ROUND);
            // Các nhóm còn lại (~70-80 nhóm) trở thành kho nhóm mồi dạo lướt né bot
            decoyPool = shuffledAll.slice(MAX_GROUPS_PER_ROUND);
        } else {
            // Danh sách <= 50 nhóm: Dành 75% cào chính, 25% làm nhóm mồi (nếu có từ 4 nhóm trở lên)
            if (shuffledAll.length >= 4) {
                const splitIdx = Math.max(1, Math.floor(shuffledAll.length * 0.75));
                activeGroups = shuffledAll.slice(0, splitIdx);
                decoyPool = shuffledAll.slice(splitIdx);
            } else {
                activeGroups = shuffledAll;
                decoyPool = [];
            }
        }

        log(`🎯 Kế hoạch phân bổ an toàn: Cào chính ${activeGroups.length} nhóm (tối đa ${MAX_GROUPS_PER_ROUND}/vòng). Kho nhóm mồi né bot: ${decoyPool.length} nhóm.`);

        // 2. GIAI ĐOẠN LƯỚT MỒI KHỞI ĐỘNG (WARM-UP DECOY BROWSING): Vào 2 - 10 nhóm ngẫu nhiên dạo lướt trước
        if (decoyPool.length > 0 && !shouldStop) {
            const minDecoys = Math.min(2, decoyPool.length);
            const maxDecoys = Math.min(10, decoyPool.length);
            const warmupCount = Math.floor(Math.random() * (maxDecoys - minDecoys + 1)) + minDecoys;

            log(`🎭 [LƯỚT MỒI NÉ BOT] Khởi động phiên duyệt: Đang ghé thăm dạo ${warmupCount} nhóm mồi ngẫu nhiên (di chuột Bézier, cuộn nhẹ 7s-13s) để xóa dấu vết bot...`);

            const warmupDecoys = decoyPool.slice(0, warmupCount);
            for (let w = 0; w < warmupDecoys.length; w++) {
                if (shouldStop) break;
                const decoy = warmupDecoys[w];
                log(`🎭 [MỒI ${w + 1}/${warmupCount}] Đang ghé thăm dạo nhóm: ${decoy.name || decoy.url}`);

                await chrome.tabs.update(crawlTabId, { url: decoy.url });
                await sleep(5000 + Math.floor(Math.random() * 2500));
                if (shouldStop) break;

                const injected = await injectCrawlScript(crawlTabId);
                if (injected && injected[0]) {
                    const browseMs = 7000 + Math.floor(Math.random() * 6000);
                    try {
                        const decoyRes = await chrome.tabs.sendMessage(crawlTabId, { action: "MK_FB_DECOY_BROWSE", durationMs: browseMs });
                        if (decoyRes && decoyRes.circuitBreaker) {
                            log(`🚨 [CẦU DAO KHẨN CẤP] Phát hiện checkpoint ở nhóm mồi: "${decoyRes.error}". DỪNG CÀO!`, "error");
                            shouldStop = true;
                            break;
                        }
                    } catch (e) {}
                }
                await sleep(3000 + Math.floor(Math.random() * 3000));
            }
            log(`✅ Đã hoàn tất giai đoạn lướt mồi khởi động an toàn! Bắt đầu tiến vào danh sách nhóm cào chính...`, "success");
        }

        // 3. TIẾN TRÌNH CÀO NHÓM CHÍNH (Xen kẽ rẽ nhánh dạo nhóm mồi)
        for (let i = 0; i < activeGroups.length; i++) {
if (shouldStop) break;
                const group = activeGroups[i];
                notifyApp({ action: "MK_FB_CRAWL_PROGRESS", groupIndex: i, totalGroups: activeGroups.length, groupUrl: group.url });
                reportProgress(i);
                log(`[${i + 1}/${activeGroups.length}] Đang mở nhóm: ${group.name || group.url}`);

                await chrome.tabs.update(crawlTabId, { url: group.url });
                await sleep(5000);
                if (shouldStop) break;
                // Chờ trang nhóm Facebook tải tự nhiên như người dùng thật (6s - 9s), tuyệt đối không reload 2 lần dồn dập
                await sleep(6000 + Math.floor(Math.random() * 3000));
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

                                // CẦU DAO KHẨN CẤP (Circuit Breaker): Phát hiện Meta kích hoạt checkpoint / chặn tạm thời
                if (response && response.circuitBreaker) {
                    log(`🚨 [CẦU DAO KHẨN CẤP] Meta cảnh báo bảo mật / checkpoint: "${response.error || 'Yêu cầu xác minh tài khoản'}". TỰ ĐỘNG DỪNG CÀO ĐỂ BẢO VỆ TÀI KHOẢN TUYỆT ĐỐI!`, "error");
                    notifyApp({
                        action: "MK_FB_CRAWL_CIRCUIT_BREAKER",
                        reason: response.error,
                        groupId: group.id || "",
                        groupUrl: group.url
                    });
                    shouldStop = true;
                    break;
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

                // 35% xác suất rẽ nhánh ghé thăm dạo 1 nhóm mồi khác trong kho để phá vỡ chuỗi quy luật
                if (!shouldStop && decoyPool.length > 0 && Math.random() < 0.35) {
                    const randomDecoy = decoyPool[Math.floor(Math.random() * decoyPool.length)];
                    log(`🎭 [LƯỚT MỒI XEN KẼ] Rẽ nhánh dạo lướt ngẫu nhiên nhóm "${randomDecoy.name || randomDecoy.url}" (7s-11s) để xóa dấu vết hành vi...`);
                    try {
                        await chrome.tabs.update(crawlTabId, { url: randomDecoy.url });
                        await sleep(5000 + Math.floor(Math.random() * 2000));
                        if (!shouldStop) {
                            await injectCrawlScript(crawlTabId);
                            await chrome.tabs.sendMessage(crawlTabId, { action: "MK_FB_DECOY_BROWSE", durationMs: 7000 + Math.floor(Math.random() * 4000) });
                        }
                    } catch (e) {}
                }

                // Nghỉ an toàn giữa các nhóm Facebook né bot (25s - 50s với Gaussian Jitter)
                const baseRest = (config.groupRestSec != null && Number(config.groupRestSec) >= 20)
                    ? Number(config.groupRestSec)
                    : (Math.floor(Math.random() * 25) + 25);
                const delayMs = baseRest * 1000; // Tùy chỉnh hoặc 10s - 22s
                log(`🛡️ Chống bot: Chờ an toàn ${(delayMs / 1000).toFixed(1)}s trước khi mở nhóm Facebook tiếp theo...`);
                await sleep(delayMs);
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
            notifyApp({ action: "MK_FB_CRAWL_DONE", totalGroups: activeGroups.length, totalFetched, totalSaved, stopped: wasStopped });
        }
        return { totalGroups: activeGroups.length, totalFetched, totalSaved, stopped: wasStopped };
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
