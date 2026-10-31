// platforms/threads/crawl-sniffer.js - chạy trong MAIN world của trang Threads (document_start)
// Bắt 2 luồng:
// 1. Cào bài: GraphQL query có "taken_at" -> chuyển sang platforms/threads/crawl.js.
// 2. Bình luận: POST /api/v1/media/configure_text_only_post/ (bóc tách từ comment_thread.json)
//    -> Dispatch CustomEvent "markee-action-captured" kèm commentId, linkComment, authorName, content, fbUid
//    để platforms/threads/content.js (ISOLATED world) ghi nhận KPI và minh chứng cho cả Tương tác nội bộ & Seeding ngoài.
(function () {
    if (window.__mkThreadsCrawlSnifferInstalled) return;
    window.__mkThreadsCrawlSnifferInstalled = true;

    const SOURCE = 'mk-threads-crawl-sniffer';

    function isWatched(url) {
        if (typeof url !== 'string') return false;
        return url.indexOf('graphql') !== -1 || url.indexOf('configure_text_only_post') !== -1;
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

    function handleCommentResponse(text) {
        if (typeof text !== 'string') return;
        try {
            const data = JSON.parse(text);
            if (data && data.status === 'ok' && data.media) {
                const media = data.media;
                const captionObj = media.caption || {};
                const userObj = media.user || {};
                const textPostInfo = media.text_post_app_info || {};
                const rootPost = textPostInfo.root_post || {};

                // Trích xuất commentId dạng số thực tế (numeric pk hoặc id)
                const commentId = String(media.pk || media.id || media.code || '');
                // Link comment trực tiếp (permalink: https://www.threads.com/@username/post/code)
                const permalink = media.permalink || (userObj.username && media.code ? `https://www.threads.com/@${userObj.username}/post/${media.code}` : window.location.href);
                const content = captionObj.text || (textPostInfo.text_fragments && textPostInfo.text_fragments.fragments ? textPostInfo.text_fragments.fragments.map(f => f.plaintext || '').join('') : '');
                const authorName = userObj.full_name || userObj.username || '';
                const profileId = String(userObj.pk || userObj.id || '');
                const rootPostId = String(rootPost.pk || '');

                const actionDetail = {
                    actionType: 'comment',
                    platform: 'threads',
                    commentId: commentId,
                    linkComment: permalink,
                    postUrl: window.location.href,
                    rootPostId: rootPostId,
                    content: content,
                    authorName: authorName,
                    fbUid: profileId,
                    timestamp: Date.now(),
                };

                console.log('[Threads-Sniffer] Bắt thành công COMMENT Threads (configure_text_only_post):', actionDetail);

                // 1. Dispatch CustomEvent cho platforms/threads/content.js (ISOLATED world)
                document.dispatchEvent(new CustomEvent('markee-action-captured', { detail: actionDetail }));

                // 2. Dispatch window.postMessage cho các listener khác
                window.postMessage({ source: 'mk-threads-comment-captured', detail: actionDetail }, '*');
            }
        } catch (e) {
            console.error('[Threads-Sniffer] Lỗi phân tích comment response:', e);
        }
    }

    function forward(text, name) {
        if (typeof text !== 'string') return;
        if (text.indexOf('"taken_at"') === -1) return;
        try {
            window.postMessage({ source: SOURCE, text: text, name: name || '' }, '*');
        } catch (e) {}
    }

    function processResponse(url, text, name) {
        if (!text || typeof text !== 'string') return;
        if (url.indexOf('configure_text_only_post') !== -1) {
            handleCommentResponse(text);
        } else if (url.indexOf('graphql') !== -1) {
            forward(text, name);
        }
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
                        res.clone().text().then(function (t) { processResponse(url, t, name); }).catch(function () {});
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
                const url = this.__mkThUrl;
                this.addEventListener('load', function () {
                    try {
                        if (this.responseType === '' || this.responseType === 'text') {
                            processResponse(url, this.responseText, name);
                        } else if (this.responseType === 'json' && this.response) {
                            processResponse(url, JSON.stringify(this.response), name);
                        }
                    } catch (e) {}
                });
            }
        } catch (e) {}
        return originalSend.apply(this, arguments);
    };
})();
