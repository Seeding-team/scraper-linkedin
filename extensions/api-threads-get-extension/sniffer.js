// Chạy trong MAIN world của trang Threads (document_start) để bắt response GraphQL mà
// chính JS của Threads gọi khi cuộn trang kết quả tìm kiếm (trang đầu nằm sẵn trong
// JSON nhúng của HTML, các trang sau mới tải qua /graphql). Chỉ ĐỌC bản sao response
// (clone) rồi chuyển nguyên văn sang content.js (world cô lập) qua window.postMessage —
// không sửa request/response gốc, lỗi gì cũng nuốt để không làm hỏng trang Threads.
(function () {
    if (window.__markeeThreadsSnifferInstalled) return;
    window.__markeeThreadsSnifferInstalled = true;

    const SOURCE = 'markee-threads-sniffer';

    function isWatched(url) {
        return typeof url === 'string' && url.indexOf('graphql') !== -1;
    }

    function forward(text) {
        // Chỉ chuyển response có dấu hiệu chứa bài viết (taken_at) — bỏ qua hàng trăm
        // request GraphQL khác (thông báo, gợi ý follow...).
        if (typeof text !== 'string' || text.indexOf('"taken_at"') === -1) return;
        try {
            window.postMessage({ source: SOURCE, text: text }, window.location.origin);
        } catch (e) {}
    }

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        const promise = originalFetch.apply(this, arguments);
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (isWatched(url)) {
                promise.then(function (res) {
                    try {
                        res.clone().text().then(forward).catch(function () {});
                    } catch (e) {}
                }).catch(function () {});
            }
        } catch (e) {}
        return promise;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        try {
            if (isWatched(String(url))) {
                this.addEventListener('load', function () {
                    try {
                        if (this.responseType === '' || this.responseType === 'text') {
                            forward(this.responseText);
                        }
                    } catch (e) {}
                });
            }
        } catch (e) {}
        return originalOpen.apply(this, arguments);
    };
})();
