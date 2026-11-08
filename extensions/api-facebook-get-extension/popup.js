// ── FB API Auto Crawler Popup Script ─────────────────────────────────────────

const btnAutoStart = document.getElementById('btnAutoStart');
const btnAutoStop = document.getElementById('btnAutoStop');
const statusDiv = document.getElementById('status');
const logPanel = document.getElementById('logPanel');

// Live Auto-Scroll Elements
const btnLiveStart = document.getElementById('btnLiveStart');
const btnLiveStop = document.getElementById('btnLiveStop');
const scoreThresholdInput = document.getElementById('scoreThreshold');
const liveScannedEl = document.getElementById('liveScanned');
const liveHighScoreEl = document.getElementById('liveHighScore');
const liveStatusDiv = document.getElementById('liveStatus');

// Settings Elements
const cfgScrollDistance = document.getElementById('cfgScrollDistance');
const cfgDelayMin = document.getElementById('cfgDelayMin');
const cfgDelayMax = document.getElementById('cfgDelayMax');
const cfgGroupRestSec = document.getElementById('cfgGroupRestSec');
const cfgMaxScrolls = document.getElementById('cfgMaxScrolls');
const cfgOldPostsLimit = document.getElementById('cfgOldPostsLimit');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const saveSettingsMsg = document.getElementById('saveSettingsMsg');

// Tab Switching
document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = document.getElementById(btn.dataset.tab);
        if (targetTab) targetTab.classList.add('active');
    });
});

// DEFAULT SETTINGS CHUẨN AN TOÀN CHỐNG CHECKPOINT
const DEFAULT_USER_CONFIG = {
    scroll_distance: 1600,
    delay_min: 1500,
    delay_max: 2800,
    group_rest_sec: 45,
    max_scrolls: 25,
    old_posts_limit: 15 // Lệnh Master: 15 bài cũ thì dừng nhóm
};

// Tải cấu hình cá nhân từ storage
function loadUserSettings() {
    chrome.storage.local.get(['fb_crawler_user_config'], (res) => {
        const cfg = { ...DEFAULT_USER_CONFIG, ...(res.fb_crawler_user_config || {}) };
        if (cfgScrollDistance) cfgScrollDistance.value = cfg.scroll_distance;
        if (cfgDelayMin) cfgDelayMin.value = cfg.delay_min;
        if (cfgDelayMax) cfgDelayMax.value = cfg.delay_max;
        if (cfgGroupRestSec) cfgGroupRestSec.value = cfg.group_rest_sec;
        if (cfgMaxScrolls) cfgMaxScrolls.value = cfg.max_scrolls;
        if (cfgOldPostsLimit) cfgOldPostsLimit.value = cfg.old_posts_limit;
    });
}
loadUserSettings();

// Lưu cấu hình cá nhân
if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
        const newCfg = {
            scroll_distance: parseInt(cfgScrollDistance.value, 10) || 1600,
            delay_min: parseInt(cfgDelayMin.value, 10) || 1500,
            delay_max: parseInt(cfgDelayMax.value, 10) || 2800,
            group_rest_sec: parseInt(cfgGroupRestSec.value, 10) || 45,
            max_scrolls: parseInt(cfgMaxScrolls.value, 10) || 25,
            old_posts_limit: parseInt(cfgOldPostsLimit.value, 10) || 15
        };

        chrome.storage.local.set({ fb_crawler_user_config: newCfg }, () => {
            if (saveSettingsMsg) {
                saveSettingsMsg.textContent = "✓ Đã lưu cấu hình cá nhân thành công!";
                setTimeout(() => { saveSettingsMsg.textContent = ""; }, 2500);
            }
            // Thông báo cho content script và background script
            chrome.runtime.sendMessage({ action: 'USER_CONFIG_UPDATED', config: newCfg });
        });
    });
}

function addLog(msg) {
    if (!logPanel) return;
    const time = new Date().toLocaleTimeString('vi-VN');
    logPanel.textContent += `[${time}] ${msg}\n`;
    logPanel.scrollTop = logPanel.scrollHeight;
}

// Lắng nghe log từ background.js và content.js
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'LOG') {
        addLog(msg.message);
    }
});

// ── 1. ĐIỀU KHIỂN LIVE AUTO-SCROLL TRÊN TAB HIỆN TẠI ────────────────────────
async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}

async function syncLiveStatus() {
    try {
        const tab = await getActiveTab();
        if (!tab || !tab.id || !tab.url || !tab.url.includes("facebook.com")) {
            if (liveStatusDiv) liveStatusDiv.textContent = "Hãy mở trang Group Facebook để kích hoạt cào!";
            if (btnLiveStart) btnLiveStart.disabled = true;
            return;
        }

        if (btnLiveStart) btnLiveStart.disabled = false;
        chrome.tabs.sendMessage(tab.id, { action: "GET_AUTO_SCROLL_STATUS" }, (res) => {
            if (chrome.runtime.lastError || !res) return;
            if (liveScannedEl) liveScannedEl.textContent = res.scannedCount || 0;
            if (liveHighScoreEl) liveHighScoreEl.textContent = (res.scoredPosts || []).length;
            if (res.threshold && scoreThresholdInput) scoreThresholdInput.value = res.threshold;

            if (res.isScrolling) {
                if (liveStatusDiv) liveStatusDiv.textContent = "🟢 Đang cuộn tự động và lọc bài...";
                if (btnLiveStart) btnLiveStart.disabled = true;
                if (btnLiveStop) btnLiveStop.disabled = false;
            } else {
                if (liveStatusDiv) {
                    liveStatusDiv.textContent = (res.scoredPosts && res.scoredPosts.length > 0)
                        ? `Đã lọc được ${res.scoredPosts.length} bài ≥ ${res.threshold || 80}đ.`
                        : "Sẵn sàng khởi động.";
                }
                if (btnLiveStart) btnLiveStart.disabled = false;
                if (btnLiveStop) btnLiveStop.disabled = true;
            }
        });
    } catch (e) {}
}

syncLiveStatus();
const statusInterval = setInterval(syncLiveStatus, 1500);
window.addEventListener("unload", () => clearInterval(statusInterval));

if (btnLiveStart) {
    btnLiveStart.addEventListener("click", async () => {
        const tab = await getActiveTab();
        if (!tab || !tab.id) return;
        const threshold = parseInt(scoreThresholdInput.value, 10) || 80;

        btnLiveStart.disabled = true;
        btnLiveStop.disabled = false;
        if (liveStatusDiv) liveStatusDiv.textContent = "Đang kích hoạt Auto-Scroll...";

        chrome.tabs.sendMessage(tab.id, { action: "START_AUTO_SCROLL_AI", threshold }, (res) => {
            if (chrome.runtime.lastError) {
                if (liveStatusDiv) liveStatusDiv.textContent = "Vui lòng F5 lại trang Facebook trước khi bắt đầu!";
                btnLiveStart.disabled = false;
                btnLiveStop.disabled = true;
                return;
            }
            if (liveStatusDiv) liveStatusDiv.textContent = "🟢 Đang cuộn tự động & bắt bài...";
        });
    });
}

if (btnLiveStop) {
    btnLiveStop.addEventListener("click", async () => {
        const tab = await getActiveTab();
        if (!tab || !tab.id) return;

        chrome.tabs.sendMessage(tab.id, { action: "STOP_AUTO_SCROLL_AI" }, () => {
            if (btnLiveStart) btnLiveStart.disabled = false;
            if (btnLiveStop) btnLiveStop.disabled = true;
            if (liveStatusDiv) liveStatusDiv.textContent = "⏸ Đã tạm dừng.";
        });
    });
}

// ── 2. ĐIỀU KHIỂN CÀO ĐA NHÓM TỰ ĐỘNG (MULTI-GROUPS) ────────────────────────
if (btnAutoStart) {
    btnAutoStart.addEventListener('click', () => {
        btnAutoStart.disabled = true;
        btnAutoStop.disabled = false;
        if (statusDiv) statusDiv.textContent = '🚀 Bắt đầu chiến dịch cào đa nhóm...';
        addLog('Đang yêu cầu Background lấy danh sách nhóm và bắt đầu cào...');
        chrome.runtime.sendMessage({ action: 'START_AUTO_CRAWL' });
    });
}

if (btnAutoStop) {
    btnAutoStop.addEventListener('click', () => {
        btnAutoStart.disabled = false;
        btnAutoStop.disabled = true;
        if (statusDiv) statusDiv.textContent = '🛑 Đang dừng cào...';
        addLog('Đã gửi yêu cầu dừng.');
        chrome.runtime.sendMessage({ action: 'STOP_AUTO_CRAWL' });
    });
}

// Kiểm tra trạng thái cào đa nhóm khi mở popup
chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (res && res.isRunning) {
        if (btnAutoStart) btnAutoStart.disabled = true;
        if (btnAutoStop) btnAutoStop.disabled = false;
        if (statusDiv) statusDiv.textContent = `🟢 Đang chạy... (Đang cào: ${res.currentGroup || 'N/A'})`;
    }
});
