"use client";

import { MaterialIcon } from "@/components/ui";
import type { ZaloCrawlerFlowValue } from "@/hooks/useZaloCrawlerFlow";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ZaloKpiPanel } from "./ZaloKpiPanel";
import { ZaloAccountAssignmentsPanel } from "./ZaloAccountAssignmentsPanel";
import { ZaloAddAccountModal } from "./ZaloAddAccountModal";
import { ZaloEditAccountModal } from "./ZaloEditAccountModal";
import { isZaloExtensionAvailable } from "@/services/zaloExtension";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformUsersService } from "@/services/all-platform.service";

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
  return <span className={`inline-block h-2.5 w-2.5 rounded-full border border-white ${className}`} />;
}

export function ZaloDashboardView({ flow, onEnterChat }: ZaloDashboardViewProps) {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [permissionsAccount, setPermissionsAccount] = useState<{ id: string; label: string } | null>(null);

  // View mode: "table" (mặc định cho dễ nhìn và đẹp) hoặc "grid"
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  // States for Editing and Dropdown Menu
  const [activeMenuAccountId, setActiveMenuAccountId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<ZaloCrawlerFlowValue["accounts"][number] | null>(null);

  // Extension availability check
  const [extensionInstalled, setExtensionInstalled] = useState<boolean>(true);

  // User profiles map (id -> name) for resolving human personnel names
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});

  useEffect(() => {
    allPlatformUsersService
      .getAllProfiles()
      .then((res: any) => {
        if (res.success && Array.isArray(res.data)) {
          const map: Record<string, string> = {};
          res.data.forEach((u: any) => {
            const uid = u.id || u.user_id;
            const uname = u.name || u.full_name || u.email;
            if (uid && uname) {
              map[uid] = uname;
            }
          });
          setUsersMap(map);
        }
      })
      .catch(() => {});
  }, []);

  const getAssignedName = (account: any) => {
    const rawName = account.owner_name;
    const memberId = account.id_member || account.owner_id;
    const isUuid = (val?: string) =>
      Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));

    // 1. If owner_name exists and is a valid readable name (not uuid), return it
    if (rawName && !isUuid(rawName)) return rawName;

    // 2. If memberId exists and is in usersMap, return mapped human name
    if (memberId && usersMap[memberId]) return usersMap[memberId];

    // 3. If rawName exists and is in usersMap (in case rawName was set to uuid)
    if (rawName && usersMap[rawName]) return usersMap[rawName];

    // 4. Fallback if memberId is a readable name (not uuid, not default)
    if (memberId && !isUuid(memberId) && memberId !== "default") return memberId;

    return "Chưa gán";
  };

  useEffect(() => {
    let mounted = true;
    const recheck = async () => {
      try {
        const available = await isZaloExtensionAvailable();
        if (mounted) setExtensionInstalled(available);
      } catch {
        if (mounted) setExtensionInstalled(false);
      }
    };
    void recheck();
    window.addEventListener("focus", recheck);
    return () => {
      mounted = false;
      window.removeEventListener("focus", recheck);
    };
  }, []);

  const filteredAccounts = flow.accounts.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const phoneMatch = a.phone?.toLowerCase().includes(q);
    const labelMatch = a.label?.toLowerCase().includes(q);
    const idMatch = a.account_id.toLowerCase().includes(q);
    const ownerMatch = (a as any).owner_name?.toLowerCase().includes(q);
    return phoneMatch || labelMatch || idMatch || ownerMatch;
  });

  return (
    <div className="space-y-4">
      {/* KPI Stats Overview */}
      {flow.userId && flow.userId !== "default" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="bg-gradient-to-br from-orange-50 to-amber-50/60 border border-orange-200/60 rounded-xl px-3.5 py-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-orange-700 uppercase">
              <span className="material-symbols-outlined text-[14px]">chat</span>
              <span>Tin nhắn KPI</span>
            </div>
            <div className="mt-1.5">
              <ZaloKpiPanel accountId={flow.userId} compact={false} />
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-50 to-sky-50/60 border border-blue-200/60 rounded-xl px-3.5 py-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-blue-700 uppercase">
              <span className="material-symbols-outlined text-[14px]">inbox</span>
              <span>Cuộc trò chuyện</span>
            </div>
            <p className="text-xl font-bold text-on-surface mt-1.5 leading-none">{flow.accounts.length}</p>
            <p className="text-[10.5px] text-on-surface-variant mt-1">tài khoản theo dõi</p>
          </div>

          <div className="bg-gradient-to-br from-emerald-50 to-green-50/60 border border-emerald-200/60 rounded-xl px-3.5 py-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-emerald-700 uppercase">
              <span className="material-symbols-outlined text-[14px]">forum</span>
              <span>Online</span>
            </div>
            <p className="text-xl font-bold text-on-surface mt-1.5 leading-none">
              {flow.accounts.filter((a) => a.listener?.connected).length}
            </p>
            <p className="text-[10.5px] text-on-surface-variant mt-1">đang kết nối Zalo</p>
          </div>

          <div className="bg-gradient-to-br from-violet-50 to-purple-50/60 border border-violet-200/60 rounded-xl px-3.5 py-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-violet-700 uppercase">
              <span className="material-symbols-outlined text-[14px]">sync</span>
              <span>Đang chạy</span>
            </div>
            <p className="text-xl font-bold text-on-surface mt-1.5 leading-none">
              {flow.accounts.filter((a) => a.listener?.running).length}
            </p>
            <p className="text-[10.5px] text-on-surface-variant mt-1">đang lắng nghe</p>
          </div>
        </div>
      )}

      {/* Extension Installation Banner */}
      {!extensionInstalled && (
        <div className="relative overflow-hidden rounded-2xl border border-red-200/80 bg-gradient-to-br from-red-50/90 via-white to-red-50/50 p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center text-primary shrink-0">
                <span className="material-symbols-outlined text-[22px]">extension</span>
              </div>
              <div>
                <h4 className="text-[13.5px] font-bold text-on-surface">Chưa phát hiện Tiện ích Zalo Extension</h4>
                <p className="text-[11.5px] text-on-surface-variant">
                  Cài đặt extension để đồng bộ tài khoản, tin nhắn tự động và quét mã QR 1-click mượt mà.
                </p>
              </div>
            </div>
            <a
              href="/api-facebook-get-extension.zip"
              download
              className="inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-lg bg-primary hover:bg-red-700 text-white text-[12px] font-bold transition shadow-sm shadow-red-500/20 shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>Tải Extension (.zip)</span>
            </a>
          </div>
        </div>
      )}

      {/* Toolbar: Search, View Mode Toggle, Add Account Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface rounded-2xl border border-outline-variant p-3.5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-50 to-red-100/70 border border-red-200 flex items-center justify-center text-primary shadow-xs">
            <span className="material-symbols-outlined text-[20px]">manage_accounts</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-on-surface">Danh sách tài khoản Zalo</h3>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-red-100 text-primary">
                {filteredAccounts.length}
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant">Quản lý nhận diện, phân công nhân sự và phạm vi nhóm phụ trách</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
          {/* Search box */}
          <div className="relative min-w-[200px] max-w-[260px] flex-1 sm:flex-initial">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên, SĐT, mã..."
              className="w-full h-8.5 pl-8 pr-3 rounded-lg border border-outline-variant bg-surface-container-low text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:bg-surface focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>

          {/* Toggle View Mode: Table / Grid */}
          <div className="inline-flex items-center rounded-lg border border-outline-variant p-0.5 bg-surface-container-low">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center gap-1 h-7.5 px-2.5 rounded-md text-[11.5px] font-bold transition cursor-pointer ${
                viewMode === "table"
                  ? "bg-surface text-primary shadow-xs font-bold"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              title="Xem dạng Bảng"
            >
              <span className="material-symbols-outlined text-[15px]">table_rows</span>
              <span className="hidden md:inline">Bảng</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`inline-flex items-center gap-1 h-7.5 px-2.5 rounded-md text-[11.5px] font-bold transition cursor-pointer ${
                viewMode === "grid"
                  ? "bg-surface text-primary shadow-xs font-bold"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              title="Xem dạng Lưới thẻ"
            >
              <span className="material-symbols-outlined text-[15px]">grid_view</span>
              <span className="hidden md:inline">Lưới</span>
            </button>
          </div>

          {/* Add Account Button */}
          <button
            type="button"
            onClick={() => setShowAddAccountModal(true)}
            className="h-8.5 bg-primary hover:bg-red-700 text-white inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-bold transition shadow-sm shadow-red-500/20 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            <span>Thêm tài khoản</span>
          </button>
        </div>
      </div>

      {/* Add Account Modal */}
      <ZaloAddAccountModal
        open={showAddAccountModal}
        onClose={() => setShowAddAccountModal(false)}
        onSubmit={async (data) => {
          await flow.createAccount(data.label, data.phone, {
            owner_name: data.owner_name,
            id_member: data.id_member,
            sim_location: data.sim_location,
            sim_location_detail: data.sim_location_detail,
            domain_ids: data.domain_ids,
            group_ids: data.group_ids,
          });
        }}
      />

      {/* Edit Account Modal with Full Fields */}
      <ZaloEditAccountModal
        open={!!editingAccount}
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onSubmit={async (data) => {
          if (!editingAccount) return;
          await flow.updateAccount(editingAccount.account_id, data.label, data.phone, {
            owner_name: data.owner_name,
            id_member: data.id_member,
            sim_location: data.sim_location,
            sim_location_detail: data.sim_location_detail,
            domain_ids: data.domain_ids,
            group_ids: data.group_ids,
          });
        }}
      />

      {/* TABLE VIEW (DẠNG BẢNG - MẶC ĐỊNH) */}
      {viewMode === "table" && filteredAccounts.length > 0 && (
        <div className="bg-surface rounded-2xl border border-outline-variant shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                  <th className="px-3.5 py-3 text-center w-12">#</th>
                  <th className="px-3.5 py-3">Tài khoản Zalo</th>
                  <th className="px-3.5 py-3">Số điện thoại</th>
                  <th className="px-3.5 py-3">Nhân sự & Vị trí SIM</th>
                  <th className="px-3.5 py-3">Phạm vi phụ trách</th>
                  <th className="px-3.5 py-3">Trạng thái kết nối</th>
                  <th className="px-3.5 py-3 text-right min-w-[170px]">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {filteredAccounts.map((account, idx) => {
                  const status = accountStatus(account);
                  const simLoc = (account as any).sim_location;
                  const simLocLabel =
                    simLoc === "office"
                      ? "SIM Văn phòng"
                      : simLoc === "other"
                        ? "SIM Vị trí khác"
                        : "SIM Máy nhân sự";

                  const domainCount = ((account as any).assigned_domains || []).length;
                  const groupCount = ((account as any).assigned_groups || []).length;

                  return (
                    <tr
                      key={account.account_id}
                      className="hover:bg-surface-container-low/60 transition-colors group"
                    >
                      {/* STT */}
                      <td className="px-3.5 py-3 text-center font-mono text-[11px] text-on-surface-variant">
                        {idx + 1}
                      </td>

                      {/* Tài khoản Zalo (Avatar + Tên + ID) */}
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="relative shrink-0">
                            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200/80 flex items-center justify-center text-xs font-black text-primary shadow-2xs">
                              {account.label?.[0]?.toUpperCase() || "Z"}
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5">
                              <StatusDot tone={status.tone} />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-on-surface text-[12.5px] truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                              <span>{account.label || "Tài khoản"}</span>
                              {account.has_auth && (
                                <span className="inline-flex items-center px-1 rounded text-[9.5px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                  Auth
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10.5px] text-on-surface-variant truncate">
                              ID: {shortId(account.account_id, 8, 4)}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Số điện thoại */}
                      <td className="px-3.5 py-3">
                        {account.phone ? (
                          <div className="inline-flex items-center gap-1.5 text-on-surface font-semibold text-xs">
                            <span className="material-symbols-outlined text-[14px] text-primary shrink-0">call</span>
                            <span>{account.phone}</span>
                          </div>
                        ) : (
                          <span className="text-on-surface-variant italic text-[11px]">Chưa gắn SĐT</span>
                        )}
                      </td>

                      {/* Nhân sự phụ trách & Vị trí SIM */}
                      <td className="px-3.5 py-3">
                        <div className="flex flex-col gap-1">
                          <div className="inline-flex items-center gap-1.5 font-bold text-on-surface">
                            <span className="material-symbols-outlined text-[14px] text-primary shrink-0">person</span>
                            <span className="truncate max-w-[160px] text-slate-800" title={getAssignedName(account)}>
                              {getAssignedName(account)}
                            </span>
                          </div>
                          <div>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-container-low text-on-surface-variant border border-outline-variant/60">
                              <span className="material-symbols-outlined text-[11px]">sim_card</span>
                              <span>{simLocLabel}</span>
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Phạm vi phụ trách (Lĩnh vực / Nhóm) */}
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {domainCount > 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-red-50 text-primary border border-red-200 text-[10px] font-bold">
                              {domainCount} Lĩnh vực
                            </span>
                          ) : null}
                          {groupCount > 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
                              {groupCount} Nhóm
                            </span>
                          ) : null}
                          {domainCount === 0 && groupCount === 0 && (
                            <span className="text-on-surface-variant italic text-[11px]">—</span>
                          )}
                        </div>
                      </td>

                      {/* Trạng thái kết nối */}
                      <td className="px-3.5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                            status.tone === "success"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : status.tone === "error"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : status.tone === "warning"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-surface-container-low text-on-surface-variant border-outline-variant"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              status.tone === "success"
                                ? "bg-emerald-500 animate-pulse"
                                : status.tone === "error"
                                  ? "bg-red-500"
                                  : status.tone === "warning"
                                    ? "bg-amber-500 animate-pulse"
                                    : "bg-slate-400"
                            }`}
                          />
                          <span>{status.text}</span>
                        </span>
                      </td>

                      {/* Thao tác (Actions) */}
                      <td className="px-3.5 py-3 text-right">
                        <div className="inline-flex items-center gap-1 justify-end">
                          {account.listener?.auth_expired ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (account.account_id !== flow.userId) {
                                  flow.switchAccount(account.account_id);
                                }
                                void flow.restartSession();
                              }}
                              className="h-7 px-2 bg-primary text-white text-[11px] font-bold rounded-lg hover:bg-red-700 transition inline-flex items-center gap-1 animate-pulse shadow-xs cursor-pointer"
                              title="Đăng nhập lại qua Extension"
                            >
                              <span className="material-symbols-outlined text-[13px]">login</span>
                              <span>Login lại</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onEnterChat(account.account_id)}
                              className="h-7 px-2.5 bg-primary hover:bg-red-700 text-white text-[11px] font-bold rounded-lg transition inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                              title="Mở giao diện Chat"
                            >
                              <span className="material-symbols-outlined text-[13px]">chat</span>
                              <span>Mở chat</span>
                            </button>
                          )}

                          {/* Nút Chỉnh sửa */}
                          <button
                            type="button"
                            onClick={() => setEditingAccount(account)}
                            className="h-7 w-7 rounded-lg border border-outline-variant hover:bg-surface-container-low text-on-surface hover:text-primary transition flex items-center justify-center cursor-pointer"
                            title="Chỉnh sửa toàn bộ thông tin tài khoản"
                          >
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                          </button>

                          {/* Nút Phân quyền (Admin) */}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() =>
                                setPermissionsAccount({
                                  id: account.account_id,
                                  label: account.label || account.account_id,
                                })
                              }
                              className="h-7 w-7 rounded-lg border border-outline-variant hover:bg-surface-container-low text-on-surface hover:text-primary transition flex items-center justify-center cursor-pointer"
                              title="Phân quyền tài khoản"
                            >
                              <span className="material-symbols-outlined text-[14px]">lock</span>
                            </button>
                          )}

                          {/* Nút Xoá Auth / Ngắt kết nối */}
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  `Bạn có chắc muốn xóa hoàn toàn dữ liệu đăng nhập của ${account.label || account.account_id}?`
                                )
                              ) {
                                void flow.deleteAccount(account.account_id, true);
                              }
                            }}
                            className="h-7 w-7 rounded-lg border border-outline-variant hover:bg-red-50 text-on-surface-variant hover:text-red-600 hover:border-red-200 transition flex items-center justify-center cursor-pointer"
                            title="Xóa Auth / Ngắt kết nối"
                          >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GRID VIEW (DẠNG LƯỚI THẺ - TÙY CHỌN) */}
      {viewMode === "grid" && filteredAccounts.length > 0 && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredAccounts.map((account) => {
            const status = accountStatus(account);
            return (
              <div
                key={account.account_id}
                className="bg-surface group relative flex flex-col rounded-2xl border border-outline-variant p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40"
              >
                {/* Header: Avatar + Name + Status + 3-dot menu */}
                <div className="flex items-start gap-2.5">
                  <div className="relative shrink-0">
                    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center text-[15px] font-black text-primary border border-red-200">
                      {account.label?.[0]?.toUpperCase() || "Z"}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5">
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
                          type="button"
                          onClick={() =>
                            setActiveMenuAccountId((prev) =>
                              prev === account.account_id ? null : account.account_id
                            )
                          }
                          className="text-on-surface-variant hover:text-on-surface h-6 w-6 rounded-md hover:bg-surface-container-low transition flex items-center justify-center cursor-pointer"
                          title="Tùy chọn"
                        >
                          <span className="material-symbols-outlined text-[16px]">more_vert</span>
                        </button>

                        {activeMenuAccountId === account.account_id && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setActiveMenuAccountId(null)}
                            />
                            <div className="absolute right-0 mt-1 w-44 bg-surface border border-outline-variant rounded-xl shadow-xl py-1 z-20 overflow-hidden text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAccount(account);
                                  setActiveMenuAccountId(null);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-surface-container-low flex items-center gap-2 font-semibold text-on-surface transition-colors cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-[14px] text-primary">edit</span>
                                <span>Chỉnh sửa đầy đủ</span>
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPermissionsAccount({
                                      id: account.account_id,
                                      label: account.label || account.account_id,
                                    });
                                    setActiveMenuAccountId(null);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-surface-container-low flex items-center gap-2 font-semibold text-on-surface transition-colors border-t border-outline-variant cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-[14px] text-primary">lock</span>
                                  <span>Phân quyền</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Bạn có chắc muốn xóa hoàn toàn dữ liệu đăng nhập của ${account.label || account.account_id}?`
                                    )
                                  ) {
                                    void flow.deleteAccount(account.account_id, true);
                                  }
                                  setActiveMenuAccountId(null);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-red-50 flex items-center gap-2 font-semibold text-red-600 border-t border-outline-variant transition-colors cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-[14px]">delete</span>
                                <span>Xóa hoàn toàn Auth</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          status.tone === "success"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : status.tone === "error"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : status.tone === "warning"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-surface-container-low text-on-surface-variant border border-outline-variant"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            status.tone === "success"
                              ? "bg-emerald-500"
                              : status.tone === "error"
                                ? "bg-red-500"
                                : status.tone === "warning"
                                  ? "bg-amber-500"
                                  : "bg-slate-400"
                          }`}
                        />
                        <span>{status.text}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Compact Info rows */}
                <div className="mt-3 flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-on-surface-variant">
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant shrink-0">call</span>
                    {account.phone ? (
                      <span className="font-semibold text-on-surface truncate">{account.phone}</span>
                    ) : (
                      <span className="text-on-surface-variant italic">Chưa có SĐT</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-on-surface-variant">
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant shrink-0">key</span>
                    <span className="font-mono text-[10.5px] bg-surface-container-low px-1.5 py-0.5 rounded text-on-surface-variant truncate border border-outline-variant/60">
                      {shortId(account.account_id, 8, 6)}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="mt-3 pt-2.5 border-t border-outline-variant flex items-center gap-1.5">
                  {account.listener?.auth_expired ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (account.account_id !== flow.userId) {
                            flow.switchAccount(account.account_id);
                          }
                          void flow.restartSession();
                        }}
                        className="flex-1 h-8 bg-primary text-white flex items-center justify-center gap-1 rounded-lg text-xs font-bold transition-all hover:bg-red-700 hover:shadow-sm shadow-red-500/20 active:scale-95 animate-pulse cursor-pointer"
                        title="Phiên đã hết hạn — bấm để đăng nhập lại qua Extension"
                      >
                        <span className="material-symbols-outlined text-[14px]">login</span>
                        <span>Đăng nhập lại</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAccount(account)}
                        className="h-8 w-8 bg-surface-container-low text-on-surface hover:text-primary flex items-center justify-center rounded-lg border border-outline-variant transition cursor-pointer"
                        title="Chỉnh sửa tài khoản"
                      >
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onEnterChat(account.account_id)}
                        className="flex-1 h-8 bg-primary text-white flex items-center justify-center gap-1 rounded-lg text-xs font-bold transition-all hover:bg-red-700 hover:shadow-sm shadow-red-500/20 active:scale-95 cursor-pointer"
                        title="Mở Zalo Chat ở trang full-screen"
                      >
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        <span>Mở chat</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAccount(account)}
                        className="h-8 w-8 bg-surface-container-low text-on-surface hover:text-primary flex items-center justify-center rounded-lg border border-outline-variant transition cursor-pointer"
                        title="Chỉnh sửa tài khoản"
                      >
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {filteredAccounts.length === 0 && !flow.isLoadingAccounts && (
        <div className="border border-dashed border-outline-variant bg-surface-container-low rounded-2xl p-8 text-center">
          <div className="h-12 w-12 mx-auto rounded-xl bg-surface flex items-center justify-center mb-2 shadow-xs border border-outline-variant">
            <span className="material-symbols-outlined text-on-surface-variant text-[24px]">account_circle</span>
          </div>
          <p className="text-[13px] font-bold text-on-surface">
            {searchQuery ? "Không tìm thấy tài khoản phù hợp" : "Chưa có tài khoản nào"}
          </p>
          <p className="text-[11.5px] text-on-surface-variant mt-1">
            {searchQuery ? "Thử từ khóa khác hoặc xóa bộ lọc" : "Hãy thêm tài khoản Zalo đầu tiên bằng nút ở trên"}
          </p>
        </div>
      )}

      {/* Permissions Modal */}
      {permissionsAccount && (
        <ZaloAccountAssignmentsPanel
          accountId={permissionsAccount.id}
          accountLabel={permissionsAccount.label}
          onClose={() => setPermissionsAccount(null)}
        />
      )}
    </div>
  );
}
