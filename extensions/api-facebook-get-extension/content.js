// ─── Dò doc_id động từ chính request thật của Facebook ──────────────────────
// graphql-sniffer.js (chạy ở MAIN world) bắt request GraphQL thật Facebook tự gửi
// rồi bắn CustomEvent này ra. Nhờ vậy khi Facebook đổi doc_id, extension tự cập nhật
// theo mà không cần sửa code tay. Nếu chưa bắt được lần nào thì dùng giá trị dự phòng
// cố định bên dưới (đã cập nhật theo request thật gần nhất tính tới thời điểm sửa code).
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
const CAPTURE_STORAGE_KEY = "fbGraphqlCapture_GroupsCometFeedRegularStoriesPaginationQuery";
const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // quá 7 ngày thì không tin tưởng nữa, quay lại giá trị dự phòng

let capturedQueryTemplate = null; // { docId, variables } lấy được từ chính request thật của Facebook

chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
    const cached = result?.[CAPTURE_STORAGE_KEY];
    if (cached && Date.now() - cached.capturedAt < CAPTURE_MAX_AGE_MS) {
        capturedQueryTemplate = { docId: cached.docId, variables: cached.variables };
    }
});

document.addEventListener("fb-graphql-docid-captured", (evt) => {
    try {
        const { friendlyName, docId, variables } = evt.detail || {};
        if (friendlyName !== "GroupsCometFeedRegularStoriesPaginationQuery") return;
        const parsedVariables = JSON.parse(variables);
        capturedQueryTemplate = { docId, variables: parsedVariables };
        chrome.storage.local.set({
            [CAPTURE_STORAGE_KEY]: { docId, variables: parsedVariables, capturedAt: Date.now() },
        });
        console.log("[FB API Crawler] Đã bắt được doc_id mới nhất từ Facebook:", docId);
    } catch (e) {
        // Bỏ qua nếu payload bắt được không hợp lệ
    }
});

// Cuộn nhẹ trang để dụ Facebook tự bắn ra request PaginationQuery thật (nếu chưa có sẵn
// giá trị đã bắt trước đó), cho graphql-sniffer.js cơ hội bắt được doc_id mới nhất.
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

// Lắng nghe yêu cầu từ popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'FETCH_API_POSTS') {
        fetchPosts(request.count)
            .then(result => sendResponse({ success: true, data: result.posts, logs: result.logs }))
            .catch(error => sendResponse({ success: false, error: error.message, logs: error.logs || [] }));
        
        return true; // Báo cho Chrome biết là mình sẽ sendResponse bất đồng bộ
    }
});

function getTokensFromPage() {
    return new Promise((resolve, reject) => {
        try {
            const html = document.documentElement.innerHTML;
            let fb_dtsg = "";
            let lsd = "";
            let groupId = "";

            // Lấy fb_dtsg
            const dtsgMatch = html.match(/"DTSGInitialData",\s*\[\],\s*\{"token":"(.*?)"\}/) || html.match(/"fb_dtsg"\s*value="(.*?)"/);
            if (dtsgMatch) fb_dtsg = dtsgMatch[1];
            if (!fb_dtsg) {
                const input = document.querySelector('input[name="fb_dtsg"]');
                if (input) fb_dtsg = input.value;
            }

            // Lấy lsd
            const lsdMatch = html.match(/"LSD",\s*\[\],\s*\{"token":"(.*?)"\}/);
            if (lsdMatch) lsd = lsdMatch[1];

            // Lấy Group ID (Phải là dạng SỐ)
            // Cách 1: Quét thẳng trong mã nguồn HTML (chính xác nhất)
            const groupIdMatch = html.match(/"groupID":"(\d+)"/) || html.match(/"group_id":"(\d+)"/);
            if (groupIdMatch) {
                groupId = groupIdMatch[1];
            }
            
            // Cách 2: Tìm trong meta tags
            if (!groupId) {
                const meta = document.querySelector('meta[property="al:android:url"]');
                if (meta) {
                    const match = meta.content.match(/group\/(\d+)/);
                    if (match) groupId = match[1];
                }
            }
            
            // Cách 3: Lấy từ URL (chỉ áp dụng nếu URL dùng số)
            if (!groupId) {
                const urlMatch = window.location.pathname.match(/groups\/(\d+)/);
                if (urlMatch) groupId = urlMatch[1];
            }

            resolve({ fb_dtsg, lsd, groupId, success: true });
        } catch (e) {
            reject(new Error("Lỗi khi quét token: " + e.message));
        }
    });
}

async function fetchPosts(count = 20) {
    const logs = [];
    function addLog(msg) {
        logs.push(msg);
        console.log(msg);
    }
    
    addLog("Bắt đầu lấy token từ trang Facebook...");
    const tokens = await getTokensFromPage();
    
    if (!tokens.groupId) {
        const err = new Error("Không tìm thấy Group ID. Hãy chắc chắn bạn đang ở trang Facebook Group!");
        err.logs = logs;
        throw err;
    }
    if (!tokens.fb_dtsg) {
        const err = new Error("Không tìm thấy fb_dtsg. Hãy thử tải lại trang (F5).");
        err.logs = logs;
        throw err;
    }

    addLog(`Đã lấy Tokens thành công! GroupID: ${tokens.groupId}, có fb_dtsg: ${!!tokens.fb_dtsg}, có lsd: ${!!tokens.lsd}`);

    addLog("Đang dò doc_id mới nhất từ chính Facebook (cuộn nhẹ trang)...");
    await nudgeFeedAndWaitForCapture();
    if (capturedQueryTemplate) {
        addLog(`Đã bắt được doc_id động: ${capturedQueryTemplate.docId}`);
    } else {
        addLog("Chưa bắt được doc_id động, dùng giá trị dự phòng cố định.");
    }

    const targetCount = parseInt(count, 10);
    const allPosts = [];
    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;

    while (allPosts.length < targetCount && hasNextPage) {
        pageCount++;
        addLog(`Đang cào Trang ${pageCount} (Đã có ${allPosts.length}/${targetCount} bài)...`);

        // Dùng template bắt được thật từ Facebook nếu có (luôn đúng theo phiên bản hiện tại
        // của Facebook), nếu chưa bắt được lần nào thì rơi về giá trị dự phòng cố định.
        const templateVariables = capturedQueryTemplate ? capturedQueryTemplate.variables : FALLBACK_VARIABLES;
        const docId = capturedQueryTemplate ? capturedQueryTemplate.docId : FALLBACK_DOC_ID;

        const variables = {
            ...templateVariables,
            count: 15, // Tăng lên 15 để cào 100 bài nhanh hơn
            cursor: cursor,
            id: tokens.groupId,
            stream_initial_count: 15,
        };

        const body = new URLSearchParams({
            fb_dtsg: tokens.fb_dtsg,
            lsd: tokens.lsd || '',
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "GroupsCometFeedRegularStoriesPaginationQuery",
            variables: JSON.stringify(variables),
            doc_id: docId,
            server_timestamps: "true",
        });

        let response = null;
        let text = "";
        let retryCount = 0;
        const MAX_RETRIES = 2;

        while (retryCount <= MAX_RETRIES) {
            try {
                response = await fetch(`${window.location.origin}/api/graphql/`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: body.toString(),
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Lỗi HTTP: ${response.status} - ${errText.substring(0, 50)}`);
                }
                text = await response.text();
                break; // Thành công, thoát vòng lặp retry
            } catch (err) {
                if (retryCount >= MAX_RETRIES) {
                    err.logs = logs;
                    throw err;
                }
                retryCount++;
                logs.push(`⚠️ Lỗi khi gọi API Facebook, thử lại lần ${retryCount}/${MAX_RETRIES}...`);
                await new Promise(r => setTimeout(r, 2000)); // Đợi 2 giây trước khi retry
            }
        }
        const lines = text.trim().split("\n");
        let parsedInThisPage = 0;
        
        // Cập nhật hàm đệ quy để xài chung
        function getDeepValue(obj, targetKeys) {
            if (!obj || typeof obj !== 'object') return null;
            for (const k of targetKeys) {
                if (obj[k] !== undefined && obj[k] !== null) return obj[k];
            }
            for (const key in obj) {
                const res = getDeepValue(obj[key], targetKeys);
                if (res !== null) return res;
            }
            return null;
        }
    
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                
                // Lấy page_info để phân trang
                const pageInfo = getDeepValue(data, ['page_info']);
                if (pageInfo) {
                    if (pageInfo.has_next_page !== undefined) hasNextPage = pageInfo.has_next_page;
                    if (pageInfo.end_cursor) cursor = pageInfo.end_cursor;
                }
                
                // Tìm mảng edges. 
                let edges = [];
                if (data?.data?.node?.group_feed?.edges) {
                    edges = data.data.node.group_feed.edges;
                } else if (Array.isArray(data?.data)) {
                    edges = data.data; 
                } else if (data?.data?.edges) {
                    edges = data.data.edges;
                } else if (data?.node) {
                    edges = [{ node: data.node }]; 
                }
                
                for (const edge of edges) {
                    const node = edge.node;
                    if (!node) continue;
                    
                    const postId = node.post_id || node.id || node.legacy_post_id || getDeepValue(node, ['post_id']);
                    if (!postId) continue; 

                    // Nếu đã đủ số lượng thì bỏ qua parse
                    if (allPosts.length >= targetCount) continue;

                    // Lấy thông tin tác giả từ actors[0] (đúng theo cấu trúc GraphQL Facebook)
                    const actorsArr = getDeepValue(node, ['actors']);
                    const actorObj = (Array.isArray(actorsArr) ? actorsArr[0] : actorsArr) || {};
                    const author = actorObj?.name || getDeepValue(node, ['actors', 'owning_profile', 'name']) || "Ẩn danh";
                    // Ưu tiên lấy url profile trực tiếp từ actor, nếu không có thì dùng numeric ID
                    const actorProfileUrl = actorObj?.url || actorObj?.profile_url || "";
                    const actorId = actorObj?.id || actorObj?.profile_id || "";
                    
                    const messageObj = getDeepValue(node, ['message']);
                    const message = messageObj?.text || "";
                    
                    const url = node.url || node.share_url || `https://www.facebook.com/groups/${tokens.groupId}/posts/${postId}`;
                    const creationTime = node.creation_time || getDeepValue(node, ['creation_time']); 
                    
                    const reactionObj = getDeepValue(node, ['reaction_count']);
                    const reactionCount = reactionObj?.count || 0;
                    
                    const commentObj = getDeepValue(node, ['total_comment_count', 'comments']);
                    const commentCount = typeof commentObj === 'number' ? commentObj : (commentObj?.total_count || 0);
                    
                    const shareObj = getDeepValue(node, ['share_count']);
                    const shareCount = shareObj?.count || 0;
                    
                    let images = [];
                    let videoUrl = null;
                    
                    // Hàm đệ quy lục lọi toàn bộ ảnh và video trong cục attachments
                    function extractMedia(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        // Nếu tìm thấy link ảnh
                        if (obj.image && typeof obj.image.uri === 'string') {
                            // Tránh lấy ảnh trùng lặp
                            if (!images.includes(obj.image.uri)) images.push(obj.image.uri);
                        } 
                        // Nếu tìm thấy link video
                        if (obj.playable_url && typeof obj.playable_url === 'string') {
                            videoUrl = obj.playable_url;
                        }
                        
                        for (const k in obj) {
                            extractMedia(obj[k]);
                        }
                    }
                    
                    const attachments = getDeepValue(node, ['attachments']);
                    if (attachments) extractMedia(attachments);
                    
                    // Lưu vào mảng tổng
                    allPosts.push({
                        post_id: postId,
                        post_url: url,
                        author_name: author,
                        // Ưu tiên URL profile thật (fb.com/username), fallback sang numeric ID URL
                        author_url: actorProfileUrl || (actorId ? `https://www.facebook.com/profile.php?id=${actorId}` : ""),
                        timestamp_raw: new Date((creationTime || 0) * 1000).toISOString(),
                        is_today: creationTime ? isToday(creationTime) : false,
                        content: message || "[Bài viết Media/Share/Poll]",
                        reactions: reactionCount,
                        comments: commentCount,
                        shares: shareCount,
                        images: images,
                        video_url: videoUrl,
                        crawled_at: new Date().toISOString()
                    });
                    parsedInThisPage++;
                }
            } catch (e) {
                // Ignore parse errors for split lines
            }
        }
        
        addLog(`=> Xong Trang ${pageCount}: lấy được ${parsedInThisPage} bài. (Tổng: ${allPosts.length}/${targetCount})`);
        
        // Tránh vòng lặp vô hạn nếu Facebook không trả về gì mới
        if (parsedInThisPage === 0 || !cursor) {
            hasNextPage = false;
        }

        // Tạm nghỉ 500ms giữa các lần chuyển trang để tránh bị Facebook chặn (Rate Limit)
        if (allPosts.length < targetCount && hasNextPage) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    if (allPosts.length === 0) {
        addLog(`[DEBUG-RAW] Không tìm thấy bài viết nào!`);
    }

    addLog(`✅ Đã cào xong tổng cộng ${allPosts.length} bài viết hợp lệ.`);
    return { posts: allPosts, logs };
}

// Kiểm tra bài viết có phải hôm nay không (dựa trên timestamp chuẩn)
function isToday(unixSeconds) {
    const postDate = new Date(unixSeconds * 1000);
    const today = new Date();
    return postDate.getDate() === today.getDate() &&
           postDate.getMonth() === today.getMonth() &&
           postDate.getFullYear() === today.getFullYear();
}


// ════════════════════════════════════════════════════════════════════════════════
// 🚀 TÍNH NĂNG MỚI: AUTO-SCROLL + LIVE NETWORK INTERCEPTOR + AI SCORING (>=80đ)
// ════════════════════════════════════════════════════════════════════════════════

(function initAutoScrollAndAiScoring() {
    if (window.__mkFbAutoScrollInitialized) return;
    window.__mkFbAutoScrollInitialized = true;

    // Trạng thái toàn cục
    window.__mkAutoScrollActive = false;
    window.__mkSeenPostIds = new Set();
    window.__mkScoredPosts = [];
    window.__mkMinScoreThreshold = 80;
    window.__mkScannedCount = 0;
    window.__mkRecentSrtCaptions = new Map(); // url -> text

    const BACKEND_BASE_URLS = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://seeding.markeeai.com"
    ];

    // Lấy endpoint backend còn hoạt động
    async function getActiveBackendUrl() {
        for (const base of BACKEND_BASE_URLS) {
            try {
                const res = await fetch(`${base}/health`, { method: "GET", signal: AbortSignal.timeout(1000) });
                if (res.ok) return base;
            } catch (e) {}
        }
        return BACKEND_BASE_URLS[0]; // fallback
    }

    // Làm sạch file phụ đề SRT thành văn bản liên tục
    function cleanSrtText(rawSrt) {
        if (!rawSrt || typeof rawSrt !== "string") return "";
        return rawSrt
            .replace(/\r\n/g, "\n")
            .replace(/^\d+\s*$/gm, "") // Bỏ số thứ tự dòng SRT
            .replace(/\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}.*$/gm, "") // Bỏ timeline
            .replace(/\n+/g, " ")
            .trim();
    }

    // ── 1. Lắng nghe SRT Subtitles được bắt từ Sniffer ─────────────────────────
    document.addEventListener("fb-stream-srt-captured", (evt) => {
        try {
            const { url, srtText } = evt.detail || {};
            if (!srtText) return;
            const cleaned = cleanSrtText(srtText);
            if (cleaned.length > 10) {
                window.__mkRecentSrtCaptions.set(url, cleaned);
                // Giữ tối đa 50 captions gần nhất
                if (window.__mkRecentSrtCaptions.size > 50) {
                    const firstKey = window.__mkRecentSrtCaptions.keys().next().value;
                    window.__mkRecentSrtCaptions.delete(firstKey);
                }
                console.log("[AI Scorer] Đã bắt được phụ đề SRT video:", cleaned.substring(0, 60) + "...");
            }
        } catch (e) {}
    });

    // ── 2. Lắng nghe GraphQL Stream Posts Response ────────────────────────────
    document.addEventListener("fb-stream-posts-response", async (evt) => {
        try {
            const { friendlyName, responseText } = evt.detail || {};
            if (!responseText) return;
            await processIncomingGraphQLResponse(responseText);
        } catch (e) {
            console.error("[AI Scorer] Lỗi xử lý response:", e);
        }
    });

    // Bóc tách bài viết từ dòng response GraphQL của Facebook
    async function processIncomingGraphQLResponse(rawText) {
        const lines = rawText.trim().split("\n");
        const newlyFoundPosts = [];

        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                let edges = [];
                if (data?.data?.node?.group_feed?.edges) edges = data.data.node.group_feed.edges;
                else if (Array.isArray(data?.data)) edges = data.data;
                else if (data?.data?.edges) edges = data.data.edges;
                else if (data?.node) edges = [{ node: data.node }];

                for (const edge of edges) {
                    const node = edge.node;
                    if (!node) continue;
                    const postId = node.post_id || node.id || node.legacy_post_id;
                    if (!postId || window.__mkSeenPostIds.has(postId)) continue;
                    window.__mkSeenPostIds.add(postId);

                    const actorsArr = node.actors || [];
                    const actorObj = (Array.isArray(actorsArr) ? actorsArr[0] : actorsArr) || {};
                    const authorName = actorObj?.name || "Ẩn danh";
                    const authorUrl = actorObj?.url || actorObj?.profile_url || (actorObj?.id ? `https://www.facebook.com/profile.php?id=${actorObj.id}` : "");
                    const messageText = node.message?.text || "";
                    const creationTime = node.creation_time;
                    const postUrl = node.url || node.share_url || `${window.location.origin}/groups/posts/${postId}`;
                    const reactionCount = node.reaction_count?.count || 0;
                    const commentCount = typeof node.total_comment_count === "number" ? node.total_comment_count : (node.total_comment_count?.total_count || 0);

                    // Ghép phụ đề SRT nếu bài là video không có chữ
                    let fullContent = messageText;
                    if (!fullContent && window.__mkRecentSrtCaptions.size > 0) {
                        const latestSrt = Array.from(window.__mkRecentSrtCaptions.values()).pop();
                        fullContent = `[Phụ đề Video]: ${latestSrt}`;
                    }

                    if (!fullContent) fullContent = "[Bài viết Chia sẻ/Media/Ảnh]";

                    const postObj = {
                        post_id: postId,
                        post_url: postUrl,
                        author_name: authorName,
                        author_url: authorUrl,
                        content: fullContent,
                        created_time: creationTime ? new Date(creationTime * 1000).toISOString() : new Date().toISOString(),
                        reactions: reactionCount,
                        comments: commentCount,
                    };

                    newlyFoundPosts.push(postObj);
                }
            } catch (e) {}
        }

        if (newlyFoundPosts.length > 0) {
            window.__mkScannedCount += newlyFoundPosts.length;
            updateHudStats();
            console.log(`[AI Scorer] Bắt được ${newlyFoundPosts.length} bài mới. Bắt đầu chấm điểm AI...`);

            // Gửi từng bài qua AI Bot chấm điểm
            for (const post of newlyFoundPosts) {
                await evaluatePostWithAi(post);
            }
        }
    }

    // ── 3. Chấm điểm bài viết bằng AI Bot ────────────────────────────────────
    async function evaluatePostWithAi(post) {
        try {
            updateHudStatus(`Đang chấm điểm bài: ${post.author_name}...`);
            const backendUrl = await getActiveBackendUrl();

            const res = await fetch(`${backendUrl}/api/all-platform/extension-crawl/score-post`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: post.content,
                    post_id: post.post_id,
                    author_name: post.author_name,
                }),
                signal: AbortSignal.timeout(15000),
            });

            if (!res.ok) {
                console.warn(`[AI Scorer] Backend HTTP ${res.status}`);
                return;
            }

            const data = await res.json();
            const score = typeof data.score === "number" ? data.score : 0;
            const reason = data.reason || "";
            const category = data.need_category || null;

            post.ai_score = score;
            post.ai_reason = reason;
            post.ai_category = category;

            console.log(`[AI Scorer] Bài ${post.post_id} -> ${score} điểm (${reason})`);

            // 🎯 BỘ LỌC ĐIỂM SỐ: CHỈ GIỮ BÀI >= NGƯỠNG (Mặc định 80đ)
            if (score >= window.__mkMinScoreThreshold) {
                window.__mkScoredPosts.unshift(post);
                addPostToHudCard(post);
                playChimeSound();
                console.log(`🔥 [HIGH LEAD >= ${window.__mkMinScoreThreshold}] ${score}đ: ${post.author_name} - ${reason}`);

                // Tự động lưu bài vào CSDL Backend
                saveHighScoredPostToBackend(post, backendUrl);
            }

            updateHudStats();
        } catch (err) {
            console.warn("[AI Scorer] Lỗi chấm điểm:", err.message);
        }
    }

    // Tự động lưu bài điểm cao về CSDL Backend
    async function saveHighScoredPostToBackend(post, backendUrl) {
        try {
            await fetch(`${backendUrl}/api/all-platform/extension-crawl/save-posts`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": "markee-extension-key-2024",
                },
                body: JSON.stringify({
                    posts: [{
                        post_url: post.post_url,
                        author_name: post.author_name,
                        author_url: post.author_url,
                        content: post.content,
                        timestamp_raw: post.created_time,
                        reactions: post.reactions || 0,
                        comments: post.comments || 0,
                    }],
                    group_url: window.location.href,
                    extension_version: "2.10-ai-autoscroll",
                }),
            });
        } catch (e) {}
    }

    // Âm thanh thông báo khi có bài điểm cao
    function playChimeSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch (e) {}
    }

    // ── 4. Bộ Điều Khiển Auto-Scroll Siêu Giả Lập Người Thật (Ultra-Realistic Human Simulator) ──
    let autoScrollTimer = null;
    let scrollCount = 0;
    let isSystemCrawlerAccount = false;

    // Kiểm tra cờ tài khoản System chuyên dụng
    chrome.storage.local.get(['is_system_crawler'], (result) => {
        isSystemCrawlerAccount = !!result?.is_system_crawler;
        updateHudSystemLockState();
    });

    // Hàm cuộn mượt vi phân theo quán tính tay người thật (Human Inertia Cubic Ease-Out)
    function smoothScrollByMicroSteps(targetDistance, durationMs = 650) {
        return new Promise(resolve => {
            const startTime = performance.now();
            const startY = window.scrollY;
            function step(now) {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / durationMs, 1);
                // Đường cong Ease-Out mô phỏng lực vuốt chuột/ngón tay
                const easeOut = 1 - Math.pow(1 - progress, 3);
                window.scrollTo(0, startY + targetDistance * easeOut);
                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            }
            requestAnimationFrame(step);
        });
    }

    window.startFbAutoScroll = function (threshold = 80) {
        if (!isSystemCrawlerAccount) {
            alert("🔒 CHẾ ĐỘ BẢO VỆ: Luồng cào tự động và đổ dữ liệu này chỉ dành riêng cho 1 Tài Khoản System của hệ thống.\n\nNếu máy này là máy chủ/trình duyệt System, vui lòng bấm 'Kích hoạt Nick System' trên bảng điều khiển để cấp quyền.");
            return;
        }

        if (window.__mkAutoScrollActive) return;
        window.__mkAutoScrollActive = true;
        window.__mkMinScoreThreshold = parseInt(threshold, 10) || 80;
        updateHudStatus("🟢 Đang giả lập người đọc lướt...");
        renderHudControlButtons();

        async function scrollStep() {
            if (!window.__mkAutoScrollActive) return;
            scrollCount++;

            // 1. Quãng đường cuộn xuống ngẫu nhiên (420px - 880px)
            const distance = Math.floor(Math.random() * 460) + 420;
            const scrollDuration = Math.floor(Math.random() * 250) + 550; // 550ms - 800ms
            await smoothScrollByMicroSteps(distance, scrollDuration);

            // 2. Hành vi mắt người: thi thoảng cuộn ngược lên xem lại (cứ 4-6 lần cuộn xuống)
            const shouldScrollUp = scrollCount % (Math.floor(Math.random() * 3) + 4) === 0;
            if (shouldScrollUp) {
                // Dừng ngắm nghía 600ms - 1.2s trước khi cuộn lên
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 600) + 600));
                const upDistance = -(Math.floor(Math.random() * 150) + 120); // -120px đến -270px
                await smoothScrollByMicroSteps(upDistance, 480);
                // Dừng đọc lại bài vừa cuộn lên 1.5s - 2.8s
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 1300) + 1500));
            }

            // 3. Thời gian dừng ngẫu nhiên đa tầng (Dynamic Human Pauses):
            // - 50% khả năng: Dừng lướt nhanh (1.0s - 2.2s)
            // - 35% khả năng: Dừng đọc bài bình thường (2.8s - 4.5s)
            // - 15% khả năng: Dừng đọc kỹ nội dung dài / xem video (5.5s - 7.5s)
            let pauseMs = 0;
            const roll = Math.random();
            if (roll < 0.50) {
                pauseMs = Math.floor(Math.random() * 1200) + 1000; // 1s - 2.2s
                updateHudStatus("👀 Lướt qua bài (" + (pauseMs / 1000).toFixed(1) + "s)...");
            } else if (roll < 0.85) {
                pauseMs = Math.floor(Math.random() * 1700) + 2800; // 2.8s - 4.5s
                updateHudStatus("📖 Đang đọc bài (" + (pauseMs / 1000).toFixed(1) + "s)...");
            } else {
                pauseMs = Math.floor(Math.random() * 2000) + 5500; // 5.5s - 7.5s
                updateHudStatus("🧐 Đọc kỹ nội dung (" + (pauseMs / 1000).toFixed(1) + "s)...");
            }

            autoScrollTimer = setTimeout(scrollStep, pauseMs);
        }

        scrollStep();
    };

    window.stopFbAutoScroll = function () {
        window.__mkAutoScrollActive = false;
        if (autoScrollTimer) clearTimeout(autoScrollTimer);
        updateHudStatus("⏸ Đã tạm dừng cuộn");
        renderHudControlButtons();
    };

    // ── 5. Giao Diện Nổi Floating HUD Widget Trực Tiếp Trên Facebook ───────────
    function injectFloatingHud() {
        if (document.getElementById("__mk_fb_crawler_hud__")) return;

        const hud = document.createElement("div");
        hud.id = "__mk_fb_crawler_hud__";
        hud.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 390px;
            max-height: 560px;
            background: rgba(24, 25, 26, 0.96);
            backdrop-filter: blur(14px);
            color: #e4e6eb;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 14px;
            box-shadow: 0 14px 40px rgba(0,0,0,0.5);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: all 0.25s ease;
        `;

        hud.innerHTML = `
            <div id="__mk_hud_header__" style="padding: 12px 16px; background: rgba(36, 37, 38, 0.95); border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between; cursor: move; user-select: none;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #2e89ff;">
                    <span>🤖 Markee AI Lead Filter</span>
                    <span id="__mk_hud_system_badge__" style="font-size: 10px; background: #3a3b3c; color: #b0b3b8; padding: 2px 6px; border-radius: 10px;">🔒 Locked</span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <button id="__mk_btn_toggle_system_lock__" title="Bật/Tắt quyền System Crawler" style="background: none; border: none; color: #eab308; cursor: pointer; font-size: 13px; padding: 0 4px;">🔑</button>
                    <button id="__mk_btn_minimize__" style="background: none; border: none; color: #b0b3b8; cursor: pointer; font-size: 16px;">—</button>
                </div>
            </div>

            <div id="__mk_hud_body__" style="padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; flex: 1;">
                <!-- Khung cảnh báo nếu không phải tài khoản System -->
                <div id="__mk_hud_lock_notice__" style="display: none; background: #3a2e12; border: 1px solid #854d0e; color: #fde047; padding: 8px 12px; border-radius: 8px; font-size: 11px; line-height: 1.4;">
                    🛡️ <b>Chế độ bảo vệ tài khoản:</b> Luồng cào tự động chỉ dành riêng cho 1 nick System chuyên dụng. Nhấn biểu tượng 🔑 để kích hoạt nếu đây là máy System.
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <div style="flex: 1; background: #3a3b3c; border-radius: 8px; padding: 8px 12px; text-align: center;">
                        <div style="font-size: 11px; color: #b0b3b8;">Đã quét</div>
                        <div id="__mk_hud_scanned_count__" style="font-size: 18px; font-weight: 700; color: #e4e6eb;">0</div>
                    </div>
                    <div style="flex: 1; background: #1b3a24; border-radius: 8px; padding: 8px 12px; text-align: center; border: 1px solid #28a745;">
                        <div style="font-size: 11px; color: #a3e635;">Bài ≥ 80đ</div>
                        <div id="__mk_hud_high_count__" style="font-size: 18px; font-weight: 700; color: #4ade80;">0</div>
                    </div>
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="font-size: 12px; color: #b0b3b8;">Ngưỡng điểm:</span>
                    <input id="__mk_hud_threshold_input__" type="number" min="50" max="100" value="80" style="width: 55px; background: #3a3b3c; border: 1px solid #4e4f50; color: #fff; border-radius: 6px; padding: 4px 6px; text-align: center; font-weight: bold;" />
                    <span id="__mk_hud_status_badge__" style="font-size: 11px; color: #eab308; margin-left: auto; text-align: right; max-width: 175px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Sẵn sàng</span>
                </div>

                <div id="__mk_hud_controls__" style="display: flex; gap: 8px;">
                    <button id="__mk_btn_toggle_scroll__" style="flex: 2; background: #1877f2; color: #fff; border: none; padding: 8px 12px; border-radius: 8px; font-weight: 600; cursor: pointer;">▶ Bắt đầu Auto-Scroll & Lọc</button>
                    <button id="__mk_btn_clear_list__" style="flex: 1; background: #3a3b3c; color: #e4e6eb; border: none; padding: 8px 10px; border-radius: 8px; font-size: 12px; cursor: pointer;">Xoá</button>
                </div>

                <div style="font-size: 12px; font-weight: 600; color: #b0b3b8; display: flex; justify-content: space-between;">
                    <span>Danh sách Leads Tiềm Năng (≥ 80đ):</span>
                    <span id="__mk_hud_list_counter__" style="color: #4ade80;">0 bài</span>
                </div>

                <div id="__mk_hud_posts_list__" style="flex: 1; max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;">
                    <div id="__mk_hud_empty_hint__" style="color: #8a8d91; text-align: center; padding: 25px 10px; font-size: 12px; border: 1px dashed #3a3b3c; border-radius: 8px;">
                        Bấm <b>[Bắt đầu Auto-Scroll]</b> để extension giả lập người thật lướt trang, bắt gói tin và AI chấm điểm bài viết...
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(hud);

        // Gắn sự kiện nút bấm
        const btnToggle = hud.querySelector("#__mk_btn_toggle_scroll__");
        const btnClear = hud.querySelector("#__mk_btn_clear_list__");
        const btnMin = hud.querySelector("#__mk_btn_minimize__");
        const btnSystemLock = hud.querySelector("#__mk_btn_toggle_system_lock__");
        const inputThreshold = hud.querySelector("#__mk_hud_threshold_input__");
        const hudBody = hud.querySelector("#__mk_hud_body__");

        btnToggle.addEventListener("click", () => {
            if (window.__mkAutoScrollActive) {
                window.stopFbAutoScroll();
            } else {
                const threshold = parseInt(inputThreshold.value, 10) || 80;
                window.startFbAutoScroll(threshold);
            }
        });

        btnClear.addEventListener("click", () => {
            window.__mkScoredPosts = [];
            const list = hud.querySelector("#__mk_hud_posts_list__");
            list.innerHTML = `<div id="__mk_hud_empty_hint__" style="color: #8a8d91; text-align: center; padding: 25px 10px; font-size: 12px; border: 1px dashed #3a3b3c; border-radius: 8px;">Đã xoá danh sách. Đang chờ bài mới...</div>`;
            updateHudStats();
        });

        // Bật/tắt quyền System Crawler trên máy này
        btnSystemLock.addEventListener("click", () => {
            isSystemCrawlerAccount = !isSystemCrawlerAccount;
            chrome.storage.local.set({ is_system_crawler: isSystemCrawlerAccount }, () => {
                updateHudSystemLockState();
                alert(isSystemCrawlerAccount 
                    ? "✅ Đã kích hoạt quyền TÀI KHOẢN SYSTEM trên trình duyệt này! Bạn có thể bắt đầu cào tự động và đổ dữ liệu về CSDL."
                    : "🔒 Đã khóa quyền System Crawler trên trình duyệt này. Trình duyệt đã chuyển về chế độ an toàn dành cho tài khoản nhân viên."
                );
            });
        });

        let isMinimized = false;
        btnMin.addEventListener("click", () => {
            isMinimized = !isMinimized;
            hudBody.style.display = isMinimized ? "none" : "flex";
            btnMin.textContent = isMinimized ? "＋" : "—";
            hud.style.width = isMinimized ? "240px" : "390px";
        });

        updateHudSystemLockState();
        makeDraggable(hud, hud.querySelector("#__mk_hud_header__"));
    }

    function updateHudSystemLockState() {
        const badge = document.getElementById("__mk_hud_system_badge__");
        const notice = document.getElementById("__mk_hud_lock_notice__");
        const btn = document.getElementById("__mk_btn_toggle_scroll__");
        if (!badge) return;

        if (isSystemCrawlerAccount) {
            badge.textContent = "⚡ System Miner";
            badge.style.background = "#28a745";
            badge.style.color = "#fff";
            if (notice) notice.style.display = "none";
            if (btn && !window.__mkAutoScrollActive) {
                btn.disabled = false;
                btn.textContent = "▶ Bắt đầu Auto-Scroll & Lọc";
                btn.style.background = "#1877f2";
            }
        } else {
            badge.textContent = "🔒 Locked";
            badge.style.background = "#3a3b3c";
            badge.style.color = "#b0b3b8";
            if (notice) notice.style.display = "block";
            if (btn && !window.__mkAutoScrollActive) {
                btn.disabled = true;
                btn.textContent = "🔒 Yêu cầu Nick System";
                btn.style.background = "#4b4c4e";
            }
        }
    }

    function updateHudStatus(statusText) {
        const badge = document.getElementById("__mk_hud_status_badge__");
        if (badge) badge.textContent = statusText;
    }

    function updateHudStats() {
        const scannedEl = document.getElementById("__mk_hud_scanned_count__");
        const highEl = document.getElementById("__mk_hud_high_count__");
        const counterEl = document.getElementById("__mk_hud_list_counter__");
        if (scannedEl) scannedEl.textContent = window.__mkScannedCount;
        if (highEl) highEl.textContent = window.__mkScoredPosts.length;
        if (counterEl) counterEl.textContent = `${window.__mkScoredPosts.length} bài`;
    }

    function renderHudControlButtons() {
        const btn = document.getElementById("__mk_btn_toggle_scroll__");
        if (!btn) return;
        if (!isSystemCrawlerAccount) {
            btn.disabled = true;
            btn.textContent = "🔒 Yêu cầu Nick System";
            btn.style.background = "#4b4c4e";
            return;
        }

        btn.disabled = false;
        if (window.__mkAutoScrollActive) {
            btn.textContent = "⏸ Tạm dừng Auto-Scroll";
            btn.style.background = "#e4405f";
        } else {
            btn.textContent = "▶ Bắt đầu Auto-Scroll & Lọc";
            btn.style.background = "#1877f2";
        }
    }

    function addPostToHudCard(post) {
        const list = document.getElementById("__mk_hud_posts_list__");
        const emptyHint = document.getElementById("__mk_hud_empty_hint__");
        if (emptyHint) emptyHint.remove();
        if (!list) return;

        const scoreColor = post.ai_score >= 90 ? "#eab308" : "#4ade80";
        const badgeIcon = post.ai_score >= 90 ? "🔥" : "⭐";
        const shortContent = (post.content || "").length > 90 ? post.content.substring(0, 90) + "..." : post.content;

        const card = document.createElement("div");
        card.style.cssText = `
            background: #242526;
            border: 1px solid rgba(255,255,255,0.08);
            border-left: 4px solid ${scoreColor};
            border-radius: 8px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            animation: fadeIn 0.3s ease;
        `;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 700; color: #e4e6eb; font-size: 12px;">${post.author_name}</div>
                <div style="background: rgba(0,0,0,0.4); color: ${scoreColor}; font-weight: 800; font-size: 12px; padding: 2px 8px; border-radius: 12px; border: 1px solid ${scoreColor};">
                    ${badgeIcon} ${post.ai_score}đ
                </div>
            </div>
            <div style="font-size: 11px; color: #b0b3b8; line-height: 1.4;">${shortContent}</div>
            <div style="font-size: 10px; color: #a3e635; font-style: italic;">💡 ${post.ai_reason || "Lead tiềm năng"}</div>
            <div style="display: flex; gap: 6px; margin-top: 4px;">
                <a href="${post.post_url}" target="_blank" style="flex: 1; text-align: center; background: #3a3b3c; color: #2e89ff; padding: 4px 6px; border-radius: 6px; text-decoration: none; font-size: 11px; font-weight: 600;">Xem bài</a>
                <button class="__mk_copy_btn__" style="flex: 1; background: #3a3b3c; color: #e4e6eb; border: none; border-radius: 6px; font-size: 11px; cursor: pointer;">Copy Link</button>
            </div>
        `;

        const copyBtn = card.querySelector(".__mk_copy_btn__");
        copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(post.post_url);
            copyBtn.textContent = "✓ Đã copy!";
            setTimeout(() => { copyBtn.textContent = "Copy Link"; }, 1500);
        });

        list.prepend(card);
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.bottom = "auto";
            element.style.right = "auto";
        }
        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    // Tự động inject HUD khi đang ở trang Group Facebook
    if (window.location.href.includes("/groups/")) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", injectFloatingHud);
        } else {
            injectFloatingHud();
        }
    }

    // ── 6. Lắng nghe lệnh từ Popup Extension ─────────────────────────────────
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "START_AUTO_SCROLL_AI") {
            window.startFbAutoScroll(request.threshold || 80);
            sendResponse({ success: true, isScrolling: true });
            return true;
        } else if (request.action === "STOP_AUTO_SCROLL_AI") {
            window.stopFbAutoScroll();
            sendResponse({ success: true, isScrolling: false });
            return true;
        } else if (request.action === "GET_AUTO_SCROLL_STATUS") {
            sendResponse({
                success: true,
                isScrolling: window.__mkAutoScrollActive,
                scannedCount: window.__mkScannedCount,
                scoredPosts: window.__mkScoredPosts,
                threshold: window.__mkMinScoreThreshold
            });
            return true;
        }
    });

    console.log("🚀 [Markee Extension] Đã kích hoạt Auto-Scroll & AI Live Scoring Module!");
})();
