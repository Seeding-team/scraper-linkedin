"use client";

/**
 * Trang "Quét thành viên nhóm" — port giao diện từ zalo-account-module/app/
 * (dashboard)/scan-group-members/page.tsx, chỉ đổi token màu brand (xem
 * lib/zaloUi.ts). Logic/data-fetching giữ nguyên — vẫn getZaloGroupMembers +
 * createZaloBulkJob theo đúng hợp đồng backend hiện có (bản gốc có thêm chế độ
 * "nhập link nhóm" — backend app này chỉ hỗ trợ quét theo group_id đã biết nên
 * không port phần đó, giữ đúng logic đang chạy).
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search, Send, Shield, UserPlus, Users, UsersRound } from "lucide-react";
import { useZaloAccountOptions, useZaloConversationOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { createZaloBulkJob, getZaloGroupMembers } from "@/services/zaloCrawlerService";
import type { ZaloBulkJobType, ZaloGroupMember } from "@/types/zalo-api";
import { alert, btn, btnSize, card, infoBox, input, label, pill, select, textarea } from "@/lib/zaloUi";

type ActionType = Extract<ZaloBulkJobType, "send_message" | "add_friend">;

const ACTION_OPTIONS: { value: ActionType; label: string; icon: typeof Send }[] = [
  { value: "send_message", label: "Nhắn tin", icon: Send },
  { value: "add_friend", label: "Gửi lời mời kết bạn", icon: UserPlus },
];

export function ZaloScanGroupMembersPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const { conversations, loading: loadingConversations } = useZaloConversationOptions(selectedAccountId);
  const groupsOnly = useMemo(() => conversations.filter((c) => c.thread_type !== "user" && !c.is_friend), [conversations]);

  const [sourceGroupId, setSourceGroupId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedGroupName, setScannedGroupName] = useState<string | null>(null);
  const [totalMember, setTotalMember] = useState<number | null>(null);
  const [members, setMembers] = useState<ZaloGroupMember[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const [actionType, setActionType] = useState<ActionType>("send_message");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleScan() {
    if (!selectedAccountId || !sourceGroupId) return;
    setScanning(true);
    setScanError(null);
    setMembers([]);
    setSelectedUids(new Set());
    setScannedGroupName(null);
    setTotalMember(null);
    try {
      const res = await getZaloGroupMembers(selectedAccountId, sourceGroupId);
      const groupName = conversations.find((c) => c.conversation_id === sourceGroupId)?.conversation_name || sourceGroupId;
      setScannedGroupName(groupName);
      setMembers(res.members);
      setTotalMember(res.total_member);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Quét thành viên thất bại.");
    } finally {
      setScanning(false);
    }
  }

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => (m.display_name || "").toLowerCase().includes(q) || m.uid.includes(q));
  }, [members, search]);

  function toggleMember(uid: string) {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      filteredMembers.forEach((m) => next.add(m.uid));
      return next;
    });
  }

  function clearSelection() {
    setSelectedUids(new Set());
  }

  const canSubmit = !submitting && Boolean(selectedAccountId) && selectedUids.size > 0 && (actionType === "add_friend" || message.trim().length > 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const selectedMembers = members.filter((m) => selectedUids.has(m.uid)).map((m) => ({ uid: m.uid, display_name: m.display_name || undefined }));
      await createZaloBulkJob({
        account_id: selectedAccountId,
        job_type: actionType,
        recipients: selectedMembers,
        message: message.trim() || undefined,
        friend_message: actionType === "add_friend" ? message.trim() || undefined : undefined,
      });
      setNotice(`Đã tạo chiến dịch cho ${selectedMembers.length} thành viên — theo dõi tiến độ ở trang "Gửi hàng loạt".`);
      setSelectedUids(new Set());
      setMessage("");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Không tạo được chiến dịch.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-4 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Quét thành viên nhóm</h1>
            <p className="text-sm text-muted-foreground">Quét đầy đủ danh sách thành viên 1 nhóm, chọn ra rồi nhắn tin / kết bạn hàng loạt.</p>
          </div>
          <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
        </div>

        <div className={infoBox}>
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span>
            <strong>Quét thành viên nhóm</strong> — Vượt qua giới hạn hiển thị ~155-200 người mặc định của Zalo, dùng để tạo danh sách bulk-send.
          </span>
        </div>

        {/* Bước 1: chọn nhóm để quét */}
        <section className={card}>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">1. Chọn nhóm cần quét</h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div>
              <label className={label}>Nhóm cần quét thành viên</label>
              <select value={sourceGroupId} onChange={(e) => setSourceGroupId(e.target.value)} disabled={loadingConversations || groupsOnly.length === 0} className={`${select} w-full sm:w-1/2`}>
                <option value="">{loadingConversations ? "Đang tải nhóm..." : "— Chọn nhóm —"}</option>
                {groupsOnly.map((g) => (
                  <option key={g.conversation_id} value={g.conversation_id}>
                    {g.conversation_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => void handleScan()} disabled={!selectedAccountId || scanning || !sourceGroupId} className={`${btn.primary} ${btnSize.sm}`}>
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Quét thành viên
              </button>
            </div>
            {scanError ? (
              <div className={alert.error}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {scanError}
              </div>
            ) : null}
          </div>
        </section>

        {/* Bước 2: kết quả quét */}
        {scannedGroupName !== null ? (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">2. Chọn thành viên — &quot;{scannedGroupName}&quot;</h2>
                <p className="text-xs text-slate-500">
                  Quét được <strong className="text-slate-700">{members.length}</strong>
                  {totalMember && totalMember !== members.length ? <span> / {totalMember} thành viên thật của nhóm</span> : <span> thành viên</span>}
                  {members.length > 0 ? (
                    <>
                      {" "}
                      · đã chọn <strong className="text-slate-700">{selectedUids.size}</strong>.
                    </>
                  ) : null}
                </p>
              </div>
              {members.length > 0 ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={selectAllFiltered} className={`${btn.outline} ${btnSize.sm}`}>
                    Chọn tất cả (đang lọc)
                  </button>
                  <button type="button" onClick={clearSelection} className={`${btn.outline} ${btnSize.sm}`}>
                    Bỏ chọn
                  </button>
                </div>
              ) : null}
            </div>
            {members.length === 0 ? (
              <div className={`${alert.error} mx-5 my-3`}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Không lấy được thành viên nào của nhóm này{totalMember ? ` (nhóm có ${totalMember} thành viên)` : ""}.</span>
              </div>
            ) : (
              <>
                <div className="border-b border-slate-100 px-5 py-3">
                  <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc uid..." className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" />
                  </div>
                </div>
                <div className="max-h-96 overflow-auto">
                  {filteredMembers.map((m) => {
                    const checkedNow = selectedUids.has(m.uid);
                    return (
                      <label key={m.uid} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-5 py-2 text-sm last:border-b-0 hover:bg-slate-50">
                        <input type="checkbox" checked={checkedNow} onChange={() => toggleMember(m.uid)} className="accent-brand" />
                        {m.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                        ) : (
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-400">
                            {(m.display_name || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          <span className="block truncate font-medium text-slate-800">{m.display_name || `uid:${m.uid}`}</span>
                          <span className="block truncate text-[11px] text-slate-400">{m.uid}</span>
                        </span>
                        {m.role === "admin" ? (
                          <span className={`${pill.info} shrink-0`}>
                            <Shield className="mr-1 inline h-3 w-3" />
                            Admin
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        ) : null}

        {/* Bước 3: hành động hàng loạt */}
        {members.length > 0 ? (
          <section className={card}>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">3. Chọn hành động</h2>
            </div>
            <div className="space-y-4 px-5 py-4">
              {notice ? (
                <div className={alert.success}>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="flex-1">{notice}</span>
                </div>
              ) : null}
              {submitError ? (
                <div className={alert.error}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {submitError}
                </div>
              ) : null}

              <div>
                <label className={label}>Hành động</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ACTION_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = actionType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setActionType(opt.value)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                          active ? "border-brand bg-brand-subtle text-brand" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={label}>{actionType === "send_message" ? "Nội dung tin nhắn *" : "Lời nhắn kèm lời mời kết bạn (tuỳ chọn)"}</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder={actionType === "send_message" ? "Nhập nội dung sẽ gửi cho từng thành viên đã chọn..." : "Để trống sẽ dùng lời nhắn kết bạn mặc định của hệ thống."}
                  className={textarea}
                />
              </div>

              <div className={alert.info}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Đây thường là những người CHƯA quen tài khoản của bạn — nên chọn số lượng vừa phải mỗi lần để tránh bị Zalo đánh dấu spam.</span>
              </div>

              <div className="flex justify-end">
                <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit} className={`${btn.primary} ${btnSize.md}`}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UsersRound className="h-4 w-4" />}
                  Tạo chiến dịch cho {selectedUids.size} thành viên
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
