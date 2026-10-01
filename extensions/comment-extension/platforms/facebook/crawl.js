// Cào bài viết Group Facebook qua GraphQL API (port từ api-facebook-get-extension/content.js).
// Được background tiêm vào tab group bằng chrome.scripting.executeScript — KHÔNG khai báo
// trong manifest. Bọc IIFE vì chạy chung isolated world với content.js (luồng comment
// Facebook) — file đó cũng khai báo top-level FALLBACK_DOC_ID/CAPTURE_STORAGE_KEY/
// getTokensFromPage(); để lộ ra global sẽ SyntaxError "already declared" hoặc ghi đè
// getTokensFromPage() của luồng comment.
(function () {
    if (window.__mkFbCrawlInjected) return;
    window.__mkFbCrawlInjected = true;

    const FALLBACK_DOC_ID = "25454082720955898";
    const FALLBACK_VARIABLES = {
        feedLocation: "GROUP",
        feedType: "DISCUSSION",
        feedbackSource: 0,
        filterTopicId: null,
        focusCommentID: null,
        privacySelectorRenderLocation: "COMET_STREAM",
        referringStoryRenderLocation: null,
        renderLocation: "group",
        scale: 1.5,
        sortingSetting: "RECENT_ACTIVITY",
        useDefaultActor: false,
        __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
        __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
        __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
        __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
        __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
        __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
        __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
        __relay_internal__pv__IsWorkUserrelayprovider: false,
        __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
        __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
        __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
        __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
        __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
        __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
        __relay_internal__pv__IsMergQAPollsrelayprovider: false,
        __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
        __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
        __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: "AUTO_TRANSLATE",
        __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
        __relay_internal__pv__CometUFISingleLineUFIrelayprovider: false,
        __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
        __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
        __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
        __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
        __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
        __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
        __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: false,
    };
    const QUERY_NAME = "GroupsCometFeedRegularStoriesPaginationQuery";
    const CAPTURE_STORAGE_KEY = "fbGraphqlCapture_" + QUERY_NAME;
    const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

    let capturedQueryTemplate = null;

    chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
        const cached = result && result[CAPTURE_STORAGE_KEY];
        if (cached && Date.now() - cached.capturedAt < CAPTURE_MAX_AGE_MS) {
            capturedQueryTemplate = { docId: cached.docId, variables: cached.variables };
        }
    });

    // Event do graphql-sniffer.js (MAIN world) bắn ra — dùng chung tên event với luồng
    // comment nên BẮT BUỘC lọc đúng friendlyName và chỉ nhận khi có variables.
    document.addEventListener("fb-graphql-docid-captured", (evt) => {
        try {
            const { friendlyName, docId, variables } = evt.detail || {};
            if (friendlyName !== QUERY_NAME || !docId || !variables) return;
            const parsedVariables = JSON.parse(variables);
            capturedQueryTemplate = { docId, variables: parsedVariables };
            chrome.storage.local.set({
                [CAPTURE_STORAGE_KEY]: { docId, variables: parsedVariables, capturedAt: Date.now() },
            });
        } catch (e) {}
    });

    function nudgeFeedAndWaitForCapture(timeoutMs = 2500) {
        return new Promise((resolve) => {
            if (capturedQueryTemplate) return resolve();
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                document.removeEventListener("fb-graphql-docid-captured", onCapture);
                clearTimeout(timer);
                resolve();
            };
            const onCapture = () => finish();
            document.addEventListener("fb-graphql-docid-captured", onCapture);
            const timer = setTimeout(finish, timeoutMs);
            try {
                window.scrollBy(0, 1200);
                setTimeout(() => window.scrollBy(0, -400), 300);
            } catch (e) {}
        });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "MK_FB_FETCH_API_POSTS") {
            fetchPosts(request.count)
                .then((result) => sendResponse({ success: true, data: result.posts, logs: result.logs }))
                .catch((error) => sendResponse({ success: false, error: error.message, logs: error.logs || [] }));
            return true;
        }
    });

    function getCrawlTokens() {
        const html = document.documentElement.innerHTML;
        let fb_dtsg = "";
        let lsd = "";
        let groupId = "";

        const dtsgMatch = html.match(/"DTSGInitialData",\s*\[\],\s*\{"token":"(.*?)"\}/) || html.match(/"fb_dtsg"\s*value="(.*?)"/);
        if (dtsgMatch) fb_dtsg = dtsgMatch[1];
        if (!fb_dtsg) {
            const input = document.querySelector('input[name="fb_dtsg"]');
            if (input) fb_dtsg = input.value;
        }

        const lsdMatch = html.match(/"LSD",\s*\[\],\s*\{"token":"(.*?)"\}/);
        if (lsdMatch) lsd = lsdMatch[1];

        const groupIdMatch = html.match(/"groupID":"(\d+)"/) || html.match(/"group_id":"(\d+)"/);
        if (groupIdMatch) groupId = groupIdMatch[1];
        if (!groupId) {
            const meta = document.querySelector('meta[property="al:android:url"]');
            const m = meta && meta.content.match(/group\/(\d+)/);
            if (m) groupId = m[1];
        }
        if (!groupId) {
            const urlMatch = window.location.pathname.match(/groups\/(\d+)/);
            if (urlMatch) groupId = urlMatch[1];
        }
        return { fb_dtsg, lsd, groupId };
    }

    function getDeepValue(obj, targetKeys) {
        if (!obj || typeof obj !== "object") return null;
        for (const k of targetKeys) {
            if (obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        for (const key in obj) {
            const res = getDeepValue(obj[key], targetKeys);
            if (res !== null) return res;
        }
        return null;
    }

    function isToday(unixSeconds) {
        const postDate = new Date(unixSeconds * 1000);
        const today = new Date();
        return postDate.getDate() === today.getDate() &&
            postDate.getMonth() === today.getMonth() &&
            postDate.getFullYear() === today.getFullYear();
    }

    async function fetchPosts(count = 20) {
        const logs = [];
        const addLog = (msg) => logs.push(msg);

        const tokens = getCrawlTokens();
        if (!tokens.groupId) {
            const err = new Error("Không tìm thấy Group ID — tài khoản Facebook trên trình duyệt này chưa đăng nhập hoặc không xem được nhóm.");
            err.logs = logs;
            throw err;
        }
        if (!tokens.fb_dtsg) {
            const err = new Error("Không tìm thấy fb_dtsg — hãy đăng nhập Facebook trên trình duyệt này rồi thử lại.");
            err.logs = logs;
            throw err;
        }
        addLog(`GroupID: ${tokens.groupId}`);

        await nudgeFeedAndWaitForCapture();
        addLog(capturedQueryTemplate ? `doc_id động: ${capturedQueryTemplate.docId}` : "Dùng doc_id dự phòng.");

        const targetCount = parseInt(count, 10) || 20;
        const allPosts = [];
        let cursor = null;
        let hasNextPage = true;
        let pageCount = 0;

        while (allPosts.length < targetCount && hasNextPage) {
            pageCount++;
            const templateVariables = capturedQueryTemplate ? capturedQueryTemplate.variables : FALLBACK_VARIABLES;
            const docId = capturedQueryTemplate ? capturedQueryTemplate.docId : FALLBACK_DOC_ID;
            const variables = { ...templateVariables, count: 15, cursor, id: tokens.groupId, stream_initial_count: 15 };

            const body = new URLSearchParams({
                fb_dtsg: tokens.fb_dtsg,
                lsd: tokens.lsd || "",
                fb_api_caller_class: "RelayModern",
                fb_api_req_friendly_name: QUERY_NAME,
                variables: JSON.stringify(variables),
                doc_id: docId,
                server_timestamps: "true",
            });

            let text = "";
            let retryCount = 0;
            const MAX_RETRIES = 2;
            while (retryCount <= MAX_RETRIES) {
                try {
                    const response = await fetch(`${window.location.origin}/api/graphql/`, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: body.toString(),
                    });
                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`Lỗi HTTP: ${response.status} - ${errText.substring(0, 50)}`);
                    }
                    text = await response.text();
                    break;
                } catch (err) {
                    if (retryCount >= MAX_RETRIES) {
                        err.logs = logs;
                        throw err;
                    }
                    retryCount++;
                    await new Promise((r) => setTimeout(r, 2000));
                }
            }

            let parsedInThisPage = 0;
            for (const line of text.trim().split("\n")) {
                try {
                    const data = JSON.parse(line);
                    const pageInfo = getDeepValue(data, ["page_info"]);
                    if (pageInfo) {
                        if (pageInfo.has_next_page !== undefined) hasNextPage = pageInfo.has_next_page;
                        if (pageInfo.end_cursor) cursor = pageInfo.end_cursor;
                    }

                    let edges = [];
                    if (data?.data?.node?.group_feed?.edges) edges = data.data.node.group_feed.edges;
                    else if (Array.isArray(data?.data)) edges = data.data;
                    else if (data?.data?.edges) edges = data.data.edges;
                    else if (data?.node) edges = [{ node: data.node }];

                    for (const edge of edges) {
                        const node = edge.node;
                        if (!node) continue;
                        const postId = node.post_id || node.id || node.legacy_post_id || getDeepValue(node, ["post_id"]);
                        if (!postId || allPosts.length >= targetCount) continue;

                        const actorsArr = getDeepValue(node, ["actors"]);
                        const actorObj = (Array.isArray(actorsArr) ? actorsArr[0] : actorsArr) || {};
                        const author = actorObj?.name || "Ẩn danh";
                        const actorProfileUrl = actorObj?.url || actorObj?.profile_url || "";
                        const actorId = actorObj?.id || actorObj?.profile_id || "";
                        const message = getDeepValue(node, ["message"])?.text || "";
                        const url = node.url || node.share_url || `https://www.facebook.com/groups/${tokens.groupId}/posts/${postId}`;
                        const creationTime = node.creation_time || getDeepValue(node, ["creation_time"]);
                        const reactionCount = getDeepValue(node, ["reaction_count"])?.count || 0;
                        const commentObj = getDeepValue(node, ["total_comment_count", "comments"]);
                        const commentCount = typeof commentObj === "number" ? commentObj : (commentObj?.total_count || 0);
                        const shareCount = getDeepValue(node, ["share_count"])?.count || 0;

                        const images = [];
                        let videoUrl = null;
                        const extractMedia = (obj) => {
                            if (!obj || typeof obj !== "object") return;
                            if (obj.image && typeof obj.image.uri === "string" && !images.includes(obj.image.uri)) images.push(obj.image.uri);
                            if (obj.playable_url && typeof obj.playable_url === "string") videoUrl = obj.playable_url;
                            for (const k in obj) extractMedia(obj[k]);
                        };
                        const attachments = getDeepValue(node, ["attachments"]);
                        if (attachments) extractMedia(attachments);

                        allPosts.push({
                            post_id: postId,
                            post_url: url,
                            author_name: author,
                            author_url: actorProfileUrl || (actorId ? `https://www.facebook.com/profile.php?id=${actorId}` : ""),
                            timestamp_raw: new Date((creationTime || 0) * 1000).toISOString(),
                            is_today: creationTime ? isToday(creationTime) : false,
                            content: message || "[Bài viết Media/Share/Poll]",
                            reactions: reactionCount,
                            comments: commentCount,
                            shares: shareCount,
                            images,
                            video_url: videoUrl,
                            crawled_at: new Date().toISOString(),
                        });
                        parsedInThisPage++;
                    }
                } catch (e) {}
            }

            addLog(`Trang ${pageCount}: +${parsedInThisPage} bài (tổng ${allPosts.length}/${targetCount})`);
            if (parsedInThisPage === 0 || !cursor) hasNextPage = false;
            if (allPosts.length < targetCount && hasNextPage) await new Promise((r) => setTimeout(r, 500));
        }

        return { posts: allPosts, logs };
    }
})();
