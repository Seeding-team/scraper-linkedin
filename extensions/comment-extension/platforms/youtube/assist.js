// Hỗ trợ comment YouTube từ tab "Seeding bên ngoài" của Markee (phiên do bg/youtube-crawl.js tạo
// khi trang web gửi MK_YT_COMMENT_OPEN):
//   1. Tab video mở ra -> hỏi background có phiên comment cho tab này không (MK_YT_ASSIST_GET).
//   2. Kiểm tra kênh YouTube đang đăng nhập có đúng kênh đã liên kết không (cảnh báo nếu sai).
//   3. Điền sẵn nội dung comment vào ô bình luận — KHÔNG tự bấm gửi.
//   4. Nhân viên tự bấm "Bình luận" (chỉ nhận click thật, event.isTrusted) -> chờ comment mới
//      hiện lên (lấy link comment + kênh đã đăng) -> MK_YT_ASSIST_POSTED để background báo KPI.
// Dùng lại các hàm tìm xuyên Shadow DOM của youtube-handler.js (findDeep, findAllDeep,
// waitForElementDeep, humanComboClick, scanForActiveShortsCommentButton, delay) và
// mkYtDetectAccount của crawl.js — cùng isolated world, nạp trước file này trong manifest.
(function () {
    if (window.__mkYtAssistLoaded) return;
    window.__mkYtAssistLoaded = true;

    const OVERLAY_ID = "mk-yt-assist-overlay";
    const POST_WAIT_MS = 20000;

    let active = null;
    let starting = false;

    function videoIdFromUrl(url) {
        const m = String(url || "").match(/(?:[?&]v=|\/shorts\/|\/live\/|youtu\.be\/)([\w-]{11})/);
        return m ? m[1] : null;
    }

    function normText(s) {
        return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function normHandle(h) {
        const v = String(h || "").trim().toLowerCase();
        return v ? (v.startsWith("@") ? v : `@${v}`) : "";
    }

    function handleFromHref(href) {
        const m = String(href || "").match(/\/(@[^/?#]+)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function matchesExpected(account, expected) {
        if (!account || !expected) return false;
        const stored = String(expected.profile_id || "").trim();
        if (account.channel_id && stored === account.channel_id) return true;
        const handles = [stored, expected.handle].map(normHandle).filter(Boolean);
        return !!account.handle && handles.includes(normHandle(account.handle));
    }

    // ── Khung thông báo nhỏ góc dưới trái ────────────────────────────────────

    function showOverlay(message, tone = "info", actions = []) {
        let box = document.getElementById(OVERLAY_ID);
        if (!box) {
            box = document.createElement("div");
            box.id = OVERLAY_ID;
            box.style.cssText = [
                "position:fixed", "left:16px", "bottom:16px", "z-index:2147483646", "max-width:360px",
                "background:#fff", "color:#0f0f0f", "border-radius:12px", "box-shadow:0 8px 28px rgba(0,0,0,.25)",
                "font:13px/1.45 Roboto,Arial,sans-serif", "padding:12px 14px", "border-left:4px solid #3b82f6",
            ].join(";");
            document.documentElement.appendChild(box);
        }
        const color = { info: "#3b82f6", success: "#16a34a", warn: "#d97706", error: "#dc2626" }[tone] || "#3b82f6";
        box.style.borderLeftColor = color;
        box.textContent = "";

        const head = document.createElement("div");
        head.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px";
        const title = document.createElement("strong");
        title.textContent = "Markee Seeding";
        title.style.color = color;
        const close = document.createElement("button");
        close.textContent = "×";
        close.title = "Ẩn";
        close.style.cssText = "border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#606060";
        close.onclick = () => box.remove();
        head.append(title, close);

        const body = document.createElement("div");
        body.style.whiteSpace = "pre-line";
        body.textContent = message;
        box.append(head, body);

        if (actions.length) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap";
            for (const a of actions) {
                const btn = document.createElement("button");
                btn.textContent = a.label;
                btn.style.cssText = "border:1px solid #d0d0d0;background:#f8f8f8;border-radius:8px;padding:4px 10px;cursor:pointer;font:12px Roboto,Arial,sans-serif";
                btn.onclick = a.onClick;
                row.appendChild(btn);
            }
            box.appendChild(row);
        }
    }

    function copyAction(text) {
        return {
            label: "Chép nội dung",
            onClick: () => navigator.clipboard.writeText(text).catch(() => {}),
        };
    }

    // ── Điền sẵn comment ─────────────────────────────────────────────────────

    async function openCommentBoxRoot() {
        if (location.pathname.startsWith("/shorts/")) {
            await delay(2500);
            const btn = await scanForActiveShortsCommentButton(15000);
            if (!btn) throw new Error("Không tìm thấy nút mở bình luận của Shorts.");
            humanComboClick(btn);
            await delay(2500);
            return (await waitForElementDeep("ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-comments-section'], ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-comments'], ytd-engagement-panel-section-list-renderer", 6000)) || document;
        }
        // Video thường: khung bình luận chỉ tải khi cuộn tới gần.
        for (let i = 0; i < 6 && !findDeep("ytd-comments ytd-comment-simplebox-renderer, ytd-comments #placeholder-area"); i++) {
            window.scrollBy({ top: 700, behavior: "smooth" });
            await delay(1200);
        }
        return document;
    }

    async function prefill(text) {
        const root = await openCommentBoxRoot();
        const placeholder = await waitForElementDeep("#placeholder-area, #simplebox-placeholder, yt-formatted-string.simplebox-placeholder", 10000, root);
        if (!placeholder) throw new Error("Không thấy ô bình luận (video có thể đã tắt bình luận).");
        placeholder.scrollIntoView({ block: "center", behavior: "smooth" });
        await delay(600);
        humanComboClick(placeholder);
        await delay(1500);

        const textbox = await waitForElementDeep('#contenteditable-root[contenteditable="true"]', 8000, root);
        if (!textbox) throw new Error("Không mở được ô nhập bình luận.");
        textbox.focus();
        let inserted = false;
        try {
            document.execCommand("selectAll", false);
            inserted = document.execCommand("insertText", false, text);
        } catch (e) {
            inserted = false;
        }
        if (!inserted || !normText(textbox.textContent)) textbox.textContent = text;
        textbox.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
        return textbox;
    }

    // ── Bắt lúc nhân viên bấm "Bình luận" ────────────────────────────────────

    function commentElements() {
        return findAllDeep("#content-text");
    }

    async function waitForPostedComment(text, knownNodes) {
        const target = normText(text).slice(0, 60);
        const started = Date.now();
        while (Date.now() - started < POST_WAIT_MS) {
            for (const el of commentElements()) {
                if (knownNodes.has(el)) continue;
                const content = normText(el.textContent);
                if (!content || !(content.startsWith(target) || target.startsWith(content.slice(0, 60)))) continue;
                const container = el.closest("ytd-comment-view-model, ytd-comment-renderer") || el.parentElement;
                const author = container && container.querySelector("#author-text, a[href^='/@']");
                const timeLink = container && container.querySelector("#published-time-text a, a[href*='lc=']");
                return {
                    link: timeLink ? new URL(timeLink.getAttribute("href"), location.origin).href : null,
                    authorHandle: author ? handleFromHref(author.getAttribute("href")) : null,
                };
            }
            await delay(800);
        }
        return null;
    }

    async function onSubmitClick(event, commentbox) {
        const textbox = commentbox.querySelector("#contenteditable-root") || (active && active.textbox);
        const text = ((textbox && textbox.innerText) || "").trim();
        if (!text) return;
        active.posting = true;
        const knownNodes = new Set(commentElements());
        showOverlay("Đang chờ YouTube đăng bình luận...", "info");

        const posted = await waitForPostedComment(text, knownNodes);
        if (!posted) {
            active.posting = false;
            showOverlay("Chưa thấy bình luận hiện lên sau 20 giây nên chưa báo KPI. Nếu YouTube báo lỗi, hãy bấm Bình luận lại.", "warn");
            return;
        }

        const account = active.account || {};
        // Tác giả của comment vừa hiện là bằng chứng chắc nhất về kênh đã đăng.
        const sameAsDetected = !posted.authorHandle || !account.handle || normHandle(posted.authorHandle) === normHandle(account.handle);
        const report = {
            content: text,
            link_comment: posted.link,
            detected_handle: posted.authorHandle || account.handle || null,
            detected_channel_id: sameAsDetected ? account.channel_id || null : null,
            detected_name: account.name || null,
        };
        let res = null;
        try {
            res = await chrome.runtime.sendMessage({ action: "MK_YT_ASSIST_POSTED", report });
        } catch (e) {
            res = { success: false, message: "Mất kết nối với Extension — hãy F5 trang Markee rồi thử lại." };
        }
        active.posting = false;
        active.reported = !!(res && res.success);
        if (active.reported) {
            showOverlay("Đã ghi nhận bình luận và tính KPI cho tài khoản Markee của bạn. Có thể đóng tab này.", "success");
        } else {
            showOverlay(`Đã bình luận nhưng CHƯA tính KPI: ${(res && res.message) || "lỗi không xác định"}`, "error");
        }
    }

    document.addEventListener("click", (event) => {
        if (!active || active.reported || active.posting || !event.isTrusted) return;
        const path = event.composedPath();
        const isSubmit = path.some((el) => el && el.id === "submit-button");
        const commentbox = path.find((el) => el && el.tagName === "YTD-COMMENTBOX");
        if (!isSubmit || !commentbox) return;
        onSubmitClick(event, commentbox);
    }, true);

    // ── Khởi động theo từng lần điều hướng (YouTube là SPA) ──────────────────

    async function start() {
        if (starting) return;
        starting = true;
        let res = null;
        try {
            res = await chrome.runtime.sendMessage({ action: "MK_YT_ASSIST_GET" });
        } catch (e) {
            res = null;
        } finally {
            starting = false;
        }
        const session = res && res.session;
        const videoId = videoIdFromUrl(location.href);
        if (!session || !videoId || videoId !== videoIdFromUrl(session.url)) return;
        if (active && active.videoId === videoId) return;
        active = { videoId, session, account: null, textbox: null, posting: false, reported: false };
        await prepare();
    }

    async function prepare() {
        const session = active.session;
        showOverlay("Đang kiểm tra kênh YouTube và điền sẵn bình luận...", "info");
        const expected = session.expectedChannel || {};
        let warning = "";
        try {
            active.account = await window.mkYtDetectAccount();
        } catch (e) {
            active.account = null;
        }
        if (!active.account || !active.account.loggedIn) {
            // Chưa đăng nhập thì YouTube không cho bình luận — không cố điền, chỉ hướng dẫn.
            // Đăng nhập xong YouTube tải lại trang, phiên Markee của tab vẫn còn nên sẽ tự điền lại.
            showOverlay(
                `Trình duyệt chưa đăng nhập YouTube. Hãy đăng nhập đúng kênh đã liên kết${expected.name ? ` ("${expected.name}")` : ""} — Markee sẽ tự điền lại nội dung sau khi đăng nhập.`,
                "error",
                [copyAction(session.text), { label: "Kiểm tra lại", onClick: () => prepare() }],
            );
            return;
        }
        if (!matchesExpected(active.account, expected)) {
            const who = active.account.name || active.account.handle || active.account.channel_id;
            warning = `Bạn đang đăng nhập kênh "${who}", KHÔNG phải kênh đã liên kết "${expected.name || expected.profile_id}". Comment bằng kênh này sẽ không được tính KPI.`;
        }

        try {
            active.textbox = await prefill(session.text);
            const done = "Đã điền sẵn nội dung. Kiểm tra lại rồi tự bấm \"Bình luận\" — Markee sẽ tự ghi nhận KPI.";
            showOverlay(warning ? `${warning}\n\n${done}` : done, warning ? "warn" : "info", [copyAction(session.text)]);
        } catch (e) {
            const hint = warning
                ? `${warning}\n\nKhông tự điền được bình luận: ${e.message}`
                : `Không tự điền được bình luận: ${e.message} Bạn có thể dán nội dung và tự bấm "Bình luận", Markee vẫn ghi nhận KPI.`;
            showOverlay(hint, "warn", [
                copyAction(session.text),
                { label: "Thử điền lại", onClick: () => prefill(session.text).then((tb) => { active.textbox = tb; }).catch(() => {}) },
            ]);
        }
    }

    document.addEventListener("yt-navigate-finish", () => start());
    start();
})();
