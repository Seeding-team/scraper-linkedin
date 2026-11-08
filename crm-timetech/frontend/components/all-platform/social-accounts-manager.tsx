"use client";

import { useState, useEffect, useCallback } from "react";
import { FaFacebook, FaLinkedin, FaPlus, FaEye, FaEyeSlash, FaQuestionCircle } from "react-icons/fa";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  socialAccountsService,
  platformsService,
} from "@/services/all-platform.service";
import type { SocialAccount, FeedPlatform } from "@/types/unified.types";
import type { SocialPlatform } from "@/services/all-platform.service";

interface SocialAccountsProps {
  onAccountChange?: (platform: string, accountName: string) => void;
}

const PLATFORMS: { key: string; label: string; Icon: typeof FaFacebook | typeof FaQuestionCircle }[] = [
  { key: "facebook", label: "Facebook", Icon: FaFacebook },
  { key: "linkedin", label: "LinkedIn", Icon: FaLinkedin },
  { key: "unknown", label: "Chưa gán", Icon: FaQuestionCircle },
];

export function SocialAccountsManager({ onAccountChange }: SocialAccountsProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePlatform, setActivePlatform] = useState<string>("facebook");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewAccount, setViewAccount] = useState<SocialAccount | null>(null);
  const [showViewPassword, setShowViewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    account_name: "",
    account_email: "",
    account_password: "",
    account_profile_id: "",
    id_platform: null as number | null,
    two_fa_secret: "",
    session_cookie: "",
    is_primary: false,
    notes: "",
    is_banned: false,
    ban_reason: "",
  });

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, platRes] = await Promise.all([
        socialAccountsService.getAll(),
        platformsService.getAll(),
      ]);
      if (accRes.success && accRes.data) setAccounts(accRes.data as SocialAccount[]);
      if (platRes.success && platRes.data) setPlatforms(platRes.data as SocialPlatform[]);
    } catch {
      setError("Không thể tải danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  const filtered = accounts.filter((a) => a.platform === activePlatform || (activePlatform === "unknown" && !a.platform));
  const platformAccounts = (platform: string) => accounts.filter((a) => a.platform === platform || (platform === "unknown" && !a.platform));

  const handleSetPrimary = async (accountId: string) => {
    try {
      const res = await socialAccountsService.setPrimary(accountId);
      if (res.success) {
        await fetchAccounts();
        setSuccess("Đã đặt làm tài khoản mặc định");
        const primary = accounts.find((a) => a.id === accountId);
        if (primary && onAccountChange)
          onAccountChange(primary.platform as FeedPlatform, primary.account_name);
      }
    } catch { setError("Lỗi khi đặt tài khoản mặc định"); }
  };

  const handleDelete = async (accountId: string) => {
    if (!confirm("Bạn có chắc muốn xóa tài khoản này?")) return;
    try {
      const res = await socialAccountsService.delete(accountId);
      if (res.success) { await fetchAccounts(); setSuccess("Đã xóa tài khoản"); }
    } catch { setError("Lỗi khi xóa tài khoản"); }
  };

  const openEdit = (acc: SocialAccount) => {
    setEditingId(acc.id);
    setFormData({
      account_name: acc.account_name,
      account_email: acc.account_email || "",
      account_password: acc.account_password || "",
      account_profile_id: acc.account_profile_id || "",
      id_platform: acc.id_platform ?? null,
      is_primary: acc.is_primary,
      notes: acc.notes || "",
      two_fa_secret: acc.two_fa_secret || "",
      session_cookie: acc.session_cookie || "",
      is_banned: acc.is_banned ?? false,
      ban_reason: acc.ban_reason || "",
    });
    setShowForm(true);
  };

  const openAdd = () => {
    setEditingId(null);
    setFormData({
      account_name: "", account_email: "", account_password: "",
      account_profile_id: "", id_platform: null,
      is_primary: false, notes: "",
      two_fa_secret: "", session_cookie: "",
      is_banned: false,
      ban_reason: "",
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.account_name.trim()) { setError("Tên tài khoản không được trống"); return; }
    setError(null); setSuccess(null);
    try {
      const payload = {
        account_name: formData.account_name,
        account_email: formData.account_email || undefined,
        account_password: formData.account_password || undefined,
        account_profile_id: formData.account_profile_id || undefined,
        id_platform: formData.id_platform,
        is_primary: formData.is_primary,
        notes: formData.notes || undefined,
        is_banned: formData.is_banned,

    ban_reason:
        formData.is_banned
            ? formData.ban_reason
            : undefined,
      };
      let res;
      if (editingId) {
        res = await socialAccountsService.update({ id: editingId, ...payload });
      } else {
        res = await socialAccountsService.create({ platform: activePlatform, ...payload });
      }
      if (res.success) {
        await fetchAccounts();
        setShowForm(false);
        setSuccess(editingId ? "Đã cập nhật tài khoản" : "Đã thêm tài khoản");
      } else {
        setError(res.message || "Thao tác thất bại");
      }
    } catch { setError("Có lỗi xảy ra"); }
  };

  // Resolve platform name from id_platform
  const getPlatformName = (id: number | null | undefined) => {
    if (!id) return null;
    const p = platforms.find((pl) => pl.id === id);
    return p?.name || null;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-on-surface">Tài khoản mạng xã hội</h2>
            <a
              href="https://www.youtube.com/watch?v=qA5U5IbOq7w"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <MaterialIcon name="videocam" className="text-[15px]" />
              Video hướng dẫn
            </a>
          </div>
          <p className="text-xs text-on-surface-variant">Quản lý danh sách tài khoản Facebook/LinkedIn phục vụ crawl dữ liệu</p>
        </div>
        <button type="button" onClick={openAdd}
          className="flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition active:scale-95 shadow-sm cursor-pointer">
          <FaPlus size={10} /> Thêm tài khoản
        </button>
      </div>

      {/* Platform tabs */}
      <div className="inline-flex w-full max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-low p-1 sm:w-fit">
        {PLATFORMS.map(({ key, label, Icon }) => {
          const count = platformAccounts(key).length;
          const active = activePlatform === key;
          return (
            <button key={key} type="button" onClick={() => setActivePlatform(key)}
              className={cn(
                "whitespace-nowrap flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all duration-200 ease-out cursor-pointer",
                active ? "bg-primary text-white shadow-[0_2px_8px_-1px_rgba(217,55,55,0.4)]"
                  : "text-on-surface-variant hover:bg-surface hover:text-primary"
              )}>
              <Icon size={9} /> {label}
              {count > 0 && (
                <span className={cn("ml-0.5 px-1 py-0.5 rounded-full text-[8px] font-black normal-case leading-none",
                  active ? "bg-white/25 text-white" : "bg-surface-container-highest text-on-surface-variant")}>
                  {count}
                </span>)}
            </button>);
        })}
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-primary-container/10 border border-primary-container/20 text-primary-container rounded-xl px-4 py-2.5 text-xs flex items-center gap-2">
          <MaterialIcon name="error" className="text-base" /><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-primary-container hover:text-on-primary-fixed-variant">✕</button>
        </div>)}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-2.5 text-xs flex items-center gap-2">
          <MaterialIcon name="check_circle" className="text-base" /><span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-500 hover:text-green-700">✕</button>
        </div>)}

      {/* Account Table */}
      {loading ? (
        <div className="text-center py-12 text-on-surface-variant text-xs">Đang tải danh sách tài khoản...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-surface-container-low/60 rounded-2xl border border-dashed border-outline-variant">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <MaterialIcon name="group_add" className="text-3xl text-primary" />
          </div>
          <p className="text-on-surface font-semibold text-sm">
            Chưa có tài khoản {activePlatform === "facebook" ? "Facebook" : activePlatform === "linkedin" ? "LinkedIn" : ""} nào
          </p>
          <p className="text-on-surface-variant text-xs mt-1">Thêm tài khoản để bắt đầu quản lý</p>
          <button onClick={openAdd}
            className="mt-4 inline-flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-out active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] cursor-pointer">
            <FaPlus size={10} /> Thêm tài khoản ngay
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
              <tr>
                <th className="py-3 px-4">FB Ban</th>
                <th className="py-3 px-4">Tên tài khoản</th>
                <th className="py-3 px-4">Email đăng nhập</th>   
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Platform</th>
                <th className="py-3 px-4 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-on-surface-variant">
              {filtered.map((acc) => (
                
                <tr key={acc.id} className="hover:bg-surface-container-low/30 transition">
                  <td className="py-3 px-4">

    {acc.is_banned ? (

        <div>

            <span className="bg-red-100 text-red-600 px-2 py-1 rounded">
                Đã BAN
            </span>

            {acc.ban_reason && (

                <div className="text-xs text-gray-500 mt-1">
                    {acc.ban_reason}
                </div>

            )}

        </div>

    ) : (

        <span className="text-green-600">
            Bình thường
        </span>

    )}

</td>
                  <td className="py-3.5 px-4 font-bold text-on-surface flex items-center gap-2">
                    <span className={cn("w-6 h-6 rounded-lg flex items-center justify-center text-[10px]",
                      acc.platform === "facebook" ? "bg-primary/10 text-primary" :
                        acc.platform === "linkedin" ? "bg-[#0077B5]/10 text-[#0077B5]" :
                          "bg-[#A0A0A0]/10 text-on-surface-variant"
                    )}>
                      {acc.platform === "facebook" ? <FaFacebook size={12} /> :
                        acc.platform === "linkedin" ? <FaLinkedin size={12} /> :
                          <FaQuestionCircle size={12} />}
                    </span>
                    {acc.account_name}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px]">{acc.account_email || "—"}</td>
                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap gap-1.5">
                      {acc.is_primary && (
                        <span className="bg-[#D97706]/10 text-[#D97706] text-[9px] font-bold px-2 py-0.5 rounded-full border border-[#D97706]/20">Mặc định</span>)}
                      <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full border",
                        acc.is_active ? "bg-green-50 text-green-700 border-green-100" : "bg-surface-container-low text-on-surface-variant border-outline-variant")}>
                        {acc.is_active ? "Hoạt động" : "Tắt"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    {acc.id_platform ? (
                      <span className="bg-primary/10 text-primary text-[9px] font-bold px-2 py-0.5 rounded-full border border-primary/20">
                        {getPlatformName(acc.id_platform) || `ID: ${acc.id_platform}`}
                      </span>
                    ) : (
                      <span className="text-on-surface-variant text-[10px] italic">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center justify-center gap-2">
                      {!acc.is_primary && (
                        <button onClick={() => void handleSetPrimary(acc.id)}
                          className="p-1.5 text-[#D97706] hover:bg-amber-50 rounded-lg transition cursor-pointer"
                          title="Đặt mặc định">
                          <MaterialIcon name="favorite" className="text-base" />
                        </button>)}
                      <button onClick={() => setViewAccount(acc)}
                        className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg transition cursor-pointer" title="Xem chi tiết">
                        <MaterialIcon name="visibility" className="text-base" />
                      </button>
                      <button onClick={() => openEdit(acc)}
                        className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition cursor-pointer" title="Sửa">
                        <MaterialIcon name="edit" className="text-base" />
                      </button>
                      <button onClick={() => void handleDelete(acc.id)}
                        className="p-1.5 text-primary-container hover:bg-red-50 rounded-lg transition cursor-pointer" title="Xóa">
                        <MaterialIcon name="delete" className="text-base" />
                      </button>
                    </div>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>)}

      {/* ── VIEW DETAILS POPUP ──────────────────────────────────────── */}
      {viewAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "448px" }}
            className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2">
                <span className="text-lg">ℹ️</span> Chi tiết tài khoản
              </h3>
              <button onClick={() => { setViewAccount(null); setShowViewPassword(false); }}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg p-1.5 transition cursor-pointer">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs max-h-[65vh] overflow-y-auto">
              {[
                ["Nền tảng", <span key="p" className="capitalize font-bold text-on-surface">{viewAccount.platform}</span>],
                ["Tên hiển thị", <span key="n" className="font-semibold text-on-surface">{viewAccount.account_name}</span>],
                ["Email / SĐT", <span key="e" className="font-mono">{viewAccount.account_email || "—"}</span>],
                ["Mật khẩu",
                  <span key="pw" className="font-mono flex items-center gap-1">
                    {showViewPassword ? viewAccount.account_password || "—" : "••••••••"}
                    {viewAccount.account_password && (
                      <button onClick={() => setShowViewPassword(!showViewPassword)} className="text-on-surface-variant hover:text-on-surface">
                        {showViewPassword ? <FaEyeSlash size={12} /> : <FaEye size={12} />}
                      </button>)}
                  </span>],
                ["Profile ID", <span key="pid" className="font-mono">{viewAccount.account_profile_id || "—"}</span>],
                ["Platform (nội bộ)", getPlatformName(viewAccount.id_platform)
                  ? <span key="pl" className="bg-primary/10 text-primary text-[9px] font-bold px-2 py-0.5 rounded-full border border-primary/20">{getPlatformName(viewAccount.id_platform)}</span>
                  : <span key="nopl" className="text-on-surface-variant italic">Chưa gán</span>],
                ["Trạng thái",
                  <span key="s" className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold border",
                    viewAccount.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-surface-container-low text-on-surface-variant border-outline-variant")}>
                    {viewAccount.is_active ? "Hoạt động" : "Tắt"}
                  </span>],
                ["Ghi chú", <span key="notes" className="italic leading-relaxed">{viewAccount.notes || "—"}</span>],
              ].map(([label, value], i) => (
                <div key={i} className={cn("flex items-start gap-3 py-2", i < 8 && "border-b border-outline-variant")}>
                  <span className="text-on-surface-variant font-medium shrink-0 w-28">{label}</span>
                  <div className="flex-1 min-w-0">{value}</div>
                </div>))}
            </div>
            <div className="px-6 py-4 bg-surface-container-low flex justify-end gap-2 border-t border-outline-variant">
              <button onClick={() => { setViewAccount(null); setShowViewPassword(false); }}
                className="px-4 py-2 bg-surface border border-outline-variant hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface rounded-xl text-xs font-semibold transition cursor-pointer">
                Đóng
              </button>
              <button onClick={() => { const acc = viewAccount; setViewAccount(null); openEdit(acc); }}
                className="px-4 py-2 bg-primary hover:bg-on-primary-fixed-variant text-white rounded-xl text-xs font-semibold transition shadow-sm cursor-pointer">
                Chỉnh sửa
              </button>
            </div>
          </div>
        </div>)}

      {/* ── ADD/EDIT MODAL ─────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "480px", maxHeight: "min(90vh, 640px)" }}
            className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant bg-surface-container-low/60 shrink-0">
              <h3 className="font-bold text-on-surface text-sm">
                {editingId ? "Sửa tài khoản" : `Thêm tài khoản ${activePlatform === "facebook" ? "Facebook" : "LinkedIn"}`}
              </h3>
              <button onClick={() => setShowForm(false)}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg p-1.5 transition cursor-pointer">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>

            {/* Scrollable form body */}
            <form id="account-form" onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* Row: Tên + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                    Tên tài khoản <span className="text-primary-container">*</span>
                  </label>
                  <input type="text" required placeholder="VD: FB Thanh Dat"
                    value={formData.account_name}
                    onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition" />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">Email / SĐT</label>
                  <input type="text" placeholder="email@example.com"
                    value={formData.account_email}
                    onChange={(e) => setFormData({ ...formData, account_email: e.target.value })}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition" />
                </div>
              </div>

              {/* Row: Password + 2FA */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 relative">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">Mật khẩu</label>
                  <input type={showPassword ? "text" : "password"}


 placeholder="••••••••"
                    value={formData.account_password}
                    onChange={(e) => setFormData({ ...formData, account_password: e.target.value })}
                    className="w-full px-3 py-2 pr-8 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-6.5 text-on-surface-variant hover:text-on-surface">
                    {showPassword ? <FaEyeSlash size={13} /> : <FaEye size={13} />}
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">Trạng thái</label>
                  <select value={formData.is_primary ? "true" : "false"}
                    onChange={(e) => setFormData({ ...formData, is_primary: e.target.value === "true" })}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition">
                    <option value="false">Tài khoản phụ</option>
                    <option value="true">Tài khoản chính (Mặc định)</option>
                  </select>
                </div>
              </div>

              {/* Row: Profile ID + Platform dropdown */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">Profile ID</label>
                  <input type="text" placeholder="UID / Public Profile ID"
                    value={formData.account_profile_id}
                    onChange={(e) => setFormData({ ...formData, account_profile_id: e.target.value })}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition" />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">Platform nội bộ</label>
                  <select value={formData.id_platform ?? ""}
                    onChange={(e) => setFormData({
                      ...formData,
                      id_platform: e.target.value ? Number(e.target.value) : null,
                    })}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition cursor-pointer">
                    <option value="">— Chưa gán —</option>
                    {platforms.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>))}
                  </select>
                </div>
              </div>
              <div className="space-y-3">

    <label className="flex items-center gap-2">

        <input
            type="checkbox"
            checked={formData.is_banned}
            onChange={(e)=>
                setFormData({
                    ...formData,
                    is_banned:e.target.checked,
                    ban_reason:e.target.checked
                        ? formData.ban_reason
                        : "",
                })
            }
        />

        <span className="text-sm font-medium">
            Facebook Account bị BAN
        </span>

    </label>

    {formData.is_banned && (

        <textarea
            rows={1}
            placeholder="Nhập lý do tài khoản bị BAN..."
            value={formData.ban_reason}
            onChange={(e)=>
                setFormData({
                    ...formData,
                    ban_reason:e.target.value,
                })
            }
            className="w-full px-3 py-2 border rounded-xl"
        />

    )}

</div>
              {/* Ghi chú */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase">Ghi chú</label>
                <textarea rows={2} placeholder="VD: Tài khoản dùng cho nhóm IT"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition resize-none" />
              </div>

              {/* Checkbox was removed in favor of the select above */}
            </form>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-outline-variant bg-surface flex items-center gap-3 shrink-0">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface font-bold py-2.5 rounded-xl text-xs transition cursor-pointer">
                Hủy
              </button>
              <button type="submit" form="account-form"
                className="flex-[2] bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2.5 rounded-xl text-xs transition shadow-sm cursor-pointer">
                {editingId ? "Cập nhật" : "Thêm mới"}
              </button>
            </div>
          </div>
        </div>)}
    </div>
  );
}