"use client";

import { useEffect, useState } from "react";
import { FaLinkedin, FaPlus, FaLock } from "react-icons/fa";
import { MaterialIcon } from "@/components/ui";
import { SocialAccountsManager } from "@/components/all-platform/social-accounts-manager";
import { FbInboxAccountsTab } from "@/components/all-platform/accounts/FbInboxAccountsTab";
import { FbCrawlAccountsTab } from "@/components/all-platform/accounts/FbCrawlAccountsTab";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  linkedInAccountService,
  linkedInAuthService,
  type LinkedInAccount,
} from "@/services/all-platform.service";

type Tab = "crawl" | "social" | "fb_inbox" | "fb_crawl_queue";

export function AccountManagementContent() {
  const { user } = useAppAuth();
  const [activeTab, setActiveTab] = useState<Tab>("crawl");

  // ── Crawl accounts state ────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [hasCreds, setHasCreds] = useState(false);

  // ── Add/Edit modal ─────────────────────────────────────────────────────
  const [showCrawlForm, setShowCrawlForm] = useState(false);
  const [viewCrawlAccount, setViewCrawlAccount] = useState<LinkedInAccount | null>(null);
  const [formId, setFormId] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [showCrawlPassword, setShowCrawlPassword] = useState(false);

  // ── Verify modal ───────────────────────────────────────────────────────
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verifyAccount, setVerifyAccount] = useState<LinkedInAccount | null>(null);
  const [verifyOtp, setVerifyOtp] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verifySuccess, setVerifySuccess] = useState("");
  const [pendingSessionId, setPendingSessionId] = useState("");
  const [checkpointUrl, setCheckpointUrl] = useState("");
  const [stepVerify, setStepVerify] = useState<"initiate" | "loading" | "otp" | "done">("initiate");

  const fetchAccounts = async () => {
    setAccountsLoading(true);
    try {
      const res = await linkedInAccountService.getAll();
      if (res.success && res.data) {
        setAccounts(res.data);
        setHasCreds(res.data.length > 0);
      }
    } catch (error) {
      console.error("Failed to load accounts", error);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => { void fetchAccounts(); }, []);

  // ── Add/Edit handlers ────────────────────────────────────────────────────
  const handleOpenAddCrawl = () => {
    setFormId(""); setFormEmail(""); setFormPassword(""); setFormError("");
    setShowCrawlPassword(false); setShowCrawlForm(true);
  };

  const handleOpenEditCrawl = (acc: LinkedInAccount) => {
    setFormId(acc.id); setFormEmail(acc.email_linkedin); setFormPassword("");
    setFormError(""); setShowCrawlPassword(false); setShowCrawlForm(true);
    setViewCrawlAccount(null);
  };

  const handleSaveCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmail.trim()) { setFormError("Vui lòng nhập Email LinkedIn"); return; }
    if (!formId && !formPassword.trim()) { setFormError("Vui lòng nhập Mật khẩu cho tài khoản mới"); return; }

    setFormSaving(true); setFormError("");
    try {
      if (formId) {
        const payload: any = { email_linkedin: formEmail.trim() };
        if (formPassword) payload.password = formPassword;
        const res = await linkedInAccountService.update(formId, payload);
        if (res.success) { await fetchAccounts(); setShowCrawlForm(false); }
        else { setFormError(res.message || "Cập nhật thất bại"); }
      } else {
        const res = await linkedInAccountService.create({
          email_member: user?.email || "unknown",
          email_linkedin: formEmail.trim(),
          password: formPassword,
        });
        if (res.success) { await fetchAccounts(); setShowCrawlForm(false); }
        else { setFormError(res.message || "Thêm thất bại"); }
      }
    } catch (err: any) { setFormError(err.message || "Lỗi mạng"); }
    finally { setFormSaving(false); }
  };

  const handleDeleteCrawl = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa tài khoản cào LinkedIn này?")) return;
    try {
      const res = await linkedInAccountService.delete(id);
      if (res.success) { await fetchAccounts(); }
      else { alert(res.message || "Xóa thất bại"); }
    } catch { alert("Lỗi mạng"); }
  };

  // ── Verify handlers ─────────────────────────────────────────────────────
  const handleOpenVerify = async (acc: LinkedInAccount) => {
    setVerifyAccount(acc);
    setVerifyError(""); setVerifySuccess(""); setVerifyOtp("");
    setPendingSessionId(""); setCheckpointUrl("");
    setStepVerify("initiate");
    setVerifyModalOpen(true);
  };

  const handleSubmitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSessionId || !verifyOtp.trim()) {
      setVerifyError("Vui lòng nhập mã OTP.");
      return;
    }
    setVerifyLoading(true); setVerifyError("");
    try {
      const res = await linkedInAuthService.verifyOtp({
        pending_session_id: pendingSessionId,
        otp_code: verifyOtp.trim(),
        checkpoint_url: checkpointUrl || undefined,
      });
      if (res.success) {
        setVerifySuccess("Xác minh OTP thành công! Tài khoản đã sẵn sàng để cào dữ liệu.");
        setStepVerify("done");
      } else {
        setVerifyError(res.message || "Xác minh OTP thất bại");
      }
    } catch (err: any) {
      setVerifyError(err.message || "Lỗi xác minh");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleLoginAndGetCheckpoint = async (password: string) => {
    if (!verifyAccount) return;
    setVerifyLoading(true); setVerifyError("");
    setStepVerify("loading");
    try {
      const res = await linkedInAuthService.login({
        email: verifyAccount.email_linkedin,
        password: password,
      });
      if (res.success && res.data) {
        if (res.data.status === "need_otp") {
          setPendingSessionId(res.data.session_id || "");
          setCheckpointUrl(res.data.checkpoint_url || "");
          setStepVerify("otp");
        } else if (res.data.status === "success") {
          setVerifySuccess("Đăng nhập thành công! Tài khoản đã sẵn sàng.");
          setStepVerify("done");
        }
      } else {
        setVerifyError(res.message || "Đăng nhập thất bại");
        setStepVerify("initiate");
      }
    } catch (err: any) {
      setVerifyError(err.message || "Lỗi đăng nhập");
      setStepVerify("initiate");
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
<div className="w-full min-w-0 space-y-6 font-sans">      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-outline-variant bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
        <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-primary/[0.06] blur-2xl" aria-hidden="true" />
        <div className="absolute -right-24 top-8 h-40 w-40 rounded-full bg-primary/[0.04] blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center gap-4">
          <div className="rounded-2xl bg-primary/10 p-3">
            <MaterialIcon name="manage_accounts" className="text-primary text-3xl" />
          </div>
          <div>
            <h1 className="text-h1 text-on-surface font-bold tracking-tight">Quản lý tài khoản</h1>
            <p className="text-body-md text-on-surface-variant">
              Cấu hình danh sách tài khoản mạng xã hội và thông tin cào dữ liệu tự động
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex w-full max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-low p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:w-fit">
        {(["crawl", "social", "fb_inbox", "fb_crawl_queue"] as Tab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={cn("whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wide transition-all duration-200 ease-out cursor-pointer",
              activeTab === tab
                ? "bg-primary text-white shadow-[0_2px_8px_-1px_rgba(217,55,55,0.4)]"
                : "text-on-surface-variant hover:bg-surface hover:text-primary")}>
            {tab === "crawl" ? "Tài khoản cào dữ liệu"
              : tab === "social" ? "Tài khoản mạng xã hội"
              : tab === "fb_inbox" ? "Tài khoản FB & KPI"
              : "Acc FB cào tự động (VPS)"}
          </button>))}
      </div>

      {/* TAB Content */}
      <div className="space-y-6">
        {activeTab === "crawl" ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-on-surface tracking-tight">Danh sách tài khoản cào LinkedIn</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">Các tài khoản dùng cho tính năng cào dữ liệu lưu trên hệ thống Supabase</p>
              </div>
              <button type="button" onClick={handleOpenAddCrawl}
                className="flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ease-out active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] hover:shadow-[0_4px_14px_-2px_rgba(217,55,55,0.45)] cursor-pointer shrink-0">
                <FaPlus size={10} /> Thêm tài khoản
              </button>
            </div>

            {accountsLoading ? (
              <div className="text-center py-16">
                <div className="w-9 h-9 border-[3px] border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-3" />
                <p className="text-on-surface-variant text-xs font-medium">Đang tải dữ liệu...</p>
              </div>
            ) : !hasCreds ? (
              <div className="text-center py-16 bg-surface-container-low/60 rounded-2xl border border-dashed border-outline-variant">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <MaterialIcon name="group_add" className="text-3xl text-primary" />
                </div>
                <p className="text-on-surface font-semibold text-sm">Chưa có tài khoản LinkedIn nào được cấu hình</p>
                <p className="text-on-surface-variant text-xs mt-1">Thêm tài khoản để bắt đầu cào dữ liệu tự động</p>
                <button onClick={handleOpenAddCrawl}
                  className="mt-4 inline-flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-out active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] cursor-pointer">
                  <FaPlus size={10} /> Thêm tài khoản ngay
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {accounts.map((acc) => (
                  <div key={acc.id}
                    className="group flex flex-col gap-3 rounded-2xl border border-outline-variant bg-surface p-4 transition-all duration-200 ease-out hover:border-primary/30 hover:shadow-[0_4px_16px_-4px_rgba(16,24,40,0.1)] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0077B5]/10 text-[#0077B5] transition-all duration-200 ease-out group-hover:scale-105">
                        <FaLinkedin size={18} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-bold text-on-surface">{acc.email_linkedin}</p>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary uppercase">
                            {(acc.email_member || "?").charAt(0)}
                          </span>
                          <span className="truncate">{acc.email_member}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      <button onClick={() => void handleOpenVerify(acc)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-primary bg-primary/10 hover:bg-primary/20 rounded-xl transition-all duration-200 ease-out text-[10px] font-bold cursor-pointer border border-primary/20"
                        title="Xác minh tài khoản (OTP)">
                        <FaLock size={11} />
                        Xác minh
                      </button>
                      <button onClick={() => setViewCrawlAccount(acc)}
                        className="p-1.5 text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface rounded-xl transition-all duration-200 ease-out cursor-pointer"
                        title="Xem chi tiết">
                        <MaterialIcon name="visibility" className="text-base" />
                      </button>
                      <button onClick={() => handleOpenEditCrawl(acc)}
                        className="p-1.5 text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 ease-out cursor-pointer"
                        title="Sửa">
                        <MaterialIcon name="edit" className="text-base" />
                      </button>
                      <button onClick={() => void handleDeleteCrawl(acc.id)}
                        className="p-1.5 text-on-surface-variant hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200 ease-out cursor-pointer"
                        title="Xóa">
                        <MaterialIcon name="delete" className="text-base" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>)}
          </div>
        ) : activeTab === "social" ? (
          <div className="rounded-2xl border border-outline-variant bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
            <SocialAccountsManager />
          </div>
        ) : activeTab === "fb_inbox" ? (
          <div className="rounded-2xl border border-outline-variant bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
            <FbInboxAccountsTab />
          </div>
        ) : (
          <div className="rounded-2xl border border-outline-variant bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
            <FbCrawlAccountsTab />
          </div>
        )}
      </div>

      {/* ── View Details Modal ─────────────────────────────────────── */}
      {viewCrawlAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "448px" }}
            className="bg-surface rounded-2xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MaterialIcon name="info" className="text-lg" />
                </span>
                Chi tiết tài khoản cào
              </h3>
              <button onClick={() => setViewCrawlAccount(null)}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl p-1.5 transition-all duration-200 ease-out cursor-pointer">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              {[
                ["Nền tảng", <span key="p" className="font-bold text-on-surface">LinkedIn</span>],
                ["Email đăng nhập", <span key="e" className="font-mono font-bold text-on-surface">{viewCrawlAccount.email_linkedin}</span>],
                ["Mật khẩu cào", <span key="pw" className="italic text-on-surface-variant">(Đã mã hóa trong database)</span>],
                ["Người sở hữu", <span key="o" className="text-on-surface-variant">{viewCrawlAccount.email_member}</span>],
                ["Ngày tạo", <span key="d" className="font-mono">{new Date(viewCrawlAccount.created_at).toLocaleString("vi-VN")}</span>],
              ].map(([label, value], i) => (
                <div key={i} className={cn("flex items-start gap-3 py-2", i < 4 && "border-b border-outline-variant")}>
                  <span className="text-on-surface-variant font-medium shrink-0 w-32">{label}</span>
                  <div className="flex-1 min-w-0">{value}</div>
                </div>))}
            </div>
            <div className="px-6 py-4 bg-surface-container-low flex justify-end gap-2 border-t border-outline-variant">
              <button onClick={() => setViewCrawlAccount(null)}
                className="px-4 py-2 bg-surface border border-outline-variant hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface rounded-2xl text-xs font-semibold transition-all duration-200 ease-out cursor-pointer">
                Đóng
              </button>
              <button onClick={() => handleOpenEditCrawl(viewCrawlAccount)}
                className="px-4 py-2 bg-primary hover:bg-on-primary-fixed-variant text-white rounded-2xl text-xs font-semibold transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer">
                Chỉnh sửa
              </button>
            </div>
          </div>
        </div>)}

      {/* ── Add/Edit Form Modal ────────────────────────────────────── */}
      {showCrawlForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "448px" }}
            className="bg-surface rounded-2xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MaterialIcon name={formId ? "edit" : "person_add"} className="text-lg" />
                </span>
                {formId ? "Cập nhật tài khoản cào" : "Thêm tài khoản cào LinkedIn"}
              </h3>
              <button onClick={() => setShowCrawlForm(false)}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl p-1.5 transition-all duration-200 ease-out cursor-pointer">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <form onSubmit={handleSaveCrawl} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 text-red-600 text-xs p-3 rounded-xl border border-red-100 flex items-center gap-2">
                  <MaterialIcon name="error" className="text-sm" /> {formError}
                </div>)}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                  Email LinkedIn <span className="text-primary">*</span>
                </label>
                <input type="email" required placeholder="name@example.com" value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out" />
              </div>
              <div className="space-y-1 relative">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                  Mật khẩu cào {formId ? "" : <span className="text-primary">*</span>}
                </label>
                <input type={showCrawlPassword ? "text" : "password"} required={!formId}
                  placeholder={formId ? "Để trống nếu không đổi mật khẩu" : "Mật khẩu tài khoản LinkedIn"}
                  value={formPassword} onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out pr-10" />
                <button type="button" onClick={() => setShowCrawlPassword(!showCrawlPassword)}
                  className="absolute right-3 top-7 text-on-surface-variant hover:text-on-surface cursor-pointer"
                  aria-label={showCrawlPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
                  {showCrawlPassword ? <span className="text-[11px]">🙈</span> : <span className="text-[11px]">👁️</span>}
                </button>
              </div>
              <div className="flex gap-3 pt-3 border-t border-outline-variant">
                <button type="button" disabled={formSaving} onClick={() => setShowCrawlForm(false)}
                  className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface font-bold py-2 rounded-2xl text-xs transition-all duration-200 ease-out cursor-pointer">
                  Hủy
                </button>
                <button type="submit" disabled={formSaving}
                  className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2 rounded-2xl text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer disabled:opacity-50 flex items-center justify-center">
                  {formSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : formId ? "Cập nhật" : "Lưu cấu hình"}
                </button>
              </div>
            </form>
          </div>
        </div>)}

      {/* ── Verify / OTP Modal ─────────────────────────────────────── */}
      {verifyModalOpen && verifyAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "440px" }}
            className="bg-surface rounded-2xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FaLock size={14} />
                </span>
                Xác minh tài khoản cào
              </h3>
              <button onClick={() => { setVerifyModalOpen(false); setVerifyError(""); setVerifySuccess(""); }}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl p-1.5 transition-all duration-200 ease-out cursor-pointer">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>

            {stepVerify === "done" ? (
              /* Success state */
              <div className="p-6 space-y-4 text-center">
                <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                  <MaterialIcon name="check_circle" className="text-green-500 text-4xl" />
                </div>
                <p className="text-sm font-bold text-on-surface">{verifySuccess}</p>
                <button onClick={() => { setVerifyModalOpen(false); setStepVerify("loading"); setVerifyError(""); setVerifySuccess(""); }}
                  className="px-6 py-2.5 bg-primary hover:bg-on-primary-fixed-variant text-white rounded-2xl text-xs font-bold transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer">
                  Đóng
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                {/* Account info */}
                <div className="bg-surface-container-low rounded-2xl p-3 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-[#0077B5]/10 text-[#0077B5] flex items-center justify-center shrink-0">
                    <FaLinkedin size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-on-surface truncate">{verifyAccount.email_linkedin}</p>
                    <p className="text-[10px] text-on-surface-variant">{verifyAccount.email_member}</p>
                  </div>
                </div>

                {/* Error */}
                {verifyError && (
                  <div className="bg-red-50 text-red-600 text-xs p-3 rounded-xl border border-red-100 flex items-center gap-2">
                    <MaterialIcon name="error" className="text-sm shrink-0" /> {verifyError}
                  </div>)}

                {stepVerify === "loading" ? (
                  <div className="py-8 text-center space-y-4">
                    <div className="w-14 h-14 border-4 border-outline-variant border-t-primary rounded-full animate-spin mx-auto" />
                    <p className="text-sm font-bold text-on-surface">Hệ thống đang chạy Playwright ngầm...</p>
                    <p className="text-[11px] text-on-surface-variant">
                      Quá trình đăng nhập và vượt rào cản có thể mất từ 30s đến 1 phút.<br/>
                      Vui lòng giữ nguyên trang và không đóng hộp thoại này.
                    </p>
                  </div>
                ) : stepVerify === "otp" ? (
                  /* Step 2: OTP input */
                  <form onSubmit={handleSubmitOtp} className="space-y-3">
                    <div className="text-center space-y-1">
                      <p className="text-xs font-bold text-on-surface">Nhập mã xác minh OTP</p>
                      <p className="text-[10px] text-on-surface-variant">
                        Mã xác minh đã được gửi đến {verifyAccount.email_linkedin} hoặc điện thoại đã đăng ký
                      </p>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      placeholder="• • • • • •"
                      maxLength={6}
                      value={verifyOtp}
                      onChange={(e) => setVerifyOtp(e.target.value.replace(/\D/g, ""))}
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant rounded-xl text-center text-2xl font-mono font-bold text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out letter-spacing-wider"
                      autoFocus />
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setStepVerify("initiate")}
                        className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface-variant font-bold py-2.5 rounded-2xl text-xs transition-all duration-200 ease-out cursor-pointer">
                        ← Quay lại
                      </button>
                      <button type="submit" disabled={verifyLoading || verifyOtp.trim().length < 6}
                        className="flex-[2] bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2.5 rounded-2xl text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                        {verifyLoading
                          ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          : <><FaLock size={12} /> Xác minh</>}
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Step 1: Password input to initiate login */
                  <LoginStep
                    onSubmit={handleLoginAndGetCheckpoint}
                    loading={verifyLoading}
                    error={verifyError}
                    onError={(msg) => setVerifyError(msg)} />
                )}
              </div>
            )}
          </div>
        </div>)}

    </div>
  );
}

// ── Login Step Component ───────────────────────────────────────────────────────

function LoginStep({
  onSubmit,
  loading,
  onError,
}: {
  onSubmit: (password: string) => Promise<void>;
  loading: boolean;
  error: string;
  onError: (msg: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onError(""); void onSubmit(password); }}
      className="space-y-3">
      <div className="text-center space-y-1">
        <p className="text-xs font-bold text-on-surface">Đăng nhập để xác minh</p>
        <p className="text-[10px] text-on-surface-variant">
          Nhập mật khẩu LinkedIn để bắt đầu quy trình xác minh OTP (nếu có)
        </p>
      </div>
      <div className="relative">
        <input type="password" placeholder="Mật khẩu LinkedIn"
          value={password}
          onChange={(e) => { setPassword(e.target.value); onError(""); }}
          className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out" />
      </div>
      <button type="submit" disabled={loading || !password.trim()}
        className="w-full bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2.5 rounded-2xl text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
        {loading
          ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          : <><FaLock size={12} /> Đăng nhập &amp; xác minh</>}
      </button>
    </form>
  );
}
