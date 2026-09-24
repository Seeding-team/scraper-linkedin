// -----------------------------------------------------------------------------
// UNIFIED EXTENSION BRIDGE SCRIPT (bridge.js)
// Injected into Web App pages (localhost, seeding.markeeai.com, vercel.app)
// Bridge between Web App window.postMessage and Extension chrome.runtime.sendMessage
// -----------------------------------------------------------------------------

// Truoc day KHONG check chrome.runtime.lastError va KHONG co timeout gi ca -
// neu background service worker (Manifest V3) bi treo/crash/khong wake len
// duoc de xu ly message, chrome.runtime.sendMessage co the KHONG BAO GIO goi
// callback (khong throw, khong loi, khong gi ca) - trang web dung im mai mai,
// dung y het trieu chung "bam Gui khong ra gi ca" (xac nhan qua watchdog phia
// FE). Them timeout 4s + luon check lastError de callback CHAC CHAN duoc goi.
function safeSendMessage(message, callback, timeoutMs) {
    try {
        if (!chrome.runtime?.id) {
            window.postMessage({ action: "COMMENT_EXTENSION_INVALIDATED" }, "*");
            window.postMessage({ action: "LI_EXTENSION_INVALIDATED" }, "*");
            return;
        }
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            console.warn("[Bridge] chrome.runtime.sendMessage khong nhan duoc phan hoi trong " + (timeoutMs || 4000) + "ms — background service worker co the da bi treo/crash.");
            callback({
                success: false,
                error: "Background service worker của Extension không phản hồi (có thể đã bị treo/crash). Hãy vào chrome://extensions, bấm reload (vòng tròn) trên extension rồi F5 lại trang này.",
            });
        }, timeoutMs || 4000);

        chrome.runtime.sendMessage(message, (response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
                console.warn("[Bridge] chrome.runtime.sendMessage lastError:", chrome.runtime.lastError.message);
                callback({ success: false, error: chrome.runtime.lastError.message || "Lỗi kết nối tới Extension background." });
                return;
            }
            callback(response);
        });
    } catch (e) {
        window.postMessage({ action: "COMMENT_EXTENSION_INVALIDATED" }, "*");
        window.postMessage({ action: "LI_EXTENSION_INVALIDATED" }, "*");
    }
}

window.addEventListener("message", function(event) {
    if (event.source !== window || !event.data) return;
    const { action, payload } = event.data;
    if (!action) return;

    if (action === "START_BULK_COMMENT" || action === "LI_START_COMMENT") {
        console.log("[Bridge] Received comment request:", action, payload);
        const url = payload?.url || payload?.posts?.[0]?.url;
        const text = payload?.text || payload?.content;
        const postsToRun = payload?.posts || (url ? [{ url, fanpage_id: payload?.fanpage_id, fanpage_name: payload?.fanpage_name }] : []);

        const normalizedPayload = {
            ...payload,
            text: text,
            content: text,
            posts: postsToRun,
        };

        safeSendMessage({
            action: "START_BULK_COMMENT",
            payload: normalizedPayload
        }, response => {
            if (response && response.success) {
                window.postMessage({ action: "BULK_COMMENT_STARTED", success: true }, "*");
                window.postMessage({ action: "LI_COMMENT_STARTED", success: true }, "*");
            } else {
                // Truoc day nhanh nay KHONG lam gi ca khi background tu choi (vd dang co
                // tien trinh khac chua xong) hoac khong tra loi gi - trang web im re khong
                // biet gi, giong het "bam nut Gui khong co phan hoi gi ca".
                const errMsg = (response && response.error) || "Không nhận được phản hồi từ Extension.";
                window.postMessage({ action: "BULK_COMMENT_FAILED_TO_START", error: errMsg }, "*");
                window.postMessage({ action: "LI_COMMENT_FAILED_TO_START", error: errMsg }, "*");
            }
        });
    } else if (action === "SYNC_ACTIVE_MEMBER" || event.data.type === "SYNC_ACTIVE_MEMBER") {
        safeSendMessage({
            action: "SYNC_ACTIVE_MEMBER",
            payload: payload
        }, () => {});
    } else if (action === "STOP_BULK_COMMENT") {
        safeSendMessage({ action: "STOP_BULK_COMMENT" }, response => {
            window.postMessage({ action: "STOP_BULK_COMMENT_RESPONSE", payload: response }, "*");
        });
    } else if (action === "PING_COMMENT_EXTENSION" || action === "PING_LI_EXTENSION") {
        window.postMessage({ action: "COMMENT_EXTENSION_READY" }, "*");
        window.postMessage({ action: "LI_EXTENSION_READY" }, "*");
    } else if (action === "GET_STATUS") {
        safeSendMessage({ action: "GET_STATUS" }, response => {
            window.postMessage({ action: "STATUS_RESPONSE", payload: response }, "*");
        });
    }
});

// Lắng nghe tiến trình từ background và relay xuống Web App UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "BULK_COMMENT_PROGRESS") {
        window.postMessage({ action: "BULK_COMMENT_PROGRESS", payload: request.payload }, "*");
        window.postMessage({ action: "LI_COMMENT_PROGRESS", payload: request.payload }, "*");
    } else if (request.action === "BULK_COMMENT_DONE") {
        window.postMessage({ action: "BULK_COMMENT_DONE", payload: request.payload }, "*");
        window.postMessage({ action: "LI_COMMENT_DONE", payload: request.payload }, "*");
    }
    return true;
});

// Gửi tín hiệu sẵn sàng khi vừa load bridge.js
window.postMessage({ action: "COMMENT_EXTENSION_READY" }, "*");
window.postMessage({ action: "LI_EXTENSION_READY" }, "*");
