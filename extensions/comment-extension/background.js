let isCommenting = false;
let currentProgress = null;
let shouldStop = false;

async function getPersistedState() {
    try {
        const result = await chrome.storage.session.get(["isCommenting", "currentProgress"]);
        if (result.isCommenting) {
            isCommenting = result.isCommenting;
            currentProgress = result.currentProgress || null;
        }
    } catch(e) {
        // session storage may not be available in some Chrome versions
    }
}

async function persistState() {
    try {
        await chrome.storage.session.set({ isCommenting, currentProgress });
    } catch(e) {}
}

async function clearPersistedState() {
    try {
        await chrome.storage.session.remove(["isCommenting", "currentProgress"]);
    } catch(e) {}
}

getPersistedState();

// Neu vi 1 ly do nao do (loi cu truoc khi co fix nay, extension bi tat dot ngot...)
// isCommenting bi ket o "true" trong chrome.storage.session, no se KET MAI - session
// storage khong tu xoa khi cap nhat/reload extension, chi mat khi dong HET trinh duyet.
// Reset sach moi lan extension duoc cai lai/cap nhat de chac chan khong bi "ket" nua.
chrome.runtime.onInstalled.addListener(() => {
    isCommenting = false;
    shouldStop = false;
    currentProgress = null;
    clearPersistedState();
});

// Manifest V3: service worker nay bi Chrome tu dong "ngu" sau ~30s khong hoat
// dong, roi Chrome PHAI tu wake lai khi co message/event moi - nhung tren
// thuc te co truong hop wake khong thanh cong (bug/edge-case da biet cua
// Chrome), khien chrome.runtime.sendMessage() ben content script KHONG BAO
// GIO nhan duoc callback (khong loi, khong gi ca) - dung y trieu chung "bam
// Gui khong ra gi ca" ma xac nhan qua watchdog phia web app. Dat 1 alarm
// dinh ky de "danh thuc" service worker thuong xuyen hon, giam kha nang bi
// ngu sau qua lau dan toi truong hop nay.
chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepAlive") {
        // Khong can lam gi - chi viec listener nay ton tai da du de Chrome
        // tinh la "co hoat dong", tranh service worker bi terminate hoan toan.
    }
});

let activeTargetTabId = null;
let activeTargetConfig = null;
let syncTimestamp = 0;

// Lắng nghe sự kiện Tab bị đóng -> Tự động xóa sạch Session KPI của Tab đó ngay lập tức!
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTargetTabId) {
        console.log(`[Background] Tab mục tiêu (ID: ${tabId}) đã bị đóng -> Tự hủy 100% Session KPI!`);
        activeTargetTabId = null;
        activeTargetConfig = null;
        syncTimestamp = 0;
        try {
            if (chrome.storage && chrome.storage.session) {
                chrome.storage.session.clear();
            }
            chrome.storage.local.remove(["markee_verify_config", "markee_email_member", "active_target_tab_id"]);
        } catch (e) {}
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_BULK_COMMENT") {
        if (isCommenting) {
            sendResponse({ success: false, error: "Đang có một tiến trình comment đang chạy." });
            return;
        }

        if (!request.payload || !request.payload.text) {
            sendResponse({ success: false, error: "Thiếu nội dung comment." });
            return;
        }

        const { links, posts: passedPosts } = request.payload;
        const postsToRun = passedPosts || (links ? links.map(l => ({ url: l })) : []);

        if (postsToRun.length === 0) {
            sendResponse({ success: false, error: "Không có bài viết nào để comment." });
            return;
        }

        isCommenting = true;
        shouldStop = false;
        currentProgress = null;
        persistState();

        // Lưu email_member và verifyConfig vào storage để content.js dùng
        // khi ghi nhận Like/Share bắt qua graphql-sniffer
        try {
            const vc = request.payload.verifyConfig || {};
            chrome.storage.local.set({
                markee_email_member: vc.email_member || "",
                markee_verify_config: {
                    email_member: vc.email_member || "",
                    apiBase: vc.apiBase || "https://seeding.markeeai.com",
                    fanpage_id: vc.fanpage_id || "",
                    fanpage_name: vc.fanpage_name || "",
                    mode: vc.mode || "internal_engagement",
                },
            });
        } catch (e) {}

        sendResponse({ success: true, total: postsToRun.length });

        runBulkComment(request.payload, sender.tab ? sender.tab.id : null, postsToRun);
    } else if (request.action === "STOP_BULK_COMMENT") {
        shouldStop = true;
        sendResponse({ success: true });
    } else if (request.action === "GET_STATUS") {
        sendResponse({ isCommenting, currentProgress });
    } else if (request.action === "SYNC_ACTIVE_MEMBER") {
        // Lưu cấu hình từ Tool và chuẩn bị gán Tab mục tiêu cho tab Facebook mở tiếp theo
        try {
            const p = request.payload || {};
            activeTargetConfig = {
                email_member: p.email_member || "",
                apiBase: p.apiBase || "https://seeding.markeeai.com",
                fanpage_id: p.fanpage_id || "",
                fanpage_name: p.fanpage_name || "",
                facebook_post_id: p.facebook_post_id || "unknown",
                target_link: p.target_link || "",
            };
            activeTargetTabId = null; // Reset tabId, sẽ tự gán cho tab đầu tiên gửi request kiểm tra
            syncTimestamp = Date.now();

            const sessionData = {
                markee_email_member: p.email_member || "",
                markee_verify_config: activeTargetConfig,
                sync_timestamp: syncTimestamp,
            };

            if (chrome.storage && chrome.storage.session) {
                chrome.storage.session.set(sessionData);
            }
            chrome.storage.local.set(sessionData);
        } catch (e) {}
        sendResponse({ success: true });
    } else if (request.action === "CHECK_TAB_PERMISSION") {
        const senderTabId = sender.tab ? sender.tab.id : null;

        // Nếu vừa sync từ Tool trong vòng 120s và chưa gán Tab mục tiêu, tự động gán Tab hiện tại làm Tab duy nhất được cấp quyền!
        if (senderTabId && !activeTargetTabId && activeTargetConfig && (Date.now() - syncTimestamp < 120000)) {
            activeTargetTabId = senderTabId;
            console.log(`[Background] Đã cấp quyền Tab Lifetime cho Tab ID: ${activeTargetTabId}`);
        }

        const isAllowed = senderTabId && activeTargetTabId && senderTabId === activeTargetTabId && !!activeTargetConfig;

        if (isAllowed) {
            sendResponse({ allowed: true, config: activeTargetConfig });
        } else {
            sendResponse({ allowed: false });
        }
    }
    return true;
});

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isNoReceiverError(message) {
    return typeof message === "string" && /Receiving end does not exist|Could not establish connection/i.test(message);
}

function sendExecuteCommentOnce(tabId, url, text) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, {
            action: "EXECUTE_COMMENT",
            payload: { url, text }
        }, response => {
            if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
            } else if (!response) {
                resolve({ success: false, error: "No response from content script." });
            } else {
                resolve(response);
            }
        });
    });
}

// Cac trang nhu LinkedIn hay dieu huong THEM 1 lan nua (authwall/locale/rut gon lnkd.in)
// SAU KHI tab da bao "complete" lan dau - content script cua lan dieu huong truoc bi huy,
// con lan sau chua kip dang ky listener, nen sendMessage bao "Receiving end does not exist"
// dung luc do. Thu lai vai lan thay vi bao loi ngay khi gap dung loai loi nay.
async function sendExecuteCommentWithRetry(tabId, url, text, maxAttempts = 5, retryDelayMs = 1500) {
    let lastResult = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        lastResult = await sendExecuteCommentOnce(tabId, url, text);
        if (lastResult.success || !isNoReceiverError(lastResult.error)) {
            return lastResult;
        }
        if (attempt < maxAttempts) {
            await delay(retryDelayMs);
        }
    }
    return lastResult;
}

async function waitForTabLoad(tabId, timeoutMs = 10000) {
    return new Promise(resolve => {
        let isResolved = false;
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve();
            }
        }, timeoutMs);

        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function runBulkComment(payload, uiTabId, postsToRun) {
    const { text, verifyConfig } = payload;

    // Toan bo vong lap boc trong try/finally - truoc day neu co loi bat ngo nao
    // thoat ra ngoai vong lap (khong duoc bat trong try/catch tung buoc ben duoi),
    // isCommenting se ket cung o "true" MAI MAI (ke ca sau khi service worker restart,
    // vi da persist qua chrome.storage.session) - moi lan bam "Gui" sau do bi background
    // tu choi ngay lap tuc voi loi "Dang co 1 tien trinh dang chay" MA KHONG AI BAO CHO
    // NGUOI DUNG BIET (xem fix o bridge.js) => giong het trieu chung "bam khong ra gi ca".
    try {
    for (let i = 0; i < postsToRun.length; i++) {
        if (shouldStop) break;

        const currentPost = postsToRun[i];
        const url = currentPost.url;
        if (!url) continue;

        currentProgress = { current: i + 1, total: postsToRun.length, url, status: "Đang mở tab..." };
        persistState();
        if (uiTabId) {
            chrome.tabs.sendMessage(uiTabId, {
                action: "BULK_COMMENT_PROGRESS",
                payload: currentProgress
            }).catch(() => {});
        }

        let tab;
        try {
            tab = await chrome.tabs.create({ url, active: false });
        } catch (e) {
            currentProgress = { current: i + 1, total: postsToRun.length, url, status: `Lỗi mở tab: ${e.message}` };
            persistState();
            continue;
        }

        try {
            await waitForTabLoad(tab.id);
            await delay(3000);

            if (shouldStop) {
                try { await chrome.tabs.remove(tab.id); } catch(e) {}
                break;
            }

            currentProgress = { current: i + 1, total: postsToRun.length, url, status: "Đang lấy token và comment..." };
            persistState();
            if (uiTabId) {
                chrome.tabs.sendMessage(uiTabId, {
                    action: "BULK_COMMENT_PROGRESS",
                    payload: currentProgress
                }).catch(() => {});
            }

            const result = await sendExecuteCommentWithRetry(tab.id, url, text);

            currentProgress = { current: i + 1, total: postsToRun.length, url, status: result.success ? "Thành công" : `Lỗi: ${result.error}`, result };
            persistState();
            if (uiTabId) {
                chrome.tabs.sendMessage(uiTabId, {
                    action: "BULK_COMMENT_PROGRESS",
                    payload: currentProgress
                }).catch(() => {});
            }

            if (result && verifyConfig && verifyConfig.email_member) {
                try {
                    const apiBase = verifyConfig.apiBase || "https://seeding.markeeai.com";
                    const detectedPlatform = (result && result.platform)
                        ? result.platform
                        : ((url && (url.includes("youtube.com") || url.includes("youtu.be")))
                            ? "youtube"
                            : ((url && (url.includes("linkedin.com") || url.includes("lnkd.in")))
                                ? "linkedin"
                                : ((url && url.includes("threads.")) ? "threads" : "facebook")));
                    const platformId = detectedPlatform === "youtube" ? 2 : (detectedPlatform === "linkedin" ? 3 : (detectedPlatform === "threads" ? 4 : 1));

                    if (verifyConfig.mode === "internal_engagement") {
                        // Trang Tương tác nội bộ — lưu vào bảng KPI riêng, không đụng
                        // vào bảng seeding_content_kpi của tính năng seeding nhóm cũ.
                        // profile_id: danh tinh tai khoan THAT SU dang bam comment (khac
                        // email_member la tai khoan dang nhap he thong noi bo) - Facebook
                        // da co san (uid so tu token trang), LinkedIn dang cho HTML mau
                        // khu vuc avatar "Me" de trich xuat tuong tu (xem account_name/
                        // account_url tra ve tu doPostComment cua tung platform).
                        const posterAccount = result.account_name || result.account_url || result.uid || undefined;
                        const kpiResp = await fetch(`${apiBase}/api/all-platform/internal-engagement/kpi/record`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                email_member: verifyConfig.email_member,
                                link_post: url,
                                platform: detectedPlatform,
                                fanpage_id: currentPost.fanpage_id,
                                fanpage_name: currentPost.fanpage_name,
                                facebook_post_id: currentPost.id_post || currentPost.facebook_post_id || "unknown",
                                action_type: "comment",
                                content: text,
                                profile_id: posterAccount,
                                status: result.success ? "success" : "failed",
                                error_message: result.success ? undefined : result.error,
                            }),
                        });
                        if (!kpiResp.ok) {
                            const errBody = await kpiResp.text().catch(() => "");
                            console.error("[Comment Extension] Lưu KPI thất bại, HTTP", kpiResp.status, errBody);
                            result.kpiSaveError = `HTTP ${kpiResp.status}`;
                        } else {
                            const kpiJson = await kpiResp.json().catch(() => null);
                            if (kpiJson && kpiJson.success === false) {
                                console.error("[Comment Extension] Lưu KPI thất bại:", kpiJson.message);
                                result.kpiSaveError = kpiJson.message;
                            }
                        }
                    } else {
                        const verifyBody = {
                            email_member: verifyConfig.email_member,
                            link_post: url,
                            platform: detectedPlatform,
                            content: text,
                            link_comment: result.url || `Bị từ chối / Không lấy được link - ${Date.now()}-${Math.random().toString(36).substring(7)}`,
                            profile_id: result.uid || "Unknown",
                            id_post: currentPost.id_post,
                            id_social_account: verifyConfig.id_social_account || undefined,
                            id_platform: currentPost.id_platform || platformId
                        };

                        const verifyEndpoint = detectedPlatform === "youtube"
                            ? `${apiBase}/api/all-platform/youtube/seeding-mark/verify`
                            : `${apiBase}/api/all-platform/facebook/seeding-mark/verify`;

                        try {
                            const vResp = await fetch(verifyEndpoint, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(verifyBody)
                            });
                            if (!vResp.ok && detectedPlatform === "youtube") {
                                await fetch(`${apiBase}/api/all-platform/facebook/seeding-mark/verify`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(verifyBody)
                                });
                            }
                        } catch (err) {
                            await fetch(`${apiBase}/api/all-platform/facebook/seeding-mark/verify`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(verifyBody)
                            }).catch(() => {});
                        }
                    }
                } catch(e) {
                    console.error("Lỗi lưu KPI:", e);
                    result.kpiSaveError = e.message;
                }

                if (result.kpiSaveError) {
                    currentProgress = {
                        current: i + 1, total: postsToRun.length, url,
                        status: `Comment ${result.success ? "OK" : "lỗi"} nhưng lưu KPI thất bại: ${result.kpiSaveError}`,
                        result,
                    };
                    persistState();
                    if (uiTabId) {
                        chrome.tabs.sendMessage(uiTabId, {
                            action: "BULK_COMMENT_PROGRESS",
                            payload: currentProgress
                        }).catch(() => {});
                    }
                }
            }

        } catch (e) {
            currentProgress = { current: i + 1, total: postsToRun.length, url, status: `Ngoại lệ: ${e.message}`, result: { success: false, error: e.message } };
            persistState();
            if (uiTabId) {
                chrome.tabs.sendMessage(uiTabId, {
                    action: "BULK_COMMENT_PROGRESS",
                    payload: currentProgress
                }).catch(() => {});
            }
        } finally {
            if (tab) {
                try { await chrome.tabs.remove(tab.id); } catch(e) {}
            }
        }

        if (shouldStop) break;

        if (i < postsToRun.length - 1) {
            currentProgress = { current: i + 1, total: postsToRun.length, url, status: "Đợi 5 giây để tiếp tục..." };
            persistState();
            if (uiTabId) {
                chrome.tabs.sendMessage(uiTabId, {
                    action: "BULK_COMMENT_PROGRESS",
                    payload: currentProgress
                }).catch(() => {});
            }
            await delay(5000);
        }
    }
    } finally {
        isCommenting = false;
        shouldStop = false;
        currentProgress = null;
        clearPersistedState();
        if (uiTabId) {
            chrome.tabs.sendMessage(uiTabId, {
                action: "BULK_COMMENT_DONE",
                payload: { total: postsToRun.length, stopped: shouldStop }
            }).catch(() => {});
        }
    }
}

// Lắng nghe yêu cầu gọi API từ content.js để bypass CORS / Mixed Content
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "RECORD_KPI_BACKGROUND") {
        const targetUrl = (request.endpoint || "").replace("localhost", "127.0.0.1");
        console.log("[Background Service Worker] Background đang gọi API tới:", targetUrl);
        console.log("[Background Service Worker] Payload:", request.payload);

        fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.payload)
        })
        .then(res => {
            if (!res.ok) {
                return res.text().then(text => { throw new Error(`HTTP ${res.status}: ${text}`) });
            }
            return res.json();
        })
        .then(data => sendResponse({ success: true, data: data }))
        .catch(err => {
            console.error("[Background Service Worker] Lỗi fetch KPI full error:", err);
            sendResponse({ success: false, error: err.message || String(err) });
        });
        
        return true; // Bắt buộc return true để giữ cổng Message mở cho bất đồng bộ (async fetch)
    }
});


