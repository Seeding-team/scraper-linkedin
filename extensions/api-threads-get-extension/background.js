// background.js - Điều phối "Siêu Tốc Cào Dữ Liệu" cho Threads.
// Với mỗi từ khoá: mở trang tìm kiếm threads.com/search?q=<từ khoá>, nhờ content.js gom
// bài (JSON của trang + GraphQL khi cuộn), rồi gửi lên backend
// POST /api/all-platform/extension/threads/save-posts để lọc (trùng, quá cũ) + lưu.

const EXTENSION_API_KEY = 'markee-extension-key-2024';
const DEFAULT_API_BASE = 'https://seeding.markeeai.com';

let isRunning = false;
let shouldStop = false;
let currentTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'THREADS_START_CRAWL') {
        if (isRunning) {
            sendResponse({ success: false, error: 'Đang có tiến trình cào Threads khác chạy, hãy dừng nó trước.' });
            return false;
        }
        startCrawl(msg.keywords || [], msg.config || {});
        sendResponse({ success: true });
    } else if (msg.action === 'THREADS_STOP_CRAWL') {
        shouldStop = true;
        sendLog('⏹ Đã nhận lệnh dừng, sẽ dừng sau bước hiện tại...', 'warn');
        sendResponse({ success: true });
    } else if (msg.action === 'THREADS_GET_STATUS') {
        sendResponse({ isRunning });
    }
    return false;
});

function broadcastToTabs(message) {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id === undefined || tab.id === currentTabId) continue;
            chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
    });
}

function sendLog(message, level = 'info') {
    if (level === 'error') console.error(message); else console.log(message);
    chrome.runtime.sendMessage({ action: 'THREADS_POPUP_LOG', message }).catch(() => {});
    broadcastToTabs({ action: 'THREADS_FRONTEND_LOG', message, level });
}

function sendProgress(data) {
    broadcastToTabs({ action: 'THREADS_FRONTEND_PROGRESS', ...data });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Chờ tab tải xong (status "complete"), tối đa timeoutMs.
function waitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timer);
            resolve(ok);
        };
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') finish(true);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId).then((tab) => {
            if (tab && tab.status === 'complete') finish(true);
        }).catch(() => finish(false));
    });
}

function buildSearchUrl(keyword, sortRecent) {
    const params = new URLSearchParams({ q: keyword, serp_type: 'default' });
    // Tab "Gần đây" của trang tìm kiếm - chỉ có tác dụng khi đã đăng nhập Threads.
    if (sortRecent) params.set('filter', 'recent');
    return `https://www.threads.com/search?${params.toString()}`;
}

async function hasThreadsLoginCookie() {
    try {
        const cookie = await chrome.cookies.get({ url: 'https://www.threads.com', name: 'sessionid' });
        return !!cookie;
    } catch (e) {
        return false;
    }
}

async function collectFromTab(tabId, targetCount) {
    const message = { action: 'THREADS_COLLECT_POSTS', targetCount, maxScrolls: 15 };
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
        // Content script chưa có trong tab (vd extension vừa cài/cập nhật) -> tiêm tay rồi thử lại.
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await sleep(500);
        return chrome.tabs.sendMessage(tabId, message);
    }
}

async function pushToBackend(apiBase, body) {
    let lastError = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
        try {
            const res = await fetch(`${apiBase}/api/all-platform/extension/threads/save-posts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': EXTENSION_API_KEY },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
            }
            return await res.json();
        } catch (e) {
            lastError = e;
            if (attempt < 2) {
                sendLog(`⚠️ Gửi backend lỗi (${e.message}), thử lại lần ${attempt + 1}/2...`, 'warn');
                await sleep(2000);
            }
        }
    }
    throw lastError;
}

async function startCrawl(keywords, config) {
    isRunning = true;
    shouldStop = false;
    // Service worker MV3 bị Chrome tắt sau ~30s không có sự kiện/lời gọi API extension,
    // trong khi 1 lượt gom bài có thể chờ tới ~50s -> gọi 1 API rẻ định kỳ để giữ sống.
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

    const apiBase = config.apiBase || (await chrome.storage.local.get('api_base_url')).api_base_url || DEFAULT_API_BASE;
    const postLimit = Number(config.postLimit) > 0 ? Math.floor(Number(config.postLimit)) : 20;
    const maxAgeDays = Number(config.maxAgeDays) > 0 ? Math.floor(Number(config.maxAgeDays)) : null;
    const sortRecent = config.sortRecent !== false;
    // Gom dư ra (x3) vì backend còn lọc bài trùng/bài cũ rồi mới cắt theo post_limit.
    const targetCount = Math.min(Math.max(postLimit * 3, 30), 150);

    let totalSaved = 0;
    let totalFound = 0;

    try {
        if (!(await hasThreadsLoginCookie())) {
            sendLog('ℹ️ Có vẻ Chrome chưa đăng nhập Threads: mỗi từ khoá chỉ lấy được ~20 bài đầu (không cuộn thêm được, không lọc được "Gần đây"). Đăng nhập threads.com để lấy nhiều bài hơn.', 'warn');
        }

        sendLog(`🚀 Bắt đầu tìm bài Threads cho ${keywords.length} từ khoá...`);
        const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
        currentTabId = tab.id;

        for (let i = 0; i < keywords.length; i++) {
            if (shouldStop) break;
            const keyword = keywords[i];
            sendProgress({ keywordIndex: i, totalKeywords: keywords.length, keyword });
            sendLog(`▶ [${i + 1}/${keywords.length}] Đang tìm: "${keyword}"`);

            await chrome.tabs.update(currentTabId, { url: buildSearchUrl(keyword, sortRecent) });
            await waitForTabComplete(currentTabId);
            await sleep(2500); // chờ React render kết quả
            if (shouldStop) break;

            let result;
            try {
                result = await collectFromTab(currentTabId, targetCount);
            } catch (e) {
                sendLog(`❌ Không đọc được trang kết quả: ${e.message}`, 'error');
                continue;
            }
            if (!result || !result.success) {
                sendLog(`❌ Lỗi gom bài: ${(result && result.error) || 'không có phản hồi'}`, 'error');
                continue;
            }

            const posts = result.data || [];
            totalFound += posts.length;
            sendProgress({ keywordIndex: i, totalKeywords: keywords.length, keyword, found: totalFound });
            sendLog(`🔎 Tìm thấy ${posts.length} bài cho "${keyword}"${result.fromDom ? ` (${result.fromDom} bài lấy từ giao diện, thiếu số tương tác)` : ''}.`);
            if (posts.length === 0) continue;

            try {
                const saved = await pushToBackend(apiBase, {
                    posts,
                    keyword,
                    id_member: config.idMember || null,
                    post_limit: postLimit,
                    max_age_days: maxAgeDays,
                    extension_version: 'Threads-API-1.0',
                });
                totalSaved += saved.count || 0;
                const notes = [];
                if (saved.skipped_existing) notes.push(`${saved.skipped_existing} bài đã có`);
                if (saved.skipped_old) notes.push(`${saved.skipped_old} bài quá cũ`);
                sendLog(`💾 Đã lưu ${saved.count || 0} bài mới cho "${keyword}"${notes.length ? ` (bỏ qua ${notes.join(', ')})` : ''}.`, 'success');
                broadcastToTabs({ action: 'THREADS_FRONTEND_SAVED', keyword, count: saved.count || 0 });
            } catch (e) {
                sendLog(`❌ Lỗi lưu backend cho "${keyword}": ${e.message}`, 'error');
            }

            await sleep(1500);
        }

        sendLog(shouldStop ? `⏹ Đã dừng. Tổng đã lưu: ${totalSaved} bài.` : `🏁 Hoàn tất! Tổng đã lưu: ${totalSaved} bài mới.`, 'success');
    } catch (e) {
        sendLog(`❌ Lỗi nghiêm trọng: ${e.message}`, 'error');
    } finally {
        clearInterval(keepAlive);
        isRunning = false;
        const tabId = currentTabId;
        currentTabId = null;
        if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
        broadcastToTabs({ action: 'THREADS_FRONTEND_DONE', totalSaved, totalFound, stopped: shouldStop });
    }
}
