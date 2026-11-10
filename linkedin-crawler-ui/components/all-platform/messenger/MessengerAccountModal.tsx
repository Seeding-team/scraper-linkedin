"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fbMessengerService } from "@/services/facebook-messenger.service";
import { toast } from "sonner";

interface MessengerAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function MessengerAccountModal({ open, onOpenChange, onSuccess }: MessengerAccountModalProps) {
  const [loading, setLoading] = useState(false);
  const [cookie, setCookie] = useState("");
  const [name, setName] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // Trạng thái kiểm tra extension
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  const [showManualGuide, setShowManualGuide] = useState(false);

  // Tự động kiểm tra xem tiện ích Extension đã được cài chưa khi mở modal
  useEffect(() => {
    if (!open) return;
    setExtInstalled(null);

    let gotPong = false;
    const handlePong = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "API_MARKEE_FB_PONG" || event.data.type === "FB_GET_SESSION_RESPONSE") {
        gotPong = true;
        setExtInstalled(true);
      }
    };

    window.addEventListener("message", handlePong);
    window.postMessage({ type: "API_MARKEE_FB_PING" }, "*");

    const timer = setTimeout(() => {
      if (!gotPong) {
        setExtInstalled(false);
      }
    }, 600);

    return () => {
      window.removeEventListener("message", handlePong);
      clearTimeout(timer);
    };
  }, [open]);

  const handleCopyExtUrl = () => {
    navigator.clipboard.writeText("chrome://extensions");
    toast.success("Đã copy chrome://extensions! Hãy dán vào thanh địa chỉ trình duyệt để mở.");
  };

  const handleCaptureFromExtension = () => {
    setCapturing(true);
    let resolved = false;

    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setCapturing(false);
        window.removeEventListener("message", handleMessage);
        setExtInstalled(false);
        toast.error(
          "Không nhận được phản hồi từ tiện ích. Vui lòng bấm 'Tải Extension' ở khung hướng dẫn bên dưới để cài đặt!"
        );
      }
    }, 3500);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "FB_GET_SESSION_RESPONSE") {
        resolved = true;
        clearTimeout(timeoutTimer);
        setCapturing(false);
        window.removeEventListener("message", handleMessage);

        if (event.data.success && event.data.data?.cookie) {
          setCookie(event.data.data.cookie);
          setExtInstalled(true);
          if (!name && event.data.data.name) {
            setName(event.data.data.name);
          }
          toast.success("Đã tự động lấy Cookie Facebook từ trình duyệt thành công!");
        } else {
          toast.error(event.data.message || "Không thể lấy cookie Facebook từ trình duyệt.");
        }
      }
    };

    window.addEventListener("message", handleMessage);
    window.postMessage({ type: "FB_GET_SESSION_REQUEST" }, "*");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookie.trim()) {
      toast.error("Vui lòng nhập chuỗi Cookie Facebook.");
      return;
    }
    if (!cookie.includes("c_user=") || !cookie.includes("xs=")) {
      toast.error("Cookie không hợp lệ: Thiếu c_user hoặc xs.");
      return;
    }

    setLoading(true);
    try {
      const res = await fbMessengerService.connectAccount({
        cookie: cookie.trim(),
        name: name.trim() || undefined,
        proxy_url: proxyUrl.trim() || undefined,
        is_shared_with_all: isShared,
      });

      if (!res.success) {
        toast.error(res.message || "Kết nối tài khoản thất bại.");
        return;
      }

      toast.success(res.message || "Kết nối tài khoản Facebook Messenger thành công!");
      setCookie("");
      setName("");
      setProxyUrl("");
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast.error("Lỗi khi kết nối tài khoản Messenger.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl font-sans max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold shrink-0">
              <span className="material-symbols-outlined text-[24px]">chat</span>
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Thêm tài khoản Facebook Messenger
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hệ thống áp dụng 5 lớp bảo vệ Anti-Checkpoint và nhịp sinh học tự nhiên
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* ── KHỐI TRẠNG THÁI TIỆN ÍCH & HƯỚNG DẪN 3 BƯỚC ─────────────────── */}
        <div className="space-y-3 pt-1">
          {/* Trạng thái tiện ích */}
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-outline-variant bg-surface-container-low text-xs">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-blue-600">
                extension
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-on-surface">Trạng thái tiện ích:</span>
                {extInstalled === null ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    Đang kiểm tra...
                  </span>
                ) : extInstalled ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Đã sẵn sàng
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold text-[10px] border border-amber-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Chưa phát hiện
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/api-facebook-get-extension.zip"
                download="api-facebook-get-extension.zip"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] shadow-2xs transition"
                title="Tải gói tiện ích FB API Crawler (.zip) cài vào Chrome"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span>Tải Extension (.zip)</span>
              </a>

              <button
                type="button"
                onClick={() => setShowManualGuide((prev) => !prev)}
                className="text-[11px] text-blue-600 hover:underline font-semibold cursor-pointer"
              >
                {showManualGuide || extInstalled === false ? "Ẩn hướng dẫn" : "Xem hướng dẫn"}
              </button>
            </div>
          </div>

          {/* Chi tiết 3 bước hướng dẫn kết nối (tự mở nếu chưa cài, hoặc bấm toggle xem) */}
          {(showManualGuide || extInstalled === false) && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 space-y-3 text-xs text-blue-950 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="font-bold flex items-center gap-1.5 text-blue-900">
                  <span className="material-symbols-outlined text-[18px] text-blue-600">help</span>
                  Quy trình 3 bước kết nối tài khoản Facebook bằng Extension:
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  Dành cho người mới
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {/* Bước 1 */}
                <div className="p-2.5 rounded-lg bg-white border border-blue-100 shadow-2xs flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-blue-900">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] shrink-0 font-bold">
                        1
                      </span>
                      <span>Tải & Giải nén</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Bấm nút tải file <code className="bg-blue-50 px-1 py-0.5 rounded text-blue-700 font-mono text-[10px]">.zip</code> và giải nén ra 1 thư mục trên máy.
                    </p>
                  </div>
                  <div className="pt-2">
                    <a
                      href="/api-facebook-get-extension.zip"
                      download="api-facebook-get-extension.zip"
                      className="w-full inline-flex items-center justify-center gap-1 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200 transition"
                    >
                      <span className="material-symbols-outlined text-[13px]">download</span>
                      <span>Tải file zip ngay</span>
                    </a>
                  </div>
                </div>

                {/* Bước 2 */}
                <div className="p-2.5 rounded-lg bg-white border border-blue-100 shadow-2xs flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-blue-900">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] shrink-0 font-bold">
                        2
                      </span>
                      <span>Cài vào Chrome</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Vào <code className="bg-blue-50 px-1 py-0.5 rounded text-blue-700 font-mono text-[10px]">chrome://extensions</code> → Bật <b>Developer mode</b> → Bấm <b>Load unpacked</b> chọn thư mục.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleCopyExtUrl}
                      className="w-full inline-flex items-center justify-center gap-1 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200 transition cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[13px]">content_copy</span>
                      <span>Copy link cài đặt</span>
                    </button>
                  </div>
                </div>

                {/* Bước 3 */}
                <div className="p-2.5 rounded-lg bg-white border border-blue-100 shadow-2xs flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-blue-900">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] shrink-0 font-bold">
                        3
                      </span>
                      <span>Mở FB & Lấy Cookie</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Đăng nhập Facebook trên cùng trình duyệt này, rồi bấm <b>⚡ Lấy tự động</b> bên dưới.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleCaptureFromExtension}
                      disabled={capturing}
                      className="w-full inline-flex items-center justify-center gap-1 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition cursor-pointer shadow-2xs"
                    >
                      <span className="material-symbols-outlined text-[13px]">bolt</span>
                      <span>Lấy Cookie ngay</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── FORM NHẬP THÔNG TIN TÀI KHOẢN ──────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-3.5 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">Tên gợi nhớ (Tùy chọn)</label>
            <Input
              placeholder="VD: Nick Seeding BĐS 01, Facebook Cá nhân..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">
                Chuỗi Cookie Facebook <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleCaptureFromExtension}
                disabled={capturing || loading}
                className={cn(
                  "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold text-[11px] shadow-xs cursor-pointer transition",
                  extInstalled
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                )}
                title="Tự động đọc session cookie Facebook đang đăng nhập trong trình duyệt"
              >
                <span className={cn("material-symbols-outlined text-[14px]", capturing && "animate-spin")}>
                  {capturing ? "progress_activity" : "bolt"}
                </span>
                <span>{capturing ? "Đang lấy..." : "⚡ Lấy tự động bằng Extension"}</span>
              </button>
            </div>
            <Textarea
              placeholder="c_user=1000...; xs=...; fr=...; datr=...;"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={4}
              className="text-xs font-mono resize-none"
              required
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
              <span>Bắt buộc chứa c_user và xs</span>
              <span className="text-muted-foreground">
                Hoặc dán trực tiếp cookie nếu bạn đã trích xuất từ trước
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">Proxy dân cư cố định (Khuyên dùng)</label>
              <span className="text-[10px] text-emerald-600 font-semibold">Chống Checkpoint</span>
            </div>
            <Input
              placeholder="http://username:password@ip:port"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Khuyên dùng Proxy 4G/Residential (Viettel, FPT, VNPT) cố định cho từng tài khoản.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isShared"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
            />
            <label htmlFor="isShared" className="text-xs font-medium text-foreground cursor-pointer">
              Chia sẻ tài khoản cho toàn bộ thành viên trong hệ thống
            </label>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
              Hủy
            </Button>
            <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-bold" disabled={loading}>
              {loading ? "Đang xác thực..." : "Xác thực & Kết nối"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
