"use client";

/**
 * "Siêu Tốc Cào Dữ Liệu" cho Threads — tab Threads của "Seeding bên ngoài".
 *
 * Tương tự ApiExtensionLauncher (Facebook) nhưng Threads không có "group": người dùng
 * nhập danh sách TỪ KHOÁ, extension "Threads API Crawler" (extensions/api-threads-get-extension)
 * mở trang tìm kiếm threads.com cho từng từ khoá, gom bài rồi gửi lên backend
 * (/api/all-platform/extension/threads/save-posts) để lọc trùng/bài cũ và lưu.
 *
 * Giao tiếp với extension qua window.postMessage, mọi message có tiền tố THREADS_API_
 * (không đụng message API_* của extension Facebook khi cài cả 2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authService } from "@/services/all-platform.service";
import { API_BASE_URL } from "@/lib/env";

interface ThreadsExtensionLauncherProps {
  /** Gọi khi extension báo đã lưu xong 1 từ khoá hoặc hoàn tất — để feed tải lại. */
  onSaved?: () => void;
  onComplete?: (totalSaved: number) => void;
}

const KEYWORDS_STORAGE_KEY = "markee.threadsCrawl.keywords";

const MAX_AGE_OPTIONS = [
  { value: "1", label: "24 giờ qua" },
  { value: "3", label: "3 ngày qua" },
  { value: "7", label: "7 ngày qua" },
  { value: "30", label: "30 ngày qua" },
  { value: "", label: "Không giới hạn" },
];

function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw.split(/[,\n]/g).map((s) => s.trim()).filter(Boolean)) {
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out;
}

export function ThreadsExtensionLauncher({ onSaved, onComplete }: ThreadsExtensionLauncherProps) {
  const [extensionReady, setExtensionReady] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ keywordIndex: 0, totalKeywords: 0, keyword: "", found: 0, saved: 0 });

  // Nhớ từ khoá lần trước cho tiện (chỉ là tiện ích theo trình duyệt, lỗi thì bỏ qua).
  // Chỉ modal (render phía client sau khi bấm nút) hiển thị giá trị này nên đọc sẵn
  // lúc khởi tạo không gây lệch hydrate.
  const [keywordsInput, setKeywordsInput] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(KEYWORDS_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [postLimitInput, setPostLimitInput] = useState("20");
  const [maxAgeDays, setMaxAgeDays] = useState("7");
  const [sortRecent, setSortRecent] = useState(true);

  const keywords = useMemo(() => parseKeywords(keywordsInput), [keywordsInput]);
  const postLimit = useMemo(() => {
    const v = Math.floor(Number(postLimitInput));
    return Number.isFinite(v) && v > 0 ? Math.min(v, 100) : null;
  }, [postLimitInput]);

  const onSavedRef = useRef(onSaved);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onSavedRef.current = onSaved;
    onCompleteRef.current = onComplete;
  }, [onSaved, onComplete]);

  const addLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-199), line]);
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
      if (!msg.type.startsWith("THREADS_API_")) return;

      switch (msg.type) {
        case "THREADS_API_PONG":
          if (msg.installed) setExtensionReady(true);
          if (msg.isRunning) setIsRunning(true);
          break;
        case "THREADS_API_LAUNCH_RESULT":
          if (!msg.success) {
            addLog(`❌ Extension từ chối lệnh: ${msg.error || "không phản hồi"}`);
            setIsRunning(false);
          }
          break;
        case "THREADS_API_LOG":
          // Log từ background.js đã có sẵn emoji trạng thái ở đầu dòng.
          addLog(String(msg.message || ""));
          break;
        case "THREADS_API_PROGRESS":
          setProgress((p) => ({
            ...p,
            keywordIndex: typeof msg.keywordIndex === "number" ? msg.keywordIndex : p.keywordIndex,
            totalKeywords: typeof msg.totalKeywords === "number" ? msg.totalKeywords : p.totalKeywords,
            keyword: typeof msg.keyword === "string" ? msg.keyword : p.keyword,
            found: typeof msg.found === "number" ? msg.found : p.found,
          }));
          break;
        case "THREADS_API_SAVED":
          setProgress((p) => ({ ...p, saved: p.saved + (Number(msg.count) || 0) }));
          if (Number(msg.count) > 0) onSavedRef.current?.();
          break;
        case "THREADS_API_DONE":
          setIsRunning(false);
          setIsDone(true);
          onCompleteRef.current?.(Number(msg.totalSaved) || 0);
          break;
        case "THREADS_API_EXTENSION_INVALIDATED":
          addLog("🔄 Extension Threads vừa được cập nhật, đang tải lại trang để kết nối lại...");
          setTimeout(() => window.location.reload(), 1500);
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [addLog]);

  // Hỏi extension có được cài không (bridge.js trả THREADS_API_PONG).
  useEffect(() => {
    if (extensionReady) return;
    let attempts = 0;
    const interval = setInterval(() => {
      if (attempts >= 5) {
        clearInterval(interval);
        return;
      }
      window.postMessage({ type: "THREADS_API_PING" }, "*");
      attempts++;
    }, 1000);
    return () => clearInterval(interval);
  }, [extensionReady]);

  const handleLaunch = useCallback(async () => {
    if (keywords.length === 0 || !postLimit) return;
    setShowModal(false);
    setIsDone(false);
    setLogs([]);
    setProgress({ keywordIndex: 0, totalKeywords: keywords.length, keyword: "", found: 0, saved: 0 });

    if (!extensionReady) {
      addLog("⚠️ Chưa thấy extension Threads API Crawler. Tải + cài extension (nút \"Tải Extension\"), rồi tải lại trang này.");
      return;
    }

    try {
      window.localStorage.setItem(KEYWORDS_STORAGE_KEY, keywordsInput);
    } catch {}

    setIsRunning(true);
    addLog("⏳ Đang lấy thông tin tài khoản...");
    try {
      const meRes = await authService.me();
      const meData = meRes?.data as { id?: string; user?: { id?: string } } | undefined;
      const idMember = meData?.id || meData?.user?.id || "";
      if (!idMember) {
        addLog("⚠️ Không lấy được thông tin người dùng. Vui lòng đăng nhập lại.");
        setIsRunning(false);
        return;
      }

      const apiBase = /^https?:\/\//i.test(API_BASE_URL) ? API_BASE_URL : window.location.origin;
      window.postMessage(
        {
          type: "THREADS_API_LAUNCH",
          data: {
            keywords,
            config: {
              idMember,
              apiBase,
              postLimit,
              maxAgeDays: maxAgeDays ? Number(maxAgeDays) : null,
              sortRecent,
            },
          },
        },
        "*",
      );
      addLog(`🚀 Đã gửi lệnh tìm ${keywords.length} từ khoá cho extension, tab Threads sẽ tự mở...`);
    } catch (err) {
      addLog(`❌ Lỗi: ${err instanceof Error ? err.message : "Không rõ"}`);
      setIsRunning(false);
    }
  }, [keywords, keywordsInput, postLimit, maxAgeDays, sortRecent, extensionReady, addLog]);

  const handleStop = useCallback(() => {
    window.postMessage({ type: "THREADS_API_STOP" }, "*");
    addLog("⏹ Đã gửi lệnh dừng...");
  }, [addLog]);

  const progressPercent =
    progress.totalKeywords > 0
      ? Math.min(100, ((isDone ? progress.totalKeywords : progress.keywordIndex + 1) / progress.totalKeywords) * 100)
      : 0;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col w-full mb-6 relative">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-muted">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center shrink-0 border border-neutral-300/60">
            <span className="text-lg font-black text-neutral-900">@</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground text-sm leading-tight">Siêu Tốc Cào Dữ Liệu Threads (API Extension)</h3>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              {isRunning
                ? `Đang tìm từ khoá ${Math.min(progress.keywordIndex + 1, progress.totalKeywords)}/${progress.totalKeywords}${progress.keyword ? `: "${progress.keyword}"` : ""}...`
                : extensionReady
                  ? "Nhập từ khoá, extension tự tìm bài trên Threads và lưu về đây."
                  : "Cần cài extension Threads API Crawler để dùng tính năng này."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api-threads-get-extension.zip"
            download
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-300 bg-card hover:bg-muted text-foreground text-xs font-bold transition cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Tải Extension
          </a>
          {isRunning ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">stop_circle</span>
              Dừng lại
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 text-xs font-bold transition-all shadow-sm active:scale-[0.98] flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">play_circle</span>
              {isDone ? "Cào lại" : "Nút: Siêu Tốc Cào Threads"}
            </button>
          )}
        </div>
      </div>

      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-bold text-foreground text-lg">Tìm bài viết trên Threads</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {keywords.length > 0 ? `${keywords.length} từ khoá` : "Chưa có từ khoá nào"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Đóng"
                className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="threads-keywords" className="text-xs font-bold text-foreground">
                  Từ khoá tìm kiếm <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="threads-keywords"
                  rows={4}
                  placeholder={"Mỗi dòng 1 từ khoá (hoặc cách nhau bởi dấu phẩy)\nVí dụ: cần tìm agency marketing, thuê seeding"}
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="threads-post-limit" className="text-xs font-bold text-foreground">
                    Số bài tối đa / từ khoá
                  </label>
                  <input
                    id="threads-post-limit"
                    type="number"
                    min={1}
                    max={100}
                    value={postLimitInput}
                    onChange={(e) => setPostLimitInput(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="threads-max-age" className="text-xs font-bold text-foreground">
                    Chỉ lấy bài đăng trong
                  </label>
                  <select
                    id="threads-max-age"
                    value={maxAgeDays}
                    onChange={(e) => setMaxAgeDays(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  >
                    {MAX_AGE_OPTIONS.map((o) => (
                      <option key={o.label} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={sortRecent}
                  onChange={(e) => setSortRecent(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Ưu tiên bài mới nhất (tab &quot;Gần đây&quot; của Threads)
                  <span className="block text-xs text-muted-foreground">
                    Cần đăng nhập threads.com trên Chrome. Chưa đăng nhập thì mỗi từ khoá chỉ lấy được ~20 bài nổi bật đầu tiên.
                  </span>
                </span>
              </label>

              <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                Bài trùng (đã lưu trước đó) và bài cũ hơn khoảng thời gian đã chọn sẽ tự bỏ qua. Bài nhiều tương tác được ưu tiên.
              </p>
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 rounded-xl font-bold text-sm text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleLaunch()}
                disabled={keywords.length === 0 || !postLimit}
                className="px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-neutral-900 hover:bg-neutral-800 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">travel_explore</span>
                Bắt đầu tìm ({keywords.length} từ khoá)
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {(isRunning || isDone || logs.length > 0) && (
        <div className="border-t border-border bg-card p-4">
          {(isRunning || isDone) && (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-muted rounded-xl p-3 text-center border border-border">
                  <div className="text-xl font-bold text-foreground">
                    {progress.totalKeywords > 0
                      ? `${isDone ? progress.totalKeywords : Math.min(progress.keywordIndex + 1, progress.totalKeywords)}/${progress.totalKeywords}`
                      : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">Từ khoá</div>
                </div>
                <div className="bg-muted rounded-xl p-3 text-center border border-border">
                  <div className="text-xl font-bold text-foreground">{progress.found}</div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">Bài tìm thấy</div>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
                  <div className="text-xl font-bold text-emerald-700">{progress.saved}</div>
                  <div className="text-[10px] text-emerald-600 font-medium mt-0.5">Bài mới đã lưu</div>
                </div>
              </div>
              <div className="mb-4 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-neutral-900 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </>
          )}
          {logs.length > 0 && (
            <div className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] text-slate-200 max-h-[180px] overflow-y-auto">
              {logs.slice(-12).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
          {isDone && !isRunning && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsDone(false);
                  setLogs([]);
                }}
                className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-bold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
