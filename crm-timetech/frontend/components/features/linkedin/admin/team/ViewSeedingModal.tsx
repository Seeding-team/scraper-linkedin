"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { getMemberActualSeedingCount, type SeedingKpiItem } from "@/services/linkedinCrawlerService";

interface ViewSeedingModalProps {
  isOpen: boolean;
  onClose: () => void;
  memberEmail: string;
  /** Profile ID — dùng lọc chuẩn xác comment của đúng người */
  profileId?: string;
  /** Tên Facebook trên web — dùng lọc dự phòng */
  facebookName?: string;
}

export function ViewSeedingModal({
  isOpen,
  onClose,
  memberEmail,
  profileId,
  facebookName,
}: ViewSeedingModalProps) {
  const [items, setItems] = useState<SeedingKpiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [stats, setStats] = useState({ verified: 0, total: 0 });

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getMemberActualSeedingCount({
          email_member: memberEmail,
          profile_id: profileId,
          facebook_name: facebookName,
        });
        if (res.success && res.data) {
          setItems(res.data.items || []);
          setStats({
            verified: res.data.verified_count,
            total: res.data.total_count,
          });
        } else {
          setError(res.message || "Không thể tải nội dung seeding.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu.");
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [isOpen, memberEmail, profileId, facebookName]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-md">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[min(94vw,900px)] max-h-[85vh] bg-surface rounded-xl border border-outline-variant p-lg shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-outline-variant pb-md mb-md">
          <div className="flex items-center gap-4">
            <div>
              <h3 className="text-h3 font-bold text-on-surface">Lịch sử Seeding</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-0.5">{memberEmail}</p>
            </div>
            {/* Stats badges */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                <MaterialIcon name="verified" className="text-sm" />
                {stats.verified} đã xác minh
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold">
                <MaterialIcon name="list_alt" className="text-sm" />
                {stats.total} tổng bài
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors cursor-pointer"
          >
            <MaterialIcon name="close" className="text-xl" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto space-y-md pr-1 min-h-[300px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-sm">
              <MaterialIcon name="sync" className="text-4xl text-primary animate-spin" />
              <p className="text-body-md text-on-surface-variant animate-pulse">Đang tải lịch sử seeding...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-error space-y-xs">
              <MaterialIcon name="error" className="text-4xl" />
              <p className="text-body-md font-bold">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant space-y-xs opacity-60">
              <MaterialIcon name="list_alt" className="text-5xl" />
              <p className="text-body-md font-bold">Chưa có nội dung seeding nào</p>
              <p className="text-xs">Thành viên chưa thực hiện hoặc chưa gửi báo cáo seeding.</p>
            </div>
          ) : (
            <div className="space-y-sm">
              {items.map((item, idx) => {
                const isExpanded = expandedRow === idx;
                const verifyStr = (item.verify || "").trim().toLowerCase();
                const hasContent = (item.content || "").trim().length > 0;
                // Thống nhất: verify='yes' || 'đã seeding' || 'xác minh'
                const isVerified = verifyStr === "yes" || verifyStr.includes("đã seeding") || verifyStr.includes("xác minh");

                return (
                  <div 
                    key={idx} 
                    className="bg-surface-container-low hover:bg-surface-container rounded-xl border border-outline-variant p-md flex gap-md items-start transition-colors duration-200"
                  >
                    {/* Platform Icon Block */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      item.platform?.toLowerCase() === "linkedin"
                        ? "bg-secondary/10 text-secondary"
                        : "bg-primary/10 text-primary"
                    }`}>
                      <MaterialIcon
                        name={item.platform?.toLowerCase() === "linkedin" ? "article" : "group"}
                        className="text-xl"
                      />
                    </div>

                    {/* Main content body */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-sm flex-wrap mb-xs">
                        <div className="flex items-center gap-xs flex-wrap">
                          <span className="font-bold text-sm text-on-surface capitalize">
                            {item.platform || "Facebook"}
                          </span>
                          
                          <span
                            className={`px-2.5 py-1 rounded-md font-bold text-[10px] border ${
                              isVerified
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : "bg-amber-100 text-amber-700 border-amber-200"
                            }`}
                          >
                            {isVerified ? "✓ Đã xác minh" : "○ Chưa xác minh"}
                          </span>

                          <span className="text-[10px] text-on-surface-variant font-mono">
                            {item.day || "-"}
                          </span>
                        </div>

                        {/* Facebook name badge */}
                        {item.facebook_name && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-bold">
                            {item.facebook_name}
                          </span>
                        )}
                      </div>

                      {/* Content block */}
                      <div className="text-xs text-on-surface bg-surface-container-high/40 px-md py-sm rounded-lg border border-outline-variant/30 mb-sm">
                        <p className={`leading-relaxed whitespace-pre-wrap break-words ${isExpanded ? "" : "line-clamp-2"}`}>
                          {item.content || <span className="opacity-50 italic">Không có nội dung bình luận</span>}
                        </p>
                        {item.content && item.content.length > 120 && (
                          <button
                            onClick={() => setExpandedRow(isExpanded ? null : idx)}
                            className="text-primary font-bold hover:underline cursor-pointer flex items-center gap-0.5 mt-xs text-[10px]"
                          >
                            <span>{isExpanded ? "Thu gọn" : "Xem thêm"}</span>
                            <MaterialIcon
                              name={isExpanded ? "chevron_left" : "chevron_right"}
                              className="text-xs"
                            />
                          </button>
                        )}
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center gap-xs flex-wrap pt-0.5">
                        {item.link_post && (
                          <a
                            href={item.link_post}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border border-outline-variant hover:bg-surface-container-high px-md py-xs rounded-lg text-[10px] font-bold text-on-surface flex items-center gap-1 transition-colors w-fit"
                          >
                            <MaterialIcon name="link" className="text-xs" />
                            <span>Xem bài viết</span>
                            <MaterialIcon name="open_in_new" className="text-xs" />
                          </a>
                        )}

                        {item.link_comment && (
                          <a
                            href={item.link_comment}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-blue-600 hover:bg-blue-700 px-md py-xs rounded-lg text-[10px] font-bold text-white flex items-center gap-1 transition-colors w-fit shadow-sm"
                          >
                            <MaterialIcon name="comment" className="text-xs" />
                            <span>Xem Comment</span>
                            <MaterialIcon name="open_in_new" className="text-xs" />
                          </a>
                        )}

                        {item.profile_id && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 font-mono">
                            ID: {item.profile_id}
                          </span>
                        )}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant pt-md mt-md flex justify-end">
          <button
            onClick={onClose}
            className="border border-outline-variant hover:bg-surface-container-high px-lg py-sm rounded-lg text-body-md font-bold uppercase transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
