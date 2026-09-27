const statusDiv = document.getElementById('status');
const btnStop = document.getElementById('btnStop');
const logPanel = document.getElementById('logPanel');

function addLog(msg) {
    const time = new Date().toLocaleTimeString('vi-VN');
    logPanel.textContent += `[${time}] ${msg}\n`;
    logPanel.scrollTop = logPanel.scrollHeight;
}

function refreshStatus() {
    chrome.runtime.sendMessage({ action: 'THREADS_GET_STATUS' }, (res) => {
        const running = !chrome.runtime.lastError && res && res.isRunning;
        statusDiv.textContent = running ? '⏳ Đang cào Threads...' : '✅ Sẵn sàng chờ lệnh từ web Markee';
        btnStop.disabled = !running;
    });
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'THREADS_POPUP_LOG') {
        addLog(msg.message);
        refreshStatus();
    }
});

btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'THREADS_STOP_CRAWL' }, () => {
        void chrome.runtime.lastError;
        addLog('Đã gửi lệnh dừng.');
        refreshStatus();
    });
});

refreshStatus();
