"use client";

import { useState, useEffect, useCallback } from "react";
import { FaFacebook, FaPlus } from "react-icons/fa";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fbInboxAccountService, type FbInboxAccount } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { provisionExtension, pingExtension, addAccountViaExtension } from "@/lib/markee-ext-provision";
import { fbFetch, fbHeaders, getFbProvisionConfig } from "@/lib/markee-fb-api";
import { usersService } from "@/services/all-platform.service";

interface FbInboxAccountsTabProps {
  onChange?: () => void;
}

interface Session {
  user_id: string; fb_user_id?: string; label?: string; owner?: string; email?: string; note?: string;
  online?: boolean; expired?: boolean; days_left?: number | null; cookie_count?: number; needs_relogin?: boolean;
}

interface UnifiedAccount {
  user_id: string;
  label: string;
  fb_user_id?: string;
  online: boolean;
  needs_relogin: boolean;
  days_left?: number | null;
  hasKpi: boolean;
  inboxAccountId?: string;
  session?: Session;
  inboxAccount?: FbInboxAccount;
  email?: string;
  note?: string;
  expired?: boolean;
}

export function FbInboxAccountsTab({ onChange }: FbInboxAccountsTabProps) {
  const { user } = useAppAuth();
  const owner = user?.id || "";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [inboxAccounts, setInboxAccounts] = useState<FbInboxAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [connErr, setConnErr] = useState(false);
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});
  const [detailAccount, setDetailAccount] = useState<UnifiedAccount | null>(null);

  const showToast = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // Khởi tạo extension
  useEffect(() => {
    if (!owner) return;
    (async () => {
      const { installed } = await pingExtension();
      setExtInstalled(installed);
      if (installed) {
        try {
          const cfg = await getFbProvisionConfig();
          await provisionExtension({ serverUrl: cfg.serverUrl, owner, apiKey: cfg.extensionApiKey, label: user?.name || user?.email || owner });
        } catch (err) {
          // Backend chưa cấu hình FB extension (thiếu env) — không crash trang, chỉ log để debug.
          console.warn("[FbInboxAccountsTab] Không lấy được cấu hình FB extension:", err);
        }
      }
    })();
  }, [owner, user?.email, user?.name]);

  useEffect(() => {
    if (!owner) return;
    const fallbackName = user?.name || user?.email || owner;
    setOwnerNames({ [owner]: fallbackName });
    usersService.getAllProfiles().then(res => {
      if (!res.success || !Array.isArray(res.data)) return;
      const next: Record<string, string> = { [owner]: fallbackName };
      for (const row of res.data) {
        if (row.id) next[row.id] = row.name || row.email || row.id;
      }
      setOwnerNames(next);
    }).catch(() => {});
  }, [owner, user?.email, user?.name]);

  // Tên
  const ownerLabel = useCallback((s: Session) => (s.owner && ownerNames[s.owner]) || "", [ownerNames]);
  const accLabel = useCallback((s: Session) => {
    const explicit = (s.label || "").trim();
    if (explicit && explicit !== s.user_id) return explicit;
    return s.email || ownerLabel(s) || "Tài khoản Facebook";
  }, [ownerLabel]);

  const loadAll = useCallback(async () => {
    try {
      const [rSessions, rInbox] = await Promise.all([
        fbFetch("/sessions").then(r => r.json()).catch(() => ({ sessions: [] })),
        fbInboxAccountService.list().catch(() => ({ success: false, data: { accounts: [] } }))
      ]);
      const nextSessions: Session[] = rSessions.sessions || [];
      setSessions(nextSessions);
      setConnErr(false);

      let nextInbox: FbInboxAccount[] = [];
      if (rInbox.success && rInbox.data) {
        nextInbox = (rInbox.data as any).accounts || [];
        setInboxAccounts(nextInbox);
      }

      // Tu dong dam bao MOI session (them moi, relogin, hay tai khoan cu con thieu
      // row) deu co fb_inbox_accounts - thay hoan toan cho nut "Bat tinh KPI" thu
      // cong truoc day. fbInboxAccountService.create() da tu update-or-insert theo
      // user_id (idempotent, xem link_user_account phia backend) nen goi lai moi
      // 5s (chu ky poll) khong tao trung, chi "chua bam" thi lan poll sau se tu bu.
      const unlinked = nextSessions.filter(s => !nextInbox.some(
        acc => acc.user_id === s.user_id || (!!acc.fb_user_id && !!s.fb_user_id && acc.fb_user_id === s.fb_user_id),
      ));
      for (const s of unlinked) {
        fbInboxAccountService.create({
          user_id: s.user_id,
          fb_user_id: s.fb_user_id || undefined,
          account_label: accLabel(s) || undefined,
        }).catch(() => { /* im lang - lan poll sau se thu lai */ });
      }
    } catch {
      setConnErr(true);
    } finally {
      setLoading(false);
    }
  }, [accLabel]);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 5000);
    return () => clearInterval(t);
  }, [loadAll]);

  // Thêm account via extension
  async function addAccount(relogin = false) {
    if (extInstalled === false) {
      showToast("Chưa cài extension trên trình duyệt này.", false);
      return;
    }
    setAdding(true);
    setStatus("⏳ Đang mở Facebook... Hãy đăng nhập tài khoản cần thêm trong tab mới. Hệ thống tự lưu khi xong.");
    const cfg = await getFbProvisionConfig();
    await provisionExtension({ serverUrl: cfg.serverUrl, owner, apiKey: cfg.extensionApiKey, label: user?.name || user?.email || owner });
    const res = await addAccountViaExtension();
    setAdding(false);
    if (res.success) {
      setStatus("");
      showToast(relogin ? "Đã đăng nhập lại tài khoản." : "Đã thêm tài khoản Facebook.", true);
      // KPI Inbox tu bat cho MOI truong hop (them moi/relogin/tai khoan cu) ngay
      // trong loadAll() - xem comment o do, khong can lam gi rieng o day nua.
      setTimeout(loadAll, 800);
    } else {
      setStatus("");
      showToast(res.error || "Thêm tài khoản thất bại.", false);
    }
  }

  // Extension actions
  async function rename(uid: string, current: string) {
    const name = window.prompt("Đặt tên gợi nhớ cho tài khoản này:", current);
    if (!name || !name.trim()) return;
    try {
      await fbFetch(`/extensions/${encodeURIComponent(uid)}/label`, {
        method: "POST", headers: fbHeaders(), body: JSON.stringify({ label: name.trim() }),
      });
      showToast("Đã đổi tên tài khoản", true);
      loadAll();
    } catch { showToast("Lỗi đổi tên", false); }
  }

  async function removeSession(uid: string, label: string) {
    if (!window.confirm(`Xóa extension "${label}" khỏi hệ thống? (chỉ xóa phiên đã lưu, không ảnh hưởng Facebook)`)) return;
    try {
      await fbFetch(`/session/cookie/${encodeURIComponent(uid)}`, { method: "DELETE" });
      showToast("Đã xóa tài khoản", true);
      loadAll();
    } catch { showToast("Lỗi xóa", false); }
  }

  async function removeAccountFull(uid: string, label: string) {
    if (!window.confirm(`CẢNH BÁO: Xóa HOÀN TOÀN tài khoản "${label}" - sẽ xóa file cookie phiên đăng nhập trên server VÀ toàn bộ dữ liệu KPI/đăng ký inbox liên quan trong database. Không thể khôi phục. Bạn có chắc chắn?`)) return;
    try {
      const r = await fbFetch(`/accounts/${encodeURIComponent(uid)}/full`, { method: "DELETE" });
      if (r.ok) {
        showToast("Đã xóa hoàn toàn tài khoản", true);
        loadAll();
        onChange?.();
      } else {
        showToast("Lỗi xóa hoàn toàn", false);
      }
    } catch { showToast("Lỗi xóa hoàn toàn", false); }
  }

  async function editMeta(s: Session) {
    const email = window.prompt("Email/SĐT đăng nhập của tài khoản này (để gợi nhắc khi cần đăng nhập lại):", s.email || "");
    if (email === null) return;
    const note = window.prompt("Ghi chú (tùy chọn):", s.note || "");
    if (note === null) return;
    try {
      await fbFetch("/session/meta", {
        method: "POST", headers: fbHeaders(),
        body: JSON.stringify({ user_id: s.user_id, email: email.trim(), note: note.trim() }),
      });
      showToast("Đã lưu thông tin gợi nhắc", true);
      loadAll();
    } catch { showToast("Lỗi lưu", false); }
  }

  async function genPairCode() {
    try {
      const cfg = await getFbProvisionConfig();
      const payload = JSON.stringify({ serverUrl: cfg.serverUrl, owner, apiKey: cfg.extensionApiKey, label: user?.name || user?.email || owner });
      const code = btoa(unescape(encodeURIComponent(payload)));
      setPairCode(code);
    } catch { showToast("Không tạo được mã", false); }
  }

  async function copyPairCode() {
    if (!pairCode) return;
    try { await navigator.clipboard.writeText(pairCode); showToast("Đã copy mã kết nối", true); }
    catch { showToast("Không copy được, hãy bôi đen + Ctrl C", false); }
  }

  // Hợp nhất data
  const unifiedList: UnifiedAccount[] = [];
  for (const s of sessions) {
    const inbox = inboxAccounts.find(acc => acc.user_id === s.user_id || (acc.fb_user_id && acc.fb_user_id === s.fb_user_id));
    unifiedList.push({
      user_id: s.user_id,
      label: accLabel(s),
      fb_user_id: s.fb_user_id || inbox?.fb_user_id,
      online: !!s.online && !s.expired && !s.needs_relogin,
      needs_relogin: !!s.needs_relogin || !!s.expired,
      days_left: s.days_left,
      hasKpi: !!inbox,
      inboxAccountId: inbox?.id,
      session: s,
      inboxAccount: inbox,
      email: s.email,
      note: s.note,
      expired: s.expired,
    });
  }
  for (const inbox of inboxAccounts) {
    if (!unifiedList.some(u => u.user_id === inbox.user_id)) {
      unifiedList.push({
        user_id: inbox.user_id,
        label: inbox.account_label || inbox.user_id,
        fb_user_id: inbox.fb_user_id,
        online: false,
        needs_relogin: false,
        hasKpi: true,
        inboxAccountId: inbox.id,
        inboxAccount: inbox,
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Thông tin kết nối Extension */}
      <div className="bg-surface rounded-xl border border-outline-variant p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-base font-bold text-on-surface">Thêm tài khoản mới</div>
              <a
                href="https://www.youtube.com/watch?v=EbmV5aGJyys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <MaterialIcon name="videocam" className="text-[15px]" />
                Video hướng dẫn
              </a>
            </div>
            <div className="text-xs text-on-surface-variant mt-0.5">Bấm nút bên phải, đăng nhập Facebook như bình thường — hệ thống tự ghi nhớ.</div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/markee-extension.zip" download
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold transition">
              <MaterialIcon name="download" className="text-[16px]" />
              Tải extension
            </a>
            <button onClick={() => addAccount(false)} disabled={adding}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-bold hover:bg-on-primary-fixed-variant transition disabled:opacity-50 cursor-pointer shadow-sm">
              <FaPlus size={12} />
              {adding ? "Đang chờ đăng nhập..." : "Thêm tài khoản FB"}
            </button>
          </div>
        </div>
        {status && <div className="mt-3 text-sm text-on-surface-variant bg-surface-container-low rounded-xl px-3 py-2">{status}</div>}
        {extInstalled === false && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-amber-700">
              <span className="font-semibold">Chưa phát hiện extension Markee trên trình duyệt này.</span>
              <span className="block mt-0.5 text-amber-600">Tải extension → giải nén → vào <code className="bg-amber-100 px-1 rounded">chrome://extensions</code> → bật Developer mode → Load unpacked → chọn thư mục vừa giải nén.</span>
            </div>
            <a href="/markee-extension.zip" download
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition cursor-pointer">
              <MaterialIcon name="download" className="text-[16px]" />
              Tải extension
            </a>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-outline-variant">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-bold text-on-surface">Thêm tài khoản ở máy / trình duyệt khác?</div>
              <div className="text-xs text-on-surface-variant mt-0.5">Tạo mã kết nối, mở extension ở máy đó → dán mã vào ô "① Dán mã kết nối" → tài khoản tự gắn về bạn.</div>
            </div>
            <button onClick={genPairCode} className="text-xs px-3 py-2 rounded-xl border border-outline-variant hover:border-primary text-on-surface font-semibold transition cursor-pointer">Tạo mã kết nối</button>
          </div>
          {pairCode && (
            <div className="mt-3 flex gap-2">
              <input readOnly value={pairCode} onFocus={e => e.currentTarget.select()}
                className="flex-1 border border-outline-variant rounded-xl px-3 py-2 text-xs font-mono text-on-surface bg-surface-container-low outline-none focus:border-primary" />
              <button onClick={copyPairCode} className="text-xs px-4 py-2 rounded-xl bg-primary text-white font-bold hover:bg-on-primary-fixed-variant transition cursor-pointer">Copy</button>
            </div>
          )}
        </div>
      </div>

      {connErr && <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-700">⚠️ Không kết nối được Facebook automation service. Kiểm tra backend.</div>}

      {/* Account Table */}
      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <h2 className="text-sm font-bold text-on-surface">Danh sách Tài khoản FB & KPI</h2>
          <span className="text-xs font-semibold text-on-surface-variant px-2 py-0.5 bg-surface-container-highest rounded-full">{unifiedList.length} tài khoản</span>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-2" />
            <p className="text-on-surface-variant text-xs">Đang tải dữ liệu...</p>
          </div>
        ) : unifiedList.length === 0 ? (
          <div className="text-center py-16 bg-surface-container-low/60">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <FaFacebook className="text-3xl text-primary" />
            </div>
            <p className="text-on-surface font-semibold text-sm">Chưa có tài khoản Facebook nào được thêm</p>
            <p className="text-on-surface-variant text-xs mt-1">Hãy cài extension và thêm tài khoản để bắt đầu</p>
            <button onClick={() => addAccount(false)} disabled={adding}
              className="mt-4 inline-flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-out active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] cursor-pointer disabled:opacity-50">
              <FaPlus size={10} />
              {adding ? "Đang chờ đăng nhập..." : "Thêm tài khoản ngay"}
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
              <tr>
                <th className="py-3 px-4">Tên hiển thị & Meta</th>
                <th className="py-3 px-4">User ID (FB)</th>
                <th className="py-3 px-4">Trạng thái Extension</th>
                <th className="py-3 px-4 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-on-surface-variant">
              {unifiedList.map((acc) => (
                <tr key={acc.user_id} className="hover:bg-surface-container-low/30 transition">
                  <td className="py-3.5 px-4 min-w-[200px]">
                    <div
                      className="flex items-center gap-2 cursor-pointer group/name"
                      onClick={() => setDetailAccount(acc)}
                      title="Xem chi tiết tài khoản"
                    >
                      <span className="w-6 h-6 rounded-lg bg-[#0866FF]/10 text-[#0866FF] flex items-center justify-center shrink-0">
                        <FaFacebook size={12} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-on-surface flex items-center gap-1 group-hover/name:underline group-hover/name:text-primary">
                          {acc.label}
                          {acc.session && <button onClick={(e) => { e.stopPropagation(); rename(acc.user_id, acc.label); }} title="Đổi tên hiển thị" className="text-[10px] text-on-surface-variant hover:text-primary cursor-pointer no-underline">✎</button>}
                        </div>
                        {(acc.email || acc.note) && (
                          <div className="text-[10px] text-on-surface-variant truncate max-w-[200px] mt-0.5">
                            {acc.email && <span title="Email đăng nhập">✉ {acc.email}</span>}
                            {acc.note && <span> · {acc.note}</span>}
                            {acc.session && <button onClick={(e) => { e.stopPropagation(); if (acc.session) editMeta(acc.session); }} title="Sửa meta" className="ml-1 text-[10px] text-on-surface-variant hover:text-primary cursor-pointer">✎</button>}
                          </div>
                        )}
                        {!acc.email && !acc.note && acc.session && (
                          <div className="text-[10px] mt-0.5 text-on-surface-variant">
                            <span className="italic">Chưa có thông tin</span>
                            <button onClick={(e) => { e.stopPropagation(); if (acc.session) editMeta(acc.session); }} className="ml-1 hover:text-primary cursor-pointer">Thêm</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] cursor-pointer" onClick={() => setDetailAccount(acc)} title="Xem chi tiết tài khoản">
                    <div className="text-on-surface">{acc.fb_user_id || "—"}</div>
                    <div className="text-on-surface-variant text-[9px] mt-0.5 truncate max-w-[120px]" title={acc.user_id}>UID: {acc.user_id.replace(/^fb_/, "")}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    {!acc.session ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-surface-container-low text-on-surface-variant border-outline-variant">
                        Offline (Lưu KPI)
                      </span>
                    ) : acc.online ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">
                          🟢 Sẵn sàng
                        </span>
                        {typeof acc.days_left === "number" && <span className="text-[9px] text-on-surface-variant">Còn {Math.round(acc.days_left)} ngày</span>}
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">
                        🔴 Cần đăng nhập lại
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      {acc.session && acc.needs_relogin && (
                        <button onClick={() => addAccount(true)} disabled={adding}
                          className="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-[10px] font-bold transition cursor-pointer disabled:opacity-50">
                          Đăng nhập lại
                        </button>
                      )}
                      {acc.session && (
                        <button onClick={() => removeSession(acc.user_id, acc.label)}
                          className="px-2 py-1 bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 rounded-lg text-[10px] font-bold transition cursor-pointer">
                          Xóa Ext
                        </button>
                      )}
                      <button onClick={() => removeAccountFull(acc.user_id, acc.label)}
                        title="Xóa hoàn toàn: file cookie + toàn bộ dữ liệu KPI/đăng ký trong database"
                        className="px-2 py-1 bg-red-600 text-white hover:bg-red-700 border border-red-700 rounded-lg text-[10px] font-bold transition cursor-pointer">
                        Xóa hoàn toàn
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div className={cn("fixed bottom-6 right-6 px-5 py-3.5 rounded-xl text-white font-bold shadow-xl animate-in slide-in-from-bottom-5 z-50 flex items-center gap-2", toast.ok ? "bg-emerald-600" : "bg-primary")}>
          <MaterialIcon name={toast.ok ? "check_circle" : "error"} className="text-lg" />
          {toast.msg}
        </div>
      )}

      {detailAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm"
          onClick={() => setDetailAccount(null)}
        >
          <div
            style={{ width: "100%", maxWidth: 448 }}
            className="bg-surface rounded-2xl border border-outline-variant shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-[#0866FF]/10 text-[#0866FF] flex items-center justify-center shrink-0">
                  <FaFacebook size={14} />
                </span>
                <h3 className="font-bold text-on-surface">Chi tiết tài khoản</h3>
              </div>
              <button onClick={() => setDetailAccount(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low cursor-pointer">
                <MaterialIcon name="close" className="text-[18px]" />
              </button>
            </div>
            <div className="px-5 py-4">
              {([
                ["Tên hiển thị", detailAccount.label],
                ["User ID hệ thống", detailAccount.user_id],
                ["Facebook UID", detailAccount.fb_user_id || "Chưa có"],
                ["Email đăng nhập", detailAccount.email || "Chưa có"],
                ["Ghi chú", detailAccount.note || "Chưa có"],
              ] as [string, string][]).map(([label, value], i, arr) => (
                <div key={label} className={cn("flex items-center justify-between py-2.5", i !== arr.length - 1 && "border-b border-outline-variant")}>
                  <span className="text-[12px] text-on-surface-variant">{label}</span>
                  <span className="text-[13px] font-semibold text-on-surface text-right max-w-[60%] truncate" title={value}>{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5 border-t border-outline-variant mt-1">
                <span className="text-[12px] text-on-surface-variant">Trạng thái</span>
                {!detailAccount.session ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-surface-container-low text-on-surface-variant border-outline-variant">Offline (Lưu KPI)</span>
                ) : detailAccount.online ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">🟢 Sẵn sàng</span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">🔴 Cần đăng nhập lại</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant bg-surface-container-low/40">
              {detailAccount.fb_user_id && (
                <button
                  onClick={() => window.open(`https://www.facebook.com/profile.php?id=${detailAccount.fb_user_id}`, "_blank")}
                  className="px-3 py-2 text-[12px] font-bold text-primary border border-primary/30 hover:bg-primary/10 rounded-lg transition cursor-pointer"
                >
                  Mở Facebook ↗
                </button>
              )}
              <button onClick={() => setDetailAccount(null)} className="px-4 py-2 text-[12px] font-bold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition cursor-pointer">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}