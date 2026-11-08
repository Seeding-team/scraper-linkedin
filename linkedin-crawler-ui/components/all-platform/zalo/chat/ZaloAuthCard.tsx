"use client";

/**
 * Ported từ components/zalo/chat/ZaloAuthCard.tsx (app chính) — không đổi
 * logic, chỉ đổi import type (@/lib/zaloApiClient thay vì @/lib/zalo-api).
 *
 * Giao diện (2026-09-10): reskin theo cùng ngôn ngữ thiết kế của mockup
 * TimeTech Chat (timetich.html) — mockup không có màn hình này riêng (chỉ có
 * modal "Thêm tài khoản Zalo"), nên card này dùng đúng bộ token màu/khoảng
 * cách/bo góc của mockup (#0068ff, viền #dce1e8, nút dạng viên thuốc) để
 * đồng bộ 100% với phần chat bên dưới thay vì để lệch tông xanh cũ.
 */

import { AlertTriangle, CheckCircle2, ClipboardList, Download, ExternalLink, Loader2, LogOut, MessageCircle, PlugZap, RefreshCw, Wifi, WifiOff, X } from "lucide-react";
import { ZaloLoginStatus } from "@/lib/zaloApiClient";

/**
 * Extension "Markee Zalo Personal Connector" — tự host ở public/ của module
 * (same-origin nên thuộc tính `download` mới có tác dụng; link Drive là
 * cross-origin, trình duyệt BỎ QUA `download` và tải về bản .rar CŨ thiếu bản
 * vá manifest cho 10.30.195.41:3002/3003).
 *
 * Lỗi "Không thấy tệp trên trang" trước đó = Chrome SERVER_BAD_CONTENT, tức
 * server trả 404 — do đường dẫn bị đổi/xoá qua lại trong khi trình duyệt vẫn
 * chạy bản trang đã cache trỏ vào đường dẫn cũ. Vì vậy GIỮ SỐNG cả 2 đường
 * dẫn: /extension-login-zalo.zip (tĩnh, dùng ở đây) và /api/download-extension.
 */
const ZALO_EXTENSION_DOWNLOAD_URL = "/extension-login-zalo.zip";

interface Props {
  status: ZaloLoginStatus | null;
  loading: boolean;
  error: string | null;
  onImport: () => void;
  /** Huỷ 1 lượt đăng nhập đang chạy dở (vd lỡ đóng tab Zalo giữa chừng) —
   *  hiện nút "Huỷ" cạnh nút đăng nhập trong lúc `loading`. Optional để
   *  không bắt buộc mọi nơi dùng component này phải truyền. */
  onCancelImport?: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onReconnect?: () => void;
  reconnecting?: boolean;
  /** `inline` = chỉ hàng nút trong `.chat-header .actions` mockup; `card` = card đầy đủ. */
  variant?: "card" | "inline";
}

const ACT =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50";

export function ZaloAuthCard({
  status,
  loading,
  error,
  onImport,
  onCancelImport,
  onLogout,
  onRefresh,
  onReconnect,
  reconnecting,
  variant = "card"
}: Props) {
  const isLoggedIn = status?.is_logged_in ?? false;
  const isExpired = status?.session_expired ?? false;
  const inline = variant === "inline";

  const actions = (
        <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
          <a href={ZALO_EXTENSION_DOWNLOAD_URL} download="extension-login-zalo.zip" className={ACT} title="Tải extension Chrome đăng nhập Zalo về máy">
            <Download className="h-3 w-3 text-[#6b7a8d]" />
            Tải extension
          </a>
          {isLoggedIn ? (
            <>
              <button onClick={onReconnect} disabled={reconnecting || loading} className={ACT} title="Restart WebSocket Zalo">
                <PlugZap className={`h-3 w-3 text-[#6b7a8d] ${reconnecting ? "animate-pulse" : ""}`} />
                {reconnecting ? "Reconnecting..." : "Reconnect WS"}
              </button>
              <button onClick={onRefresh} disabled={loading} className={ACT}>
                <RefreshCw className={`h-3 w-3 text-[#6b7a8d] ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </button>
              <button onClick={onLogout} disabled={loading} className={ACT}>
                <LogOut className="h-3 w-3 text-[#6b7a8d]" />
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onImport}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-[30px] bg-[#0068ff] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0057d9] disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                {loading ? "Đang kết nối..." : "Đăng nhập Zalo"}
              </button>
              {/* Chỉ hiện lúc đang kết nối — lỡ đóng tab Zalo/QR giữa chừng
                  thì có đường thoát ngay, không phải đợi hết login_timeout_ms
                  (90s, đôi khi lâu hơn) mới bấm lại được. */}
              {loading && onCancelImport ? (
                <button
                  onClick={onCancelImport}
                  className="inline-flex items-center gap-1 rounded-[30px] border border-[#dce1e8] bg-white px-3 py-1.5 text-xs font-medium text-[#6b7a8d] transition hover:bg-[#f1f4f8]"
                  title="Huỷ kết nối đang chờ"
                >
                  <X className="h-3.5 w-3.5" />
                  Huỷ
                </button>
              ) : null}
            </>
          )}
        </div>
  );

  if (inline) {
    return (
      <>
        {actions}
        {error ? <span className="w-full text-[11px] text-red-600">{error}</span> : null}
      </>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-[#e6eaef] bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0068ff] text-white">
            <MessageCircle className="h-4 w-4" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[#0a1a2b]">Kết nối Zalo</span>
            {isLoggedIn ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                  <Wifi className="h-3 w-3" />
                  Đã kết nối
                </span>
                <span className="text-[#6b7a8d]">
                  Session: <code className="font-mono">{status?.session_id?.slice(-12) || "—"}</code>
                </span>
              </>
            ) : isExpired ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                <WifiOff className="h-3 w-3" />
                Phiên hết hạn
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f4f8] px-2 py-0.5 font-semibold text-[#4f5f71]">
                <WifiOff className="h-3 w-3" />
                Chưa kết nối
              </span>
            )}
          </div>
        </div>
        {actions}
      </div>

      {!isLoggedIn && (
        <div className="mt-2 rounded-xl border border-dashed border-[#dce1e8] bg-[#f8fafc] p-3 text-[11px] text-[#4f5f71]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-[#2f3e50]">
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Hướng dẫn kết nối (1 click):</span>
          </div>
          <ol className="ml-4 list-decimal space-y-0.5">
            <li>
              Bấm{" "}
              <a
                href={ZALO_EXTENSION_DOWNLOAD_URL}
                download="extension-login-zalo.zip"
                className="font-semibold text-[#0068ff] underline underline-offset-2 hover:text-[#0057d9]"
              >
                Tải extension
              </a>{" "}
              về máy, giải nén. Mở <code className="rounded bg-[#e6eaef] px-1 font-mono text-[10px]">chrome://extensions</code>, bật Developer mode, rồi <strong>kéo thả thư mục vừa giải nén thẳng vào trang đó</strong> (hoặc bấm <strong>Load unpacked</strong> trỏ vào thư mục — 2 cách cho cùng kết quả). Lưu ý: Chrome không cài trực tiếp từ file .zip còn nén — phải giải nén trước.
            </li>
            <li>
              Mở tab{" "}
              <a href="https://chat.zalo.me/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[#0068ff] hover:underline">
                chat.zalo.me <ExternalLink className="h-3 w-3" />
              </a>{" "}
              và đăng nhập QR trên điện thoại.
            </li>
            <li>
              <strong className="text-amber-700">Quan trọng:</strong> trước khi bấm &quot;Đăng nhập Zalo&quot; ở đây, hãy <strong>đóng tab chat.zalo.me</strong> — nếu không Zalo sẽ đóng WS bridge ngay (lỗi Overlimit).
            </li>
            <li>
              Quay lại đây bấm <strong>Đăng nhập Zalo</strong> — extension tự lấy cookie và gửi về zalo-bridge.
            </li>
          </ol>
        </div>
      )}

      {isLoggedIn && (
        <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <strong>Lưu ý:</strong> để WS không bị đóng bởi Zalo (lỗi <code className="font-mono">Overlimit connection</code>), hãy đóng tab chat.zalo.me khi dùng UI này. Nếu lỡ mở, bấm <strong>Reconnect WS</strong>.
        </div>
      )}

      {error && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoggedIn && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          <span>Sẵn sàng gửi và nhận tin nhắn.</span>
        </div>
      )}
    </div>
  );
}
