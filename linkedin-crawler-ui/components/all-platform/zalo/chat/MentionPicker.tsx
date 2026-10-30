"use client";

/**
 * Popup "gõ @ để tag" — hiện ngay TRÊN khung soạn tin (giống hành vi Zalo
 * thật): hàng đầu "Báo cho cả nhóm · @All", sau đó là danh sách thành viên
 * nhóm (avatar + tên), lọc dần theo phần đang gõ sau "@".
 *
 * Component THUẦN HIỂN THỊ — toàn bộ logic mở/đóng, lọc theo query, gõ phím
 * mũi tên nằm ở ZaloChatPanel (nơi giữ state ô soạn tin); ở đây chỉ nhận
 * `activeIndex` để tô sáng đúng hàng và bắn `onSelectAll`/`onSelectMember`
 * khi người dùng bấm chọn.
 */

import { useEffect, useRef } from "react";
import { Loader2, Users } from "lucide-react";
import { Avatar } from "./Avatar";
import { ALL_MENTION_TOKEN, filterMentionCandidates, matchesAllMention, type MentionCandidate } from "@/lib/mentionUtils";

type Props = {
  query: string;
  members: MentionCandidate[];
  loading: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelectAll: () => void;
  onSelectMember: (member: MentionCandidate) => void;
};

const POPUP_BASE = "absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-[#e6eaef] bg-white shadow-lg";

export function MentionPicker({
  query,
  members,
  loading,
  activeIndex,
  onActiveIndexChange,
  onSelectAll,
  onSelectMember,
}: Props) {
  const showAll = matchesAllMention(query);
  const filteredMembers = filterMentionCandidates(members, query);
  const rowCount = (showAll ? 1 : 0) + filteredMembers.length;
  const listRef = useRef<HTMLDivElement>(null);

  // Cuộn theo hàng đang tô sáng khi điều hướng bằng phím mũi tên.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (loading && members.length === 0) {
    return (
      <div className={`${POPUP_BASE} p-4 text-center text-xs text-[#6b7a8d]`}>
        <Loader2 className="mx-auto mb-1.5 h-4 w-4 animate-spin" />
        Đang tải danh sách thành viên...
      </div>
    );
  }

  if (rowCount === 0) {
    return <div className={`${POPUP_BASE} p-4 text-center text-xs text-[#8a9aa8]`}>Không tìm thấy thành viên phù hợp</div>;
  }

  return (
    <div ref={listRef} className={`${POPUP_BASE} max-h-72 overflow-y-auto py-1.5`}>
      {showAll ? (
        <button
          type="button"
          data-idx={0}
          onMouseDown={(e) => e.preventDefault() /* giữ focus + selection trong textarea */}
          onMouseEnter={() => onActiveIndexChange(0)}
          onClick={onSelectAll}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${activeIndex === 0 ? "bg-[#f1f4f8]" : ""}`}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0068ff] text-white">
            <Users className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-[#0a1a2b]">Báo cho cả nhóm</span>
          <span className="shrink-0 text-xs text-[#0068ff]">{ALL_MENTION_TOKEN}</span>
        </button>
      ) : null}
      {filteredMembers.map((member, i) => {
        const idx = showAll ? i + 1 : i;
        return (
          <button
            key={member.uid}
            type="button"
            data-idx={idx}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActiveIndexChange(idx)}
            onClick={() => onSelectMember(member)}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${activeIndex === idx ? "bg-[#f1f4f8]" : ""}`}
          >
            <Avatar src={member.avatar} name={member.display_name || "?"} className="h-9 w-9 shrink-0 text-sm" />
            <span className="min-w-0 flex-1 truncate text-sm text-[#0a1a2b]">{member.display_name || member.uid}</span>
          </button>
        );
      })}
    </div>
  );
}
