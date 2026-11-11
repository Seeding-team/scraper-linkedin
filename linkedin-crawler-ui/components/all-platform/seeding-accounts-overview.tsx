"use client";

/**
 * Tab phụ "Tài khoản seeding" (Lịch crawl & Hàng đợi) — bảng tổng quan mỗi thành viên:
 * tên+email, nền tảng đang dùng (Facebook/LinkedIn/Telegram), số nhóm đang cào, lịch sử
 * cào. Bấm vào 1 hàng mở drawer chi tiết trượt từ phải vào, giống style bấm vào 1 Lead
 * ở CRM (không xây lại — chỉ dùng cùng ngôn ngữ thiết kế: drawer bên phải, header rõ,
 * các block thông tin tách bạch).
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformPostsService } from "@/services/all-platform.service";
import type { MemberCrawlHistoryData, MemberSeedingAccount } from "@/types/unified.types";

function formatDateTimeVN(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const date = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${time} ${date}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Chưa từng cào";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return "Vừa xong";
  if (diffH < 24) return `${Math.floor(diffH)} giờ trước`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD} ngày trước`;
  return d.toLocaleDateString("vi-VN");
}

function formatLastSeenRelative(iso?: string | null): string {
  if (!iso) return "Chưa ghi nhận";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Chưa ghi nhận";
  const diffMin = Math.max(1, Math.floor((Date.now() - d.getTime()) / 60_000));
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} giờ trước`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} ngày trước`;
}

function formatOnlineDuration(minutes?: number): string {
  const m = Math.max(0, Number(minutes || 0));
  if (m === 0) return "";
  if (m < 60) return `${m}p hôm nay`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}g ${rem}p hôm nay` : `${h}g hôm nay`;
}

export function SeedingAccountsOverview() {
  const { user } = useAppAuth();
  const [accounts, setAccounts] = useState<MemberSeedingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MemberSeedingAccount | null>(null);
  const [timeRange, setTimeRange] = useState<"today" | "this_week" | "last_week" | "last_month" | "all">("all");

  // In-memory SWR Cache: Render tức thì 0ms khi bấm qua lại giữa các mốc thời gian
  const cacheRef = useRef<Record<string, MemberSeedingAccount[]>>({});

  const load = useCallback(() => {
    if (!user?.email) return;
    const cachedData = cacheRef.current[timeRange];
    if (cachedData && cachedData.length > 0) {
      setAccounts(cachedData);
      setLoading(false);
    } else {
      setLoading(true);
    }

    allPlatformPostsService
      .getMemberSeedingOverview(user.email, timeRange)
      .then((res) => {
        if (res.success === false) {
          setError(res.message || "Không tải được danh sách tài khoản seeding.");
          return;
        }
        const accs = res.data?.accounts || [];
        cacheRef.current[timeRange] = accs;
        setAccounts(accs);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không tải được danh sách tài khoản seeding."))
      .finally(() => setLoading(false));
  }, [user?.email, timeRange]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 45_000);
    return () => clearInterval(timer);
  }, [load]);

  // Mở khóa cho cả Member và Leader: Thành viên xem tài khoản của chính mình, Leader xem toàn team
  const isMember = user?.role === "member";
  const onlineCount = accounts.filter((a) => a.is_online).length;

  return (
    <div className="w-full min-w-0 space-y-4 font-sans">
      <div className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3">
            <span className="material-symbols-outlined text-primary text-[26px]">manage_accounts</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-on-surface">Tài khoản seeding</h2>
            <p className="text-xs text-on-surface-variant">
              {isMember ? "Thống kê tài khoản seeding cá nhân của bạn" : (user?.role === "admin" ? "Toàn bộ thành viên đang seeding" : "Thành viên trong team bạn quản lý")} — bấm vào 1 hàng để xem chi tiết.
            </p>
          </div>
        </div>
        {accounts.length > 0 && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span>{onlineCount} / {accounts.length} đang online</span>
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-700">⚠️ {error}</div>
      ) : null}

      {/* Bộ lọc thời gian cào */}
      <div className="flex flex-wrap items-center gap-2 p-1">
        <span className="text-xs font-bold text-muted-foreground mr-1">Bộ lọc thời gian:</span>
        {[
          { key: "today", label: "Hôm nay (Ngày)" },
          { key: "this_week", label: "Tuần này" },
          { key: "last_week", label: "Tuần trước" },
          { key: "last_month", label: "Tháng trước" },
          { key: "all", label: "Tất cả" },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTimeRange(t.key as any)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border",
              timeRange === t.key
                ? "bg-primary text-white border-primary shadow-xs"
                : "bg-surface text-on-surface-variant border-outline-variant hover:bg-surface-container-low"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse text-left text-sm">
            <thead className="bg-surface-container-low border-b border-outline-variant text-[11px] font-bold text-on-surface-variant uppercase">
              <tr>
                <th className="py-3 px-4 min-w-[200px]">Người dùng</th>
                <th className="py-3 px-4 text-center min-w-[140px]">Trạng thái online</th>
                <th className="py-3 px-4 min-w-[170px]">Nền tảng đang dùng</th>
                <th className="py-3 px-4 text-center min-w-[130px]">Số group cào</th>
                <th className="py-3 px-4 text-center min-w-[120px]">Số lịch cào</th>
                <th className="py-3 px-4 text-center min-w-[120px]">Số bài cào</th>
                <th className="py-3 px-4 text-center min-w-[170px]">Số bài viết vượt AI check</th>
                <th className="py-3 px-4 min-w-[150px]">Lần cào gần nhất</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                    Đang tải dữ liệu...
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                    Chưa có tài khoản seeding nào.
                  </td>
                </tr>
              ) : (
                accounts.map((a) => (
                  <tr
                    key={a.id_member}
                    onClick={() => setSelected(a)}
                    className="hover:bg-primary/5 cursor-pointer transition"
                  >
                    <td className="py-3 px-4 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block w-2 h-2 rounded-full shrink-0",
                            a.is_online ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" : "bg-slate-300",
                          )}
                          title={a.is_online ? "Đang online" : "Offline"}
                        />
                        <div className="font-bold text-on-surface">{a.name}</div>
                      </div>
                      <div className="text-[11px] text-on-surface-variant pl-4">{a.email}</div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {a.is_online ? (
                        <div className="inline-flex flex-col items-center">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            Đang online
                          </span>
                          {formatOnlineDuration(a.online_today_minutes) ? (
                            <span className="text-[10px] text-emerald-600/90 mt-0.5 font-medium">
                              {formatOnlineDuration(a.online_today_minutes)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-center">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
                            Offline
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                            {a.last_seen_at ? formatLastSeenRelative(a.last_seen_at) : "Chưa hoạt động"}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                            a.fb_groups > 0 ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-muted text-muted-foreground border-border opacity-50",
                          )}
                        >
                          Facebook
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                            a.li_groups > 0 ? "bg-sky-50 text-sky-700 border-sky-200" : "bg-muted text-muted-foreground border-border opacity-50",
                          )}
                        >
                          LinkedIn
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                            a.telegram_connected ? "bg-cyan-50 text-cyan-700 border-cyan-200" : "bg-muted text-muted-foreground border-border opacity-50",
                          )}
                        >
                          Telegram
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="font-bold text-on-surface">{a.fb_groups + a.li_groups}</span>
                      <span className="text-[10px] text-muted-foreground ml-1">
                        (FB {a.fb_groups} · LI {a.li_groups})
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border",
                          (a.scheduled_crawls_count ?? 0) > 0
                            ? "bg-purple-50 text-purple-700 border-purple-200"
                            : "bg-muted text-muted-foreground border-border opacity-70"
                        )}
                        title="Số group đã được bật lịch cào tự động 24h hoặc khoảng cách cào"
                      >
                        <span className="material-symbols-outlined text-[13px]">calendar_clock</span>
                        {a.scheduled_crawls_count ?? 0} lịch
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {a.total_crawled_posts ?? a.total_fb_posts_crawled ?? 0} bài
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200" title="Bài viết có điểm AI check >= 40 từ database">
                          ⚡ {a.ai_passed_posts ?? 0} bài
                        </span>
                        {(a.total_crawled_posts || a.total_fb_posts_crawled) ? (
                          <span className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                            ({a.ai_passed_percent ?? 0}%)
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-[11px] font-bold text-on-surface flex items-center gap-1">
                        {a.last_crawled_at ? (
                          <>
                            <span className="material-symbols-outlined text-[13px] text-muted-foreground">schedule</span>
                            <span>{formatDateTimeVN(a.last_crawled_at)}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-medium">{formatRelative(a.last_crawled_at)}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? <MemberDetailDrawer account={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function MemberDetailDrawer({ account, onClose }: { account: MemberSeedingAccount; onClose: () => void }) {
  const { user } = useAppAuth();
  const [data, setData] = useState<MemberCrawlHistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) return;
    setLoading(true);
    allPlatformPostsService
      .getMemberCrawlHistory(user.email, account.id_member)
      .then((res) => {
        if (res.success !== false) setData(res.data || null);
      })
      .finally(() => setLoading(false));
  }, [user?.email, account.id_member]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[480px] h-full bg-card shadow-2xl overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-border sticky top-0 bg-card z-10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold text-lg">{account.name.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-bold text-base text-foreground truncate">{account.name}</div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0",
                    account.is_online
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-600 border-slate-200",
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", account.is_online ? "bg-emerald-500" : "bg-slate-400")} />
                  {account.is_online ? "Đang online" : "Offline"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground truncate">{account.email}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted shrink-0">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Nhóm Facebook" value={String(account.fb_groups)} />
            <Stat label="Nhóm LinkedIn" value={String(account.li_groups)} />
            <Stat label="Số lịch cào" value={`${account.scheduled_crawls_count ?? 0} lịch`} />
            <Stat label="Bài đã cào" value={String(account.total_crawled_posts ?? account.total_fb_posts_crawled ?? 0)} highlight />
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-bold text-muted-foreground mb-2">Nền tảng đang dùng</div>
            <div className="flex flex-wrap gap-2">
              <PlatformBadge label="Facebook" active={account.fb_groups > 0} />
              <PlatformBadge label="LinkedIn" active={account.li_groups > 0} />
              <PlatformBadge label="Telegram Chat" active={account.telegram_connected} />
            </div>
          </div>

          <div>
            <div className="text-sm font-bold text-foreground mb-2">
              Nhóm Facebook đang sở hữu ({data?.groups.length ?? 0})
            </div>
            {loading ? (
              <div className="text-xs text-muted-foreground">Đang tải...</div>
            ) : !data || data.groups.length === 0 ? (
              <div className="text-xs text-muted-foreground">Chưa sở hữu nhóm Facebook nào.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.groups.map((g) => (
                  <span key={g.id} className="px-2.5 py-1 rounded-full bg-muted text-[11px] font-semibold text-foreground border border-border">
                    {g.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-bold text-foreground mb-2">Lịch sử cào gần đây</div>
            {loading ? (
              <div className="text-xs text-muted-foreground">Đang tải...</div>
            ) : !data || data.history.length === 0 ? (
              <div className="text-xs text-muted-foreground">Chưa có lịch sử cào nào.</div>
            ) : (
              <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
                {data.history.map((h) => (
                  <div key={h.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-foreground truncate">{h.group_name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {h.crawl_date ? new Date(h.crawl_date).toLocaleString("vi-VN") : ""}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{h.content || "(không có nội dung)"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl p-3 text-center border", highlight ? "bg-emerald-50 border-emerald-100" : "bg-muted/50 border-border")}>
      <div className={cn("text-lg font-bold", highlight ? "text-emerald-700" : "text-foreground")}>{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium mt-0.5">{label}</div>
    </div>
  );
}

function PlatformBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border",
        active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border opacity-60",
      )}
    >
      <span className="material-symbols-outlined text-[13px]">{active ? "check_circle" : "radio_button_unchecked"}</span>
      {label}
    </span>
  );
}
