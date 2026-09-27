// bridge.js - cầu nối giữa web app Markee (React) và background của extension Threads.
// Mọi message đều có tiền tố THREADS_ để không đụng với extension Facebook
// (api-facebook-get-extension/bridge.js dùng API_LAUNCH_FROM_APP, API_CRAWL_LOG...)
// khi người dùng cài cả 2 extension cùng lúc.

function isExtensionContextValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

function notifyInvalidated() {
    window.postMessage({ type: 'THREADS_API_EXTENSION_INVALIDATED' }, '*');
}

function safeSendMessage(message, callback) {
    if (!isExtensionContextValid()) {
        notifyInvalidated();
        return;
    }
    try {
        chrome.runtime.sendMessage(message, (response) => {
            // Đọc lastError để Chrome không báo "Unchecked runtime.lastError".
            const err = chrome.runtime.lastError;
            if (callback) callback(err ? { success: false, error: err.message } : response);
        });
    } catch (e) {
        notifyInvalidated();
    }
}

try {
    chrome.storage.local.set({ api_base_url: window.location.origin });
} catch (e) {
    // Context đã invalidated ngay lúc inject - chờ người dùng F5.
}

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'THREADS_API_LAUNCH') {
        const payload = data.data || {};
        safeSendMessage({
            action: 'THREADS_START_CRAWL',
            keywords: payload.keywords || [],
            // Web app gửi kèm apiBase (URL backend tuyệt đối); thiếu thì coi backend
            // cùng origin với web app (production chạy sau cùng 1 nginx router).
            config: { ...(payload.config || {}), apiBase: (payload.config && payload.config.apiBase) || window.location.origin },
        }, (response) => {
            window.postMessage({
                type: 'THREADS_API_LAUNCH_RESULT',
                success: !!(response && response.success),
                error: response && response.error,
            }, '*');
        });
    }

    if (data.type === 'THREADS_API_STOP') {
        safeSendMessage({ action: 'THREADS_STOP_CRAWL' });
    }

    if (data.type === 'THREADS_API_PING') {
        if (!isExtensionContextValid()) {
            notifyInvalidated();
            return;
        }
        safeSendMessage({ action: 'THREADS_GET_STATUS' }, (response) => {
            window.postMessage({
                type: 'THREADS_API_PONG',
                installed: true,
                isRunning: !!(response && response.isRunning),
            }, '*');
        });
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'THREADS_FRONTEND_LOG') {
        window.postMessage({ type: 'THREADS_API_LOG', level: msg.level || 'info', message: msg.message }, '*');
    } else if (msg.action === 'THREADS_FRONTEND_PROGRESS') {
        window.postMessage({
            type: 'THREADS_API_PROGRESS',
            keywordIndex: msg.keywordIndex,
            totalKeywords: msg.totalKeywords,
            keyword: msg.keyword,
            found: msg.found,
        }, '*');
    } else if (msg.action === 'THREADS_FRONTEND_SAVED') {
        window.postMessage({ type: 'THREADS_API_SAVED', keyword: msg.keyword, count: msg.count }, '*');
    } else if (msg.action === 'THREADS_FRONTEND_DONE') {
        window.postMessage({
            type: 'THREADS_API_DONE',
            totalSaved: msg.totalSaved,
            totalFound: msg.totalFound,
            stopped: msg.stopped,
        }, '*');
    }
});

window.postMessage({ type: 'THREADS_API_PONG', installed: true, isRunning: false }, '*');
