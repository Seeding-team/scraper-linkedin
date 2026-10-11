/**
 * SNIPPET nhúng vào DASHBOARD (repo Hoàng) — tự đẩy config sang Extension seeding.
 *
 * Cách dùng (React/Next.js): gọi provisionExtension() sau khi seeder đã đăng nhập dashboard,
 * truyền userId = chính tài khoản seeder đang login. Seeder KHÔNG phải gõ gì.
 *
 * Cơ chế: extension cài sẵn 1 content-script bridge chạy trên domain dashboard,
 * nghe window.postMessage. Trang chỉ cần postMessage, không cần biết extension ID.
 *
 * LƯU Ý whitelist: domain dashboard thật phải được thêm vào manifest extension
 * (content_scripts.matches + đổi externally_connectable nếu dùng kênh đó). Hiện whitelist:
 * localhost:3000, 127.0.0.1:3000, localhost:8000. Khi deploy -> thêm domain thật.
 */

export interface ExtProvisionConfig {
  serverUrl: string; // Markee service, vd https://auto-fb.zenithglobal.dev
  owner: string;     // = tài khoản Markee (nhân viên login dashboard) — để phân quyền
  apiKey: string;    // Extension key quyền hẹp do product backend cấp
  label?: string;    // tên hiển thị acc (tùy chọn)
}

interface ExtBridgeMessage {
  type?: string;
  extension?: string;
  version?: string;
  features?: string[];
  success?: boolean;
  error?: string;
  data?: unknown;
  installed?: boolean;
  connected?: boolean;
}

/** Đẩy config sang extension. Trả Promise<{success, error?}>. Timeout 4s. */
export function provisionExtension(cfg: ExtProvisionConfig): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data as ExtBridgeMessage;
      if (d && d.type === 'MARKEE_FB_PROVISION_RESULT') {
        done = true;
        window.removeEventListener('message', onMsg);
        resolve({ success: !!d.success, error: d.error });
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'MARKEE_FB_PROVISION', ...cfg }, '*');
    setTimeout(() => {
      if (!done) {
        window.removeEventListener('message', onMsg);
        resolve({ success: false, error: 'Không thấy extension phản hồi (chưa cài hoặc sai domain whitelist).' });
      }
    }, 4000);
  });
}

/** Kiểm tra đúng extension Seeding Markee đã cài + đang kết nối chưa. */
export function pingExtension(): Promise<{ installed: boolean; connected: boolean; version?: string; features: string[] }> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data as ExtBridgeMessage;
      if (d && d.type === 'MARKEE_FB_PONG' && d.extension === 'seeding-markee') {
        done = true;
        window.removeEventListener('message', onMsg);
        resolve({ installed: !!d.installed, connected: !!d.connected, version: d.version, features: d.features || [] });
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'MARKEE_FB_PING' }, '*');
    setTimeout(() => {
      if (!done) { window.removeEventListener('message', onMsg); resolve({ installed: false, connected: false, features: [] }); }
    }, 3000);
  });
}

/**
 * Yêu cầu extension THÊM TÀI KHOẢN FB: tự mở tab Facebook login → người dùng đăng nhập
 * (tự vượt checkpoint/2FA nếu có) → extension lụm cookie + gửi server (kèm owner).
 * DÙNG CHUNG cho "Thêm acc mới" lẫn "Đăng nhập lại" khi cookie hết hạn.
 * Timeout dài (3 phút) vì người dùng cần thời gian login.
 */
export function addAccountViaExtension(): Promise<{ success: boolean; error?: string; data?: unknown }> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data as ExtBridgeMessage;
      if (d && d.type === 'MARKEE_FB_ADD_ACCOUNT_RESULT') {
        done = true;
        window.removeEventListener('message', onMsg);
        resolve({ success: !!d.success, error: d.error, data: d.data });
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'MARKEE_FB_ADD_ACCOUNT' }, '*');
    setTimeout(() => {
      if (!done) {
        window.removeEventListener('message', onMsg);
        resolve({ success: false, error: 'Hết thời gian chờ đăng nhập (3 phút) hoặc extension không phản hồi.' });
      }
    }, 185000);
  });
}

/*
VÍ DỤ dùng trong component dashboard (sau khi nhân viên login):
  import { provisionExtension, pingExtension } from "@/lib/markee-ext-provision";
  import { useAppAuth } from "@/contexts/AppAuthContext";

  const { user } = useAppAuth();  // user.id = tài khoản Markee đang login
  async function autoSetup() {
    const { installed } = await pingExtension();
    if (!installed) return; // hiện nút "Tải extension"
    const res = await provisionExtension({
      serverUrl: "<serverUrl từ /api/all-platform/fb/config>",
      owner: user.id,        // phân quyền: extension gắn với nhân viên này
      apiKey: "<extension key từ /api/all-platform/fb/config>",
    });
    // user_id của acc FB do extension tự lấy (c_user), không cần truyền.
  }
*/
