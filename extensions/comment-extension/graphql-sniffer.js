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

                // 1. ƯU TIÊN SỐ 1: BẮT BÌNH LUẬN THỦ CÔNG (bắt qua json.data.comment_create)
                if (responseData && responseData.data && responseData.data.comment_create) {
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
                    console.log("[GraphQL-Sniffer] Bắt thành công COMMENT:", { linkComment, commentId, authorName, content });
                }

                // 2. ƯU TIÊN SỐ 2: BẮT THAO TÁC THÍCH / THẢ TIM (feedback_react / feedback_reaction)
                if (!actionType && responseData && responseData.data) {
                    const fbReact = responseData.data.feedback_react || responseData.data.feedback_reaction;
                    if (fbReact) {
                        const reactionInfo = fbReact.viewer_feedback_reaction_info || (fbReact.feedback && fbReact.feedback.viewer_feedback_reaction_info);
                        // CHỈ GHI NHẬN KHI THỰC SỰ LIKE / THẢ TIM (reactionInfo != null)
                        // Khi người dùng bấm xóa like (unlike), reactionInfo là null -> BỎ QUA KHÔNG TÍNH KPI!
                        if (reactionInfo) {
                            actionType = "like";
                            fbUid = (fbReact.viewer_actor && fbReact.viewer_actor.id)
                                || (fbReact.feedback && fbReact.feedback.viewer_actor && fbReact.feedback.viewer_actor.id)
                                || (fbReact.actor_provider && fbReact.actor_provider.current_actor && fbReact.actor_provider.current_actor.id)
                                || "unknown";
                            authorName = (fbReact.viewer_actor && fbReact.viewer_actor.name)
                                || (fbReact.actor_provider && fbReact.actor_provider.current_actor && fbReact.actor_provider.current_actor.name)
                                || "";
                            postUrl = (fbReact.feedback && fbReact.feedback.url) || window.location.href;
                            reactionId = String(reactionInfo.id || reactionInfo.key || reactionInfo.reaction_type || "1");
                            console.log("[GraphQL-Sniffer] Bắt thành công LIKE/REACTION:", { reactionId, authorName, fbUid });
                        } else {
                            console.log("[GraphQL-Sniffer] Người dùng BỎ THÍCH (Unlike), bỏ qua không tính KPI.");
                        }
                    }
                }

                // 3. ƯU TIÊN SỐ 3: BẮT THAO TÁC CHIA SẺ THẬT (story_create / share_create / reels_share_create)
                // LƯU Ý BẢO MẬT: TUYỆT ĐỐI KHÔNG bắt xfb_fb_shorts_seen_state_mutation (đó chỉ là xem video 3s, không phải Share!)
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
                        console.log("[GraphQL-Sniffer] Bắt thành công SHARE:", { postUrl, authorName, fbUid });
                    }
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


    // ==========================================
    // BÓC TÁCH BÀI VIẾT LINKEDIN VOYAGER GRAPHQL
    // ==========================================
    function tryCaptureLinkedIn(url, responseData) {
        if (!responseData || !url) return;
        if (url.includes("voyagerFeedDashGroupsUpdates") || url.includes("voyagerFeedDashUpdates")) {
            try {
                const included = responseData.included || [];
                if (!included.length) return;

                const entityMap = new Map();
                included.forEach(function (item) {
                    if (item && item.entityUrn) entityMap.set(item.entityUrn, item);
                });

                const updates = included.filter(function (item) {
                    return item && item.$type === "com.linkedin.voyager.dash.feed.Update";
                });
                if (!updates.length) return;

                const groupUrl = window.location.href.split("?")[0];
                const groupName = document.title ? document.title.split("|")[0].trim() : "";

                const posts = [];
                for (let i = 0; i < updates.length; i++) {
                    const upd = updates[i];
                    const backendUrn = (upd.metadata && upd.metadata.backendUrn) || "";
                    let activityUrn = backendUrn;
                    if (!activityUrn && upd.entityUrn && upd.entityUrn.includes("urn:li:activity:")) {
                        const m = upd.entityUrn.match(/urn:li:activity:\d+/);
                        if (m) activityUrn = m[0];
                    }
                    const postUrl = activityUrn ? `https://www.linkedin.com/feed/update/${activityUrn}/` : "";
                    const content = (upd.commentary && upd.commentary.text && upd.commentary.text.text) || "";
                    const author = (upd.actor && upd.actor.name && upd.actor.name.text) || "";
                    const authorHeadline = (upd.actor && upd.actor.description && upd.actor.description.text) || "";
                    const authorUrl = (upd.actor && upd.actor.navigationContext && upd.actor.navigationContext.actionTarget) || "";
                    const postedAtRaw = (upd.actor && upd.actor.subDescription && upd.actor.subDescription.text) || "";

                    let likes = 0, comments = 0, reposts = 0;
                    const socialDetailUrn = upd["*socialDetail"];
                    if (socialDetailUrn && entityMap.has(socialDetailUrn)) {
                        const sd = entityMap.get(socialDetailUrn);
                        const countsUrn = sd["*totalSocialActivityCounts"];
                        if (countsUrn && entityMap.has(countsUrn)) {
                            const counts = entityMap.get(countsUrn);
                            likes = counts.numLikes || 0;
                            comments = counts.numComments || 0;
                            reposts = counts.numShares || 0;
                        }
                    }

                    if (postUrl && (content || author)) {
                        posts.push({
                            post_url: postUrl,
                            author: author,
                            author_headline: authorHeadline,
                            author_url: authorUrl,
                            content: content,
                            posted_at_raw: postedAtRaw,
                            likes: likes,
                            comments: comments,
                            reposts: reposts,
                            comments_list: [],
                            likers: [],
                            group_url: groupUrl,
                            group_name: groupName,
                            crawled_at: new Date().toISOString(),
                        });
                    }
                }

                if (posts.length > 0) {
                    console.log(`[GraphQL-Sniffer] Bắt thành công ${posts.length} bài viết LinkedIn từ Voyager API.`);
                    document.dispatchEvent(new CustomEvent("li-feed-updates-captured", {
                        detail: { posts: posts, timestamp: Date.now() }
                    }));
                    window.postMessage({
                        source: "MK_GRAPHQL_SNIFFER",
                        type: "LINKEDIN_FEED_EXTRACTED",
                        posts: posts
                    }, "*");
                }
            } catch (e) {
                console.error("[GraphQL-Sniffer] Lỗi bóc tách LinkedIn updates:", e);
            }
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
            } else if (url && url.includes("/voyager/api/graphql")) {
                response.clone().json().then(function(data) {
                    tryCaptureLinkedIn(url, data);
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
            } else if (url && url.includes("/voyager/api/graphql")) {
                this.addEventListener("load", function () {
                    try {
                        const data = JSON.parse(this.responseText);
                        tryCaptureLinkedIn(url, data);
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
