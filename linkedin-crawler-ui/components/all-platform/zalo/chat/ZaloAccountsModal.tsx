"use client";

import { useEffect, useState } from "react";
import { Download, Plus, RefreshCw, Trash2, CheckCircle2, AlertTriangle, ExternalLink, X, ShieldCheck, Zap } from "lucide-react";
import { ensureZaloExtensionBridge } from "@/lib/zaloExtensionClient";
import type { ZaloAccountSummary } from "@/lib/types";

interface Props {
  onClose: () => void;
  onChanged?: () => void;
}

interface NoticeMessage {
  text: string;
  isError?: boolean;
  actionUrl?: string;
  actionLabel?: string;
}

export function ZaloAccountsModal({ onClose, onChanged }: Props) {
  const [accounts, setAccounts] = useState<ZaloAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/all-platform/zalo/accounts?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      const rawAccounts = Array.isArray(data?.accounts) ? data.accounts : [];
      const normalized: ZaloAccountSummary[] = rawAccounts.map((a: any) => {
        const isExpired = Boolean(a.listener?.auth_expired);
        const isOnline = Boolean(a.listener?.connected);
        const hasAuth = Boolean(a.has_auth);
        let status: "connected" | "waiting_qr" | "disconnected" | "error" = "disconnected";
        if (isExpired) status = "error";
        else if (isOnline || hasAuth) status = "connected";

        return {
          account_id: a.account_id,
          display_name: a.label || a.account_id,
          status,
          is_ws_connected: isOnline,
          phone: a.phone || null,
          owner_staff_id: a.owner_id || null,
          last_error: a.listener?.last_error || null,
        };
      });
      setAccounts(normalized);
    } catch (e: any) {
      setMessage({ text: e.message || "Không thể tải danh sách tài khoản.", isError: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    ensureZaloExtensionBridge();
    loadAccounts();
  }, []);

  const handleConnect = async (acc: ZaloAccountSummary) => {
    setConnectingId(acc.account_id);
    const accName = acc.display_name || acc.account_id;
    const bridgeUrl = typeof window !== "undefined" ? window.location.origin : "";
    const connectUrl = `https://chat.zalo.me/?zaloExtUserId=${encodeURIComponent(acc.account_id)}&zaloExtBackendUrl=${encodeURIComponent(bridgeUrl)}`;

    try {
      window.open(connectUrl, "_blank");
    } catch (_) {}

    setMessage({
      text: `⏳ Đang mở Zalo Web và chờ Extension "Seeding Zalo Connector" trích xuất phiên cho "${accName}"... Nếu chưa đăng nhập, vui lòng đăng nhập trên tab Zalo vừa mở.`,
      actionUrl: connectUrl,
      actionLabel: "Mở lại tab Zalo ↗",
    });

    try {
      ensureZaloExtensionBridge();

      try {
        window.__zaloExtension?.importSession?.({
          account_id: acc.account_id,
          owner_id: acc.account_id,
          backend_url: bridgeUrl,
          login_timeout_ms: 60000,
        }).catch(() => {});
      } catch (_) {}

      let connected = false;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const checkRes = await fetch(`/api/all-platform/zalo/accounts?t=${Date.now()}`, { cache: "no-store" });
          const checkData = await checkRes.json();
          const current = (checkData.accounts || []).find((a: any) => a.account_id === acc.account_id);
          if (current && (current.listener?.connected || current.has_auth)) {
            connected = true;
            break;
          }
        } catch (_) {}
      }

      if (!connected) {
        throw new Error(
          `Hệ thống đang chờ nhận phiên đăng nhập từ Extension. Vui lòng đảm bảo bạn đã đăng nhập Zalo trên tab vừa mở, sau đó bấm lại nút "⚡ Kết nối 1-chạm".`
        );
      }

      setMessage({
        text: `✅ Kết nối thành công tài khoản "${accName}"! Phiên Zalo đã sẵn sàng hoạt động.`
      });
      await loadAccounts();
      onChanged?.();
    } catch (err: any) {
      setMessage({
        text: err.message || "Lỗi khi kết nối tài khoản qua Extension.",
        isError: true,
        actionUrl: connectUrl,
        actionLabel: "Mở lại tab Zalo ↗",
      });
    } finally {
      setConnectingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/all-platform/zalo/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId.trim(),
          label: displayName.trim() || accountId.trim(),
          phone: phone.trim() || undefined,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Không thể tạo tài khoản.");
      setMessage({ text: `Đã tạo tài khoản "${accountId.trim()}". Hãy bấm "⚡ Kết nối 1-chạm" để đăng nhập.` });
      setAccountId("");
      setDisplayName("");
      setPhone("");
      setShowAddForm(false);
      await loadAccounts();
      onChanged?.();
    } catch (err: any) {
      setMessage({ text: err.message, isError: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (acc: ZaloAccountSummary) => {
    const name = acc.display_name || acc.account_id;
    const msg = `⚠️ XÁC NHẬN XÓA TÀI KHOẢN "${name}"?\n\n` +
      `Thao tác này sẽ xóa sạch session kết nối và dữ liệu liên quan. Bạn có chắc chắn muốn xóa vĩnh viễn không?`;

    if (!confirm(msg)) return;

    setBusyId(acc.account_id);
    setMessage(null);
    try {
      const res = await fetch(`/api/all-platform/zalo/accounts/${encodeURIComponent(acc.account_id)}`, {
        method: "DELETE"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Không thể xóa tài khoản.");
      setMessage({ text: `Đã xóa tài khoản "${name}".` });
      await loadAccounts();
      onChanged?.();
    } catch (err: any) {
      setMessage({ text: err.message, isError: true });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200/80 overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0068ff] to-[#0052cc] text-white shadow-md">
              <Zap size={22} className="fill-current" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Quản lý tài khoản Zalo</h2>
              <p className="text-xs text-slate-500">Kết nối 1-chạm qua Extension "Seeding Zalo Connector" & đồng bộ hội thoại</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/extension-login-zalo.zip"
              download
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition shadow-2xs"
              title="Tải tiện ích Seeding Zalo Connector (.zip)"
            >
              <Download size={14} />
              <span>Tải Extension (Zip)</span>
            </a>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0068ff] hover:bg-[#0052cc] px-3.5 py-1.5 text-xs font-bold text-white transition shadow-sm cursor-pointer"
            >
              <Plus size={14} />
              <span>{showAddForm ? "Hủy" : "Thêm tài khoản"}</span>
            </button>
            <button
              onClick={onClose}
              className="ml-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
              title="Đóng"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`flex items-start justify-between gap-3 px-6 py-3 text-xs font-medium border-b ${message.isError ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}>
            <div className="flex items-start gap-2 flex-1">
              {message.isError ? <AlertTriangle size={16} className="shrink-0 text-red-600 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 text-emerald-600 mt-0.5" />}
              <div>
                <span>{message.text}</span>
                {message.actionUrl && (
                  <a href={message.actionUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-bold underline hover:opacity-80">
                    {message.actionLabel || "Xem liên kết ↗"}
                  </a>
                )}
              </div>
            </div>
            <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Form thêm tài khoản mới */}
        {showAddForm && (
          <form onSubmit={handleCreate} className="border-b border-slate-200/80 bg-slate-50/50 p-6 space-y-4 animate-in slide-in-from-top-2 duration-150">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Thêm tài khoản Zalo mới</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mã định danh (ID) *</label>
                <input
                  type="text"
                  required
                  placeholder="vd: zl_markee_01"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0068ff] focus:ring-1 focus:ring-[#0068ff]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tên gợi nhớ (Display Name)</label>
                <input
                  type="text"
                  placeholder="vd: Markee CSKH 1"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0068ff] focus:ring-1 focus:ring-[#0068ff]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Số điện thoại (SĐT)</label>
                <input
                  type="text"
                  placeholder="vd: 0765055708"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0068ff] focus:ring-1 focus:ring-[#0068ff]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving || !accountId.trim()}
                className="rounded-xl bg-[#0068ff] hover:bg-[#0052cc] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50 shadow-sm"
              >
                {saving ? "Đang tạo..." : "Tạo & Lưu"}
              </button>
            </div>
          </form>
        )}

        {/* Danh sách tài khoản dạng Card đẹp chuẩn Kho Tri Thức */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw size={20} className="animate-spin text-[#0068ff]" />
              <span>Đang tải danh sách tài khoản...</span>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Chưa có tài khoản Zalo nào. Hãy bấm <strong>"+ Thêm tài khoản"</strong> ở trên để bắt đầu!
            </div>
          ) : (
            accounts.map((acc) => {
              const isConnecting = connectingId === acc.account_id;
              const isBusy = busyId === acc.account_id;
              const isOnline = acc.status === "connected";
              const isError = acc.status === "error";

              return (
                <div
                  key={acc.account_id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs hover:border-slate-300 transition-all"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 font-bold text-[#0068ff] text-base">
                        {acc.display_name.slice(0, 1).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white ${isOnline ? "bg-emerald-500 ring-1 ring-emerald-200" : isError ? "bg-red-500" : "bg-slate-300"}`}
                        title={isOnline ? "Online (Đã kết nối)" : isError ? "Lỗi phiên đăng nhập" : "Offline"}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 truncate">{acc.display_name}</span>
                        {isOnline ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                            <ShieldCheck size={11} /> Đã kết nối
                          </span>
                        ) : isError ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-[10px] font-bold text-red-700">
                            <AlertTriangle size={11} /> Hết hạn phiên
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
                            Chưa kết nối
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                        <span className="font-mono text-[11px] text-slate-600 font-semibold">{acc.account_id}</span>
                        {acc.phone && <span>· SĐT: <strong className="text-slate-700">{acc.phone}</strong></span>}
                      </div>
                      {acc.last_error && isError && (
                        <p className="text-[11px] text-red-600 mt-1 line-clamp-1">{acc.last_error}</p>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      disabled={isConnecting || isBusy}
                      onClick={() => handleConnect(acc)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shadow-xs cursor-pointer ${
                        isOnline
                          ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          : "bg-gradient-to-r from-[#0068ff] to-[#0052cc] text-white hover:from-[#0052cc] hover:to-[#003d99]"
                      } disabled:opacity-50`}
                      title="Kết nối nhanh bằng Extension Chrome"
                    >
                      {isConnecting ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>Đang kết nối...</span>
                        </>
                      ) : (
                        <>
                          <Zap size={14} className={isOnline ? "text-amber-500 fill-amber-500" : "fill-current"} />
                          <span>{isOnline ? "Đăng nhập lại" : "⚡ Kết nối 1-chạm"}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isBusy || isConnecting}
                      onClick={() => handleDelete(acc)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition"
                      title="Xóa hoàn toàn tài khoản (Deep Purge)"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
