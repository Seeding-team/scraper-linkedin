"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { allPlatformKpiService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";

interface FbPostItem {
  id: string;
  job_id: string;
  post_url: string | null;
  content: string | null;
  target_type: string;
  target_id: string | null;
  posted_at: string;
}

interface FbPostSummary {
  post_count: number;
  profile_count: number;
  group_count: number;
  page_count: number;
  posts: FbPostItem[];
  range: { start: string; end: string };
}

interface LeaderPostViewProps {
  isOpen: boolean;
  onClose: () => void;
  /** Member email mà leader muốn xem posts (nếu trống thì leader chọn từ dropdown) */
  memberEmail?: string;
  memberName?: string;
  /** Override leaderEmail, dùng cho admin */
  leaderEmail?: string;
  /** Tuần KPI range (YYYY-MM-DD) */
  startDate?: string;
  endDate?: string;
  onStatusChange?: () => void;
}

const TARGET_TYPE_CONFIG: Record<string, { label: string; icon: string; bg: string; text: string; activeBg: string; activeText: string }> = {
  profile: {
    label: "Cá nhân",
    icon: "person",
    bg: "bg-blue-50",
    text: "text-blue-700",
    activeBg: "bg-blue-600",
    activeText: "text-white",
  },
  group: {
    label: "Nhóm",
    icon: "group",
    bg: "bg-purple-50",
    text: "text-purple-700",
    activeBg: "bg-purple-600",
    activeText: "text-white",
  },
  page: {
    label: "Page",
    icon: "thumb_up",
    bg: "bg-green-50",
    text: "text-green-700",
    activeBg: "bg-green-600",
    activeText: "text-white",
  },
};

function getMondayOfWeek(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

function getSundayOfWeek(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  const sunday = new Date(d);
  sunday.setDate(d.getDate() + diff);
  return sunday.toISOString().split("T")[0];
}

export function LeaderPostView({
  isOpen,
  onClose,
  memberEmail: initialMemberEmail,
  memberName: initialMemberName,
  leaderEmail: overrideLeaderEmail,
  startDate: initialStartDate,
  endDate: initialEndDate,
  onStatusChange,
}: LeaderPostViewProps) {
  const { user } = useAppAuth();

  const now = new Date();
  const defaultStart = initialStartDate || getMondayOfWeek(now);
  const defaultEnd = initialEndDate || getSundayOfWeek(now);

  const [memberEmail, setMemberEmail] = useState((initialMemberEmail || "").trim().toLowerCase());
  const [memberName, setMemberName] = useState(initialMemberName || "");
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [postData, setPostData] = useState<FbPostSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const leaderEmail = (overrideLeaderEmail || user?.email || "").trim().toLowerCase();

  const refreshPosts = useCallback(async () => {
    if (!memberEmail) return;
    setLoading(true);
    setError(null);
    try {
      const res = await allPlatformKpiService.getFbPostKpiSummary(memberEmail, startDate, endDate);
      if (res?.success && res.data) {
        setPostData(res.data);
      } else {
        setError(res?.message || "Lỗi tải danh sách bài viết");
        setPostData(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi kết nối máy chủ");
      setPostData(null);
    } finally {
      setLoading(false);
    }
  }, [memberEmail, startDate, endDate]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialMemberEmail) {
      setMemberEmail(initialMemberEmail.trim().toLowerCase());
      setMemberName(initialMemberName || "");
    }
    if (initialStartDate) setStartDate(initialStartDate);
    if (initialEndDate) setEndDate(initialEndDate);
  }, [isOpen, initialMemberEmail, initialMemberName, initialStartDate, initialEndDate]);

  useEffect(() => {
    if (isOpen && memberEmail) {
      refreshPosts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, memberEmail]);

  const filteredPosts = useMemo(() => {
    if (!postData?.posts) return [];
    if (!filterType) return postData.posts;
    return postData.posts.filter((p) => p.target_type === filterType);
  }, [postData, filterType]);

  const stats = useMemo(
    () => ({
      total: postData?.post_count ?? 0,
      profile: postData?.profile_count ?? 0,
      group: postData?.group_count ?? 0,
      page: postData?.page_count ?? 0,
    }),
    [postData]
  );

  const formatDate = (isoDate: string) => {
    try {
      return new Date(isoDate).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoDate;
    }
  };

  const formatDateInput = (isoDate: string) => {
    try {
      return new Date(isoDate).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return isoDate;
    }
  };

  const openPostUrl = (url: string | null) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleLoad = () => {
    if (!memberEmail.trim()) {
      setError("Vui lòng nhập email thành viên");
      return;
    }
    refreshPosts();
  };

  const handleQuickWeek = (weeksBack: number) => {
    const d = new Date();
    d.setDate(d.getDate() - weeksBack * 7);
    setStartDate(getMondayOfWeek(d));
    setEndDate(getSundayOfWeek(d));
    // refresh after setting dates
    setTimeout(() => {
      if (memberEmail) refreshPosts();
    }, 0);
  };

  if (!isOpen) return null;

  const headerBg = "bg-gradient-to-r from-slate-800 to-slate-700";
  const accentColor = "var(--color-primary)";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: 960,
          height: "88vh",
          backgroundColor: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className={cn("px-6 py-4 flex items-center justify-between", headerBg)}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: accentColor + "20" }}
            >
              <MaterialIcon
                name="article"
                className="text-[22px] text-white"
              />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                KPI Bài viết Facebook
              </h2>
              <p className="text-[11px] text-outline mt-0.5">
                {memberName
                  ? `${memberName} · `
                  : memberEmail
                  ? `${memberEmail} · `
                  : ""}
                {startDate && endDate
                  ? `${formatDateInput(startDate)} — ${formatDateInput(endDate)}`
                  : "Tuần KPI hiện tại"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshPosts}
              disabled={loading || !memberEmail}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold transition hover:bg-surface/10 disabled:opacity-40"
              style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
            >
              <MaterialIcon name="refresh" className="text-[14px]" />
              Làm mới
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-surface/10 flex items-center justify-center transition"
            >
              <MaterialIcon name="close" className="text-[20px]" />
            </button>
          </div>
        </div>

        {/* Search + Date Bar */}
        <div className="px-6 py-3 border-b border-outline-variant bg-surface-container-low flex flex-col gap-2">
          {/* Email row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1" ref={dropdownRef}>
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                <MaterialIcon name="person" className="text-[16px]" />
              </div>
              <input
                ref={inputRef}
                value={memberEmail}
                onChange={(e) => {
                  setMemberEmail(e.target.value.toLowerCase());
                  setError(null);
                }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={(e) => e.key === "Enter" && handleLoad()}
                placeholder="Email thành viên cần xem (VD: thanh@company.com)"
                className="w-full pl-9 pr-3 py-2 bg-surface border border-outline-variant rounded-xl text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
              />
              {showDropdown && memberEmail && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden">
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      handleLoad();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container-low flex items-center gap-2"
                  >
                    <MaterialIcon
                      name="search"
                      className="text-[14px] text-on-surface-variant"
                    />
                    Tìm: <strong>{memberEmail}</strong>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleLoad}
              disabled={loading || !memberEmail.trim()}
              className="px-5 py-2 rounded-xl text-white text-xs font-bold transition disabled:opacity-50 shrink-0"
              style={{ backgroundColor: accentColor }}
            >
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Đang tải…
                </span>
              ) : (
                "Tải bài viết"
              )}
            </button>
          </div>

          {/* Date row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase">
              Tuần:
            </span>
            <div className="flex items-center gap-1">
              {[
                { label: "Tuần trước", weeks: 1 },
                { label: "2 tuần trước", weeks: 2 },
                { label: "Tuần này", weeks: 0 },
              ].map(({ label, weeks }) => (
                <button
                  key={label}
                  onClick={() => handleQuickWeek(weeks)}
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold transition"
                  style={{
                    backgroundColor:
                      weeks === 0
                        ? accentColor
                        : "rgba(0,0,0,0.05)",
                    color: weeks === 0 ? "#ffffff" : "#64748b",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2 py-1 border border-outline-variant rounded-lg text-[11px] text-on-surface-variant outline-none focus:border-primary bg-surface"
              />
              <span className="text-on-surface-variant text-xs">—</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2 py-1 border border-outline-variant rounded-lg text-[11px] text-on-surface-variant outline-none focus:border-primary bg-surface"
              />
            </div>
          </div>
        </div>

        {/* Stats + Filter Bar */}
        {postData && (
          <div className="px-6 py-3 border-b border-outline-variant flex items-center gap-4 flex-wrap">
            {/* Counters */}
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="font-bold text-on-surface">{stats.total}</span>
              <span className="text-on-surface-variant">bài viết</span>
            </div>
            <div className="h-4 w-px bg-surface-container-highest" />
            {/* Filter pills */}
            <div className="flex items-center gap-1.5">
              {[
                null,
                "profile",
                "group",
                "page",
              ].map((type) => {
                const cfg = type ? TARGET_TYPE_CONFIG[type] : null;
                const count = type ? stats[type as keyof typeof stats] : stats.total;
                const isActive = filterType === type;
                return (
                  <button
                    key={type ?? "all"}
                    onClick={() => setFilterType(filterType === type ? null : type)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer",
                      isActive
                        ? cfg
                          ? cfg.activeBg
                          : "bg-slate-800 text-white"
                        : cfg
                        ? cn(cfg.bg, cfg.text, "hover:opacity-80")
                        : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-highest"
                    )}
                  >
                    {cfg && <MaterialIcon name={cfg.icon as MaterialSymbolName} className="text-[11px]" />}
                    {type
                      ? `${cfg?.label} ${count}`
                      : `Tất cả ${count}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Error */}
          {error && (
            <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <MaterialIcon name="error_outline" className="text-[16px] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Lỗi khi tải bài viết</p>
                <p className="mt-0.5 opacity-80">{error}</p>
              </div>
            </div>
          )}

          {/* Initial empty state */}
          {!loading && !postData && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: "#f1f5f9" }}
              >
                <MaterialIcon name="article" className="text-[36px] text-outline" />
              </div>
              <p className="text-sm font-medium text-on-surface-variant">
                Nhập email thành viên và bấm{" "}
                <span className="font-bold" style={{ color: accentColor }}>
                  Tải bài viết
                </span>
              </p>
              <p className="text-xs text-on-surface-variant mt-1">
                Hệ thống sẽ hiển thị danh sách bài viết đã đăng trong tuần KPI
              </p>
            </div>
          )}

          {/* Loaded but empty */}
          {!loading && postData && filteredPosts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: "#f1f5f9" }}
              >
                <MaterialIcon name="inbox" className="text-[36px] text-outline" />
              </div>
              <p className="text-sm font-medium text-on-surface-variant">Không có bài viết nào</p>
              <p className="text-xs text-on-surface-variant mt-1">
                {filterType
                  ? `Không có bài viết loại "${TARGET_TYPE_CONFIG[filterType]?.label || filterType}"`
                  : "Thành viên chưa đăng bài nào trong khoảng thời gian này"}
              </p>
              {filterType && (
                <button
                  onClick={() => setFilterType(null)}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition"
                  style={{ backgroundColor: accentColor }}
                >
                  Xem tất cả bài viết
                </button>
              )}
            </div>
          )}

          {/* Posts list */}
          {!loading && filteredPosts.length > 0 && (
            <div className="space-y-3">
              {filteredPosts.map((post) => {
                const cfg =
                  TARGET_TYPE_CONFIG[post.target_type] || TARGET_TYPE_CONFIG.profile;
                return (
                  <div
                    key={post.id}
                    className="border border-outline-variant rounded-xl bg-surface overflow-hidden hover:shadow-md hover:border-outline-variant transition-all duration-200"
                  >
                    {/* Post header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-surface-container-low border-b border-outline-variant">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold",
                            cfg.bg,
                            cfg.text
                          )}
                        >
                          <MaterialIcon name={cfg.icon as MaterialSymbolName} className="text-[11px]" />
                          {cfg.label}
                        </span>
                        {post.target_id && (
                          <span className="text-[10px] text-on-surface-variant font-mono">
                            {post.target_id}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-on-surface-variant font-medium">
                          {formatDate(post.posted_at)}
                        </span>
                        {post.job_id && (
                          <span className="text-[10px] text-outline font-mono">
                            #{post.job_id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Post content */}
                    <div className="px-4 py-3">
                      {post.content ? (
                        <p className="text-[13px] text-on-surface whitespace-pre-wrap line-clamp-3 leading-relaxed">
                          {post.content}
                        </p>
                      ) : (
                        <p className="text-[13px] text-on-surface-variant italic">
                          Không có nội dung (chỉ đăng ảnh/video)
                        </p>
                      )}
                    </div>

                    {/* Post actions */}
                    {post.post_url && (
                      <div className="px-4 py-2.5 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
                        <button
                          onClick={() => openPostUrl(post.post_url)}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold transition hover:underline"
                          style={{ color: accentColor }}
                        >
                          <MaterialIcon name="open_in_new" className="text-[13px]" />
                          Xem bài viết trên Facebook
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(post.post_url || "");
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant hover:text-on-surface-variant transition"
                          title="Sao chép link"
                        >
                          <MaterialIcon name="content_copy" className="text-[13px]" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
