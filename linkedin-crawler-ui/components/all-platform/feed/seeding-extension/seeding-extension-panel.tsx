"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { UnifiedPost } from "@/types/unified.types";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { CrawlSection } from "./crawl-section";
import { CommentSection } from "./comment-section";
import { KeywordCrawlSection } from "./keyword-crawl-section";
import { YouTubeChannelSection } from "./youtube-channel-section";
import {
  REQUIRED_EXTENSION_VERSION,
  useBulkCommentRuntime,
  useExtensionCrawl,
  useSeedingExtensionStatus,
  type ExtensionPlatform,
} from "./use-seeding-extension";

interface SeedingExtensionPanelProps {
  platform: ExtensionPlatform;
  posts: UnifiedPost[];
  onCrawlSaved?: (platform: ExtensionPlatform, data: { count: number; groupUrl: string; groupId: string }) => void;
  onCrawlDone?: (platform: ExtensionPlatform, data: { totalSaved: number; stopped: boolean }) => void;
  onCommentDone?: (seededUrls: string[]) => void;
  /** Yêu cầu từ ngoài mở 1 tab của panel (vd "channel" khi chưa liên kết kênh YouTube); đổi nonce để mở lại. */
  focusRequest?: { tab: PanelTab; nonce: number } | null;
}

export type PanelTab = "crawl" | "comment" | "channel";

const OLD_EXTENSIONS = "FB API Crawler, LinkedIn Group Post Crawler, Bulk Comment Extension (bản cũ)";

const PLATFORM_LABEL: Record<ExtensionPlatform, string> = { facebook: "Facebook", linkedin: "LinkedIn", threads: "Threads", youtube: "YouTube" };

const PLATFORM_DESCRIPTION: Record<ExtensionPlatform, string> = {
  facebook: "1 extension duy nhất: cào bài viết và bình luận hàng loạt cho Facebook & LinkedIn, chạy ngầm trên trình duyệt.",
  linkedin: "1 extension duy nhất: cào bài viết và bình luận hàng loạt cho Facebook & LinkedIn, chạy ngầm trên trình duyệt.",
  threads: "1 extension duy nhất: tìm bài Threads theo từ khoá và lưu về hệ thống, chạy ngầm trên trình duyệt.",
  youtube: "1 extension duy nhất: tìm video YouTube theo từ khoá/link, liên kết kênh YouTube và điền sẵn comment để tính KPI.",
};

/** Feature extension cần có cho từng nền tảng tìm theo từ khoá (bridge.js MK_EXTENSION_INFO.features). */
const KEYWORD_FEATURE = { threads: "th_crawl", youtube: "yt_crawl" } as const;

export function SeedingExtensionPanel({ platform, posts, onCrawlSaved, onCrawlDone, onCommentDone, focusRequest }: SeedingExtensionPanelProps) {
  const { user } = useAppAuth();
  const [tab, setTab] = useState<PanelTab | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [appliedFocusNonce, setAppliedFocusNonce] = useState<number | null>(null);

  // Áp yêu cầu mở tab ngay trong lúc render (đổi state theo prop, không cần effect).
  if (focusRequest && focusRequest.nonce !== appliedFocusNonce) {
    setAppliedFocusNonce(focusRequest.nonce);
    setTab(focusRequest.tab);
  }

  useEffect(() => {
    if (focusRequest) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusRequest]);
  const { status, version, features, isReady } = useSeedingExtensionStatus();
  const crawl = useExtensionCrawl({ onSaved: onCrawlSaved, onDone: onCrawlDone });
  const comment = useBulkCommentRuntime({ isReady, email: user?.email, onComplete: onCommentDone });

  const platformLabel = PLATFORM_LABEL[platform];
  const isKeywordPlatform = platform === "threads" || platform === "youtube";
  const runtime = crawl.runtime[platform];
  const otherRunning = (Object.keys(PLATFORM_LABEL) as ExtensionPlatform[]).find((p) => p !== platform && crawl.runtime[p].running);
  // Threads/YouTube không có bình luận hàng loạt từ trang này (YouTube comment từng video, từ thẻ bài).
  // Tab đang mở của nền tảng trước có thể không tồn tại ở nền tảng này -> rơi về "crawl".
  const tabAllowed = (t: PanelTab) =>
    t === "crawl" || (t === "comment" && !isKeywordPlatform) || (t === "channel" && platform === "youtube");
  const openTab = tab && !tabAllowed(tab)
    ? "crawl"
    : tab ?? (runtime.running ? "crawl" : !isKeywordPlatform && comment.isCommenting ? "comment" : null);
  const needsUpdate = isKeywordPlatform && isReady && !features.includes(KEYWORD_FEATURE[platform]);

  const tabs: { key: PanelTab; label: string; icon: string; busy: boolean }[] = [
    { key: "crawl", label: platform === "youtube" ? "Tìm video" : isKeywordPlatform ? "Tìm bài theo từ khoá" : "Cào bài viết", icon: "travel_explore", busy: runtime.running },
    ...(isKeywordPlatform ? [] : [{ key: "comment" as const, label: "Bình luận hàng loạt", icon: "forum", busy: comment.isCommenting }]),
    ...(platform === "youtube" ? [{ key: "channel" as const, label: "Kênh YouTube của bạn", icon: "account_circle", busy: false }] : []),
  ];

  return (
    <div ref={panelRef} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden w-full scroll-mt-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-muted/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <span className="material-symbols-outlined text-primary text-[22px]">extension</span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-foreground text-sm leading-tight">Markee Seeding Extension · {platformLabel}</h3>
              <StatusChip status={status} version={version} />
            </div>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">{PLATFORM_DESCRIPTION[platform]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/comment-extension.zip"
            download
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted text-foreground text-xs font-bold"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Tải Extension
          </a>
        </div>
      </div>

      {status === "outdated" || status === "missing" || status === "invalidated" ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          {status === "outdated"
            ? `Bạn đang dùng extension bình luận bản cũ — chưa có chức năng cào. Tải bản ${REQUIRED_EXTENSION_VERSION} ở nút "Tải Extension", giải nén, vào chrome://extensions bấm "Load unpacked" chọn thư mục vừa giải nén rồi F5 lại trang này.`
            : status === "invalidated"
              ? "Extension vừa được cập nhật/cài lại — hãy F5 lại trang này để kết nối lại."
              : `Chưa phát hiện Markee Seeding Extension. Tải ở nút "Tải Extension", giải nén, vào chrome://extensions bật Developer mode → "Load unpacked" chọn thư mục vừa giải nén rồi F5 lại trang này.`}
          <div className="mt-1 font-semibold">
            Lưu ý: gỡ các extension cũ ({OLD_EXTENSIONS}) để tránh 2 extension cùng chạy 1 lệnh.
          </div>
        </div>
      ) : null}

      <div className="flex gap-1 px-4 pt-3 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(openTab === t.key ? null : t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 -mb-px border-b-2 text-sm font-bold transition-colors",
              openTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
            {t.busy ? <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-label="đang chạy" /> : null}
          </button>
        ))}
        {otherRunning && !runtime.running ? (
          <span className="ml-auto self-center text-[11px] text-muted-foreground">
            Đang cào {PLATFORM_LABEL[otherRunning]} ở tab nền tảng khác
          </span>
        ) : null}
      </div>

      {openTab ? (
        <div className="p-4">
          {openTab === "channel" && platform === "youtube" ? (
            <YouTubeChannelSection isReady={isReady} needsUpdate={needsUpdate} />
          ) : openTab === "crawl" && isKeywordPlatform ? (
            <KeywordCrawlSection
              key={platform}
              platform={platform}
              isReady={isReady}
              needsUpdate={needsUpdate}
              runtime={runtime}
              onStart={(keywords, config) => crawl.startKeywords(keywords, config, platform)}
              onStop={() => crawl.stop(platform)}
              onReset={() => crawl.reset(platform)}
            />
          ) : isKeywordPlatform ? null : openTab === "crawl" ? (
            <CrawlSection
              key={platform}
              platform={platform}
              isReady={isReady}
              runtime={runtime}
              onStart={(groups, config) => crawl.start(platform, groups, config)}
              onStop={() => crawl.stop(platform)}
              onReset={() => crawl.reset(platform)}
            />
          ) : (
            <CommentSection
              key={platform}
              platform={platform}
              posts={posts}
              isReady={isReady}
              isCommenting={comment.isCommenting}
              progress={comment.progress}
              stopping={comment.stopping}
              lastError={comment.lastError}
              onStart={comment.start}
              onStop={comment.stop}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusChip({ status, version }: { status: string; version: string }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
        <span className="material-symbols-outlined text-[12px]">check_circle</span>
        Đã kết nối{version ? ` · v${version}` : ""}
      </span>
    );
  }
  if (status === "checking") {
    return <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold border border-border">Đang kiểm tra...</span>;
  }
  return (
    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200">
      {status === "outdated" ? "Bản cũ — cần cập nhật" : status === "invalidated" ? "Cần F5 lại trang" : "Chưa cài extension"}
    </span>
  );
}
