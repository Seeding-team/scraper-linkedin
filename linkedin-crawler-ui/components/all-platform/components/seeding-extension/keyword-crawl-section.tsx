"use client";

/**
 * Cào bài theo TỪ KHOÁ (tab "Cào bài viết" của SeedingExtensionPanel khi chọn Threads/YouTube).
 *
 * Threads/YouTube không có "group" như Facebook/LinkedIn: người dùng nhập từ khoá, Markee Seeding
 * Extension mở trang tìm kiếm cho từng từ khoá, gom bài rồi gửi lên backend — backend lọc bài trùng,
 * bài cũ hơn khoảng thời gian đã chọn, ưu tiên bài nhiều tương tác.
 * - Threads: lệnh MK_TH_CRAWL_* (bg/threads-crawl.js) -> /extension/threads/save-posts.
 * - YouTube: lệnh MK_YT_CRAWL_* (bg/youtube-crawl.js) -> /extension/youtube/save-videos. Dòng nào là
 *   LINK video thì extension mở thẳng video đó, lưu luôn (không lọc theo thời gian/số lượng).
 */

import { useMemo, useState } from "react";
import { ExternalLink, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  THREADS_CRAWL_EXTENSION_VERSION,
  YOUTUBE_EXTENSION_VERSION,
  type CrawlRuntime,
  type KeywordPlatform,
  type LiveCrawlPost,
} from "./use-seeding-extension";

interface KeywordCrawlSectionProps {
  platform: KeywordPlatform;
  isReady: boolean;
  /** Extension đã kết nối nhưng là bản chưa có lệnh cào của nền tảng này. */
  needsUpdate: boolean;
  runtime: CrawlRuntime;
  onStart: (keywords: string[], config: Record<string, unknown>) => void;
  onStop: () => void;
  onReset: () => void;
}

const COPY: Record<KeywordPlatform, {
  storageKey: string;
  label: string;
  placeholder: string;
  sortLabel: string;
  hint: string;
  version: string;
  unit: string;
}> = {
  threads: {
    storageKey: "markee.threadsCrawl.keywords",
    label: "Từ khoá tìm kiếm trên Threads",
    placeholder: "Mỗi dòng 1 từ khoá (hoặc cách nhau bởi dấu phẩy)\nVD: thuê seeding, cần agency marketing",
    sortLabel: "Ưu tiên bài mới nhất (tab \"Gần đây\" của Threads)",
    hint: "Extension mở 1 tab Threads, tìm từng từ khoá bằng tài khoản Threads đang đăng nhập trình duyệt, vừa cuộn đọc giao diện vừa bắt request API của Threads để lấy bài (hiện ngay bên dưới), rồi tự lưu về hệ thống. Chưa đăng nhập threads.com thì mỗi từ khoá chỉ lấy được ~20 bài nổi bật (thường là bài cũ). Bài trùng và bài cũ hơn khoảng thời gian đã chọn sẽ tự bỏ qua.",
    version: THREADS_CRAWL_EXTENSION_VERSION,
    unit: "bài",
  },
  youtube: {
    storageKey: "markee.youtubeCrawl.keywords",
    label: "Từ khoá hoặc link video YouTube",
    placeholder: "Mỗi dòng 1 từ khoá hoặc 1 link video\nVD: review phần mềm CRM\nhttps://www.youtube.com/watch?v=xxxxxxxxxxx",
    sortLabel: "Ưu tiên video mới tải lên (sắp xếp theo ngày tải lên)",
    hint: "Extension mở 1 tab YouTube, tìm từng từ khoá rồi tự lưu video về hệ thống (link video chuẩn youtube.com/watch?v=... hoặc /shorts/...). Dòng là link video thì mở thẳng video đó và lưu luôn, không lọc theo thời gian. Video đã có sẽ tự bỏ qua.",
    version: YOUTUBE_EXTENSION_VERSION,
    unit: "video",
  },
};

const MAX_AGE_OPTIONS = [
  { value: "1", label: "24 giờ qua" },
  { value: "3", label: "3 ngày qua" },
  { value: "7", label: "7 ngày qua" },
  { value: "30", label: "30 ngày qua" },
  { value: "", label: "Không giới hạn" },
];

const LOG_COLOR: Record<string, string> = {
  success: "text-emerald-300",
  error: "text-red-300",
  warn: "text-amber-300",
  info: "text-slate-200",
};

const YOUTUBE_LINK_RE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)/i;

function parseKeywords(input: string, platform: KeywordPlatform): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Link YouTube có thể chứa dấu phẩy trong tham số -> với YouTube chỉ tách theo dòng khi dòng là link.
  const lines = input.split("\n").flatMap((line) =>
    platform === "youtube" && YOUTUBE_LINK_RE.test(line.trim()) ? [line] : line.split(","),
  );
  for (const k of lines.map((s) => s.trim()).filter(Boolean)) {
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

export function KeywordCrawlSection({ platform, isReady, needsUpdate, runtime, onStart, onStop, onReset }: KeywordCrawlSectionProps) {
  const { user } = useAppAuth();
  const copy = COPY[platform];
  const idPrefix = `${platform}-crawl`;
  // Nhớ từ khoá lần trước cho tiện (chỉ là tiện ích theo trình duyệt, lỗi thì bỏ qua).
  // Section này chỉ render phía client sau khi mở tab "Cào bài viết" nên đọc sẵn lúc
  // khởi tạo không gây lệch hydrate.
  const [keywordsInput, setKeywordsInput] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(copy.storageKey) || "";
    } catch {
      return "";
    }
  });
  const [limitInput, setLimitInput] = useState("20");
  const [maxAgeDays, setMaxAgeDays] = useState("7");
  const [sortRecent, setSortRecent] = useState(true);

  const keywords = useMemo(() => parseKeywords(keywordsInput, platform), [keywordsInput, platform]);
  const linkCount = useMemo(
    () => (platform === "youtube" ? keywords.filter((k) => YOUTUBE_LINK_RE.test(k)).length : 0),
    [keywords, platform],
  );
  const limit = useMemo(() => {
    const v = Math.floor(Number(limitInput));
    return Number.isFinite(v) && v > 0 ? Math.min(v, 100) : null;
  }, [limitInput]);

  const canStart = isReady && !needsUpdate && !runtime.running && keywords.length > 0 && !!limit && !!user?.id;

  const handleStart = () => {
    if (!canStart || !user?.id || !limit) return;
    try {
      window.localStorage.setItem(copy.storageKey, keywordsInput);
    } catch {}
    onStart(keywords, {
      idMember: user.id,
      postLimit: limit,
      maxAgeDays: maxAgeDays ? Number(maxAgeDays) : null,
      sortRecent,
    });
  };

  const progressPct =
    runtime.totalGroups > 0 ? Math.min(100, Math.round(((runtime.groupIndex + (runtime.done ? 1 : 0)) / runtime.totalGroups) * 100)) : 0;

  const countLabel = platform === "youtube" && linkCount > 0
    ? `${keywords.length - linkCount} từ khoá, ${linkCount} link`
    : `${keywords.length}`;

  return (
    <div className="flex flex-col gap-4">
      {needsUpdate ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Extension bạn đang cài chưa có chức năng này. Tải bản {copy.version} ở nút &quot;Tải Extension&quot;,
          giải nén đè lên thư mục cũ, vào chrome://extensions bấm reload (vòng tròn) trên Markee Seeding Extension rồi F5 lại trang này.
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 flex flex-col gap-2 min-w-0">
          <label htmlFor={`${idPrefix}-keywords`} className="text-sm font-bold text-foreground">
            {copy.label} ({countLabel}) <span className="text-red-500">*</span>
          </label>
          <textarea
            id={`${idPrefix}-keywords`}
            rows={6}
            value={keywordsInput}
            onChange={(e) => setKeywordsInput(e.target.value)}
            disabled={runtime.running}
            placeholder={copy.placeholder}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
          />
        </div>

        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idPrefix}-post-limit`} className="text-xs font-bold text-foreground">Số {copy.unit} tối đa / từ khoá</label>
              <input
                id={`${idPrefix}-post-limit`}
                type="number"
                min={1}
                max={100}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                disabled={runtime.running}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idPrefix}-max-age`} className="text-xs font-bold text-foreground">Chỉ lấy {copy.unit} đăng trong</label>
              <select
                id={`${idPrefix}-max-age`}
                value={maxAgeDays}
                onChange={(e) => setMaxAgeDays(e.target.value)}
                disabled={runtime.running}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
              >
                {MAX_AGE_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={sortRecent}
              onChange={(e) => setSortRecent(e.target.checked)}
              disabled={runtime.running}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span>{copy.sortLabel}</span>
          </label>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{copy.hint}</p>
          <div className="flex items-center gap-2 mt-auto">
            {runtime.running ? (
              <button type="button" onClick={onStop} className="flex-1 px-4 py-2 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-sm font-bold">
                Dừng cào
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={!canStart}
                className="flex-1 px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {linkCount > 0 ? `Bắt đầu (${countLabel})` : `Bắt đầu tìm (${keywords.length} từ khoá)`}
              </button>
            )}
            {runtime.done && !runtime.running ? (
              <button type="button" onClick={onReset} className="px-3 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted">
                Xoá log
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {runtime.running || runtime.done || runtime.logs.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Từ khoá" value={runtime.totalGroups > 0 ? `${Math.min(runtime.groupIndex + 1, runtime.totalGroups)}/${runtime.totalGroups}` : "—"} />
            <Stat label={`${copy.unit === "bài" ? "Bài" : "Video"} tìm thấy`} value={String(runtime.posts)} />
            <Stat label="Đã lưu mới" value={String(runtime.saved)} highlight />
          </div>
          {runtime.totalGroups > 0 ? (
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          ) : null}
          <div className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] max-h-[180px] overflow-y-auto">
            {runtime.logs.slice(-40).map((line, i) => (
              <div key={`${line.at}-${i}`} className={LOG_COLOR[line.level] || LOG_COLOR.info}>
                {line.message}
              </div>
            ))}
          </div>
          {runtime.livePosts.length > 0 ? <LivePostList posts={runtime.livePosts} /> : null}
        </div>
      ) : null}
    </div>
  );
}

const SOURCE_BADGE: Record<string, { label: string; title: string; className: string }> = {
  api: { label: "API", title: "Bắt từ request GraphQL trang tự gọi khi cuộn", className: "bg-violet-50 text-violet-700 border-violet-200" },
  embedded: { label: "JSON", title: "Dữ liệu JSON nhúng sẵn trong trang", className: "bg-sky-50 text-sky-700 border-sky-200" },
  dom: { label: "DOM", title: "Đọc từ giao diện trang", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

const SOURCE_FILTERS = [
  { value: "", label: "Tất cả" },
  { value: "api", label: "API" },
  { value: "embedded", label: "JSON" },
  { value: "dom", label: "Chỉ DOM" },
];

function formatPostTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

/** Danh sách bài extension đang gom được (cập nhật realtime trong lúc cào, trước cả khi lưu hệ thống). */
function LivePostList({ posts }: { posts: LiveCrawlPost[] }) {
  const [sourceFilter, setSourceFilter] = useState("");
  const shown = useMemo(() => {
    if (!sourceFilter) return posts;
    // "Chỉ DOM": bài mà API/JSON không có, chỉ đọc được từ giao diện (số tương tác là ước lượng).
    if (sourceFilter === "dom") return posts.filter((p) => p.sources.length > 0 && p.sources.every((s) => s === "dom"));
    return posts.filter((p) => p.sources.includes(sourceFilter));
  }, [posts, sourceFilter]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-foreground">
          Bài vừa tìm thấy <span className="text-muted-foreground font-medium">({posts.length})</span>
        </div>
        <div className="flex items-center gap-1">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setSourceFilter(f.value)}
              className={cn(
                "px-2 py-0.5 rounded-md border text-[11px] font-semibold",
                sourceFilter === f.value ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Danh sách tạm trong lúc cào, chưa lọc. Hệ thống sẽ bỏ bài trùng và bài quá cũ khi lưu.
      </p>
      <div className="rounded-xl border border-border divide-y divide-border max-h-[420px] overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">Không có bài nào khớp bộ lọc.</div>
        ) : (
          shown.map((post) => (
            <div key={post.post_url} className="p-3 flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-bold text-foreground truncate max-w-[200px]">{post.author_name || post.author_username}</span>
                <span className="text-muted-foreground truncate">@{post.author_username}</span>
                {post.post_time ? <span className="text-muted-foreground">· {formatPostTime(post.post_time)}</span> : null}
                {post.keyword ? (
                  <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold text-muted-foreground truncate max-w-[160px]">{post.keyword}</span>
                ) : null}
                <span className="ml-auto flex items-center gap-1">
                  {post.sources.map((s) =>
                    SOURCE_BADGE[s] ? (
                      <span key={s} title={SOURCE_BADGE[s].title} className={cn("px-1.5 py-0.5 rounded border text-[10px] font-bold", SOURCE_BADGE[s].className)}>
                        {SOURCE_BADGE[s].label}
                      </span>
                    ) : null,
                  )}
                </span>
              </div>
              {post.content ? (
                <p className="text-xs text-foreground leading-relaxed line-clamp-3 whitespace-pre-line break-words">{post.content}</p>
              ) : null}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{post.reactions.toLocaleString("vi-VN")}</span>
                <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{post.comments.toLocaleString("vi-VN")}</span>
                <span className="flex items-center gap-1"><Repeat2 className="h-3.5 w-3.5" />{post.shares.toLocaleString("vi-VN")}</span>
                {post.image_urls.length > 0 ? <span>{post.image_urls.length} ảnh</span> : null}
                <a
                  href={post.post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer transition"
                >
                  Mở bài <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl p-2.5 text-center border", highlight ? "bg-emerald-50 border-emerald-100" : "bg-muted/50 border-border")}>
      <div className={cn("text-lg font-bold", highlight ? "text-emerald-700" : "text-foreground")}>{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
    </div>
  );
}
