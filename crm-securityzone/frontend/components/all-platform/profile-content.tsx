"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { authService } from "@/services/all-platform.service";
import { pingLiExtension } from "@/lib/li-ext-bridge";

type Tab = "personal" | "password" | "extensions";
type Notice = { type: "success" | "error"; text: string };

const VALID_TABS: Tab[] = ["personal", "password", "extensions"];

export function ProfileContent() {
  const { user, refreshUser, logout } = useAppAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tab hien tai dong bo qua query param (?tab=...) - refresh/deep-link van
  // giu dung tab, KHONG tao route rieng (dung co che tab hien co, khong
  // dung router thu 2).
  const requestedTab = searchParams.get("tab");
  const activeTab: Tab = useMemo(() => {
    if (requestedTab && (VALID_TABS as string[]).includes(requestedTab)) {
      return requestedTab as Tab;
    }
    return "personal";
  }, [requestedTab]);

  function setActiveTab(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "personal") params.delete("tab");
    else params.set("tab", tab);
    const qs = params.toString();
    router.replace(`/all-platform/profile${qs ? `?${qs}` : ""}`);
  }

  // Personal state
  const [editName, setEditName] = useState(user?.name || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Notice | null>(null);

  // Password state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<Notice | null>(null);

  // Deactivate state
  const [deactivatePw, setDeactivatePw] = useState("");
  const [showDeactivatePw, setShowDeactivatePw] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateMsg, setDeactivateMsg] = useState<Notice | null>(null);

  // Extensions tab state
  const [isLiExtensionReady, setIsLiExtensionReady] = useState<boolean | null>(null);
  const [checkingLiExtension, setCheckingLiExtension] = useState(false);

  const checkLiExtension = useCallback(async () => {
    setCheckingLiExtension(true);
    try {
      const res = await pingLiExtension();
      setIsLiExtensionReady(res.installed);
    } finally {
      setCheckingLiExtension(false);
    }
  }, []);

  const handleSaveProfile = useCallback(async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await authService.updateProfile({
        name: editName.trim() || undefined,
      });
      if (res.success) {
        setProfileMsg({ type: "success", text: "Đã lưu thông tin cá nhân." });
        await refreshUser();
      } else {
        setProfileMsg({ type: "error", text: res.message || "Lưu thất bại." });
      }
    } catch {
      setProfileMsg({ type: "error", text: "Lỗi kết nối server." });
    } finally {
      setSavingProfile(false);
    }
  }, [editName, refreshUser]);

  const handleChangePassword = useCallback(async () => {
    setPwMsg(null);
    if (!currentPw || !newPw || !confirmPw) {
      setPwMsg({ type: "error", text: "Vui lòng điền đầy đủ các trường." });
      return;
    }
    if (newPw.length < 6) {
      setPwMsg({ type: "error", text: "Mật khẩu mới phải có ít nhất 6 ký tự." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ type: "error", text: "Mật khẩu mới và xác nhận không khớp." });
      return;
    }
    if (currentPw === newPw) {
      setPwMsg({ type: "error", text: "Mật khẩu mới phải khác mật khẩu hiện tại." });
      return;
    }

    setSavingPw(true);
    try {
      const res = await authService.changePassword({
        current_password: currentPw,
        new_password: newPw,
      });
      if (res.success) {
        setPwMsg({
          type: "success",
          text: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
        });
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
        setTimeout(() => {
          void logout();
        }, 2000);
      } else {
        setPwMsg({
          type: "error",
          text: res.message || "Đổi mật khẩu thất bại.",
        });
      }
    } catch {
      setPwMsg({ type: "error", text: "Lỗi kết nối server." });
    } finally {
      setSavingPw(false);
    }
  }, [currentPw, newPw, confirmPw, logout]);

  const handleDeactivate = useCallback(async () => {
    setDeactivateMsg(null);
    if (!deactivatePw) {
      setDeactivateMsg({
        type: "error",
        text: "Vui lòng nhập mật khẩu để xác nhận.",
      });
      return;
    }
    if (
      !window.confirm(
        "Bạn có chắc muốn vô hiệu hóa tài khoản này? Hành động này không thể hoàn tác.",
      )
    ) {
      return;
    }

    setDeactivating(true);
    try {
      const res = await authService.deactivateAccount({ password: deactivatePw });
      if (res.success) {
        setDeactivateMsg({
          type: "success",
          text: "Tài khoản đã bị vô hiệu hóa. Đang chuyển hướng...",
        });
        setTimeout(() => {
          void logout();
        }, 2000);
      } else {
        setDeactivateMsg({
          type: "error",
          text: res.message || "Vô hiệu hóa thất bại.",
        });
      }
    } catch {
      setDeactivateMsg({ type: "error", text: "Lỗi kết nối server." });
    } finally {
      setDeactivating(false);
    }
  }, [deactivatePw, logout]);

  useEffect(() => {
    if (activeTab === "extensions") void checkLiExtension();
  }, [activeTab, checkLiExtension]);

  const TABS: { key: Tab; label: string; icon: MaterialSymbolName }[] = [
    { key: "personal", label: "Thông tin cá nhân", icon: "person" },
    { key: "password", label: "Đổi mật khẩu", icon: "lock" },
    { key: "extensions", label: "Tiện ích mở rộng", icon: "download" },
  ];

  const createdAtLabel = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("vi-VN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";

  return (
    <div className="w-full min-w-0 space-y-6 font-sans">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-primary/10 p-3">
          <MaterialIcon name="person" className="text-primary text-3xl" />
        </div>
        <div>
          <h1 className="text-h1 text-on-surface font-semibold">Trang cá nhân</h1>
          <p className="text-body-md text-on-surface-variant">
            Quản lý thông tin cá nhân và cài đặt bảo mật tài khoản
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-outline-variant overflow-x-auto whitespace-nowrap">
        <div className="flex gap-8 px-2">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "py-4 text-xs font-bold border-b-2 transition-all uppercase cursor-pointer",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-primary",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB: Personal */}
      {activeTab === "personal" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 min-w-0 space-y-6">
            {/* Personal info */}
            <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-6 shadow-sm">
              <h2 className="text-sm font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
                <MaterialIcon name="person" className="text-primary" />
                Chi tiết tài khoản
              </h2>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                    Email đăng nhập
                  </label>
                  <input
                    className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface-variant focus:ring-primary/15 focus:border-primary cursor-not-allowed"
                    readOnly
                    type="text"
                    value={user?.email ?? ""}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                    Họ tên hiển thị
                  </label>
                  <input
                    className="w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-primary/15 focus:border-primary transition-all"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                    Vai trò hệ thống
                  </label>
                  <div className="pt-1">
                    <span className="inline-flex items-center px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant text-[9px] uppercase border border-outline-variant font-bold">
                      {user?.role ?? "member"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                    Ngày đăng ký
                  </label>
                  <p className="text-xs font-semibold text-on-surface flex items-center gap-2 pt-1.5">
                    <MaterialIcon
                      name="calendar_today"
                      className="text-xs text-on-surface-variant"
                    />
                    {createdAtLabel}
                  </p>
                </div>
              </div>

              {profileMsg && (
                <div
                  className={cn(
                    "rounded-xl border px-4 py-3 text-xs font-medium",
                    profileMsg.type === "success"
                      ? "bg-green-50 text-green-800 border-green-200"
                      : "bg-primary-container/10 text-primary-container border-primary-container/20",
                  )}
                >
                  {profileMsg.text}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSaveProfile()}
                  disabled={savingProfile}
                  className="px-4 py-2 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  {savingProfile ? "Đang lưu..." : "Lưu thông tin"}
                </button>
              </div>
            </div>

            {/* Danger zone */}
            <div className="rounded-xl border border-red-100 bg-surface p-6 space-y-6 shadow-sm">
              <h2 className="text-sm font-bold text-red-600 border-b border-red-50 pb-3 flex items-center gap-2">
                <MaterialIcon name="warning" className="text-red-500" />
                Vô hiệu hóa tài khoản
              </h2>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Việc vô hiệu hóa tài khoản sẽ khiến bạn không thể truy cập vào hệ thống nữa.
                Hành động này không thể hoàn tác, vui lòng cẩn thận.
              </p>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                  Mật khẩu xác nhận
                </label>
                <div className="relative">
                  <input
                    className="w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-error focus:border-error pr-12 transition-all"
                    type={showDeactivatePw ? "text" : "password"}
                    placeholder="••••••••"
                    value={deactivatePw}
                    onChange={(e) => setDeactivatePw(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeactivatePw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                  >
                    <MaterialIcon
                      name={showDeactivatePw ? "visibility_off" : "visibility"}
                      className="text-lg"
                    />
                  </button>
                </div>
              </div>

              {deactivateMsg && (
                <div
                  className={cn(
                    "rounded-xl border px-4 py-3 text-xs font-medium",
                    deactivateMsg.type === "success"
                      ? "bg-green-50 text-green-800 border-green-200"
                      : "bg-primary-container/10 text-primary-container border-primary-container/20",
                  )}
                >
                  {deactivateMsg.text}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleDeactivate()}
                  disabled={deactivating}
                  className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {deactivating ? "Đang xử lý..." : "Xác nhận vô hiệu hóa"}
                </button>
              </div>
            </div>
          </div>

          {/* Right notes */}
          <div className="col-span-12 lg:col-span-4 min-w-0">
            <div className="rounded-xl border border-outline-variant bg-surface p-6 sticky top-24 space-y-6 shadow-sm">
              <h3 className="text-xs font-bold text-on-surface border-b border-outline-variant pb-2 flex items-center gap-2">
                <MaterialIcon name="verified_user" className="text-primary" />
                An toàn & Bảo mật
              </h3>
              <ul className="space-y-4">
                {[
                  "Không chia sẻ tài khoản đăng nhập với bất kỳ ai để tránh rủi ro mất mát dữ liệu cào.",
                  "Khuyến nghị định kỳ thay đổi mật khẩu sau mỗi 30-60 ngày để đảm bảo an toàn.",
                  "Nếu nghi ngờ có hành vi truy cập bất thường, vui lòng thay đổi mật khẩu ngay lập tức.",
                ].map((t) => (
                  <li key={t} className="flex gap-2 min-w-0">
                    <MaterialIcon
                      name="check_circle"
                      className="text-green-500 shrink-0 text-sm mt-0.5"
                    />
                    <span className="text-xs text-on-surface-variant leading-normal">
                      {t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Password */}
      {activeTab === "password" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 min-w-0">
            <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-6 shadow-sm">
              <h2 className="text-sm font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
                <MaterialIcon name="lock_reset" className="text-primary" />
                Thay đổi mật khẩu đăng nhập
              </h2>

              <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                      Mật khẩu hiện tại
                    </label>
                    <div className="relative">
                      <input
                        className="w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-2 focus:ring-primary/15 focus:border-primary pr-12 transition-all outline-none"
                        placeholder="••••••••"
                        type={showCurrent ? "text" : "password"}
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrent((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                      >
                        <MaterialIcon
                          name={showCurrent ? "visibility_off" : "visibility"}
                          className="text-lg"
                        />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                        Mật khẩu mới
                      </label>
                      <div className="relative">
                        <input
                          className="w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-2 focus:ring-primary/15 focus:border-primary pr-12 transition-all outline-none"
                          placeholder="••••••••"
                          type={showNew ? "text" : "password"}
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNew((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                        >
                          <MaterialIcon
                            name={showNew ? "visibility_off" : "visibility"}
                            className="text-lg"
                          />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                        Xác nhận mật khẩu mới
                      </label>
                      <input
                        className="w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all outline-none"
                        placeholder="••••••••"
                        type="password"
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {pwMsg && (
                  <div
                    className={cn(
                      "rounded-xl border px-4 py-3 text-xs font-medium",
                      pwMsg.type === "success"
                        ? "bg-green-50 text-green-800 border-green-200"
                        : "bg-primary-container/10 text-primary-container border-primary-container/20",
                    )}
                  >
                    {pwMsg.text}
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleChangePassword()}
                    disabled={savingPw}
                    className="px-4 py-2 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
                  >
                    {savingPw ? "Đang xử lý..." : "Cập nhật mật khẩu"}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-4 min-w-0">
            <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-4 shadow-sm">
              <h3 className="text-xs font-bold text-on-surface border-b border-outline-variant pb-2">
                Quy định mật khẩu
              </h3>
              <ul className="space-y-3">
                {[
                  "Phải chứa ít nhất 6 ký tự",
                  "Khuyến khích sử dụng chữ hoa, chữ thường và chữ số",
                  "Không trùng lặp với mật khẩu hiện tại",
                ].map((t) => (
                  <li
                    key={t}
                    className="flex items-center gap-2 text-xs text-on-surface-variant font-medium"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Extensions */}
      {activeTab === "extensions" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 min-w-0 space-y-6">
            <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-6 shadow-sm">
              <h2 className="text-sm font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
                <MaterialIcon name="download" className="text-primary" />
                Tiện ích mở rộng (Chrome Extension)
              </h2>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Cài các tiện ích mở rộng bên dưới để dùng các tính năng cào bài viết / comment
                tự động ngay trên trình duyệt của bạn (dùng session đăng nhập sẵn có).
              </p>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant p-4">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-bold text-on-surface">LinkedIn Group Post Crawler</div>
                  <p className="text-[11px] text-on-surface-variant leading-normal">
                    Cào bài viết theo Group, lấy nội dung/tương tác 1 bài viết và comment tự động
                    cho tính năng &quot;Tương tác nội bộ&quot; (LinkedIn).
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    {isLiExtensionReady === null ? (
                      <span className="text-[10px] text-on-surface-variant">Chưa kiểm tra kết nối</span>
                    ) : isLiExtensionReady ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px] font-bold border border-green-200">
                        <MaterialIcon name="check_circle" className="text-[12px]" /> Đã kết nối
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200">
                        Chưa kết nối
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void checkLiExtension()}
                      disabled={checkingLiExtension}
                      className="text-[10px] font-bold text-primary hover:underline disabled:opacity-50"
                    >
                      {checkingLiExtension ? "Đang kiểm tra..." : "Kiểm tra lại"}
                    </button>
                  </div>
                </div>
                <a
                  href="/linkedin-group-crawler-extension.zip"
                  download
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-on-primary-fixed-variant text-white text-xs font-bold transition-all active:scale-95 shadow-sm"
                >
                  <MaterialIcon name="download" className="text-sm" />
                  Tải Extension
                </a>
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-4 min-w-0">
            <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-4 shadow-sm">
              <h3 className="text-xs font-bold text-on-surface border-b border-outline-variant pb-2">
                Hướng dẫn cài đặt
              </h3>
              <ul className="space-y-3">
                {[
                  "Tải file .zip về máy rồi giải nén ra 1 thư mục.",
                  "Mở chrome://extensions, bật \"Developer mode\" (Chế độ dành cho nhà phát triển).",
                  "Bấm \"Load unpacked\" (Tải tiện ích đã giải nén) và chọn đúng thư mục vừa giải nén.",
                  "Bấm \"Kiểm tra lại\" ở trên để xác nhận đã kết nối được.",
                ].map((t) => (
                  <li
                    key={t}
                    className="flex items-start gap-2 text-xs text-on-surface-variant font-medium"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
