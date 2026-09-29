// Cao xoay vong lien tuc ca 3 nen tang (Facebook -> LinkedIn -> Threads -> lap lai) - danh
// cho tai khoan seeding-crawl dang nhap tren VPS, chay khong nguoi giam sat lien tuc.
//
// Goi TRUC TIEP cac ham noi bo cua bg/fb-crawl.js, bg/li-crawl.js, bg/threads-crawl.js
// (self.__mkStartFbCrawl/__mkStartLiCrawl/__mkStartThreadsCrawl - da export o cuoi 3 file
// do, cung chia se 1 global scope qua importScripts trong background.js) thay vi goi lai
// chinh no qua chrome.runtime.sendMessage (khong dam bao 1 service worker nhan duoc message
// no tu gui cho chinh no).
//
// QUAN TRONG ve do tin cay MV3: giai doan "cho den gio vong ke tiep" co the keo dai HANG
// GIO - KHONG dung setTimeout/await sleep() cho khoang nay vi Chrome co the tat service
// worker bat ky luc nao sau ~30s khong hoat dong, lam mat luon Promise dang cho. Dung
// chrome.alarms (duoc Chrome dam bao danh thuc lai service worker dung gio) de lap lich
// vong ke tiep - trang thai luon duoc luu chrome.storage.local truoc khi "ngu", doc lai
// khi alarm bao thuc.
(function () {
    const STATE_KEY = "mk_rotation_state";
    const RESUME_ALARM = "mkRotationResume";
    const ONLINE_RETRY_MINUTES = 1;

    let dashboardTabId = null;
    let cancelRequested = false;

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    async function getState() {
        const stored = await chrome.storage.local.get(STATE_KEY);
        return stored[STATE_KEY] || null;
    }
    async function setState(state) {
        await chrome.storage.local.set({ [STATE_KEY]: state });
    }
    async function clearState() {
        await chrome.storage.local.remove(STATE_KEY);
        try { await chrome.alarms.clear(RESUME_ALARM); } catch (e) {}
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
        console.log("[Rotation]", message);
        notifyApp({ action: "MK_ROTATE_CRAWL_LOG", level, message });
    }

    function stage(stageName, extra) {
        notifyApp({ action: "MK_ROTATE_CRAWL_STAGE", stage: stageName, ...(extra || {}) });
    }

    async function checkIsOnline(apiBase, email) {
        try {
            const res = await fetch(`${apiBase}/api/all-platform/presence/online-summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!data || !data.success || !data.data) return false;
            const members = data.data.members || [];
            const target = (email || "").toLowerCase();
            const me = members.find((m) => (m.email || "").toLowerCase() === target);
            return !!(me && me.is_online);
        } catch (e) {
            // Loi mang khi kiem tra online KHONG duoc coi la "offline that su" - tranh
            // dung ca vong lap chi vi 1 lan fetch tam thoi that bai. Coi nhu chua ro,
            // se thu lai o lan alarm ke tiep.
            log(`Không kiểm tra được trạng thái online (lỗi mạng: ${e.message}) — sẽ thử lại.`, "warn");
            return false;
        }
    }

    async function runOneRound(cfg, roundNumber) {
        const summary = { roundNumber, facebook: null, linkedin: null, threads: null };

        if (!cancelRequested && cfg.fbGroups.length > 0) {
            stage("facebook", { roundNumber });
            log(`[Vòng ${roundNumber}] Bắt đầu cào Facebook (${cfg.fbGroups.length} nhóm)...`);
            try {
                summary.facebook = await self.__mkStartFbCrawl(cfg.fbGroups, { apiBase: cfg.apiBase, idMember: cfg.idMember, fetchCount: 100 });
                log(`[Vòng ${roundNumber}] Facebook xong: lưu ${summary.facebook.totalSaved} bài mới${summary.facebook.stopped ? " — BỊ DỪNG GIỮA CHỪNG (có thể do tab Facebook bị đóng)" : ""}.`, summary.facebook.stopped ? "warn" : "success");
            } catch (e) {
                log(`[Vòng ${roundNumber}] Lỗi cào Facebook: ${e.message}`, "error");
            }
        }

        if (!cancelRequested && cfg.liGroups.length > 0) {
            stage("linkedin", { roundNumber });
            log(`[Vòng ${roundNumber}] Bắt đầu cào LinkedIn (${cfg.liGroups.length} nhóm)...`);
            try {
                summary.linkedin = await self.__mkStartLiCrawl(cfg.liGroups, { apiBase: cfg.apiBase, idMember: cfg.idMember, maxPosts: 40 });
                log(`[Vòng ${roundNumber}] LinkedIn xong: lưu ${summary.linkedin.totalSaved} bài mới${summary.linkedin.stopped ? " — BỊ DỪNG GIỮA CHỪNG (có thể do tab LinkedIn bị đóng)" : ""}.`, summary.linkedin.stopped ? "warn" : "success");
            } catch (e) {
                log(`[Vòng ${roundNumber}] Lỗi cào LinkedIn: ${e.message}`, "error");
            }
        }

        if (!cancelRequested && cfg.threadsKeywords.length > 0) {
            stage("threads", { roundNumber });
            log(`[Vòng ${roundNumber}] Bắt đầu tìm Threads (${cfg.threadsKeywords.length} từ khoá)...`);
            try {
                summary.threads = await self.__mkStartThreadsCrawl(cfg.threadsKeywords, { apiBase: cfg.apiBase, idMember: cfg.idMember, postLimit: 20 });
                log(`[Vòng ${roundNumber}] Threads xong: lưu ${summary.threads.totalSaved} bài mới${summary.threads.stopped ? " — BỊ DỪNG GIỮA CHỪNG" : ""}.`, summary.threads.stopped ? "warn" : "success");
            } catch (e) {
                log(`[Vòng ${roundNumber}] Lỗi cào Threads: ${e.message}`, "error");
            }
        }

        return summary;
    }

    async function runRoundAndScheduleNext(cfg, roundNumber) {
        await setState({ running: true, cfg, roundNumber, stage: "running" });
        const summary = await runOneRound(cfg, roundNumber);
        const totalSaved = (summary.facebook?.totalSaved || 0) + (summary.linkedin?.totalSaved || 0) + (summary.threads?.totalSaved || 0);
        log(`Hoàn tất vòng ${roundNumber} — tổng ${totalSaved} bài mới trên cả 3 nền tảng. Xem ở tab "Hoạt động seeding".`, "success");
        notifyApp({ action: "MK_ROTATE_CRAWL_ROUND_DONE", roundNumber, summary, totalSaved });

        if (cancelRequested) {
            log("Đã dừng theo yêu cầu — không lên lịch vòng kế tiếp.", "warn");
            await clearState();
            stage("stopped");
            notifyApp({ action: "MK_ROTATE_CRAWL_DONE", stopped: true });
            return;
        }

        if (!cfg.repeatEnabled) {
            await clearState();
            stage("idle");
            notifyApp({ action: "MK_ROTATE_CRAWL_DONE", stopped: false });
            return;
        }

        const nextRoundAt = Date.now() + cfg.intervalHours * 3600 * 1000;
        await setState({ running: true, cfg, roundNumber, stage: "waiting_interval", nextRoundAt });
        try {
            await chrome.alarms.create(RESUME_ALARM, { when: nextRoundAt });
        } catch (e) {
            log(`Không lên lịch được vòng kế tiếp: ${e.message}`, "error");
            await clearState();
            return;
        }
        stage("waiting_interval", { roundNumber, nextRoundAt });
        log(`Đã lên lịch vòng ${roundNumber + 1} lúc ${new Date(nextRoundAt).toLocaleString("vi-VN")} (sau ${cfg.intervalHours} giờ) — CHỈ chạy nếu tài khoản vẫn đang online trên app Seeding lúc đó.`);
    }

    async function tryRunNextRound() {
        const state = await getState();
        if (!state || !state.running) return;
        cancelRequested = false;

        const online = await checkIsOnline(state.cfg.apiBase, state.cfg.email);
        if (!online) {
            log(`Đã tới giờ vòng ${state.roundNumber + 1} nhưng tài khoản KHÔNG còn online trên app Seeding (có thể đã đóng tab/tắt trình duyệt/mất phiên đăng nhập) — tạm dừng, sẽ tự kiểm tra lại mỗi ${ONLINE_RETRY_MINUTES} phút.`, "warn");
            stage("waiting_online", { roundNumber: state.roundNumber });
            await chrome.alarms.create(RESUME_ALARM, { delayInMinutes: ONLINE_RETRY_MINUTES });
            return;
        }
        await runRoundAndScheduleNext(state.cfg, state.roundNumber + 1);
    }

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === RESUME_ALARM) tryRunNextRound();
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;

        if (msg.action === "MK_ROTATE_CRAWL_START") {
            getState().then(async (existing) => {
                if (existing && existing.running) {
                    sendResponse({ success: false, error: "Đang có 1 vòng cào xoay vòng chạy rồi — bấm Dừng trước khi bắt đầu lại." });
                    return;
                }
                const fbGroups = Array.isArray(msg.fbGroups) ? msg.fbGroups.filter((g) => g && g.url) : [];
                const liGroups = Array.isArray(msg.liGroups) ? msg.liGroups.filter((g) => g && g.url) : [];
                const threadsKeywords = Array.isArray(msg.threadsKeywords) ? msg.threadsKeywords.filter(Boolean) : [];
                if (fbGroups.length === 0 && liGroups.length === 0 && threadsKeywords.length === 0) {
                    sendResponse({ success: false, error: "Chưa có nhóm Facebook/LinkedIn hoặc từ khoá Threads nào để cào." });
                    return;
                }
                if (!msg.config || !msg.config.email) {
                    sendResponse({ success: false, error: "Thiếu email tài khoản — cần để kiểm tra điều kiện 'đang online' trước mỗi vòng lặp lại." });
                    return;
                }

                const cfg = {
                    apiBase: msg.config.apiBase || "https://seeding.markeeai.com",
                    email: msg.config.email,
                    idMember: msg.config.idMember || null,
                    intervalHours: Math.max(0.25, Number(msg.config.intervalHours) || 2),
                    repeatEnabled: !!msg.config.repeatEnabled,
                    fbGroups,
                    liGroups,
                    threadsKeywords,
                };

                dashboardTabId = sender.tab ? sender.tab.id : null;
                cancelRequested = false;
                await setState({ running: true, cfg, roundNumber: 0, stage: "starting" });
                sendResponse({ success: true, total: fbGroups.length + liGroups.length + threadsKeywords.length });
                runRoundAndScheduleNext(cfg, 1);
            });
            return true;
        }

        if (msg.action === "MK_ROTATE_CRAWL_STOP") {
            cancelRequested = true;
            try { self.__mkStopFbCrawl && self.__mkStopFbCrawl(); } catch (e) {}
            try { self.__mkStopLiCrawl && self.__mkStopLiCrawl(); } catch (e) {}
            try { self.__mkStopThreadsCrawl && self.__mkStopThreadsCrawl(); } catch (e) {}
            getState().then(async (state) => {
                // "waiting_interval"/"waiting_online" nghia la KHONG co vong nao dang chay luc
                // nay (dang cho alarm) - runRoundAndScheduleNext (noi phat MK_ROTATE_CRAWL_DONE
                // khi thay cancelRequested) se KHONG duoc goi lai nua vi da huy alarm ngay ben
                // duoi, nen phai tu phat DONE ở day, neu khong web app se ket mai o trang thai
                // "dang chay" (nut Dung khong bao gio bien mat lai thanh nut Bat dau).
                const noRoundActive = !!state && (state.stage === "waiting_interval" || state.stage === "waiting_online");
                if (state) {
                    state.running = false;
                    await setState(state);
                }
                try { await chrome.alarms.clear(RESUME_ALARM); } catch (e) {}
                log("Đã nhận lệnh dừng cào xoay vòng — sẽ dừng ngay sau bước hiện tại (nếu đang giữa 1 vòng) hoặc hủy vòng kế tiếp đã lên lịch.", "warn");
                sendResponse({ success: true });
                if (noRoundActive) {
                    await clearState();
                    stage("stopped");
                    notifyApp({ action: "MK_ROTATE_CRAWL_DONE", stopped: true });
                }
            });
            return true;
        }

        if (msg.action === "MK_ROTATE_CRAWL_STATUS") {
            getState().then((state) => {
                sendResponse({
                    running: !!(state && state.running),
                    roundNumber: state?.roundNumber || 0,
                    stage: state?.stage || "idle",
                    nextRoundAt: state?.nextRoundAt || null,
                    cfg: state?.cfg || null,
                });
            });
            return true;
        }
    });
})();
