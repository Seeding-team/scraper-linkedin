// messenger-sync.js - Đồng bộ tin nhắn Messenger về Hộp thư Messenger trên Seeding.
// Chat 1-1 giờ mặc định E2EE: nội dung chỉ được giải mã trong trình duyệt, nên đọc tin cuối của
// từng cuộc chat từ danh sách chat (cột trái) trên facebook.com/messages rồi gửi về backend.
// shortcut: chỉ thấy tin CUỐI của mỗi cuộc chat ở mỗi lần quét (3s) - nhiều tin dồn dập chỉ lấy tin sau cùng.
(function () {
    if (window.__mkMessengerSyncInstalled) return;
    window.__mkMessengerSyncInstalled = true;

    const SELF_PREFIXES = ['Bạn: ', 'You: '];
    const lastSent = {}; // thread_id -> snippet đã gửi trong tab này

    function readRows() {
        const rows = [];
        document.querySelectorAll('[role="grid"] a[href*="/messages/"]').forEach((a) => {
            const m = (a.getAttribute('href') || '').match(/\/messages\/(?:e2ee\/)?t\/(\d+)/);
            if (!m) return;
            // Bố cục 1 dòng: [trạng thái online?] [tên] [tin cuối] [·] [thời gian]
            const texts = [...a.querySelectorAll('span')]
                .filter((s) => !s.querySelector('span'))
                .map((s) => (s.innerText || '').trim())
                .filter((t) => t && t !== '·');
            if (texts.length < 3) return;
            let snippet = texts[texts.length - 2];
            const name = texts[texts.length - 3];
            const prefix = SELF_PREFIXES.find((p) => snippet.startsWith(p));
            if (prefix) snippet = snippet.slice(prefix.length);
            rows.push({ thread_id: m[1], peer_name: name, content: snippet, is_self: !!prefix });
        });
        return rows;
    }

    function scan() {
        if (!location.pathname.startsWith('/messages')) return;
        let alive = false;
        try { alive = !!chrome.runtime?.id; } catch (e) {}
        if (!alive) return;
        for (const row of readRows()) {
            const key = (row.is_self ? '1|' : '0|') + row.content;
            if (lastSent[row.thread_id] === key) continue;
            lastSent[row.thread_id] = key;
            try { chrome.runtime.sendMessage({ action: 'MESSENGER_SYNC', row }); } catch (e) {}
        }
    }

    setInterval(scan, 3000);
})();
