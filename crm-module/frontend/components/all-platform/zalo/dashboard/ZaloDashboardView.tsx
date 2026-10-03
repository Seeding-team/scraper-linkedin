"use client";

import { MaterialIcon } from "@/components/ui";
import type { ZaloCrawlerFlowValue } from "@/hooks/useZaloCrawlerFlow";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ZaloKpiPanel } from "./ZaloKpiPanel";
import { isZaloExtensionAvailable } from "@/services/zaloExtension";

interface ZaloDashboardViewProps {
  flow: ZaloCrawlerFlowValue;
  onEnterChat: (accountId: string) => void;
}

function shortId(value: string, head = 10, tail = 6) {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function accountStatus(account: ZaloCrawlerFlowValue["accounts"][number]) {
  if (account.listener?.auth_expired) return { text: "Hết hạn — đăng nhập lại", tone: "error" as const };
  if (account.listener?.connected) return { text: "Online", tone: "success" as const };
  if (account.listener?.running) return { text: "Đang chạy", tone: "warning" as const };
  if (account.has_auth) return { text: "Đã kết nối", tone: "success" as const };
  return { text: "Chưa kết nối", tone: "muted" as const };
}

function StatusDot({ tone }: { tone: "success" | "warning" | "muted" | "error" }) {
  const className =
    tone === "success"
      ? "bg-green-500"
      : tone === "warning"
        ? "bg-amber-500"
        : tone === "error"
          ? "bg-red-500"
          : "bg-surface-container-highest";
  return <span className={`inline-block h-3 w-3 rounded-full border-2 border-white ${className}`} />;
}

export function ZaloDashboardView({ flow, onEnterChat }: ZaloDashboardViewProps) {
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountPhone, setNewAccountPhone] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // States for Editing and Dropdown Menu
  const [activeMenuAccountId, setActiveMenuAccountId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<ZaloCrawlerFlowValue["accounts"][number] | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Extension đã cài chưa — dùng để disable nút "Tải extension" (không cho tải
  // lại vô nghĩa nếu đã có). Check lại khi tab được focus lại (vd sau khi user
  // vừa cài xong ở chrome://extensions rồi quay lại tab này) để không cần F5.
  const [extensionAvailable, setExtensionAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void isZaloExtensionAvailable().then((available) => {
        if (!cancelled) setExtensionAvailable(available);
      });
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  async function handleCreateAccount() {
    const label = newAccountLabel.trim();
    if (!label) return;
    await flow.createAccount(label, newAccountPhone.trim() || undefined);
    setNewAccountLabel("");
    setNewAccountPhone("");
  }

  const filteredAccounts = flow.accounts.filter(acc =>
    (acc.label || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (acc.phone || "").includes(searchQuery)
  );

  return (
    <div className="flex flex-col gap-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant pb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-red-700 flex items-center justify-center shadow-sm">
            <MaterialIcon name="account_circle" className="text-white text-[22px]" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-lg font-bold text-on-surface leading-tight">Quản lý tài khoản</h2>
            <p className="text-[11px] text-on-surface-variant leading-tight">Theo dõi trạng thái Zalo, share inbox với leader</p>
          </div>
          <span className="ml-1 rounded-full bg-surface-container-low border border-outline-variant px-2.5 py-0.5 text-[11px] font-bold text-on-surface-variant">
            {flow.accounts.length} TK
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MaterialIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]" />
            <input
              type="text"
              placeholder="Tìm tên, SĐT, UID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-outline-variant bg-surface rounded-lg py-1.5 pl-8 pr-3 text-[13px] w-[220px] focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all placeholder:text-on-surface-variant"
            />
          </div>
          {extensionAvailable ? (
            <span
              className="bg-emerald-50 border border-emerald-200 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-emerald-700 cursor-default"
              title="Chrome Extension lấy Zalo cookies đã được cài trên trình duyệt này"
            >
              <MaterialIcon name="check_circle" className="text-[16px]" />
              Đã cài Extension
            </span>
          ) : (
            <a
              href="/extension-login-zalo.zip"
              download
              className="bg-surface border border-outline-variant inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-on-surface hover:bg-surface-container-low hover:border-outline-variant transition"
              title="Giải nén rồi Load unpacked ở chrome://extensions"
            >
              <MaterialIcon name="download" className="text-[16px]" />
              Tải extension Zalo
            </a>
          )}
          <button className="bg-surface border border-outline-variant inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-on-surface hover:bg-surface-container-low hover:border-outline-variant transition">
            <MaterialIcon name="group_add" className="text-[16px]" />
            Gộp TK
          </button>
          <button className="bg-primary text-white inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-red-700 transition shadow-sm shadow-red-500/20">
            <MaterialIcon name="support_agent" className="text-[16px]" />
            Hỗ trợ
          </button>
        </div>
      </header>

      {/* KPI CARDS */}
      {flow.userId && flow.userId !== "default" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="bg-gradient-to-br from-orange-50 to-amber-50/60 border border-orange-200/60 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-1 text-[10.5px] font-bold text-orange-700 uppercase">
              <MaterialIcon name="chat" className="text-[13px]" />
              Tin nhắn KPI
            </div>
            <div className="mt-1.5">
              <ZaloKpiPanel accountId={flow.userId} compact={false} />
            </div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-sky-50/60 border border-blue-200/60 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-1 text-[10.5px] font-bold text-blue-700 uppercase">
              <MaterialIcon name="inbox" className="text-[13px]" />
              Cuộc trò chuyện
            </div>
            <p className="text-xl font-bold text-on-surface mt-1.5 leading-none">{flow.accounts.length}</p>
            <p className="text-[10px] text-on-surface-variant mt-0.5">đang theo dõi</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-green-50/60 border border-emerald-200/60 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 uppercase">
              <MaterialIcon name="forum" className="text-[13px]" />
              Online
            </div>
            <p className="text-xl font-bold text-on-surface mt-1.5 leading-none">
              {flow.accounts.filter((a) => a.listener?.connected).length}
            </p>
            <p className="text-[10px] text-on-surface-variant mt-0.5">đang kết nối Zalo</p>
          </div>
          <div className="bg-gradient-to-br from-violet-50 to-purple-50/60 border border-violet-200/60 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-1 text-[10.5px] font-bold text-violet-700 uppercase">
              <MaterialIcon name="sync" className="text-[13px]" />
              Đang chạy
            </div>
            <p className="text-xl font-bold text-on-surface mt-1.5 leading-none">
              {flow.accounts.filter((a) => a.listener?.running).length}
            </p>
            <p className="text-[10px] text-on-surface-variant mt-0.5">đang lắng nghe</p>
          </div>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-outline-variant px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="h-6 w-6 rounded-md bg-red-50 flex items-center justify-center">
            <MaterialIcon name="person_add" className="text-primary text-[14px]" />
          </div>
          <h3 className="text-[12.5px] font-bold text-on-surface">Thêm tài khoản Zalo mới</h3>
          <span className="text-[10.5px] text-on-surface-variant ml-auto">Label + SĐT tùy chọn</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MaterialIcon name="person" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[14px]" />
            <input
              value={newAccountLabel}
              onChange={(event) => setNewAccountLabel(event.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateAccount(); }}
              placeholder="Tên tài khoản (vd: Nam, Mai...)"
              className="border border-outline-variant bg-surface h-9 w-full rounded-lg pl-8 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all placeholder:text-on-surface-variant"
            />
          </div>
          <div className="relative flex-1">
            <MaterialIcon name="call" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[14px]" />
            <input
              value={newAccountPhone}
              onChange={(event) => setNewAccountPhone(event.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateAccount(); }}
              placeholder="Số điện thoại (tùy chọn)"
              className="border border-outline-variant bg-surface h-9 w-full rounded-lg pl-8 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all placeholder:text-on-surface-variant"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleCreateAccount()}
            disabled={!newAccountLabel.trim()}
            className="h-9 bg-primary text-white inline-flex items-center justify-center gap-1 rounded-lg px-4 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 transition hover:bg-red-700 shadow-sm shadow-red-500/20"
          >
            <MaterialIcon name="add" className="text-[16px]" />
            Thêm
          </button>
        </div>
        {flow.accountsError ? (
          <div className="border border-red-200 bg-red-50 text-red-600 mt-2.5 rounded-lg px-3 py-2 text-[12px] font-medium flex items-center gap-1.5">
            <MaterialIcon name="error" className="text-[14px]" />
            {flow.accountsError}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filteredAccounts.map((account) => {
          const status = accountStatus(account);
          return (
            <div
              key={account.account_id}
              className="bg-surface group relative flex flex-col rounded-xl border border-outline-variant p-3.5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40"
            >
              {/* Compact Header: Avatar + Name + Status + 3-dot menu */}
              <div className="flex items-start gap-2.5">
                <div className="relative shrink-0">
                  <div className="h-11 w-11 rounded-lg bg-gradient-to-br from-red-50 to-red-100/60 flex items-center justify-center text-[15px] font-bold text-primary border border-red-100">
                    {account.label?.[0]?.toUpperCase() || "Z"}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 border-[2px] border-white rounded-full bg-surface">
                    <StatusDot tone={status.tone} />
                  </div>
                </div>

                <div className="flex-1 min-w-0 -mt-0.5">
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[13.5px] font-bold text-on-surface truncate group-hover:text-primary transition-colors leading-tight">
                      {account.label || "Tài khoản"}
                    </div>

                    {/* 3-Dot Menu Dropdown */}
                    <div className="relative shrink-0 -mr-1">
                      <button
                        onClick={() => setActiveMenuAccountId(prev => prev === account.account_id ? null : account.account_id)}
                        className="text-on-surface-variant hover:text-on-surface h-6 w-6 rounded-md hover:bg-surface-container-low transition flex items-center justify-center"
                        title="Tùy chọn"
                      >
                        <MaterialIcon name="more_vert" className="text-[16px]" />
                      </button>

                      {activeMenuAccountId === account.account_id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setActiveMenuAccountId(null)}
                          />
                          <div className="absolute right-0 mt-1 w-44 bg-surface border border-outline-variant rounded-lg shadow-xl py-1 z-20 overflow-hidden">
                            <button
                              onClick={() => {
                                setEditingAccount(account);
                                setEditLabel(account.label || "");
                                setEditPhone(account.phone || "");
                                setActiveMenuAccountId(null);
                              }}
                              className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-surface-container-low flex items-center gap-2 font-semibold text-on-surface transition-colors"
                            >
                              <MaterialIcon name="edit" className="text-[14px] text-primary" />
                              Chỉnh sửa
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Bạn có chắc muốn xóa hoàn toàn dữ liệu đăng nhập của ${account.label || account.account_id}?`)) {
                                  void flow.deleteAccount(account.account_id, true);
                                }
                                setActiveMenuAccountId(null);
                              }}
                              className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-red-50 flex items-center gap-2 font-semibold text-red-600 border-t border-outline-variant transition-colors"
                            >
                              <MaterialIcon name="delete" className="text-[14px]" />
                              Xóa hoàn toàn Auth
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="mt-1">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      status.tone === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      status.tone === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                      status.tone === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-surface-container-low text-on-surface-variant border border-outline-variant'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        status.tone === 'success' ? 'bg-emerald-500' :
                        status.tone === 'error' ? 'bg-red-500' :
                        status.tone === 'warning' ? 'bg-amber-500' :
                        'bg-slate-400'
                      }`} />
                      {status.text}
                    </span>
                  </div>
                </div>
              </div>

              {/* Compact Info rows */}
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[12px] text-on-surface-variant">
                  <MaterialIcon name="call" className="text-[13px] text-on-surface-variant shrink-0" />
                  {account.phone ? (
                    <span className="font-medium truncate">{account.phone}</span>
                  ) : (
                    <span className="text-on-surface-variant italic">Chưa có SĐT</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-on-surface-variant">
                  <MaterialIcon name="key" className="text-[13px] text-on-surface-variant shrink-0" />
                  <span className="font-mono text-[11px] bg-surface-container-low px-1.5 py-0.5 rounded text-on-surface-variant truncate">
                    {shortId(account.account_id, 8, 6)}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 pt-2.5 border-t border-outline-variant flex items-center gap-1.5">
                {account.listener?.auth_expired ? (
                  <>
                    <button
                      onClick={() => {
                        // Chuyển sang account này rồi gọi restartSession — hàm này TỰ
                        // gọi Chrome Extension để mở tab Zalo Web lấy cookie đăng nhập
                        // trước (ổn định, dùng chung cơ chế lấy tin nhắn/gửi tin), chỉ
                        // fallback về QR quét mã nếu extension chưa cài hoặc lỗi.
                        if (account.account_id !== flow.userId) {
                          flow.switchAccount(account.account_id);
                        }
                        void flow.restartSession();
                      }}
                      className="flex-1 h-8 bg-primary text-white flex items-center justify-center gap-1 rounded-lg text-[12px] font-semibold transition-all duration-200 hover:bg-[#C2000D] hover:shadow-sm shadow-red-500/20 active:scale-95 animate-pulse"
                      title="Phiên đã hết hạn — bấm để đăng nhập lại qua Extension (fallback QR nếu chưa cài)"
                    >
                      <MaterialIcon name="login" className="text-[14px]" />
                      Đăng nhập lại
                    </button>
                    <button
                      onClick={() => onEnterChat(account.account_id)}
                      className="h-8 w-8 bg-surface-container-low text-on-surface-variant flex items-center justify-center rounded-lg cursor-not-allowed opacity-50"
                      title="Cần đăng nhập lại trước"
                      disabled
                    >
                      <MaterialIcon name="chat" className="text-[14px]" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => onEnterChat(account.account_id)}
                      className="flex-1 h-8 bg-primary text-white flex items-center justify-center gap-1 rounded-lg text-[12px] font-semibold transition-all duration-200 hover:bg-[#C2000D] hover:shadow-sm shadow-red-500/20 active:scale-95"
                      title="Mở Zalo Chat ở trang full-screen"
                    >
                      <MaterialIcon name="open_in_new" className="text-[14px]" />
                      Mở chat
                    </button>
                    <button
                      onClick={() => flow.deleteAccount(account.account_id, false)}
                      className="h-8 w-8 bg-surface-container-low text-on-surface-variant flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-red-50 hover:text-primary border border-outline-variant hover:border-red-200 active:scale-95"
                      title="Ngắt kết nối"
                    >
                      <MaterialIcon name="logout" className="text-[16px]" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredAccounts.length === 0 && !flow.isLoadingAccounts && (
        <div className="border border-dashed border-outline-variant bg-surface-container-low rounded-xl p-8 text-center">
          <div className="h-12 w-12 mx-auto rounded-full bg-surface-container-low flex items-center justify-center mb-2">
            <MaterialIcon name="account_circle" className="text-on-surface-variant text-[24px]" />
          </div>
          <p className="text-[13px] font-semibold text-on-surface">
            {searchQuery ? "Không tìm thấy tài khoản phù hợp" : "Chưa có tài khoản nào"}
          </p>
          <p className="text-[11.5px] text-on-surface-variant mt-1">
            {searchQuery ? "Thử từ khóa khác hoặc xóa bộ lọc" : "Hãy thêm tài khoản Zalo đầu tiên ở form phía trên"}
          </p>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-surface border border-outline-variant rounded-xl p-5 w-[360px] shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-2.5 border-b border-outline-variant pb-3">
              <div className="h-8 w-8 rounded-lg bg-red-50 flex items-center justify-center">
                <MaterialIcon name="edit" className="text-primary text-[16px]" />
              </div>
              <div className="flex-1">
                <h3 className="text-[14px] font-bold text-on-surface leading-tight">Chỉnh sửa tài khoản</h3>
                <p className="text-[11px] text-on-surface-variant leading-tight">Cập nhật tên & số điện thoại</p>
              </div>
              <button
                onClick={() => setEditingAccount(null)}
                className="text-on-surface-variant hover:text-on-surface h-7 w-7 rounded-md hover:bg-surface-container-low transition flex items-center justify-center"
              >
                <MaterialIcon name="close" className="text-[16px]" />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11.5px] font-semibold text-on-surface-variant">Tên tài khoản</label>
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="border border-outline-variant bg-surface h-9 rounded-lg px-3 text-[13px] focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all"
                placeholder="Vd: Việt, Nam..."
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11.5px] font-semibold text-on-surface-variant">Số điện thoại</label>
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="border border-outline-variant bg-surface h-9 rounded-lg px-3 text-[13px] focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all"
                placeholder="Vd: 0912 xxx xxx"
              />
            </div>

            <div className="flex justify-end gap-2 mt-1 border-t border-outline-variant pt-3">
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="h-9 border border-outline-variant bg-surface text-on-surface px-4 rounded-lg text-[12.5px] font-semibold hover:bg-surface-container-low transition"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSavingEdit || !editLabel.trim()}
                onClick={async () => {
                  setIsSavingEdit(true);
                  try {
                    await flow.updateAccount(editingAccount.account_id, editLabel, editPhone);
                    setEditingAccount(null);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setIsSavingEdit(false);
                  }
                }}
                className="h-9 bg-primary text-white px-5 rounded-lg text-[12.5px] font-semibold hover:bg-red-700 transition shadow-sm shadow-red-500/20 disabled:opacity-50 disabled:shadow-none"
              >
                {isSavingEdit ? "Đang lưu..." : "Lưu lại"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
