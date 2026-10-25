// Chạy trong MAIN world của trang Facebook (không phải world cô lập của content script)
// để có thể patch window.fetch/XMLHttpRequest và bắt trực tiếp response GraphQL thật.
// QUAN TRỌNG: MAIN world KHÔNG có quyền truy cập chrome.storage hay gọi API cross-origin
// bị giới hạn CORS. Thay vào đó, dispatch CustomEvent để content.js (ISOLATED world) xử lý.
(function () {
    if (window.__fbGraphqlSnifferInstalled) return;
    window.__fbGraphqlSnifferInstalled = true;

    // Dispatch CustomEvent để content.js (ISOLATED world) bắt và kiểm tra session / target_link
    // trước khi ghi nhận KPI và hiển thị Toast thông báo cho người dùng.
    function dispatchActionCaptured(actionData) {
        document.dispatchEvent(new CustomEvent("markee-action-captured", {
            detail: {
                actionType: actionData.actionType || "",
                fbUid: actionData.fbUid || "",
                authorName: actionData.authorName || "",
                postUrl: actionData.postUrl || window.location.href,
                linkComment: actionData.linkComment || "",
                commentId: actionData.commentId || "",
                reactionId: actionData.reactionId || "",
                delayMs: actionData.delayMs || 0,
                content: actionData.content || "",
            },
        }));
    }

    function tryCapture(bodyText, responseData) {
        let friendlyName = "";
        if (bodyText && typeof bodyText === "string") {
            try {
                const params = new URLSearchParams(bodyText);
                friendlyName = params.get("fb_api_req_friendly_name") || "";
                if (friendlyName === "useCometUFICreateCommentMutation") {
                    const docId = params.get("doc_id");
                    if (docId) {
                        document.dispatchEvent(new CustomEvent("fb-graphql-docid-captured", {
                            detail: { friendlyName, docId },
                        }));
                    }
                } else if (friendlyName === "GroupsCometFeedRegularStoriesPaginationQuery" || friendlyName === "GroupsFeedRootSuccessionQuery") {
                    // Luồng cào bài cần cả variables để dựng lại query.
                    const docId = params.get("doc_id");
                    const variables = params.get("variables");
                    if (docId && variables) {
                        document.dispatchEvent(new CustomEvent("fb-graphql-docid-captured", {
                            detail: { friendlyName, docId, variables },
                        }));
                    }
                }
            } catch (e) {}
        }

        if (responseData) {
            try {
                // Bắt stream bài viết group feed cho AI Lead Scorer
                if (responseData.data && (responseData.data.node?.group_feed || responseData.data.node || responseData.data.edges)) {
                    document.dispatchEvent(new CustomEvent("fb-stream-posts-response", {
                        detail: { friendlyName: friendlyName || "GroupsCometFeedRegularStoriesPaginationQuery", responseText: JSON.stringify(responseData), timestamp: Date.now() },
                    }));
                }

                let actionType = null;
                let postUrl = window.location.href;
                let fbUid = "unknown";
                let authorName = "";
                let linkComment = "";
                let commentId = "";
                let reactionId = "";
                let delayMs = 0;
                let content = "";

                // 1. NGHE HÀNH ĐỘNG LIKE (CometUFIFeedbackReactMutation / Reel Like)
                const fbReact = responseData && responseData.data && (responseData.data.feedback_react || responseData.data.feedback_reaction);
                if (fbReact) {
                    // CHỈ GHI NHẬN KHI THỰC SỰ LIKE / THẢ TIM (viewer_feedback_reaction_info != null)
                    // Khi người dùng bấm xóa like (unlike), viewer_feedback_reaction_info là null -> BỎ QUA KHÔNG TÍNH KPI!
                    if (fbReact.viewer_feedback_reaction_info && fbReact.viewer_feedback_reaction_info.id) {
                        actionType = "like";
                        fbUid = (fbReact.viewer_actor && fbReact.viewer_actor.id)
                            || (fbReact.feedback && fbReact.feedback.viewer_actor && fbReact.feedback.viewer_actor.id)
                            || "unknown";
                        authorName = (fbReact.viewer_actor && fbReact.viewer_actor.name) || "";
                        postUrl = (fbReact.feedback && fbReact.feedback.url) || window.location.href;
                        reactionId = fbReact.viewer_feedback_reaction_info.id;
                    }
                }

                // 2. NGHE HÀNH ĐỘNG SHARE (Bài viết thường - Kích hoạt ngay tức thì)
                if (!actionType && responseData && responseData.data) {
                    const shareResult =
                        (responseData.data.story_create && (responseData.data.story_create.story || responseData.data.story_create)) ||
                        (responseData.data.share_create && (responseData.data.share_create.story || responseData.data.share_create)) ||
                        (responseData.data.fb_shorts_story_create && (responseData.data.fb_shorts_story_create.story || responseData.data.fb_shorts_story_create)) ||
                        (responseData.data.fb_shorts_share_create && (responseData.data.fb_shorts_share_create.story || responseData.data.fb_shorts_share_create)) ||
                        (responseData.data.composer_story_create && (responseData.data.composer_story_create.story || responseData.data.composer_story_create)) ||
                        responseData.data.reels_share_create;

                    if (shareResult) {
                        actionType = "share";
                        const storyObj = shareResult.story || shareResult;
                        fbUid = (storyObj.default_actor && storyObj.default_actor.id)
                            || (storyObj.actor && storyObj.actor.id)
                            || (storyObj.owner && storyObj.owner.id)
                            || "unknown";
                        authorName = (storyObj.default_actor && storyObj.default_actor.name) || "";
                        postUrl = storyObj.url || storyObj.permalink_url || window.location.href;
                    }
                }

                // 3. NGHE HÀNH ĐỘNG SHARE REEL (Bắt qua xfb_fb_shorts_seen_state_mutation hoặc fb_shorts_seen_state_mutation)
                if (!actionType && responseData && responseData.data) {
                    const shortsMutation = responseData.data.xfb_fb_shorts_seen_state_mutation || responseData.data.fb_shorts_seen_state_mutation;
                    const actorId = shortsMutation && shortsMutation.viewer && shortsMutation.viewer.actor && shortsMutation.viewer.actor.id;

                    if (shortsMutation && actorId) {
                        actionType = "share";
                        fbUid = actorId;
                        delayMs = 3000;
                    }
                }

                // 4. NGHE HÀNH ĐỘNG COMMENT THỦ CÔNG (bắt qua json.data.comment_create)
                if (!actionType && responseData && responseData.data && responseData.data.comment_create) {
                    const commentCreate = responseData.data.comment_create;
                    const edgeNode = commentCreate.feedback_comment_edge && commentCreate.feedback_comment_edge.node;
                    actionType = "comment";
                    content = (edgeNode && edgeNode.body && edgeNode.body.text) || "";

                    fbUid = (edgeNode && edgeNode.author && edgeNode.author.id)
                        || (commentCreate.feedback && commentCreate.feedback.viewer_actor && commentCreate.feedback.viewer_actor.id)
                        || "unknown";

                    authorName = (edgeNode && edgeNode.author && edgeNode.author.name) || "";
                    commentId = (edgeNode && edgeNode.legacy_fbid) || (edgeNode && edgeNode.id) || "";
                    
                    // Link comment minh chứng trực tiếp (ví dụ: https://www.facebook.com/reel/29299018259785802/?comment_id=1096395736652564)
                    linkComment = (edgeNode && edgeNode.url) || "";
                    postUrl = (commentCreate.feedback && commentCreate.feedback.url) || window.location.href;
                }

                if (actionType) {
                    dispatchActionCaptured({
                        actionType,
                        fbUid,
                        authorName,
                        postUrl,
                        linkComment,
                        commentId,
                        reactionId,
                        delayMs,
                        content
                    });
                }
            } catch (e) {}
        }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
        const response = await originalFetch.apply(this, arguments);
        try {
            const url = typeof input === "string" ? input : (input && input.url);
            if (url && url.includes("/api/graphql/")) {
                if (init && init.body) tryCapture(init.body, null);
                response.clone().json().then(function(data) {
                    tryCapture(null, data);
                }).catch(function() {});
            } else if (url && url.includes(".srt")) {
                response.clone().text().then(function(srtText) {
                    if (srtText && srtText.length > 5) {
                        document.dispatchEvent(new CustomEvent("fb-stream-srt-captured", {
                            detail: { url, srtText, timestamp: Date.now() },
                        }));
                    }
                }).catch(function() {});
            }
        } catch (e) {}
        return response;
    };

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
            if (url && url.includes("/api/graphql/")) {
                tryCapture(body, null);
                this.addEventListener("load", function () {
                    try {
                        const data = JSON.parse(this.responseText);
                        tryCapture(null, data);
                    } catch (e) {}
                });
            } else if (url && url.includes(".srt")) {
                this.addEventListener("load", function () {
                    try {
                        const srtText = this.responseText;
                        if (srtText && srtText.length > 5) {
                            document.dispatchEvent(new CustomEvent("fb-stream-srt-captured", {
                                detail: { url, srtText, timestamp: Date.now() },
                            }));
                        }
                    } catch (e) {}
                });
            }
        } catch (e) {}
        return originalSend.apply(this, arguments);
    };
})();
