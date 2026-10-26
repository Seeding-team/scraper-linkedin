// Chạy trong MAIN world của trang Facebook (không phải world cô lập của content script)
// để có thể patch window.fetch/XMLHttpRequest và bắt trực tiếp các request và response GraphQL thật
// mà chính JS của Facebook gửi và nhận. Nhờ vậy doc_id/variables luôn tự cập nhật đúng,
// đồng thời bắt được luồng dữ liệu bài viết và file phụ đề (.srt) thời gian thực khi cuộn trang.
(function () {
    if (window.__fbGraphqlSnifferInstalled) return;
    window.__fbGraphqlSnifferInstalled = true;

    // Danh sách các query danh sách bài viết Group cần theo dõi
    const WATCHED_QUERIES = new Set([
        "GroupsCometFeedRegularStoriesPaginationQuery",
        "GroupsFeedRootSuccessionQuery",
        "CometGroupFeedPaginationQuery",
        "GroupsCometFeedRegularStoriesRootSuccessionQuery",
    ]);

    function tryCaptureRequest(bodyText) {
        if (!bodyText || typeof bodyText !== "string") return null;
        try {
            const params = new URLSearchParams(bodyText);
            const friendlyName = params.get("fb_api_req_friendly_name");
            if (!friendlyName || !WATCHED_QUERIES.has(friendlyName)) return null;
            const docId = params.get("doc_id");
            const variablesRaw = params.get("variables");
            if (docId && variablesRaw) {
                document.dispatchEvent(new CustomEvent("fb-graphql-docid-captured", {
                    detail: { friendlyName, docId, variables: variablesRaw },
                }));
            }
            return friendlyName;
        } catch (e) {
            return null;
        }
    }

    function dispatchStreamPosts(friendlyName, text) {
        if (!text || typeof text !== "string") return;
        try {
            document.dispatchEvent(new CustomEvent("fb-stream-posts-response", {
                detail: { friendlyName, responseText: text, timestamp: Date.now() },
            }));
        } catch (e) {}
    }

    function dispatchStreamSrt(url, srtText) {
        if (!srtText || typeof srtText !== "string") return;
        try {
            document.dispatchEvent(new CustomEvent("fb-stream-srt-captured", {
                detail: { url, srtText, timestamp: Date.now() },
            }));
        } catch (e) {}
    }

    // ── 1. Intercept Fetch API ───────────────────────────────────────────
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
        let isGraphql = false;
        let isSrt = false;
        let friendlyName = null;
        let url = "";

        try {
            url = typeof input === "string" ? input : input?.url || "";
            if (url.includes(".srt") || (init && init.headers && JSON.stringify(init.headers).includes("text/srt"))) {
                isSrt = true;
            } else if (url.includes("/api/graphql/") && init && init.body) {
                isGraphql = true;
                friendlyName = tryCaptureRequest(init.body);
            }
        } catch (e) {}

        const response = await originalFetch.apply(this, arguments);

        try {
            if (isGraphql && friendlyName) {
                const clone = response.clone();
                clone.text().then((text) => {
                    if (text && (text.includes("group_feed") || text.includes("node") || text.includes("story") || text.includes("edges"))) {
                        dispatchStreamPosts(friendlyName, text);
                    }
                }).catch(() => {});
            } else if (isSrt || (response.headers && (response.headers.get("content-type") || "").includes("text/srt"))) {
                const clone = response.clone();
                clone.text().then((text) => {
                    if (text && text.length > 5) {
                        dispatchStreamSrt(url, text);
                    }
                }).catch(() => {});
            }
        } catch (e) {}

        return response;
    };

    // ── 2. Intercept XMLHttpRequest ──────────────────────────────────────
    const OriginalXHR = window.XMLHttpRequest;
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method, url) {
        this.__sniffUrl = url;
        return originalOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function (body) {
        try {
            const url = this.__sniffUrl || "";
            const isSrt = url.includes(".srt");
            let friendlyName = null;
            if (url.includes("/api/graphql/") && body) {
                friendlyName = tryCaptureRequest(body);
            }

            if (friendlyName) {
                this.addEventListener("load", function () {
                    try {
                        const text = this.responseText;
                        if (text && (text.includes("group_feed") || text.includes("node") || text.includes("story") || text.includes("edges"))) {
                            dispatchStreamPosts(friendlyName, text);
                        }
                    } catch (e) {}
                });
            } else if (isSrt) {
                this.addEventListener("load", function () {
                    try {
                        const text = this.responseText;
                        if (text && text.length > 5) {
                            dispatchStreamSrt(url, text);
                        }
                    } catch (e) {}
                });
            }
        } catch (e) {}

        return originalSend.apply(this, arguments);
    };
})();
