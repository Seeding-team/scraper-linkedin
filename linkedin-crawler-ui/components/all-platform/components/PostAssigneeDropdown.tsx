"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { allPlatformUsersService } from "@/services/all-platform.service";

export interface PostMemberItem {
  email: string;
  name?: string;
  role?: string;
  team_name?: string;
}

interface PostAssigneeDropdownProps {
  postId: string;
  teamMembers?: PostMemberItem[];
  initialAssignee?: PostMemberItem | null;
  onAssigneeChange?: (member: PostMemberItem | null) => void;
  className?: string;
}

export function PostAssigneeDropdown({
  postId,
  teamMembers: propMembers,
  initialAssignee,
  onAssigneeChange,
  className,
}: PostAssigneeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fetchedMembers, setFetchedMembers] = useState<PostMemberItem[]>([]);
  const [currentAssignee, setCurrentAssignee] = useState<PostMemberItem | null>(() => {
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_assignee_${postId}`);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // invalid json
        }
      }
    }
    return initialAssignee || null;
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Load members if not passed via props
  useEffect(() => {
    if (propMembers && propMembers.length > 0) return;
    allPlatformUsersService
      .getAllProfiles()
      .then((res) => {
        if (res.success && res.data) {
          setFetchedMembers(res.data);
        }
      })
      .catch(() => {});
  }, [propMembers]);

  const availableMembers = useMemo(() => {
    const list = propMembers && propMembers.length > 0 ? propMembers : fetchedMembers;
    return list;
  }, [propMembers, fetchedMembers]);

  // Sync state if postId changes
  useEffect(() => {
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_assignee_${postId}`);
      if (saved) {
        try {
          setCurrentAssignee(JSON.parse(saved));
          return;
        } catch {}
      }
    }
    if (initialAssignee) {
      setCurrentAssignee(initialAssignee);
    }
  }, [postId, initialAssignee]);

  // Listen for sync event from other views
  useEffect(() => {
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<{ postId: string; assignee: PostMemberItem | null }>;
      if (customEvent.detail?.postId === postId) {
        setCurrentAssignee(customEvent.detail.assignee || null);
      }
    };
    window.addEventListener("seeding_post_assignee_updated", handleSync);
    return () => window.removeEventListener("seeding_post_assignee_updated", handleSync);
  }, [postId]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return availableMembers;
    const q = searchQuery.toLowerCase().trim();
    return availableMembers.filter(
      (m) =>
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.email && m.email.toLowerCase().includes(q))
    );
  }, [availableMembers, searchQuery]);

  const handleSelectMember = (member: PostMemberItem | null, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCurrentAssignee(member);
    setIsOpen(false);
    setSearchQuery("");

    if (typeof window !== "undefined" && postId) {
      if (member) {
        localStorage.setItem(`post_assignee_${postId}`, JSON.stringify(member));
      } else {
        localStorage.removeItem(`post_assignee_${postId}`);
      }
      window.dispatchEvent(
        new CustomEvent("seeding_post_assignee_updated", {
          detail: { postId, assignee: member },
        })
      );
    }

    if (onAssigneeChange) {
      onAssigneeChange(member);
    }

    if (member) {
      toast.success(`✓ Đã gán bài viết cho: ${member.name || member.email}`);
    } else {
      toast.info("Đã hủy gán người seeding cho bài viết này.");
    }
  };

  return (
    <div className={cn("relative inline-block text-left", className)} ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition cursor-pointer select-none",
          currentAssignee
            ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 font-semibold shadow-xs"
            : "bg-background text-foreground border-border hover:bg-muted shadow-2xs"
        )}
        title={
          currentAssignee
            ? `Người phụ trách seeding: ${currentAssignee.name || currentAssignee.email}`
            : "Gán người phụ trách seeding bài viết này"
        }
      >
        <span className="material-symbols-outlined text-[15px] opacity-80 leading-none">
          person
        </span>
        <span className="truncate max-w-[130px]">
          {currentAssignee?.name || currentAssignee?.email || "Gán seeding"}
        </span>
        <span className="material-symbols-outlined text-[15px] opacity-70 ml-0.5 leading-none">
          expand_more
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 w-60 rounded-xl border border-border bg-card shadow-xl p-1.5 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Ô tìm kiếm nhanh thành viên */}
          <div className="px-1.5 py-1 mb-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên hoặc email..."
              className="w-full px-2.5 py-1 text-xs rounded-lg border border-border bg-muted/40 focus:outline-hidden focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {/* Lựa chọn Hủy gán / Chưa gán */}
            <button
              type="button"
              onClick={(e) => handleSelectMember(null, e)}
              className={cn(
                "w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition cursor-pointer flex items-center justify-between",
                !currentAssignee
                  ? "bg-muted font-bold text-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-muted-foreground">
                  person_off
                </span>
                <span>Chưa gán (Bỏ gán)</span>
              </span>
              {!currentAssignee && (
                <span className="material-symbols-outlined text-[14px] text-primary">check</span>
              )}
            </button>

            <div className="h-px bg-border my-1" />

            {/* Danh sách thành viên */}
            {filteredMembers.length === 0 ? (
              <div className="text-center py-2 text-xs text-muted-foreground">
                Không tìm thấy thành viên nào.
              </div>
            ) : (
              filteredMembers.map((member) => {
                const isSelected =
                  currentAssignee &&
                  (currentAssignee.email === member.email ||
                    (currentAssignee.name && currentAssignee.name === member.name));
                return (
                  <button
                    key={member.email || member.name}
                    type="button"
                    onClick={(e) => handleSelectMember(member, e)}
                    className={cn(
                      "w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition cursor-pointer flex items-center justify-between",
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-medium truncate">{member.name || member.email}</div>
                      {member.name && member.email && (
                        <div
                          className={cn(
                            "text-[10px] truncate",
                            isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                          )}
                        >
                          {member.email}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span className="material-symbols-outlined text-[14px] shrink-0">check</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
