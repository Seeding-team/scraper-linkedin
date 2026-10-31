// Cao xoay vong lien tuc ca 3 nen tang (Facebook -> LinkedIn -> Threads -> lap lai) - danh
// cho tai khoan seeding-crawl dang nhap tren VPS, chay khong nguoi giam sat lien tuc.
//
// HO TRO NHIEU LICH CAO DOC LAP ("Lich crawl & Hang doi"): moi lich co nhom FB/LinkedIn +
// tu khoa Threads + gio lap lai RIENG. Chi 1 lich duoc chay TAI 1 THOI DIEM (chi co 1 trinh
// duyet/1 tab moi nen tang) - lich nao den gio truoc thi chay truoc, lich khac cho tiep (dung
// tinh than "hang doi"); lich chay xong se tu kiem tra ngay xem co lich nao khac dang den gio
// khong de chay tiep lien tuc, khong doi het chu ky alarm.
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
// khi alarm bao thuc. Chi dung DUY NHAT 1 alarm (RESUME_ALARM) dat vao thoi diem SOM NHAT
// trong so moi lich dang cho, tranh gioi han so luong alarm cua Chrome.
(function () {
    const SCHEDULES_KEY = "mk_rotation_schedules";
    const RESUME_ALARM = "mkRotationResume";
    const ONLINE_RETRY_MINUTES = 1;

    let dashboardTabId = null;
    // id lich dang THUC SU chay 1 vong luc nay (chi 1 tai 1 thoi diem) - bien trong bo nho,
    // KHONG luu storage (service worker restart giua chung 1 vong la mat tien do vong do,
    // da disclose voi nguoi dung - xem ghi chu o cuoi file).
    let activeScheduleId = null;
    // Tap hop id lich da duoc yeu cau DUNG NGAY trong luc dang chay (bam nut Dung).
    let cancelRequestedIds = new Set();
    function isSystemCrawlerAccount(email) {
        // Cho phép tất cả tài khoản (thành viên, leader, hệ thống) đều có quyền thêm và chạy lịch cào xoay vòng
        return true;
    }

    // Thuat toan Fisher-Yates xao tron ngau nhien thu tu nhom de ne bot checkpoint
    function shuffleArray(orig) {
        const arr = [...orig];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }


    function genId() {
        return "sch_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    async function readSchedulesRaw() {
        const stored = await chrome.storage.local.get(SCHEDULES_KEY);
        return Array.isArray(stored[SCHEDULES_KEY]) ? stored[SCHEDULES_KEY] : [];
    }

    async function writeSchedules(list) {
        await chrome.storage.local.set({ [SCHEDULES_KEY]: list });
        notifyApp({ action: "MK_ROTATE_SCHEDULE_CHANGED", schedules: list });
        return list;
    }

    // Doc danh sach lich + tu sua cac lich bi "ket" o trang thai running do service worker
    // vua restart giua luc dang cao dang do (khong con khop voi activeScheduleId trong bo
    // nho, vi bien do bi reset ve null moi lan service worker khoi dong lai) - dua ve cho
    // chay lai ngay thay vi ket mai o "running" ma khong ai dang thuc su cao ca.
    async function getSchedules() {
        const list = await readSchedulesRaw();
        let changed = false;
        const fixed = list.map((s) => {
            if (s.status === "running" && s.id !== activeScheduleId) {
                changed = true;
                return { ...s, status: "waiting_interval", nextRunAt: Date.now(), currentStage: null };
            }
            return s;
        });
        if (changed) await writeSchedules(fixed);
        return fixed;
    }

    async function updateSchedule(id, patch) {
        const list = await readSchedulesRaw();
        const idx = list.findIndex((s) => s.id === id);
        if (idx === -1) return list;
        list[idx] = { ...list[idx], ...patch };
        return writeSchedules(list);
    }

    function findSchedule(list, id) {
        return list.find((s) => s.id === id);
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

    function log(scheduleId, label, message, level = "info") {
        console.log(`[Rotation:${label || scheduleId}]`, message);
        notifyApp({ action: "MK_ROTATE_SCHEDULE_LOG", scheduleId, label, level, message });
    }

    function stage(scheduleId, stageName, extra) {
        notifyApp({ action: "MK_ROTATE_SCHEDULE_STAGE", scheduleId, stage: stageName, ...(extra || {}) });
    }

    // Tien do CHI TIET (nhom/tu khoa thu bao nhieu, da luu bao nhieu bai) trong luc 1 nen
    // tang dang chay - cac module bg/fb-crawl.js, bg/li-crawl.js, bg/threads-crawl.js tu
    // goi __mk*ProgressHook (gan o duoi) moi khi xong 1 nhom/tu khoa.
    function progress(scheduleId, stageName, data) {
        notifyApp({ action: "MK_ROTATE_SCHEDULE_PROGRESS", scheduleId, stage: stageName, ...(data || {}) });
    }

    function hostnameFromUrl(u) {
        try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ""; }
    }

    // Dieu kien de acc He Thong tiep tuc cao xoay vong: CHI CAN tab trang Seeding con
    // MO (ke ca dang chay NEN, khong phai tab dang active/hien thi - vd nguoi van hanh
    // bat tab khac lam viec) - KHONG con doi hoi "online" theo kieu heartbeat cua nhan
    // vien thuong (MemberOnlineTimeWidget.tsx - can tab o trang thai HIEN THI moi tinh,
    // dung cho muc dich khac la theo doi gio lam viec nhan vien, khong lien quan o day).
    // Dung chrome.tabs.query() (local, tuc thi, khong qua mang) thay vi goi backend check
    // heartbeat - vua dung dung yeu cau "chi can bat tab" vua on dinh hon (khong phu
    // thuoc TTL 120s + visibilityState cua heartbeat).
    async function checkAppTabOpen(apiBase) {
        try {
            const targetHost = hostnameFromUrl(apiBase);
            if (!targetHost) return true; // khong parse duoc apiBase thi khong chan vo ly do
            const tabs = await chrome.tabs.query({});
            return tabs.some((t) => t.url && hostnameFromUrl(t.url) === targetHost);
        } catch (e) {
            // Loi khi truy van tab KHONG duoc coi la "tab da dong that su" - tranh dung ca
            // vong lap chi vi 1 lan query tam thoi loi. Coi nhu chua ro, se thu lai sau.
            return { networkError: e.message };
        }
    }

    // Lay danh sach tu khoa/chu de Threads tu dong kham pha (registry backend,
    // threads_keyword_service.py) - goi NGAY DAU vong (khong await o day) de chay SONG SONG
    // voi luc dang cao Facebook/LinkedIn, toi luc vao stage Threads thi da co san, khong mat
    // them thoi gian cho (yeu cau 2026-10-02).
    async function fetchAutoThreadsKeywords(apiBase) {
        try {
            const res = await fetch(`${apiBase}/api/all-platform/extension/threads/keywords`);
            const data = await res.json();
            const keywords = data && data.data && Array.isArray(data.data.keywords) ? data.data.keywords : [];
            return keywords.filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    async function runOneRound(scheduleId, label, cfg, roundNumber) {
        const summary = { roundNumber, facebook: null, linkedin: null, threads: null };
        const isCancelled = () => cancelRequestedIds.has(scheduleId);
        const autoThreadsKeywordsPromise = cfg.threadsAutoDiscover ? fetchAutoThreadsKeywords(cfg.apiBase) : Promise.resolve([]);

        // 1. CHỐNG BOT NÉ CHECKPOINT: XÁO TRỘN NGẪU NHIÊN THỨ TỰ NHÓM FACEBOOK MỖI VÒNG (FISHER-YATES)
        const fbGroupsToRun = (cfg.antiBotEnabled !== false && cfg.fbGroups.length > 1)
            ? shuffleArray(cfg.fbGroups)
            : cfg.fbGroups;

        if (!isCancelled() && fbGroupsToRun.length > 0) {
            stage(scheduleId, "facebook", { roundNumber });
            log(scheduleId, label, `[Vòng ${roundNumber}] Bắt đầu cào Facebook (${fbGroupsToRun.length} nhóm${cfg.antiBotEnabled !== false ? " - đã xáo trộn thứ tự né bot" : ""})...`);
            self.__mkFbProgressHook = (p) => progress(scheduleId, "facebook", p);
            try {
                summary.facebook = await self.__mkStartFbCrawl(fbGroupsToRun, { apiBase: cfg.apiBase, idMember: cfg.idMember, fetchCount: 100, dashboardTabId, antiBotEnabled: cfg.antiBotEnabled !== false });
                log(scheduleId, label, `[Vòng ${roundNumber}] Facebook xong: lưu ${summary.facebook.totalSaved} bài mới${summary.facebook.stopped ? " — BỊ DỪNG GIỮA CHỪNG (có thể do tab Facebook bị đóng)" : ""}.`, summary.facebook.stopped ? "warn" : "success");
            } catch (e) {
                log(scheduleId, label, `[Vòng ${roundNumber}] Lỗi cào Facebook: ${e.message}`, "error");
            } finally {
                self.__mkFbProgressHook = null;
            }
        }

        // 2. CHỐNG BOT: NGHỈ AN TOÀN CHUYỂN GIAO NỀN TẢNG (INTER-PLATFORM COOL-DOWN)
        if (!isCancelled() && cfg.fbGroups.length > 0 && cfg.liGroups.length > 0) {
            const pauseSec = Math.floor(Math.random() * 21) + 20; // 20s - 40s
            log(scheduleId, label, `🛡️ Cơ chế chống bot: Nghỉ tự nhiên ${pauseSec}s trước khi chuyển sang cào LinkedIn...`);
            await sleep(pauseSec * 1000);
        }

        // 3. CHỐNG BOT NÉ CHECKPOINT: XÁO TRỘN NGẪU NHIÊN THỨ TỰ NHÓM LINKEDIN MỖI VÒNG (FISHER-YATES)
        const liGroupsToRun = (cfg.antiBotEnabled !== false && cfg.liGroups.length > 1)
            ? shuffleArray(cfg.liGroups)
            : cfg.liGroups;

        if (!isCancelled() && liGroupsToRun.length > 0) {
            stage(scheduleId, "linkedin", { roundNumber });
            log(scheduleId, label, `[Vòng ${roundNumber}] Bắt đầu cào LinkedIn (${liGroupsToRun.length} nhóm${cfg.antiBotEnabled !== false ? " - đã xáo trộn thứ tự né bot" : ""})...`);
            self.__mkLiProgressHook = (p) => progress(scheduleId, "linkedin", p);
            try {
                summary.linkedin = await self.__mkStartLiCrawl(liGroupsToRun, { apiBase: cfg.apiBase, idMember: cfg.idMember, maxPosts: 40, dashboardTabId });
                log(scheduleId, label, `[Vòng ${roundNumber}] LinkedIn xong: lưu ${summary.linkedin.totalSaved} bài mới${summary.linkedin.stopped ? " — BỊ DỪNG GIỮA CHỪNG (có thể do tab LinkedIn bị đóng)" : ""}.`, summary.linkedin.stopped ? "warn" : "success");
            } catch (e) {
                log(scheduleId, label, `[Vòng ${roundNumber}] Lỗi cào LinkedIn: ${e.message}`, "error");
            } finally {
                self.__mkLiProgressHook = null;
            }
        }

        // Gop tu khoa tay (neu co) voi tu khoa tu dong kham pha
        const autoThreadsKeywords = await autoThreadsKeywordsPromise;
        if (autoThreadsKeywords.length > 0) {
            log(scheduleId, label, `Registry tự khám phá: ${autoThreadsKeywords.length} từ khoá/chủ đề Threads đang active.`);
        }
        const seenKw = new Set();
        const effectiveThreadsKeywords = [...cfg.threadsKeywords, ...autoThreadsKeywords].filter((k) => {
            const key = (k || "").trim().toLowerCase();
            if (!key || seenKw.has(key)) return false;
            seenKw.add(key);
            return true;
        });

        if (!isCancelled() && effectiveThreadsKeywords.length > 0) {
            stage(scheduleId, "threads", { roundNumber });
            log(scheduleId, label, `[Vòng ${roundNumber}] Bắt đầu tìm Threads (${effectiveThreadsKeywords.length} từ khoá)...`);
            self.__mkThreadsProgressHook = (p) => progress(scheduleId, "threads", p);
            try {
                summary.threads = await self.__mkStartThreadsCrawl(effectiveThreadsKeywords, { apiBase: cfg.apiBase, idMember: cfg.idMember, postLimit: 20, dashboardTabId, sortRecent: true });
                log(scheduleId, label, `[Vòng ${roundNumber}] Threads xong: lưu ${summary.threads.totalSaved} bài mới${summary.threads.stopped ? " — BỊ DỪNG GIỮA CHỪNG" : ""}.`, summary.threads.stopped ? "warn" : "success");
            } catch (e) {
                log(scheduleId, label, `[Vòng ${roundNumber}] Lỗi tìm Threads: ${e.message}`, "error");
            } finally {
                self.__mkThreadsProgressHook = null;
            }
        }

        return summary;
    }

    // Dung 1 alarm LAP LAI MOI PHUT (thay vi dat dung 1 lan vao moc nextRunAt som nhat) khi
    // con bat ky lich nao dang bat (enabled) - day la LUOI AN TOAN de dam bao "chay lien tuc,
    // khong bi ngat giua chung": neu service worker bi Chrome tat/crash GIUA LUC dang cao
    // (lich ket o status "running" nhung bien activeScheduleId trong bo nho da mat vi service
    // worker restart), KHONG co alarm chinh xac nao con duoc dat de danh thuc lai (alarm cu
    // chi duoc tao o CUOI 1 vong chay thanh cong) - lich do se "treo" vinh vien cho den khi
    // co nguoi vo tinh lam service worker thuc day (mo tab, gui message...). Alarm lap moi
    // phut dam bao toi da 60s sau la tu phat hien qua getSchedules() (tu sua lich ket) va
    // chay tiep ngay, khong can cho dung chinh xac 1 moc gio nao ca.
    async function scheduleNextAlarm() {
        const list = await getSchedules();
        const hasEnabled = list.some((s) => s.enabled);
        if (!hasEnabled) {
            try { await chrome.alarms.clear(RESUME_ALARM); } catch (e) {}
            return;
        }
        try {
            const existing = await chrome.alarms.get(RESUME_ALARM);
            if (!existing || existing.periodInMinutes !== 1) {
                await chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 1, when: Date.now() + 1000 });
            }
        } catch (e) {}
    }

    async function runScheduleRound(schedule) {
        activeScheduleId = schedule.id;
        cancelRequestedIds.delete(schedule.id);
        const roundStartTime = Date.now();
        const roundNumber = (schedule.roundNumber || 0) + 1;
        await updateSchedule(schedule.id, { status: "running", roundNumber, nextRunAt: null, currentStage: null });

        const summary = await runOneRound(schedule.id, schedule.label, schedule.cfg, roundNumber);
        const totalSaved = (summary.facebook?.totalSaved || 0) + (summary.linkedin?.totalSaved || 0) + (summary.threads?.totalSaved || 0);
        const wasCancelled = cancelRequestedIds.has(schedule.id);
        cancelRequestedIds.delete(schedule.id);
        activeScheduleId = null;

        log(schedule.id, schedule.label, `Hoàn tất vòng ${roundNumber} — tổng ${totalSaved} bài mới trên cả 3 nền tảng. Xem ở tab "Hoạt động seeding".`, "success");
        notifyApp({ action: "MK_ROTATE_SCHEDULE_ROUND_DONE", scheduleId: schedule.id, roundNumber, summary, totalSaved });

        // Tự động đồng bộ báo cáo vòng cào về backend để hiển thị tab "Lịch sử cào từ lịch"
        try {
            const apiBase = schedule.cfg?.apiBase || "https://seeding.markeeai.com";
            const durSec = Math.max(1, Math.round((Date.now() - roundStartTime) / 1000));
            const durFormatted = durSec >= 60 ? `${Math.floor(durSec / 60)} phút ${durSec % 60} giây` : `${durSec} giây`;
            fetch(`${apiBase}/api/all-platform/unified/crawl-schedule/record-round`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schedule_id: schedule.id,
                    schedule_label: schedule.label || "Lịch cào xoay vòng đa nền tảng",
                    round_number: roundNumber,
                    user_id: schedule.cfg?.idMember,
                    user_email: schedule.cfg?.email,
                    started_at: new Date(roundStartTime).toISOString(),
                    finished_at: new Date().toISOString(),
                    duration_seconds: durSec,
                    duration_formatted: durFormatted,
                    status: "done",
                    facebook: {
                        posts_count: summary.facebook?.totalSaved || 0,
                        ai_passed_count: 0,
                        ai_pass_rate: 0,
                    },
                    linkedin: {
                        posts_count: summary.linkedin?.totalSaved || 0,
                        ai_passed_count: 0,
                        ai_pass_rate: 0,
                    },
                    threads: {
                        posts_count: summary.threads?.totalSaved || 0,
                        ai_passed_count: 0,
                        ai_pass_rate: 0,
                    },
                    total_posts: totalSaved,
                    total_ai_passed: 0,
                    ai_pass_rate: 0,
                }),
            }).catch(() => {});
        } catch (e) {}

        const list = await readSchedulesRaw();
        const stillExists = findSchedule(list, schedule.id);
        if (!stillExists) {
            // Nguoi dung da xoa lich nay trong luc dang chay - khong can cap nhat/len lich gi them.
        } else if (wasCancelled) {
            await updateSchedule(schedule.id, { status: "stopped", enabled: false, nextRunAt: null, currentStage: null });
        } else if (!schedule.cfg.repeatEnabled) {
            await updateSchedule(schedule.id, { status: "done", enabled: false, nextRunAt: null, currentStage: null, lastRoundSummary: { roundNumber, totalSaved, at: Date.now() } });
        } else {
            let baseHours = schedule.cfg.intervalHours || 1;
            let intervalMs = baseHours * 3600 * 1000;
            let jitterDesc = "";
            if (schedule.cfg.antiBotEnabled !== false) {
                // Jitter ngẫu nhiên +-8% (0.92 đến 1.08)
                const jitterFactor = 0.92 + Math.random() * 0.16;
                intervalMs = Math.round(intervalMs * jitterFactor);
                const actualMinutes = Math.round(intervalMs / 60000);
                jitterDesc = ` (đã thêm jitter né bot: thực tế ~${actualMinutes} phút)`;
            }
            const nextRunAt = Date.now() + intervalMs;
            await updateSchedule(schedule.id, {
                status: "waiting_interval",
                nextRunAt,
                currentStage: null,
                lastRoundSummary: { roundNumber, totalSaved, at: Date.now() },
            });
            log(schedule.id, schedule.label, `Đã lên lịch vòng ${roundNumber + 1} lúc ${new Date(nextRunAt).toLocaleString("vi-VN")}${jitterDesc} — CHỈ chạy nếu tab Seeding vẫn còn mở lúc đó.`);
        }

        await scheduleNextAlarm();
        // Vua xong 1 lich - kiem tra ngay xem co lich nao KHAC dang den gio khong de chay
        // tiep lien tuc (dung tinh than hang doi), khong doi den lan alarm ke tiep.
        await tryRunDueSchedules();
    }

    async function tryRunDueSchedules() {
        if (activeScheduleId != null) return; // dang co 1 lich chay roi, doi no xong.
        const list = await getSchedules();
        const now = Date.now();
        const due = list
            .filter((s) => s.enabled && typeof s.nextRunAt === "number" && s.nextRunAt <= now)
            .sort((a, b) => a.nextRunAt - b.nextRunAt);
        if (due.length === 0) {
            await scheduleNextAlarm();
            return;
        }
        const schedule = due[0];
        // Cho phép thành viên và leader chạy lịch cào
        const tabOpen = await checkAppTabOpen(schedule.cfg.apiBase);
        if (tabOpen && typeof tabOpen === "object" && tabOpen.networkError) {
            log(schedule.id, schedule.label, `Không kiểm tra được tab Seeding (lỗi: ${tabOpen.networkError}) — sẽ thử lại sau ${ONLINE_RETRY_MINUTES} phút.`, "warn");
            await updateSchedule(schedule.id, { nextRunAt: now + ONLINE_RETRY_MINUTES * 60 * 1000 });
            await scheduleNextAlarm();
            return;
        }
        if (!tabOpen) {
            log(schedule.id, schedule.label, `Đã tới giờ chạy nhưng tab trang Seeding đã bị đóng (hoặc trình duyệt đã tắt) — tạm dừng, sẽ tự kiểm tra lại mỗi ${ONLINE_RETRY_MINUTES} phút. Mở lại tab Seeding (không cần để nó hiển thị) để tiếp tục.`, "warn");
            await updateSchedule(schedule.id, { status: "waiting_online", nextRunAt: now + ONLINE_RETRY_MINUTES * 60 * 1000 });
            stage(schedule.id, "waiting_online", { roundNumber: schedule.roundNumber });
            await scheduleNextAlarm();
            return;
        }
        await runScheduleRound(schedule);
    }

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === RESUME_ALARM) tryRunDueSchedules();
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;

        if (msg.action === "MK_ROTATE_SCHEDULE_LIST") {
            getSchedules().then((list) => sendResponse({ success: true, schedules: list }));
            return true;
        }

        if (msg.action === "MK_ROTATE_SCHEDULE_ADD") {
            (async () => {
                // Cho phép thành viên và leader thêm lịch cào
                const fbGroups = Array.isArray(msg.fbGroups) ? msg.fbGroups.filter((g) => g && g.url) : [];
                const liGroups = Array.isArray(msg.liGroups) ? msg.liGroups.filter((g) => g && g.url) : [];
                const threadsKeywords = Array.isArray(msg.threadsKeywords) ? msg.threadsKeywords.filter(Boolean) : [];
                const threadsAutoDiscover = !!(msg.config && msg.config.threadsAutoDiscover);
                if (fbGroups.length === 0 && liGroups.length === 0 && threadsKeywords.length === 0 && !threadsAutoDiscover) {
                    sendResponse({ success: false, error: "Chưa có nhóm Facebook/LinkedIn hoặc từ khoá Threads nào để cào." });
                    return;
                }
                if (!msg.config || !msg.config.email) {
                    sendResponse({ success: false, error: "Thiếu email tài khoản — cần để gắn đúng tài khoản cho lịch cào này." });
                    return;
                }
                const cfg = {
                    apiBase: msg.config.apiBase || "https://seeding.markeeai.com",
                    email: msg.config.email,
                    idMember: msg.config.idMember || null,
                    intervalHours: Math.max(0.05, Number(msg.config.intervalHours) || 1),
                    repeatEnabled: !!msg.config.repeatEnabled,
                    antiBotEnabled: msg.config.antiBotEnabled !== false,
                    fbGroups,
                    liGroups,
                    threadsKeywords,
                    threadsAutoDiscover,
                };
                const schedule = {
                    id: genId(),
                    label: (msg.label || "").trim() || `Lịch cào ${new Date().toLocaleTimeString("vi-VN")}`,
                    cfg,
                    enabled: true,
                    status: "waiting_interval",
                    currentStage: null,
                    roundNumber: 0,
                    nextRunAt: Date.now(),
                    lastRoundSummary: null,
                    lastError: null,
                    createdAt: Date.now(),
                };
                dashboardTabId = sender.tab ? sender.tab.id : dashboardTabId;
                const list = await readSchedulesRaw();
                list.push(schedule);
                await writeSchedules(list);
                sendResponse({ success: true, schedule });
                await tryRunDueSchedules();
            })();
            return true;
        }

        if (msg.action === "MK_ROTATE_SCHEDULE_TOGGLE") {
            (async () => {
                const list = await readSchedulesRaw();
                const schedule = findSchedule(list, msg.id);
                if (!schedule) {
                    sendResponse({ success: false, error: "Không tìm thấy lịch cào này." });
                    return;
                }
                const enabled = !!msg.enabled;
                const patch = { enabled };
                if (enabled && schedule.nextRunAt == null) {
                    patch.nextRunAt = Date.now();
                    patch.status = "waiting_interval";
                }
                await updateSchedule(msg.id, patch);
                sendResponse({ success: true });
                if (enabled) await tryRunDueSchedules();
                else await scheduleNextAlarm();
            })();
            return true;
        }

        if (msg.action === "MK_ROTATE_SCHEDULE_STOP") {
            (async () => {
                const list = await readSchedulesRaw();
                const schedule = findSchedule(list, msg.id);
                if (!schedule) {
                    sendResponse({ success: false, error: "Không tìm thấy lịch cào này." });
                    return;
                }
                if (schedule.id === activeScheduleId) {
                    cancelRequestedIds.add(schedule.id);
                    try { self.__mkStopFbCrawl && self.__mkStopFbCrawl(); } catch (e) {}
                    try { self.__mkStopLiCrawl && self.__mkStopLiCrawl(); } catch (e) {}
                    try { self.__mkStopThreadsCrawl && self.__mkStopThreadsCrawl(); } catch (e) {}
                    log(schedule.id, schedule.label, "Đã nhận lệnh dừng — sẽ dừng ngay sau bước hiện tại.", "warn");
                    sendResponse({ success: true });
                } else {
                    await updateSchedule(schedule.id, { status: "stopped", enabled: false, nextRunAt: null });
                    await scheduleNextAlarm();
                    sendResponse({ success: true });
                }
            })();
            return true;
        }

        if (msg.action === "MK_ROTATE_SCHEDULE_DELETE") {
            (async () => {
                if (msg.id === activeScheduleId) cancelRequestedIds.add(msg.id);
                const list = await readSchedulesRaw();
                const next = list.filter((s) => s.id !== msg.id);
                await writeSchedules(next);
                await scheduleNextAlarm();
                sendResponse({ success: true });
            })();
            return true;
        }
    });

    // Luc service worker vua khoi dong (cai dat/cap nhat extension, hoac Chrome tu wake lai
    // khi co alarm) - dam bao luon co dung 1 alarm cho lich som nhat, phong khi truoc do bi
    // mat alarm vi ly do nao do (vd Chrome bi tat dot ngot).
    scheduleNextAlarm();
})();
