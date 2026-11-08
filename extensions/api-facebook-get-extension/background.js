// Thuật toán xáo trộn ngẫu nhiên Fisher-Yates chuẩn xác chống ban chu kỳ
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// background.js - Điều phối auto crawl API

let isRunning = false;
let shouldStop = false;
let currentTabId = null;

// Watchdog Lifecycle: Nếu người dùng đóng tab Web Seeding hoặc tắt trình duyệt,
// lập tức dừng cào và đóng sạch các tab cào ngầm để bảo vệ an toàn cho tài khoản.
let lastAppHeartbeat = Date.now();
function stopCrawlAndCloseCrawlTabs(reason = 'TAB_CLOSED') {
    shouldStop = true;
    isRunning = false;
    if (currentTabId) {
        chrome.tabs.remove(currentTabId).catch(() => {});
        currentTabId = null;
    }
    chrome.storage.local.set({ crawl_status: 'PAUSED_BY_USER_TAB_CLOSED' });
    sendLog(`🛑 [Lifecycle Watchdog] ${reason === 'TAB_CLOSED' ? 'Đã phát hiện tắt tab/app Web Seeding' : reason}. Đã lập tức dừng cào và đóng sạch các tab ngầm!`, false, 'warn');
}

setInterval(() => {
    if (isRunning && Date.now() - lastAppHeartbeat > 8000) {
        stopCrawlAndCloseCrawlTabs('Mất kết nối tab Web Seeding quá 8 giây');
    }
}, 3000);

// Nhận lệnh từ Popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_AUTO_CRAWL') {
        startAutoCrawl(msg.groups, msg.config || {});
        sendResponse({ success: true });
    } else if (msg.action === 'STOP_AUTO_CRAWL') {
        shouldStop = true;
        isRunning = false;
        sendLog('Cảnh báo: Yêu cầu dừng cào...');
        sendResponse({ success: true });
    } else if (msg.action === 'GROUP_FINISHED') {
        if (msg.reason === 'OLD_POSTS_LIMIT_REACHED') {
            sendLog('🛑 [Bộ Lọc Ngày] Đã phát hiện 15 bài viết cũ liên tiếp ngoài ngày hôm nay. Dừng cào nhóm hiện tại theo chỉ đạo và chuyển sang nhóm kế tiếp!', false, 'warn');
        } else if (msg.reason === 'MAX_SCROLLS_REACHED') {
            sendLog('🏁 Đã hoàn thành đủ số nhịp cuộn tối đa cho nhóm này. Chuyển nhóm...', false, 'info');
        }
        sendResponse({ received: true });
    } else if (msg.action === 'APP_TAB_HEARTBEAT' || msg.action === 'APP_TAB_ACTIVE') {
        lastAppHeartbeat = Date.now();
        sendResponse({ alive: true });
    } else if (msg.action === 'APP_TAB_CLOSING') {
        lastAppHeartbeat = 0;
        if (isRunning) {
            stopCrawlAndCloseCrawlTabs('Người dùng chủ động đóng tab Web Seeding');
        }
        sendResponse({ stopped: true });
    }
});

async function sendLog(message, isRaw = false, level = 'info') {
    // In ra console của service worker -- nơi duy nhất xem được log khi chạy
    // trên VPS (không có popup nào mở để nhận message này).
    if (level === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }

    // Gửi log cho Popup của Extension
    chrome.runtime.sendMessage({ action: 'LOG', message, isRaw }).catch(() => {});
    
    // Gửi log cho React Frontend thông qua bridge.js
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { 
                action: 'FRONTEND_LOG', 
                message, 
                level 
            }).catch(() => {});
        });
    });
}

function sendFrontendProgress(groupIndex, totalGroups) {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { 
                action: 'FRONTEND_PROGRESS', 
                groupIndex, 
                totalGroups 
            }).catch(() => {});
        });
    });
}

function sendFrontendDone(totalGroups, totalPosts) {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { 
                action: 'FRONTEND_DONE', 
                totalGroups, 
                totalPosts 
            }).catch(() => {});
        });
    });
}

let API_BASE = 'https://dev.seeding.markeeai.com'; // global fallback for save-posts (dev)

async function startAutoCrawl(groups, config = {}) {
    if (isRunning) return;
    isRunning = true;
    shouldStop = false;
    
    const idMember = config.idMember || null;
    // Use the API URL detected by popup, or fall back to storage (bridge.js).
    API_BASE = config.apiBase || (await chrome.storage.local.get('api_base_url')).api_base_url || API_BASE;
    sendLog(`🚀 Bắt đầu quá trình tự động cào ${groups.length} nhóm...`);

    try {
        const tab = await chrome.tabs.create({ url: 'https://www.facebook.com/', active: true });
        currentTabId = tab.id;

        let totalPostsCrawled = 0;
        let roundCount = 0;

        // Vòng lặp cào đa vòng kèm xáo trộn ngẫu nhiên Anti-Ban
        while (!shouldStop) {
            roundCount++;
            // Vòng 1 theo danh sách ban đầu, từ vòng 2 trở đi luôn xáo trộn ngẫu nhiên
            const currentGroups = roundCount === 1 ? [...groups] : shuffleArray(groups);

            sendLog(`\n🔄 ══════════════════════════════════════════════`, false, 'info');
            sendLog(`🚀 BẮT ĐẦU VÒNG CÀO THỨ ${roundCount} (${currentGroups.length} nhóm)${roundCount > 1 ? ' [ĐÃ XÁO TRỘN NGẪU NHIÊN 🎲]' : ''}`, false, 'success');
            sendLog(`══════════════════════════════════════════════`, false, 'info');

            for (let i = 0; i < currentGroups.length; i++) {
                if (shouldStop) break;
                
                sendFrontendProgress(i, currentGroups.length);
                
                const group = currentGroups[i];
                sendLog(`\n▶ [Vòng ${roundCount} | Nhóm ${i+1}/${currentGroups.length}] Đang xử lý: ${group.name || group.url}`, false, 'info');
                
                // Bước 1: Navigate tới Group
                await chrome.tabs.update(currentTabId, { url: group.url });
                await sleep(Math.floor(Math.random() * 2000) + 4500); // 4.5s - 6.5s
                
                if (shouldStop) break;

                // Bước 2: Reload vệ sinh session
                sendLog(`Vệ sinh session: Reload lần 1...`);
                await chrome.tabs.reload(currentTabId);
                await sleep(Math.floor(Math.random() * 2000) + 4500);
                
                sendLog(`Vệ sinh session: Reload lần 2...`);
                await chrome.tabs.reload(currentTabId);
                await sleep(Math.floor(Math.random() * 2000) + 5500);

                if (shouldStop) break;

                // Bước 3: Tiêm Content Script để gọi API GraphQL
                sendLog(`Đang tiêm lệnh gọi GraphQL API vào trang...`);
                let results = await chrome.scripting.executeScript({
                    target: { tabId: currentTabId },
                    files: ['content.js']
                }).catch(async (e) => {
                    sendLog(`❌ Lỗi tiêm script: ${e.message}. Tiến hành tải lại tab và thử lại...`);
                    await chrome.tabs.reload(currentTabId);
                    await sleep(5000);
                    return chrome.scripting.executeScript({
                        target: { tabId: currentTabId },
                        files: ['content.js']
                    }).catch(err => {
                        sendLog(`❌ Lỗi tiêm script (lần 2): ${err.message}.`);
                        return null;
                    });
                });

                if (!results || !results[0]) {
                    sendLog(`❌ Không thể thực thi script tại group này.`);
                    continue;
                }

                await sleep(1500);
                
                try {
                    sendLog(`Đang ra lệnh lấy 100 bài viết qua API...`);
                    const response = await chrome.tabs.sendMessage(currentTabId, {
                        action: "FETCH_API_POSTS",
                        count: 100
                    });

                    if (response && response.success && response.data) {
                        const postCount = response.data.length;
                        totalPostsCrawled += postCount;
                        sendLog(`✅ API trả về ${postCount} bài. Dữ liệu trích xuất được:`, false, 'success');
                        
                        response.data.forEach((p, idx) => {
                            const snippet = (p.content || '').substring(0, 50).replace(/\n/g, ' ') + (p.content?.length > 50 ? '...' : '');
                            sendLog(`   ${idx + 1}. [${p.author_name || 'Khách'}] ${snippet} (❤️ ${p.reactions || 0}, 💬 ${p.comments || 0})`, false, 'info');
                        });
                        
                        sendLog(`Đang gửi ${postCount} bài lên Backend để lọc & chấm điểm AI...`, false, 'info');
                        
                        let pushRes = null;
                        let backendRetry = 0;
                        while (backendRetry <= 2) {
                            try {
                                pushRes = await fetch(`${API_BASE}/api/all-platform/extension/save-posts`, {
                                    method: "POST",
                                    headers: { 
                                        "Content-Type": "application/json",
                                        "x-api-key": "markee-extension-key-2024"
                                    },
                                    body: JSON.stringify({
                                        posts: response.data,
                                        group_id: '',
                                        group_url: group.url,
                                        id_member: idMember,
                                        extension_version: "API-Automated-System-2.0",
                                        keywords: group.keywords || null,
                                        post_limit: group.post_limit ?? null,
                                        is_system_crawl: true,
                                        worker_type: "system_account"
                                    })
                                });
                                break;
                            } catch(err) {
                                if (backendRetry >= 2) throw err;
                                backendRetry++;
                                sendLog(`⚠️ Backend mất kết nối, thử lại lần ${backendRetry}/2...`, false, 'warn');
                                await sleep(2000);
                            }
                        }

                        if (pushRes && pushRes.ok) {
                            const pushData = await pushRes.json();
                            sendLog(`🎉 Backend phản hồi: Đã lưu ${pushData.count || 0} bài!`, false, 'success');
                        } else {
                            sendLog(`❌ Lỗi Backend: ${pushRes ? pushRes.status : 'Disconnected'}`, false, 'error');
                        }
                    } else {
                        sendLog(`⚠️ Không nhận được dữ liệu bài viết.`, false, 'warn');
                    }
                } catch (err) {
                    sendLog(`❌ Lỗi giao tiếp content script: ${err.message}`, false, 'error');
                }

                // Đọc thời gian nghỉ giữa các nhóm từ cấu hình cá nhân của user
                let userGroupRestSec = 45;
                try {
                    const storageRes = await chrome.storage.local.get(['fb_crawler_user_config']);
                    if (storageRes?.fb_crawler_user_config?.group_rest_sec) {
                        userGroupRestSec = parseInt(storageRes.fb_crawler_user_config.group_rest_sec, 10) || 45;
                    }
                } catch (e) {}

                // Nghỉ ngẫu nhiên giữa các nhóm (mô phỏng người thật chuyển tab): +-15s Jitter
                const jitterMs = (Math.floor(Math.random() * 15) - 7) * 1000;
                const interGroupDelay = Math.max(10000, (userGroupRestSec * 1000) + jitterMs);
                sendLog(`⏳ Nghỉ giãn cách giữa các nhóm: ${(interGroupDelay/1000).toFixed(1)}s (Theo cấu hình cá nhân, mô phỏng người thật chống checkpoint)...\n`);
                await sleep(interGroupDelay);
            }

            if (shouldStop) break;

            // Nếu không bật infiniteLoop trong config thì dừng sau 1 vòng
            if (config.singleRun) break;

            // Nghỉ ngơi giữa các vòng cào toàn bộ nhóm: 35s - 75s
            const roundCooldownMs = Math.floor(Math.random() * 40000) + 35000;
            sendLog(`\n⏸️ [Anti-Ban] Đã hoàn thành toàn bộ nhóm của Vòng ${roundCount}!`);
            sendLog(`🛌 Tạm nghỉ ngơi ${(roundCooldownMs/1000).toFixed(0)} giây trước khi xáo trộn ngẫu nhiên thứ tự nhóm cho Vòng ${roundCount + 1}...\n`);
            await sleep(roundCooldownMs);
        }

        sendLog(`\n🏁 HOÀN TẤT TOÀN BỘ TIẾN TRÌNH CÀO!`, false, 'success');
        sendFrontendDone(groups.length, totalPostsCrawled);

    } catch (e) {
        sendLog(`❌ Lỗi nghiêm trọng: ${e.message}`, false, 'error');
    } finally {
        isRunning = false;
        if (currentTabId) {
            chrome.tabs.remove(currentTabId).catch(() => {});
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Worker mode: cào theo hàng đợi job từ main server (dùng cho VPS worker) ──
// Khác với startAutoCrawl (kích hoạt thủ công từ tab đang mở), worker mode tự
// poll GET /next-job định kỳ (không cần user mở trang frontend), cào 1 group
// mỗi lần nhận job rồi báo kết quả kèm job_id/worker_id để main server đóng job.

const WORKER_POLL_ALARM = 'crawl-queue-poll';
let workerPolling = false; // chống chạy chồng nếu alarm bắn khi job trước chưa xong

async function getOrCreateWorkerId() {
    const stored = await chrome.storage.local.get('worker_id');
    if (stored.worker_id) return stored.worker_id;
    const workerId = crypto.randomUUID();
    await chrome.storage.local.set({ worker_id: workerId });
    return workerId;
}

async function getWorkerApiBase() {
    const stored = await chrome.storage.local.get(['worker_api_base', 'api_base_url']);
    return stored.worker_api_base || stored.api_base_url || API_BASE;
}

// ── FB Account Pool: tự "xin" 1 acc chưa ai dùng + tự inject cookie ──────────
// Giải quyết vấn đề VM bị cấp lại mất hết chrome.storage.local/cookie login,
// không cần RDP gõ tay -- worker tự claim 1 acc từ pool rồi set cookie thẳng.

async function hasFacebookLoginCookie() {
    const cookie = await chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' });
    return !!cookie;
}

async function claimFbAccount(apiBase, idMember) {
    const workerId = await getOrCreateWorkerId();
    let url = `${apiBase}/api/all-platform/extension/accounts/claim?worker_id=${encodeURIComponent(workerId)}&worker_name=${encodeURIComponent('vps-' + workerId.slice(0, 8))}`;
    if (idMember) url += `&id_member=${encodeURIComponent(idMember)}`;
    const res = await fetch(url, { headers: { 'x-api-key': 'markee-extension-key-2024' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.account || null;
}

async function applyFbAccountCookies(account, idMember) {
    for (const cookie of account.cookies) {
        try {
            await chrome.cookies.set(cookie);
        } catch (e) {
            sendLog(`⚠️ Lỗi set cookie ${cookie.name}: ${e.message}`, false, 'warn');
        }
    }
    await chrome.storage.local.set({
        fb_account_id: account.id,
        fb_account_email: account.email,
        fb_account_member_id: idMember || account.id_member || null
    });
}

async function ensureFbAccountReady(apiBase) {
    if (await hasFacebookLoginCookie()) return true; // đã có session hợp lệ, không cần xin acc mới

    sendLog('🔑 [FB Account Pool] Chưa có cookie login hợp lệ, đang xin 1 acc chưa ai dùng...');
    const account = await claimFbAccount(apiBase);
    if (!account) {
        sendLog('⚠️ [FB Account Pool] Hết acc khả dụng trong pool, chờ lượt poll kế tiếp.', false, 'warn');
        return false;
    }

    await applyFbAccountCookies(account);
    sendLog(`✅ [FB Account Pool] Đã nhận acc ${account.email}.`, false, 'success');
    return true;
}

// Khác với ensureFbAccountReady (chỉ cần "có acc bất kỳ", dùng cho luồng cào thủ công
// startAutoCrawl() từ popup) -- hàm này đảm bảo acc đang cầm ĐÚNG CHỦ (id_member) của
// job worker-queue sắp cào (nhóm Facebook là nhóm kín, chỉ acc đúng thành viên mới xem
// được bài). Tự đổi acc (đăng nhập lại cookie) nếu acc hiện tại không đúng chủ.
async function ensureFbAccountForJob(apiBase, idMember) {
    const stored = await chrome.storage.local.get(['fb_account_id', 'fb_account_member_id']);
    if (stored.fb_account_id && stored.fb_account_member_id === idMember && await hasFacebookLoginCookie()) {
        return true; // đã đúng acc rồi, khỏi đổi (case phổ biến nhờ sticky-preference lúc claim job)
    }

    sendLog('🔑 [FB Account Pool] Cần đổi acc cho đúng nhân viên sở hữu nhóm, đang xin acc...');
    const account = await claimFbAccount(apiBase, idMember);
    if (!account) {
        sendLog('⚠️ [FB Account Pool] Không có acc khả dụng cho nhân viên này, chờ lượt poll kế tiếp.', false, 'warn');
        return false;
    }

    await applyFbAccountCookies(account, idMember);
    sendLog(`✅ [FB Account Pool] Đã đổi acc ${account.email}.`, false, 'success');
    return true;
}

async function reportAccountInvalid(apiBase, reason) {
    const stored = await chrome.storage.local.get('fb_account_id');
    if (!stored.fb_account_id) return;
    try {
        await fetch(`${apiBase}/api/all-platform/extension/accounts/report-invalid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'markee-extension-key-2024' },
            body: JSON.stringify({
                worker_id: await getOrCreateWorkerId(),
                account_id: stored.fb_account_id,
                error_message: String(reason).slice(0, 500)
            })
        });
    } catch (e) {
        // Bỏ qua -- nếu báo lỗi cũng lỗi, acc vẫn còn 'assigned' cho worker này,
        // sẽ tự bị thả về 'available' nếu worker mất heartbeat luôn (xem WORKER_STALE_SECONDS).
    } finally {
        await chrome.storage.local.remove('fb_account_id'); // lượt poll kế tiếp tự xin acc mới
    }
}

// Backend đã có sẵn endpoint /heartbeat (upsert_worker_heartbeat) nhưng trước đây không
// bên nào gọi tới -- heartbeat chỉ được set 1 lần lúc claim job (GET /next-job), không
// refresh trong lúc đang cào (16-30s+, có thể lâu hơn nếu FB chậm). Nếu 1 job cào lâu hơn
// WORKER_STALE_SECONDS (90s) mà không có heartbeat mới, backend sẽ coi worker "chết" và
// giao job đang cào thật cho VPS khác -> cào trùng. Gọi hàm này ở vài checkpoint xuyên suốt
// crawlSingleGroupJob để tránh khoảng trống heartbeat nào vượt quá ngưỡng đó.
async function sendWorkerHeartbeat(apiBase, workerId) {
    try {
        await fetch(`${apiBase}/api/all-platform/extension/queue/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'markee-extension-key-2024'
            },
            body: JSON.stringify({
                worker_id: workerId,
                worker_name: 'vps-' + workerId.slice(0, 8),
                status: 'busy' // phải gửi rõ 'busy' -- HeartbeatRequest.status mặc định 'idle' nếu bỏ trống
            })
        });
    } catch (e) {
        // Bỏ qua lỗi heartbeat giữa lúc cào -- không làm gián đoạn job, heartbeat kế tiếp tự bù.
    }
}

async function crawlSingleGroupJob(job, apiBase) {
    const workerId = await getOrCreateWorkerId();
    const tab = await chrome.tabs.create({ url: 'https://www.facebook.com/', active: false });
    const tabId = tab.id;
    try {
        await chrome.tabs.update(tabId, { url: job.group_url });
        await sleep(5000);
        await chrome.tabs.reload(tabId);
        await sleep(5000);
        await sendWorkerHeartbeat(apiBase, workerId);
        await chrome.tabs.reload(tabId);
        await sleep(6000);

        if (!(await hasFacebookLoginCookie())) {
            throw new Error('FB_LOGIN_LOST');
        }

        let results = await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        }).catch(async () => {
            await chrome.tabs.reload(tabId);
            await sleep(5000);
            return chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => null);
        });

        if (!results || !results[0]) {
            throw new Error('Không thể tiêm content script vào group này.');
        }

        await sendWorkerHeartbeat(apiBase, workerId);
        await sleep(1000);
        const response = await chrome.tabs.sendMessage(tabId, { action: 'FETCH_API_POSTS', count: 100 });
        if (!response || !response.success || !response.data) {
            const detail = response && response.error ? response.error : 'không có phản hồi hợp lệ';
            throw new Error(`Không nhận được dữ liệu bài viết từ content script: ${detail}`);
        }

        await sendWorkerHeartbeat(apiBase, workerId);
        const pushRes = await fetch(`${apiBase}/api/all-platform/extension/save-posts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'markee-extension-key-2024'
            },
            body: JSON.stringify({
                posts: response.data,
                group_id: job.group_id || '',
                group_url: job.group_url,
                group_name: job.group_name,
                id_member: job.id_member,
                extension_version: 'Worker-Queue-1.0',
                keywords: job.keywords || null,
                post_limit: job.post_limit ?? null,
                job_id: job.id,
                worker_id: workerId
            })
        });

        if (!pushRes.ok) {
            throw new Error(`Backend từ chối kết quả: HTTP ${pushRes.status}`);
        }
    } finally {
        chrome.tabs.remove(tabId).catch(() => {});
    }
}

async function reportJobFailure(job, apiBase, errorMessage) {
    try {
        await fetch(`${apiBase}/api/all-platform/extension/queue/job-result`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'markee-extension-key-2024'
            },
            body: JSON.stringify({
                job_id: job.id,
                worker_id: await getOrCreateWorkerId(),
                success: false,
                error_message: String(errorMessage).slice(0, 500)
            })
        });
    } catch (e) {
        // Không có gì thêm để làm nếu report lỗi cũng lỗi -- job sẽ tự requeue
        // sau khi heartbeat của worker này hết hạn (xem WORKER_STALE_SECONDS ở backend).
    }
}

async function pollNextJob() {
    if (workerPolling || isRunning) return; // isRunning: đang có luồng cào thủ công từ popup
    workerPolling = true;
    try {
        const workerId = await getOrCreateWorkerId();
        const apiBase = await getWorkerApiBase();

        // Poll job TRƯỚC (kèm acc đang cầm sẵn, nếu có, để backend ưu tiên job cùng chủ) --
        // chỉ sau khi biết job.id_member mới xác định cần acc nào, tránh xin acc mù trước
        // khi biết job kế tiếp thuộc về ai.
        const currentMember = (await chrome.storage.local.get('fb_account_member_id')).fb_account_member_id || '';
        let url = `${apiBase}/api/all-platform/extension/queue/next-job?worker_id=${encodeURIComponent(workerId)}&worker_name=${encodeURIComponent('vps-' + workerId.slice(0, 8))}`;
        if (currentMember) url += `&current_id_member=${encodeURIComponent(currentMember)}`;

        const res = await fetch(url, { headers: { 'x-api-key': 'markee-extension-key-2024' } });
        if (!res.ok) return;
        const data = await res.json();
        const job = data.job;
        if (!job) return; // không có job -> đã tự cập nhật heartbeat "idle" phía server

        const ready = await ensureFbAccountForJob(apiBase, job.id_member || null);
        if (!ready) {
            sendLog(`⚠️ [Worker Queue] Không có acc FB khả dụng cho nhân viên sở hữu nhóm này, báo job lỗi để thử lại sau...`, false, 'warn');
            await reportJobFailure(job, apiBase, 'NO_FB_ACCOUNT_FOR_MEMBER');
            return;
        }

        sendLog(`📥 [Worker Queue] Nhận job cào: ${job.group_name || job.group_url}`);
        try {
            await crawlSingleGroupJob(job, apiBase);
            sendLog(`✅ [Worker Queue] Hoàn tất job ${job.id}`, false, 'success');
        } catch (e) {
            sendLog(`❌ [Worker Queue] Job ${job.id} lỗi: ${e.message}`, false, 'error');
            await reportJobFailure(job, apiBase, e.message);

            if (e.message === 'FB_LOGIN_LOST' || !(await hasFacebookLoginCookie())) {
                sendLog('🚨 [FB Account Pool] Phát hiện mất login, báo acc hỏng...', false, 'warn');
                await reportAccountInvalid(apiBase, e.message);
            }
        }
    } catch (e) {
        // Lỗi mạng khi poll -- bỏ qua, alarm kế tiếp sẽ tự thử lại.
    } finally {
        workerPolling = false;
    }
}

(async () => {
    const apiBase = await getWorkerApiBase();
    await ensureFbAccountReady(apiBase);
})();

chrome.alarms.create(WORKER_POLL_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WORKER_POLL_ALARM) {
        pollNextJob();
    }
});
