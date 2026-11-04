"use client";

import React, { useState, useMemo } from "react";
import { Search, UserCheck, Check, User, X, ShieldCheck } from "lucide-react";
import { useMembers } from "@/hooks/useMembers";
import { MemberProfile } from "@/types/unified.types";

interface AssignUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOwnerName?: string;
  onAssignUser: (user: MemberProfile) => void;
}

export const AssignUserModal: React.FC<AssignUserModalProps> = ({
  isOpen,
  onClose,
  currentOwnerName = "Nguyễn Thị Mai",
  onAssignUser,
}) => {
  const { members, loading } = useMembers();
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<MemberProfile | null>(null);

  // Fallback members list if API is loading or empty in dev
  const fallbackMembers: MemberProfile[] = [
    { id: "usr-1", display_name: "Nguyễn Thị Mai", full_name: "Nguyễn Thị Mai", email: "mai.nguyen@markee.vn", position: "Sale Leader", department: "Kinh doanh" },
    { id: "usr-2", display_name: "Lê Văn Nam", full_name: "Lê Văn Nam", email: "nam.le@markee.vn", position: "Sale Executive", department: "Kinh doanh" },
    { id: "usr-3", display_name: "Trần Thị Bình", full_name: "Trần Thị Bình", email: "binh.tran@markee.vn", position: "CSKH", department: "Chăm sóc khách hàng" },
    { id: "usr-4", display_name: "Phạm Quốc Hùng", full_name: "Phạm Quốc Hùng", email: "hung.pham@markee.vn", position: "Tech Presale", department: "Kỹ thuật" },
  ];

  const displayMembers = members.length > 0 ? members : fallbackMembers;

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return displayMembers;
    const q = search.toLowerCase();
    return displayMembers.filter((m) => {
      const name = (m.display_name || m.full_name || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      const pos = (m.position || m.department || "").toLowerCase();
      return name.includes(q) || email.includes(q) || pos.includes(q);
    });
  }, [displayMembers, search]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedUser) {
      onAssignUser(selectedUser);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs font-sans select-none animate-in fade-in duration-150">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-[440px] max-w-full rounded-2xl bg-white p-4 shadow-2xl z-10 space-y-4 border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-[var(--color-markee-primary,#c2185b)] font-bold">
              <UserCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Gán người phụ trách</h3>
              <p className="text-[11px] text-slate-500">Phân công nhân viên xử lý hội thoại & chăm sóc khách hàng</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Current Owner Badge */}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 border border-slate-200/80">
          <span className="text-xs text-slate-500 font-medium">Người đang phụ trách:</span>
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>{currentOwnerName}</span>
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm nhân viên theo tên, email hoặc vai trò..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 pl-8 pr-3 py-2 text-xs focus:border-[var(--color-markee-primary,#c2185b)] outline-hidden"
          />
        </div>

        {/* Members List */}
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {loading ? (
            <div className="text-center py-6 text-xs text-slate-400">Đang tải danh sách nhân sự...</div>
          ) : filteredMembers.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400">Không tìm thấy nhân viên phù hợp</div>
          ) : (
            filteredMembers.map((user) => {
              const userName = user.display_name || user.full_name || "Nhân viên";
              const userRole = user.position || user.department || "Kinh doanh";
              const isSelected = selectedUser?.id === user.id;
              const isCurrent = userName === currentOwnerName;
              return (
                <div
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? "border-[var(--color-markee-primary,#c2185b)] bg-rose-50/40"
                      : "border-slate-200/80 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 font-bold text-xs">
                      {userName.substring(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="truncate text-xs font-bold text-slate-800">{userName}</h4>
                        {isCurrent && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-800">Hiện tại</span>
                        )}
                      </div>
                      <p className="truncate text-[10px] text-slate-500">{user.email || userRole}</p>
                    </div>
                  </div>

                  <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition ${
                    isSelected
                      ? "border-[var(--color-markee-primary,#c2185b)] bg-[var(--color-markee-primary,#c2185b)] text-white"
                      : "border-slate-300 bg-white"
                  }`}>
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Action Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={!selectedUser}
            onClick={handleConfirm}
            className="rounded-xl bg-[var(--color-markee-primary,#c2185b)] px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#a3134c] disabled:opacity-50 transition"
          >
            Gán người phụ trách
          </button>
        </div>
      </div>
    </div>
  );
};
