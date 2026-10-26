// platforms/threads/crawl-sniffer.js - chạy trong MAIN world của trang Threads (document_start) để bắt response GraphQL mà
// chính JS của Threads gọi khi cuộn trang (trang đầu nằm sẵn trong JSON nhúng của HTML,
// các trang sau mới tải qua /graphql/query hoặc /api/graphql - CHỈ khi đã đăng nhập; chưa
// đăng nhập thì Threads không phân trang, không có request nào chứa bài).
// Cùng khuôn với graphql-sniffer.js (Facebook/LinkedIn): patch fetch + XHR, ghi lại tên
// query (x-fb-friendly-name / fb_api_req_friendly_name) để log biết bài đến từ API nào.
// Chỉ ĐỌC bản sao response (clone) rồi chuyển nguyên văn sang platforms/threads/crawl.js
// (world cô lập) qua window.postMessage (structured clone - an toàn hơn CustomEvent.detail
// khi đi qua ranh giới world) — không sửa request/response gốc, lỗi gì cũng nuốt để
// không làm hỏng trang Threads. Phần "dịch ngược" ra bài viết nằm ở crawl.js.
(function () {
    if (window.__mkThreadsCrawlSnifferInstalled) return;
    window.__mkThreadsCrawlSnifferInstalled = true;

    const SOURCE = 'mk-threads-crawl-sniffer';

    function isWatched(url) {
        return typeof url === 'string' && url.indexOf('graphql') !== -1;
    }

    function nameFromBody(body) {
        try {
            if (typeof body === 'string') {
                const m = body.match(/(?:^|&)fb_api_req_friendly_name=([^&]+)/);
                return m ? decodeURIComponent(m[1]) : '';
            }
            if (body && typeof body.get === 'function') {
                return String(body.get('fb_api_req_friendly_name') || '');
            }
        } catch (e) {}
        return '';
    }

    function nameFromHeaders(headers) {
        try {
            if (!headers) return '';
            if (typeof headers.get === 'function') return headers.get('x-fb-friendly-name') || '';
            return headers['x-fb-friendly-name'] || headers['X-FB-Friendly-Name'] || '';
        } catch (e) {
            return '';
        }
    }

    function forward(text, name) {
        // Chỉ chuyển response có dấu hiệu chứa bài viết (taken_at) — bỏ qua hàng trăm
        // request GraphQL khác (thông báo, gợi ý follow, experiment...).
        if (typeof text !== 'string' || text.indexOf('"taken_at"') === -1) return;
        try {
            window.postMessage({ source: SOURCE, text: text, name: name || '' }, window.location.origin);
        } catch (e) {}
    }

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        const promise = originalFetch.apply(this, arguments);
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (isWatched(url)) {
                const name = nameFromHeaders(init && init.headers) || nameFromHeaders(input && input.headers) || nameFromBody(init && init.body);
                promise.then(function (res) {
                    try {
                        res.clone().text().then(function (t) { forward(t, name); }).catch(function () {});
                    } catch (e) {}
                }).catch(function () {});
            }
        } catch (e) {}
        return promise;
    };

    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSetHeader = XHR.setRequestHeader;
    const originalSend = XHR.send;

    XHR.open = function (method, url) {
        try {
            this.__mkThUrl = String(url);
            this.__mkThName = '';
        } catch (e) {}
        return originalOpen.apply(this, arguments);
    };

    XHR.setRequestHeader = function (key, value) {
        try {
            if (String(key).toLowerCase() === 'x-fb-friendly-name') this.__mkThName = String(value);
        } catch (e) {}
        return originalSetHeader.apply(this, arguments);
    };

    XHR.send = function (body) {
        try {
            if (isWatched(this.__mkThUrl)) {
                const name = this.__mkThName || nameFromBody(body);
                this.addEventListener('load', function () {
                    try {
                        if (this.responseType === '' || this.responseType === 'text') {
                            forward(this.responseText, name);
                        } else if (this.responseType === 'json' && this.response) {
                            forward(JSON.stringify(this.response), name);
                        }
                    } catch (e) {}
                });
            }
        } catch (e) {}
        return originalSend.apply(this, arguments);
    };
})();
