"use client";

import { useState, useEffect, useCallback } from "react";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  linkedInAccountService,
  linkedInCrawlService,
  allPlatformGroupsService,
  type LinkedInAccount,
  type LinkedInCrawlResult,
} from "@/services/all-platform.service";

// ── Types ───────────────────────────────────────────────────────────────────

interface LinkedInGroup {
  id: string;
  group_name?: string;
  group_url: string;
  status?: string;
  intent_name?: string;
}

interface CrawlLinkedInPopupProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// ── Step indicator ─────────────────────────────────────────────────────────

function StepDot({ step, active, done }: { step: number; active: boolean; done: boolean }) {
  return (
    <div
      className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-all duration-300",
        done
          ? "bg-emerald-500 border-emerald-500 text-white"
          : active
            ? "bg-primary border-primary text-white scale-110 shadow-md"
            : "bg-surface border-outline-variant text-on-surface-variant"
      )}
    >
      {done ? <MaterialIcon name="check" className="text-[14px]" /> : step}
    </div>
  );
}

// ── Group card ─────────────────────────────────────────────────────────────

function GroupCard({
  group,
  selected,
  onToggle,
}: {
  group: LinkedInGroup;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full text-left px-4 py-3 rounded-xl border transition-all duration-150 flex items-start gap-3 cursor-pointer",
        selected
          ? "bg-primary/10 border-primary/20 shadow-sm"
          : "bg-surface border-outline-variant hover:border-primary/30 hover:bg-surface-container-low/30"
      )}
    >
      <div
        className={cn(
          "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
          selected ? "bg-primary border-primary" : "border-outline-variant"
        )}
      >
        {selected && <MaterialIcon name="check" className="text-white text-[12px]" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-on-surface truncate">
          {group.group_name || "Nhóm chưa đặt tên"}
        </p>
        <p className="text-[10px] text-on-surface-variant font-mono truncate mt-0.5">{group.group_url}</p>
        {group.intent_name && (
          <span className="mt-1 inline-block bg-primary/10 text-primary text-[9px] font-bold px-2 py-0.5 rounded-full border border-primary/20">
            {group.intent_name}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Result summary ─────────────────────────────────────────────────────────

function ResultSummary({ result, message }: { result: LinkedInCrawlResult; message: string }) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <MaterialIcon name="check_circle" className="text-emerald-500 text-4xl" />
        </div>
        <p className="text-sm font-bold text-on-surface">{message}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface-container-low rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-primary">{result.total_sessions_saved}</p>
          <p className="text-[10px] text-on-surface-variant font-semibold uppercase mt-0.5">
            Nhóm đã lưu
          </p>
        </div>
        <div className="bg-surface-container-low rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-emerald-600">{result.total_posts_saved}</p>
          <p className="text-[10px] text-on-surface-variant font-semibold uppercase mt-0.5">
            Bài viết đã lưu
          </p>
        </div>
      </div>

      {result.groups_results && result.groups_results.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {result.groups_results.map((g, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
                g.success
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-700"
              )}
            >
              <MaterialIcon
                name={g.success ? "check_circle" : "error"}
                className="text-[14px] shrink-0"
              />
              <span className="truncate flex-1 font-mono text-[10px]">{g.group_url}</span>
              {g.success ? (
                <span className="font-bold shrink-0">{g.posts_count} bài</span>
              ) : (
                <span className="shrink-0 font-semibold">Lỗi</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function CrawlLinkedInPopup({ open, onClose, onSuccess }: CrawlLinkedInPopupProps) {
  const [step, setStep] = useState(1); // 1 = select account, 2 = select groups, 3 = result

  // Accounts
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>("");

  // Groups
  const [groups, setGroups] = useState<LinkedInGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState("");

  // Crawl
  const [crawling, setCrawling] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawlResult, setCrawlResult] = useState<LinkedInCrawlResult | null>(null);
  const [crawlMessage, setCrawlMessage] = useState("");

  // Date
  const today = new Date().toISOString().split("T")[0];
  const [targetDate, setTargetDate] = useState(today);

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await linkedInAccountService.getAll();
      if (res.success && Array.isArray(res.data)) {
        setAccounts(res.data);
      }
    } catch {
      // ignore
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const res = await allPlatformGroupsService.getAll("linkedin");
      if (res.success && Array.isArray(res.data)) {
        setGroups(res.data as LinkedInGroup[]);
      }
    } catch {
      // ignore
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedAccount("");
      setSelectedGroups(new Set());
      setGroupSearch("");
      setCrawlError(null);
      setCrawlResult(null);
      setTargetDate(today);
      void fetchAccounts();
    }
  }, [open, fetchAccounts, today]);

  useEffect(() => {
    if (step === 2 && groups.length === 0) {
      void fetchGroups();
    }
  }, [step, groups.length, fetchGroups]);

  const filteredGroups = groups.filter((g) => {
    const q = groupSearch.toLowerCase();
    return (
      (g.group_name || "").toLowerCase().includes(q) ||
      (g.group_url || "").toLowerCase().includes(q)
    );
  });

  const toggleGroup = (url: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedGroups.size === filteredGroups.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(filteredGroups.map((g) => g.group_url)));
    }
  };

  const handleStartCrawl = async () => {
    if (!selectedAccount) return;
    if (selectedGroups.size === 0) {
      setCrawlError("Vui lòng chọn ít nhất một nhóm");
      return;
    }
    setCrawlError(null);
    setCrawling(true);
    setStep(3);
    try {
      const res = await linkedInCrawlService.crawl({
        email_linkedin: selectedAccount,
        group_urls: Array.from(selectedGroups),
        target_date: targetDate || undefined,
        max_items: 30,
        fallback_recent_count: 20,
      });
      if (res.success && res.data) {
        setCrawlResult(res.data as LinkedInCrawlResult);
        setCrawlMessage(res.message || "Cào dữ liệu thành công!");
      } else {
        setCrawlError(res.message || "Cào dữ liệu thất bại");
      }
    } catch (e) {
      setCrawlError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setCrawling(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]"
      role="presentation"
    >
      {/* Backdrop close */}
      <button
        type="button"
        className="absolute inset-0 w-full h-full cursor-default bg-transparent outline-none"
        aria-label="Đóng"
        onClick={onClose}
      />

      <div
        className="relative z-10 bg-surface rounded-xl border border-outline-variant shadow-2xl w-[90vw] sm:w-[512px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{ maxHeight: "min(92vh, 640px)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crawl-li-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0077B5]/10 flex items-center justify-center">
              <MaterialIcon name="travel_explore" className="text-[#0077B5] text-xl" />
            </div>
            <div>
              <h2 id="crawl-li-title" className="text-sm font-black text-on-surface">
                Cào dữ liệu LinkedIn
              </h2>
              <p className="text-[10px] text-on-surface-variant font-medium">
                Lưu trực tiếp vào Supabase
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg p-1.5 transition cursor-pointer"
            aria-label="Đóng"
          >
            <MaterialIcon name="close" className="text-xl" />
          </button>
        </div>

        {/* Steps indicator */}
        {step < 3 && (
          <div className="flex items-center justify-center gap-3 py-3 px-6 border-b border-outline-variant shrink-0">
            <StepDot step={1} active={step === 1} done={step > 1} />
            <div className={cn("flex-1 h-0.5 rounded-full max-w-[48px] transition-all", step > 1 ? "bg-emerald-400" : "bg-surface-container-highest")} />
            <StepDot step={2} active={step === 2} done={step > 2} />
            <div className={cn("flex-1 h-0.5 rounded-full max-w-[48px] transition-all", step > 2 ? "bg-emerald-400" : "bg-surface-container-highest")} />
            <StepDot step={3} active={step === 3} done={false} />
            <div className="flex flex-col items-center absolute left-1/2 -translate-x-1/2 mt-8 pointer-events-none">
              {/* step labels below – optional, keep UI clean */}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">

          {/* ── STEP 1: Select account ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-black text-on-surface uppercase mb-3">
                  Bước 1 — Chọn tài khoản LinkedIn
                </h3>
                {accountsLoading ? (
                  <div className="flex items-center justify-center py-10 text-on-surface-variant">
                    <div className="w-5 h-5 border-2 border-outline-variant border-t-primary rounded-full animate-spin mr-2" />
                    <span className="text-xs">Đang tải tài khoản...</span>
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                    <MaterialIcon name="warning" className="text-amber-500 text-2xl mx-auto mb-2" />
                    <p className="text-xs font-bold text-amber-800">Chưa có tài khoản LinkedIn nào</p>
                    <p className="text-[10px] text-amber-600 mt-1">
                      Vui lòng thêm tài khoản trong trang{" "}
                      <span className="font-bold">Quản lý tài khoản</span>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => setSelectedAccount(acc.email_linkedin)}
                        className={cn(
                          "w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer",
                          selectedAccount === acc.email_linkedin
                            ? "bg-primary/10 border-primary/20 shadow-sm"
                            : "bg-surface border-outline-variant hover:border-primary/30 hover:bg-surface-container-low/30"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-black shrink-0",
                              selectedAccount === acc.email_linkedin ? "bg-primary" : "bg-[#A0A0A0]"
                            )}
                          >
                            {(acc.email_linkedin[0] || "L").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-on-surface truncate">
                              {acc.email_linkedin}
                            </p>
                            {acc.email_member && (
                              <p className="text-[10px] text-on-surface-variant truncate">
                                Thành viên: {acc.email_member}
                              </p>
                            )}
                          </div>
                          {selectedAccount === acc.email_linkedin && (
                            <MaterialIcon name="check_circle" className="text-primary text-lg ml-auto shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Date picker */}
              {accounts.length > 0 && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                    Ngày mục tiêu
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    max={today}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition"
                  />
                  <p className="text-[10px] text-on-surface-variant">
                    Lấy bài trong ngày này. Nếu không có bài, sẽ lấy 20 bài gần nhất.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Select groups ── */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-on-surface uppercase">
                  Bước 2 — Chọn nhóm cần cào
                </h3>
                {filteredGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[10px] text-primary font-bold hover:underline cursor-pointer"
                  >
                    {selectedGroups.size === filteredGroups.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                  </button>
                )}
              </div>

              {/* Search */}
              <div className="relative">
                <MaterialIcon
                  name="search"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-base pointer-events-none"
                />
                <input
                  type="text"
                  placeholder="Tìm nhóm theo tên hoặc URL..."
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition"
                />
              </div>

              {/* Selected count badge */}
              {selectedGroups.size > 0 && (
                <div className="bg-primary/10 border border-primary/20 rounded-xl px-3 py-2 flex items-center gap-2">
                  <MaterialIcon name="check_circle" className="text-primary text-sm" />
                  <span className="text-xs text-primary font-bold">
                    Đã chọn {selectedGroups.size} nhóm
                  </span>
                </div>
              )}

              {/* Groups list */}
              {groupsLoading ? (
                <div className="flex items-center justify-center py-10 text-on-surface-variant">
                  <div className="w-5 h-5 border-2 border-outline-variant border-t-primary rounded-full animate-spin mr-2" />
                  <span className="text-xs">Đang tải danh sách nhóm...</span>
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="text-center py-10 bg-surface-container-low rounded-xl border border-dashed border-outline-variant">
                  <MaterialIcon name="group_off" className="text-on-surface-variant text-3xl mx-auto mb-2" />
                  <p className="text-xs text-on-surface-variant">
                    {groupSearch ? "Không tìm thấy nhóm phù hợp" : "Chưa có nhóm LinkedIn nào"}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredGroups.map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      selected={selectedGroups.has(g.group_url)}
                      onToggle={() => toggleGroup(g.group_url)}
                    />
                  ))}
                </div>
              )}

              {/* Crawl error */}
              {crawlError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                  <MaterialIcon name="error" className="text-base shrink-0 mt-0.5" />
                  <span>{crawlError}</span>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Result ── */}
          {step === 3 && (
            <div className="py-4">
              {crawling ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-4">
                  <div className="w-12 h-12 border-4 border-outline-variant border-t-primary rounded-full animate-spin" />
                  <div className="text-center">
                    <p className="text-sm font-bold text-on-surface">Đang cào dữ liệu...</p>
                    <p className="text-xs text-on-surface-variant mt-1">Quá trình này có thể mất vài phút. Vui lòng không đóng cửa sổ này.</p>
                  </div>
                </div>
              ) : crawlResult ? (
                <ResultSummary result={crawlResult} message={crawlMessage} />
              ) : crawlError ? (
                <div className="text-center py-10">
                  <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <MaterialIcon name="error" className="text-red-500 text-4xl" />
                  </div>
                  <p className="text-sm font-bold text-on-surface">Cào dữ liệu thất bại</p>
                  <p className="text-xs text-primary-container mt-2">{crawlError}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-outline-variant bg-surface shrink-0 flex items-center gap-3">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold py-2.5 rounded-xl text-xs hover:bg-surface-container-low transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={!selectedAccount}
                onClick={() => setStep(2)}
                className={cn(
                  "flex-1 font-bold py-2.5 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer",
                  selectedAccount
                    ? "bg-primary hover:bg-on-primary-fixed-variant text-white"
                    : "bg-surface-container-low text-on-surface-variant cursor-not-allowed"
                )}
              >
                Tiếp theo
                <MaterialIcon name="arrow_forward" className="text-sm" />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => { setCrawlError(null); setStep(1); }}
                disabled={crawling}
                className="flex-1 border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold py-2.5 rounded-xl text-xs hover:bg-surface-container-low transition disabled:opacity-50 cursor-pointer"
              >
                Quay lại
              </button>
              <button
                type="button"
                onClick={() => void handleStartCrawl()}
                disabled={crawling || selectedGroups.size === 0}
                className={cn(
                  "flex-[2] font-bold py-2.5 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2 cursor-pointer",
                  crawling || selectedGroups.size === 0
                    ? "bg-surface-container-low text-on-surface-variant cursor-not-allowed"
                    : "bg-primary hover:bg-on-primary-fixed-variant text-white"
                )}
              >
                {crawling ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Đang cào dữ liệu...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="travel_explore" className="text-base" />
                    Bắt đầu cào {selectedGroups.size > 0 ? `(${selectedGroups.size} nhóm)` : ""}
                  </>
                )}
              </button>
            </>
          )}

          {step === 3 && (
            <button
              type="button"
              onClick={() => {
                if (crawlResult) onSuccess?.();
                onClose();
              }}
              disabled={crawling}
              className={cn(
                "flex-1 font-bold py-2.5 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer",
                crawling
                  ? "bg-surface-container-low text-on-surface-variant cursor-not-allowed"
                  : "bg-[#1A1A1A] hover:bg-[#1A1A1A]/90 text-white"
              )}
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
