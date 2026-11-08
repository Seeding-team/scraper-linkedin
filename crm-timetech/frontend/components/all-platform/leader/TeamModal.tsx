"use client";

import { useState, useEffect, useMemo } from "react";
import { MaterialIcon } from "@/components/ui";
import { teamsService, usersService } from "@/services/all-platform.service";
import type { AppUserProfile, TeamRow } from "@/services/all-platform.service";
import { useMembers } from "@/hooks/useMembers";

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: TeamRow | null; // Null if creating a new team
  leaderId: string;
  onSuccess: () => void;
}

export function TeamModal({ isOpen, onClose, team, leaderId, onSuccess }: TeamModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [nameTeam, setNameTeam] = useState("");
  const [allMembers, setAllMembers] = useState<AppUserProfile[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  // Hiện ĐẦY ĐỦ toàn bộ danh bạ (140 người) — GET /api/all-platform/members —
  // tích tự do không chặn ai. Người chưa liên kết tài khoản đăng nhập vẫn tích
  // được bình thường; lúc lưu sẽ tự lọc ra ai có tài khoản thật để gửi lên (vì
  // member_of_teams cần app_users.id thật), phần còn lại chờ họ tự liên kết sau.
  const { members } = useMembers();
  const rosterEntries = useMemo(() => {
    return members
      .map(m => {
        const linkedUserId = m.linked_user_id || m.linked_user_id_2 || null;
        const user = linkedUserId ? allMembers.find(u => u.id === linkedUserId) : undefined;
        return {
          memberId: m.id,
          displayName: m.display_name,
          linkedUserId,
          email: user?.email || null,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, allMembers]);

  // Load all members (role === "member")
  useEffect(() => {
    async function loadMembers() {
      setIsLoadingMembers(true);
      try {
        const res = await usersService.getByRole("member");
        if (res.success && res.data) {
          setAllMembers(res.data);
        }
      } catch (err) {
        console.error("Lỗi khi tải danh sách thành viên:", err);
      } finally {
        setIsLoadingMembers(false);
      }
    }
    if (isOpen) {
      loadMembers();
    }
  }, [isOpen]);

  // Set form state based on Mode (Create vs Edit)
  useEffect(() => {
    if (isOpen) {
      if (team) {
        setNameTeam(team.name_team);
        // team.members chứa app_users.id thật đã lưu trong DB — map ngược sang
        // memberId tương ứng trong roster để tích đúng checkbox (selectedMemberIds
        // giờ lưu theo memberId, chỉ resolve sang app_users.id lúc submit).
        const existingUserIds = new Set(team.members?.map(m => m.id) || []);
        const matched = rosterEntries
          .filter(e => e.linkedUserId && existingUserIds.has(e.linkedUserId))
          .map(e => e.memberId);
        setSelectedMemberIds(matched);
      } else {
        setNameTeam("");
        setSelectedMemberIds([]);
      }
      setError(null);
    }
  }, [isOpen, team, rosterEntries]);

  if (!isOpen) return null;

  // Hiện toàn bộ danh bạ, lọc theo search query (tên hoặc email).
  const filteredMembers = rosterEntries.filter(e => {
    const query = searchQuery.toLowerCase();
    return e.displayName.toLowerCase().includes(query) || (e.email || "").toLowerCase().includes(query);
  });

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameTeam.trim()) {
      setError("Tên team không được để trống");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Chỉ người ĐÃ liên kết tài khoản mới có app_users.id thật để lưu vào
      // member_of_teams (cột có FK, người chưa liên kết sẽ bị DB từ chối) — lọc
      // ra, tạo team vẫn chạy bình thường, phần còn lại chờ họ tự liên kết sau.
      const resolvedMemberIds = selectedMemberIds
        .map(mid => rosterEntries.find(e => e.memberId === mid)?.linkedUserId)
        .filter((id): id is string => Boolean(id));

      const payload = {
        name_team: nameTeam.trim(),
        leader_id: leaderId,
        member_ids: resolvedMemberIds
      };

      let res;
      if (team) {
        // Edit Mode
        res = await teamsService.update(payload);
      } else {
        // Create Mode
        res = await teamsService.create(payload);
      }

      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setError(res.message || "Đã xảy ra lỗi");
      }
    } catch (err) {
      setError("Lỗi kết nối máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          cursor: 'pointer'
        }}
      />

      {/* Modal Content */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
          <div>
            <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <MaterialIcon name="group_add" className="text-primary" />
              {team ? "Chỉnh sửa thành viên Team" : "Thêm Team Mới"}
            </h2>
            <p className="text-xs text-on-surface-variant font-medium mt-0.5">
              {team ? `Cập nhật thành viên cho team: ${team.name_team}` : "Tạo team mới và chỉ định thành viên"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-highest/50 transition">
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-medium flex items-start gap-2 border border-red-100">
              <MaterialIcon name="error" className="text-[16px] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase">Tên Team</label>
            <input
              type="text"
              value={nameTeam}
              onChange={(e) => setNameTeam(e.target.value)}
              disabled={!!team} // Disable editing team name to preserve backend update key logic
              placeholder="VD: Growth Team, Dev Team..."
              className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition disabled:opacity-60 disabled:cursor-not-allowed"
              required
            />
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                Chọn thành viên ({selectedMemberIds.length})
              </label>
              <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                Toàn bộ danh bạ ({rosterEntries.length})
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm thành viên theo email hoặc tên..."
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-9 pr-3 py-2 text-xs text-on-surface outline-none focus:border-primary transition"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant flex items-center">
                <MaterialIcon name="search" className="text-[16px]" />
              </div>
            </div>

            {/* Members List */}
            <div className="border border-outline-variant rounded-xl max-h-[200px] overflow-y-auto divide-y divide-outline-variant bg-surface-container-low">
              {isLoadingMembers ? (
                <div className="py-8 text-center text-xs text-on-surface-variant flex flex-col items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span>Đang tải danh sách thành viên...</span>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="py-8 text-center text-xs text-on-surface-variant italic">
                  Không tìm thấy thành viên phù hợp
                </div>
              ) : (
                filteredMembers.map(e => {
                  const isSelected = selectedMemberIds.includes(e.memberId);
                  return (
                    <div
                      key={e.memberId}
                      onClick={() => handleToggleMember(e.memberId)}
                      className="flex items-center justify-between px-3 py-2.5 hover:bg-surface transition cursor-pointer select-none"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-bold text-on-surface truncate">{e.displayName}</div>
                        <div className="text-[10px] text-on-surface-variant font-medium truncate">{e.email || "Chưa liên kết tài khoản"}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition shrink-0 ${
                        isSelected
                          ? "bg-primary border-primary text-white"
                          : "border-outline-variant bg-surface"
                      }`}>
                        {isSelected && <MaterialIcon name="check" className="text-[14px]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-highest transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-primary hover:bg-on-primary-fixed-variant transition disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isSubmitting ? "Đang lưu..." : team ? "Lưu thay đổi" : "Tạo Team"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
