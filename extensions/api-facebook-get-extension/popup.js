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

function addLog(msg) {
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

// ── 1. ĐIỀU KHIỂN LIVE AUTO-SCROLL & AI LỌC BÀI >= 80đ ──────────────────────
async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}

async function syncLiveStatus() {
    try {
        const tab = await getActiveTab();
        if (!tab || !tab.id || !tab.url || !tab.url.includes("facebook.com")) {
            liveStatusDiv.textContent = "Hãy mở trang Group Facebook để sử dụng tính năng này!";
            btnLiveStart.disabled = true;
            return;
        }

        btnLiveStart.disabled = false;
        chrome.tabs.sendMessage(tab.id, { action: "GET_AUTO_SCROLL_STATUS" }, (res) => {
            if (chrome.runtime.lastError || !res) return;
            liveScannedEl.textContent = res.scannedCount || 0;
            liveHighScoreEl.textContent = (res.scoredPosts || []).length;
            if (res.threshold) scoreThresholdInput.value = res.threshold;

            if (res.isScrolling) {
                liveStatusDiv.textContent = "🟢 Đang cuộn tự động và lọc bài...";
                btnLiveStart.disabled = true;
                btnLiveStop.disabled = false;
            } else {
                liveStatusDiv.textContent = (res.scoredPosts && res.scoredPosts.length > 0)
                    ? `Đã lọc được ${res.scoredPosts.length} bài ≥ ${res.threshold || 80}đ.`
                    : "Sẵn sàng khởi động.";
                btnLiveStart.disabled = false;
                btnLiveStop.disabled = true;
            }
        });
    } catch (e) {}
}

// Đồng bộ trạng thái mỗi giây khi popup mở
syncLiveStatus();
const statusInterval = setInterval(syncLiveStatus, 1500);
window.addEventListener("unload", () => clearInterval(statusInterval));

btnLiveStart.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    const threshold = parseInt(scoreThresholdInput.value, 10) || 80;

    btnLiveStart.disabled = true;
    btnLiveStop.disabled = false;
    liveStatusDiv.textContent = "Đang kích hoạt Auto-Scroll...";

    chrome.tabs.sendMessage(tab.id, { action: "START_AUTO_SCROLL_AI", threshold }, (res) => {
        if (chrome.runtime.lastError) {
            liveStatusDiv.textContent = "Vui lòng F5 lại trang Facebook trước khi bắt đầu!";
            btnLiveStart.disabled = false;
            btnLiveStop.disabled = true;
            return;
        }
        liveStatusDiv.textContent = "🟢 Đang cuộn tự động & bắt bài...";
    });
});

btnLiveStop.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    chrome.tabs.sendMessage(tab.id, { action: "STOP_AUTO_SCROLL_AI" }, () => {
        btnLiveStart.disabled = false;
        btnLiveStop.disabled = true;
        liveStatusDiv.textContent = "⏸ Đã tạm dừng.";
    });
});


// ── 2. ĐIỀU KHIỂN CÀO ĐA NHÓM THEO LỊCH TRÌNH ──────────────────────────────
btnAutoStart.addEventListener('click', async () => {
    btnAutoStart.disabled = true;
    btnAutoStop.disabled = false;
    statusDiv.textContent = "Đang lấy danh sách Group từ Backend...";
    logPanel.textContent = '';
    addLog("Đang gọi API lấy danh sách Group...");

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs[0]?.url || '';
        const knownHosts = ['seeding.markeeai.com', 'zenithglobal.dev', 'localhost', '127.0.0.1'];
        let API_BASE = null;
        if (knownHosts.find(h => currentUrl.includes(h))) {
            try { API_BASE = new URL(currentUrl).origin; } catch (_) {}
        }

        if (!API_BASE) {
            const { api_base_url } = await chrome.storage.local.get('api_base_url');
            API_BASE = api_base_url || 'https://dev.seeding.markeeai.com';
        }

        addLog(`🌐 Backend: ${API_BASE}`);

        const response = await fetch(`${API_BASE}/api/all-platform/facebook/groups?for_extension=true`, {
            credentials: 'include',
        });
        if (!response.ok) throw new Error("Backend không phản hồi danh sách group.");
        
        const data = await response.json();
        const groups = data.data || [];
        
        if (groups.length === 0) {
            addLog("❌ Không có group nào cần cào từ Backend.");
            statusDiv.textContent = "Sẵn sàng chờ lệnh...";
            btnAutoStart.disabled = false;
            btnAutoStop.disabled = true;
            return;
        }

        addLog(`✅ Đã lấy được ${groups.length} nhóm. Gửi lệnh cho Background để bắt đầu auto-crawl...`);
        statusDiv.textContent = `Đang tự động cào ${groups.length} nhóm...`;

        chrome.runtime.sendMessage({
            action: 'START_AUTO_CRAWL',
            groups: groups,
            config: { apiBase: API_BASE }
        });

    } catch (err) {
        addLog(`❌ Lỗi: ${err.message}`);
        statusDiv.textContent = "Lỗi. Vui lòng kiểm tra lại backend.";
        btnAutoStart.disabled = false;
        btnAutoStop.disabled = true;
    }
});

btnAutoStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP_AUTO_CRAWL' });
    btnAutoStart.disabled = false;
    btnAutoStop.disabled = true;
    statusDiv.textContent = "Đã dừng.";
    addLog("Đã yêu cầu dừng toàn bộ tiến trình.");
});
