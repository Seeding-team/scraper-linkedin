// bridge.js - Cầu nối giao tiếp giữa React Frontend và Background của Extension API MỚI

// Sau khi extension được reload/update (chrome://extensions), content script cũ
// đang chạy trong tab đã mở sẵn sẽ bị Chrome "cắt dây" khỏi background - mọi lệnh
// gọi chrome.runtime.* lúc này throw "Extension context invalidated". Bọc lại để
// báo cho React app biết và tự F5 lại trang (thay vì crash im lặng khi bấm cào).
function isExtensionContextValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

function notifyExtensionInvalidated() {
    window.postMessage({ type: 'API_EXTENSION_INVALIDATED' }, '*');
}

function safeSendMessage(message, callback) {
    if (!isExtensionContextValid()) {
        notifyExtensionInvalidated();
        return;
    }
    try {
        chrome.runtime.sendMessage(message, callback);
    } catch (e) {
        notifyExtensionInvalidated();
    }
}

// Save the current backend URL to storage so popup.js and background.js
// can read it instead of using hardcoded production URL.
try {
    chrome.storage.local.set({ api_base_url: window.location.origin });
} catch (e) {
    // Context đã invalidated ngay từ lúc inject - bỏ qua, chờ user F5.
}

window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data && event.data.type === 'API_LAUNCH_FROM_APP') {
        const groups = event.data.data.groups;
        const config = event.data.data.config;

        safeSendMessage({
            action: 'START_AUTO_CRAWL',
            groups: groups,
            config: config
        }, (response) => {
            window.postMessage({ type: 'API_LAUNCH_FROM_APP_RESULT', success: true }, '*');
        });
    }

    if (event.data && event.data.type === 'API_STOP_CRAWL') {
        safeSendMessage({ action: 'STOP_AUTO_CRAWL' });
    }

    if (event.data && event.data.type === 'API_MARKEE_FB_PING') {
        if (!isExtensionContextValid()) {
            notifyExtensionInvalidated();
            return;
        }
        window.postMessage({ type: 'API_MARKEE_FB_PONG', installed: true, isRunning: false }, '*');
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'FRONTEND_LOG') {
        window.postMessage({ 
            type: 'API_CRAWL_LOG', 
            level: msg.level || 'info',
            message: msg.message 
        }, '*');
    }
    
    if (msg.action === 'FRONTEND_PROGRESS') {
        window.postMessage({ 
            type: 'API_CRAWL_PROGRESS', 
            groupIndex: msg.groupIndex,
            totalGroups: msg.totalGroups
        }, '*');
    }

    if (msg.action === 'FRONTEND_DONE') {
        window.postMessage({ 
            type: 'API_CRAWL_DONE',
            totalGroups: msg.totalGroups,
            totalPosts: msg.totalPosts
        }, '*');
    }
});

window.postMessage({ type: 'API_MARKEE_FB_PONG', installed: true, isRunning: false }, '*');
window.postMessage({ type: 'API_MARKEE_FB_EXTENSION_READY' }, '*');

// Lifecycle Heartbeat: Báo cho Extension biết tab Seeding Web đang mở
let heartbeatTimer = setInterval(() => {
    safeSendMessage({ action: 'APP_TAB_HEARTBEAT', timestamp: Date.now() });
}, 3000);

window.addEventListener('beforeunload', () => {
    clearInterval(heartbeatTimer);
    safeSendMessage({ action: 'APP_TAB_CLOSING', timestamp: Date.now() });
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        safeSendMessage({ action: 'APP_TAB_ACTIVE', timestamp: Date.now() });
    }
});
