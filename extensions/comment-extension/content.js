// Lắng nghe lệnh từ background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXECUTE_COMMENT") {
    executeComment(request.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // asynchronous
  }
});

// Facebook đổi doc_id của useCometUFICreateCommentMutation theo từng bản deploy —
// hardcode 1 giá trị sẽ hỏng dần. graphql-sniffer.js (chạy ở MAIN world) bắt trực
// tiếp doc_id thật mỗi khi CÓ AI đăng comment thật trên Facebook (kể cả tab khác),
// lưu vào chrome.storage.local để dùng lại. Lần đầu cài extension, hãy tự tay đăng
// 1 comment thật bất kỳ trên Facebook để "hiệu chỉnh" giá trị này trước khi seeding.
const FALLBACK_DOC_ID = "36574905442124839";
const CAPTURE_STORAGE_KEY = "fbGraphqlCapture_useCometUFICreateCommentMutation";
const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // quá 7 ngày thì không tin tưởng nữa, quay lại giá trị dự phòng

let capturedDocId = null;

chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
  const cached = result?.[CAPTURE_STORAGE_KEY];
  if (cached && Date.now() - cached.capturedAt < CAPTURE_MAX_AGE_MS) {
    capturedDocId = cached.docId;
  }
});

document.addEventListener("fb-graphql-docid-captured", (evt) => {
  try {
    const { friendlyName, docId } = evt.detail || {};
    if (friendlyName !== "useCometUFICreateCommentMutation" || !docId) return;
    capturedDocId = docId;
    chrome.storage.local.set({
      [CAPTURE_STORAGE_KEY]: { docId, capturedAt: Date.now() },
    });
    console.log("[Comment Extension] Đã bắt được doc_id comment mới nhất từ Facebook:", docId);
  } catch (e) {
    // Bỏ qua nếu payload bắt được không hợp lệ
  }
});

// Hiển thị Toast thông báo xanh cho người dùng khi tương tác bài mục tiêu thành công
function showToastNotification(msg) {
  try {
    let toast = document.getElementById("markee-extension-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "markee-extension-toast";
      toast.style.position = "fixed";
      toast.style.bottom = "24px";
      toast.style.right = "24px";
      toast.style.zIndex = "99999999";
      toast.style.backgroundColor = "#10b981";
      toast.style.color = "#ffffff";
      toast.style.padding = "12px 20px";
      toast.style.borderRadius = "12px";
      toast.style.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)";
      toast.style.fontSize = "14px";
      toast.style.fontWeight = "600";
      toast.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      toast.style.display = "flex";
      toast.style.alignItems = "center";
      toast.style.gap = "8px";
      toast.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    setTimeout(() => {
      if (toast) {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
      }
    }, 3500);
  } catch (e) {}
}

// 1. Tự động xóa config trong bộ nhớ session & local ngay khi người dùng đóng tab Facebook
window.addEventListener("beforeunload", () => {
  try {
    // Content script mặc định KHÔNG có quyền chrome.storage.session -> promise reject
    // "Access to storage is not allowed from this context" thành lỗi unhandled trên trang.
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.clear().catch(() => {});
    }
    chrome.storage.local.remove(["markee_verify_config", "markee_email_member"]);
  } catch (e) {}
});

// Hàm đọc config ưu tiên từ chrome.storage.session (nếu không có mới đọc local)
function getStoredConfig(callback) {
  const keys = ["markee_verify_config", "markee_email_member"];
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.get(keys, (sessionData) => {
      if (sessionData && sessionData.markee_verify_config && sessionData.markee_verify_config.email_member) {
        return callback(sessionData);
      }
      chrome.storage.local.get(keys, callback);
    });
  } else {
    chrome.storage.local.get(keys, callback);
  }
}

// Hàm bóc tách ID toàn năng cho mọi loại link Facebook
function getUniversalFacebookId(url) {
  if (!url) return "";

  // 1. Quét các định dạng có từ khóa rõ ràng: /posts/, /permalink/, /reel/, /videos/, /fbid=, v=
  const keywordMatch = url.match(/(?:\/posts\/|\/permalink\/|\/reel\/|\/videos\/|v=|fbid=|\/story\.php\?story_fbid=)([0-9]+)/);
  if (keywordMatch && keywordMatch[1]) {
    return keywordMatch[1];
  }

  // 2. Quét các cụm số đứng sau dấu gạch chéo (Thường gặp ở link rút gọn sau khi trình duyệt redirect)
  const slashMatch = url.match(/\/([0-9]{10,})(?:\/|\?|$)/);
  if (slashMatch && slashMatch[1]) {
    return slashMatch[1];
  }

  // 3. Fallback cuối cùng: Lọc ra chuỗi số dài nhất (từ 10 chữ số trở lên) có mặt trong URL
  const allNumbers = url.match(/[0-9]{10,}/g);
  if (allNumbers && allNumbers.length > 0) {
    // Trả về chuỗi số dài nhất tìm được (tránh lấy nhầm ID tài khoản cá nhân ngắn)
    return allNumbers.reduce((a, b) => (a.length >= b.length ? a : b));
  }

  return "";
}

let reelShareTimer = null;

// Lắng nghe sự kiện Like/Share bắt được từ graphql-sniffer.js (MAIN world)
document.addEventListener("markee-action-captured", (evt) => {
  try {
    const { actionType, fbUid, postUrl, delayMs, content } = evt.detail || {};
    if (!actionType) return;

    const executeRecordAction = () => {
      // Gửi yêu cầu tới Background kiểm tra xem TAB HIỆN TẠI có phải là Tab mục tiêu được cấp quyền không
      chrome.runtime.sendMessage({ action: "CHECK_TAB_PERMISSION" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.allowed) {
          // Sai tab hoặc Tab mục tiêu đã đóng (Session đã tự hủy) -> CÂM LẶNG 100%, KHÔNG LOG, KHÔNG TOAST
          return;
        }

        const verifyConfig = response.config || {};
        const emailMember = verifyConfig.email_member || "";
        if (!emailMember) return;

        // ĐÚNG TAB MỤC TIÊU ĐƯỢC CẤP QUYỀN -> Hiển thị Toast thông báo xanh cho người dùng
        const actionLabel = actionType === "like" ? "Like" : (actionType === "comment" ? "Comment" : "Share");
        showToastNotification(`✅ Đã ghi nhận ${actionLabel} thành công!`);

        let apiBase = verifyConfig.apiBase || "https://seeding.markeeai.com";
        if (!apiBase || typeof apiBase !== "string" || !apiBase.startsWith("http")) {
          apiBase = "https://seeding.markeeai.com";
        }
        apiBase = apiBase.replace(/\/$/, "");

        const kpiPayload = {
          email_member: emailMember,
          link_post: verifyConfig.target_link || postUrl,
          fanpage_id: verifyConfig.fanpage_id || "",
          fanpage_name: verifyConfig.fanpage_name || "",
          facebook_post_id: verifyConfig.facebook_post_id || "unknown",
          action_type: actionType,
          content: content || "",
          profile_id: fbUid || "",
          status: "success",
        };

        const recordEndpoint = `${apiBase}/api/all-platform/internal-engagement/kpi/record`;
        console.log(`[Comment Extension] Ghi nhận ${actionType} cho Tab mục tiêu:`, kpiPayload);

        chrome.runtime.sendMessage({
            action: "RECORD_KPI_BACKGROUND",
            endpoint: recordEndpoint,
            payload: kpiPayload
        }, (res) => {
            if (res && res.success) {
                console.log("[Comment Extension] Đã lưu KPI thành công.");
            }
        });
      });
    };

    // Nếu là thao tác Share Reel (có delayMs), hoãn 3s trước khi hiển thị Toast và đẩy KPI về Supabase
    if (delayMs && delayMs > 0) {
      if (reelShareTimer) clearTimeout(reelShareTimer);
      console.log(`[Comment Extension] Bắt được thao tác Share Reel, chờ ${delayMs}ms trước khi gửi KPI...`);
      reelShareTimer = setTimeout(executeRecordAction, delayMs);
    } else {
      executeRecordAction();
    }
  } catch (e) {}
});


function getTokensFromPage() {
  return new Promise((resolve, reject) => {
    try {
      const html = document.documentElement.innerHTML;
      let fb_dtsg = "";
      let lsd = "";
      let uid = "";
      let spin_r = "";
      let spin_t = "";
      let jazoest = "";

      const dtsgMatch = html.match(/"DTSGInitialData",\s*\[\],\s*\{"token":"(.*?)"\}/) || html.match(/"fb_dtsg"\s*value="(.*?)"/);
      if (dtsgMatch) fb_dtsg = dtsgMatch[1];
      if (!fb_dtsg) {
        const input = document.querySelector('input[name="fb_dtsg"]');
        if (input) fb_dtsg = input.value;
      }

      const lsdMatch = html.match(/"LSD",\s*\[\],\s*\{"token":"(.*?)"\}/);
      if (lsdMatch) lsd = lsdMatch[1];

      const uidMatch = html.match(/"USER_ID":"(\d+)"/) || html.match(/"ACCOUNT_ID":"(\d+)"/);
      if (uidMatch) uid = uidMatch[1];

      const spinRMatch = html.match(/"__spin_r":(\d+)/);
      if (spinRMatch) spin_r = spinRMatch[1];

      const spinTMatch = html.match(/"__spin_t":(\d+)/);
      if (spinTMatch) spin_t = spinTMatch[1];

      const jazoestMatch = html.match(/"jazoest"\s*value="(.*?)"/) || html.match(/jazoest=(\d+)/);
      if (jazoestMatch) {
        jazoest = jazoestMatch[1];
      } else if (fb_dtsg) {
        let j = 0;
        for (let i = 0; i < fb_dtsg.length; i++) {
          j += fb_dtsg.charCodeAt(i);
        }
        jazoest = "2" + j;
      }

      resolve({ fb_dtsg, lsd, uid, spin_r, spin_t, jazoest });
    } catch (e) {
      reject(new Error("Lỗi khi quét token: " + e.message));
    }
  });
}

async function executeComment(payload) {
  const { url, text } = payload;
  const currentUrl = window.location.href;

  // RẼ NHÁNH CHO REEL: Cách ly tuyệt đối luồng Reel để bảo vệ luồng bài viết thường
  const isReel = url.includes("/reel/") || url.includes("/reels/") || currentUrl.includes("/reel/") || currentUrl.includes("/reels/");
  if (isReel) {
    console.log("[Comment Extension] Phát hiện bài viết Facebook Reel. Kích hoạt luồng Reel riêng biệt.");
    return await executeReelComment(payload);
  }

  // Tách Post ID với cơ chế 3-Layer Fallback (Bao bọc mọi loại URL kể cả pfbid)
  let postId = null;

  // LỚP 1: Quét từ URL payload gửi lên (Hỗ trợ chữ, số, dấu gạch dưới của pfbid)
  const urlMatch = url.match(/\/(?:posts|permalink|videos|story|reel|reels)\/([a-zA-Z0-9_]+)/i) || url.match(/fbid=([a-zA-Z0-9_]+)/i) || url.match(/story_fbid=([a-zA-Z0-9_]+)/i);
  if (urlMatch && urlMatch[1]) {
    postId = urlMatch[1];
  }

  // LỚP 2: Quét từ URL thực tế của tab đang mở (Phòng trường hợp link rút gọn đã redirect)
  if (!postId) {
    const currentUrl = window.location.href;
    const currentMatch = currentUrl.match(/\/(?:posts|permalink|videos|story)\/([a-zA-Z0-9_]+)/i) || currentUrl.match(/fbid=([a-zA-Z0-9_]+)/i) || currentUrl.match(/story_fbid=([a-zA-Z0-9_]+)/i);
    if (currentMatch && currentMatch[1]) {
      postId = currentMatch[1];
    }
  }

  // LỚP 3: Quét trực tiếp trong mã nguồn DOM của Facebook
  if (!postId) {
    // Ưu tiên thẻ meta og:url
    const ogUrlMeta = document.querySelector('meta[property="og:url"]');
    if (ogUrlMeta && ogUrlMeta.content) {
      const ogMatch = ogUrlMeta.content.match(/\/(?:posts|permalink|videos|story)\/([a-zA-Z0-9_]+)/i) || ogUrlMeta.content.match(/fbid=([a-zA-Z0-9_]+)/i);
      if (ogMatch && ogMatch[1]) {
        postId = ogMatch[1];
      }
    }

    // Đào sâu vào config ẩn của Facebook
    if (!postId) {
      const htmlContent = document.documentElement.innerHTML;
      const fbIdMatch = htmlContent.match(/"target_fbid":"([a-zA-Z0-9_]+)"/) || htmlContent.match(/"ft_ent_identifier":"([a-zA-Z0-9_]+)"/);
      if (fbIdMatch && fbIdMatch[1]) {
        postId = fbIdMatch[1];
      }
    }
  }

  // Chốt chặn cuối cùng: Nếu qua 3 lớp vẫn không có thì mới cho bay màu
  if (!postId) {
    throw new Error("Không thể trích xuất Post ID từ URL: " + url + " | Current Tab URL: " + window.location.href);
  }

  const tokens = await getTokensFromPage();
  if (!tokens.fb_dtsg || !tokens.uid) {
    throw new Error("Không tìm thấy fb_dtsg hoặc uid. Vui lòng tải lại trang.");
  }

  const feedbackId = btoa(`feedback:${postId}`);

  const variables = {
    input: {
      client_mutation_id: "1",
      actor_id: tokens.uid,
      feedback_id: feedbackId,
      message: { ranges: [], text: text },
      attachments: null,
      source: "COMET",
    },
    displayCommentsFeedbackContext: null,
    displayCommentsContext: null,
  };

  const body = new URLSearchParams({
    av: tokens.uid,
    __user: tokens.uid,
    fb_api_req_friendly_name: "useCometUFICreateCommentMutation",
    doc_id: capturedDocId || FALLBACK_DOC_ID,
    fb_dtsg: tokens.fb_dtsg,
    lsd: tokens.lsd || "",
    jazoest: tokens.jazoest,
    __spin_r: tokens.spin_r,
    __spin_t: tokens.spin_t,
    __a: "1",
    variables: JSON.stringify(variables),
  });

  const response = await fetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Lỗi HTTP: ${response.status} - ${errText.substring(0, 50)}`);
  }

  const resText = await response.text();
  // Facebook often prepends for (;;); to JSON responses
  const cleanText = resText.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/g, "").trim();

  let success = false;
  let commentUrl = "";

  let parsedItems = [];
  try {
    parsedItems = [JSON.parse(cleanText)];
  } catch (e) {
    parsedItems = cleanText
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
  }

  for (const data of parsedItems) {
    const commentCreate = data?.data?.comment_create;
    if (commentCreate) {
      success = true;

      // Theo hướng dẫn chuẩn
      const edge = commentCreate?.feedback_comment_edge;
      const node = edge?.node;

      if (node) {
        const commentId = node.legacy_fbid;
        commentUrl = node.url || (commentId ? `${url}?comment_id=${commentId}` : url);
        break;
      } else if (data.label || data.path) {
        // Có thể là defer/stream fragment chứa node
        const streamNode = data?.data?.node || data?.data;
        if (streamNode && streamNode.legacy_fbid) {
          commentUrl = streamNode.url || `${url}?comment_id=${streamNode.legacy_fbid}`;
          break;
        }
      } else {
        commentUrl = url;
      }
    } else if (data?.errors) {
      console.error("GraphQL Error:", data.errors[0]?.message);
    }
  }

  if (success) {
    return { success: true, url: commentUrl || url, uid: tokens.uid };
  } else {
    throw new Error("API Facebook phản hồi không như mong đợi: " + resText.substring(0, 100));
  }
}

// -----------------------------------------------------------------------------
// LUỒNG XỬ LÝ RIÊNG DÀNH CHO FACEBOOK REELS (/reel/ VÀ /reels/)
// -----------------------------------------------------------------------------

function waitForElement(selector, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    let timer = null;
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        if (timer) clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    timer = setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector(selector));
    }, timeoutMs);
  });
}

async function executeReelComment(payload) {
  const { url, text } = payload;
  const currentUrl = window.location.href;

  // 1. Thử trích xuất Reel ID để gọi GraphQL ngầm (Phương án Nhanh & Ẩn)
  let reelId = null;
  const reelMatch = url.match(/\/(?:reel|reels)\/([a-zA-Z0-9_]+)/i) || currentUrl.match(/\/(?:reel|reels)\/([a-zA-Z0-9_]+)/i);
  if (reelMatch && reelMatch[1]) {
    reelId = reelMatch[1];
  }

  if (!reelId) {
    const htmlContent = document.documentElement.innerHTML;
    const fbIdMatch = htmlContent.match(/"target_fbid":"([a-zA-Z0-9_]+)"/) || htmlContent.match(/"ft_ent_identifier":"([a-zA-Z0-9_]+)"/) || htmlContent.match(/"video_id":"(\d+)"/);
    if (fbIdMatch && fbIdMatch[1]) {
      reelId = fbIdMatch[1];
    }
  }

  // Nếu có Reel ID & Tokens, thử gửi qua API GraphQL
  if (reelId) {
    try {
      const tokens = await getTokensFromPage();
      if (tokens.fb_dtsg && tokens.uid) {
        const feedbackId = btoa(`feedback:${reelId}`);
        const variables = {
          input: {
            client_mutation_id: "1",
            actor_id: tokens.uid,
            feedback_id: feedbackId,
            message: { ranges: [], text: text },
            attachments: null,
            source: "COMET",
          },
          displayCommentsFeedbackContext: null,
          displayCommentsContext: null,
        };

        const body = new URLSearchParams({
          av: tokens.uid,
          __user: tokens.uid,
          fb_api_req_friendly_name: "useCometUFICreateCommentMutation",
          doc_id: capturedDocId || FALLBACK_DOC_ID,
          fb_dtsg: tokens.fb_dtsg,
          lsd: tokens.lsd || "",
          jazoest: tokens.jazoest,
          __spin_r: tokens.spin_r,
          __spin_t: tokens.spin_t,
          __a: "1",
          variables: JSON.stringify(variables),
        });

        const response = await fetch("https://www.facebook.com/api/graphql/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        if (response.ok) {
          const resText = await response.text();
          const cleanText = resText.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/g, "").trim();
          let parsedItems = [];
          try {
            parsedItems = [JSON.parse(cleanText)];
          } catch (e) {
            parsedItems = cleanText
              .split("\n")
              .filter((l) => l.trim())
              .map((l) => {
                try {
                  return JSON.parse(l);
                } catch (err) {
                  return null;
                }
              })
              .filter(Boolean);
          }
          for (const data of parsedItems) {
            if (data?.data?.comment_create) {
              const edge = data.data.comment_create?.feedback_comment_edge;
              const node = edge?.node;
              const commentUrl = node?.url || (node?.legacy_fbid ? `${url}?comment_id=${node.legacy_fbid}` : url);
              console.log("[Comment Extension] Đăng comment Reel thành công qua GraphQL API!");
              return { success: true, url: commentUrl, uid: tokens.uid };
            }
          }
        }
      }
    } catch (gqlErr) {
      console.log("[Comment Extension] GraphQL Reel comment không khả thi, chuyển sang mô phỏng DOM:", gqlErr.message);
    }
  }

  // 2. Thao tác DOM dự phòng cho Reel (DOM Simulation)
  return await executeReelDomComment(payload);
}

async function executeReelDomComment(payload) {
  const { url, text } = payload;

  // A. Bóc tách Tên Fanpage / Chủ sở hữu Reel bằng selector đặc thù
  let pageName = "";
  const ownerLink = document.querySelector('a[aria-label="Xem trang cá nhân của chủ sở hữu"], a[aria-label="View owner\'s profile"], a[role="link"][href*="/reel/"]');
  if (ownerLink) {
    pageName = ownerLink.innerText.trim();
  }

  // B. Mở nút Bình luận nếu ô comment bị ẩn trong Reel Drawer
  const commentBtnSelector = 'div[aria-label="Bình luận"][role="button"], div[aria-label="Leave a comment"][role="button"], div[aria-label="Comment"][role="button"], div[aria-label*="Bình luận"][role="button"]';
  const commentBtn = await waitForElement(commentBtnSelector, 5000);

  if (commentBtn) {
    commentBtn.click();
    await new Promise((r) => setTimeout(r, 1500));
  }

  // C. Đợi ô nhập liệu comment xuất hiện
  const textboxSelector = 'div[contenteditable="true"][role="textbox"]';
  const textbox = await waitForElement(textboxSelector, 7000);

  if (!textbox) {
    throw new Error("Không thể tìm thấy ô nhập bình luận trên Reels sau khi mở khung bình luận.");
  }

  // D. Focus và inject text qua execCommand
  textbox.focus();
  await new Promise((r) => setTimeout(r, 300));

  document.execCommand("insertText", false, text);
  textbox.dispatchEvent(new Event("input", { bubbles: true }));

  await new Promise((r) => setTimeout(r, 500));

  // E. Giả lập bấm Enter phát bình luận
  const enterEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  });
  textbox.dispatchEvent(enterEvent);

  await new Promise((r) => setTimeout(r, 2000));

  const tokens = await getTokensFromPage().catch(() => ({ uid: "unknown" }));
  return {
    success: true,
    url: url,
    uid: tokens.uid || "unknown",
    pageName: pageName || undefined,
  };
}
