"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fbMessengerService, FbMessengerAccount } from "@/services/facebook-messenger.service";
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
    } catch (err) {
      toast.error("Lỗi khi kết nối tài khoản Messenger.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg font-sans">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold">
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

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
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
              <span className="text-[10px] text-muted-foreground">Bắt buộc chứa c_user và xs</span>
            </div>
            <Textarea
              placeholder="c_user=1000...; xs=...; fr=...; datr=...;"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={4}
              className="text-xs font-mono resize-none"
              required
            />
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
