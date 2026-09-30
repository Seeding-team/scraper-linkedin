"use client";

/**
 * Tab phụ "Tài khoản seeding" (Lịch crawl & Hàng đợi) — bảng tổng quan mỗi thành viên:
 * tên+email, nền tảng đang dùng (Facebook/LinkedIn/Telegram), số nhóm đang cào, lịch sử
 * cào. Bấm vào 1 hàng mở drawer chi tiết trượt từ phải vào, giống style bấm vào 1 Lead
 * ở CRM (không xây lại — chỉ dùng cùng ngôn ngữ thiết kế: drawer bên phải, header rõ,
 * các block thông tin tách bạch).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformPostsService } from "@/services/all-platform.service";
import type { MemberCrawlHistoryData, MemberSeedingAccount } from "@/types/unified.types";

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

export function SeedingAccountsOverview() {
  const { user } = useAppAuth();
  const [accounts, setAccounts] = useState<MemberSeedingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MemberSeedingAccount | null>(null);

  const load = useCallback(() => {
    if (!user?.email) return;
    allPlatformPostsService
      .getMemberSeedingOverview(user.email)
      .then((res) => {
        if (res.success === false) {
          setError(res.message || "Không tải được danh sách tài khoản seeding.");
          return;
        }
        setAccounts(res.data?.accounts || []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không tải được danh sách tài khoản seeding."))
      .finally(() => setLoading(false));
  }, [user?.email]);

  useEffect(() => {
    load();
  }, [load]);

  if (user?.role === "member") {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Chỉ admin/leader mới xem được danh sách tài khoản seeding.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4 font-sans">
      <div className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] flex items-center gap-3">
        <div className="rounded-2xl bg-primary/10 p-3">
          <span className="material-symbols-outlined text-primary text-[26px]">manage_accounts</span>
        </div>
        <div>
          <h2 className="text-lg font-bold text-on-surface">Tài khoản seeding</h2>
          <p className="text-xs text-on-surface-variant">
            {user?.role === "admin" ? "Toàn bộ thành viên đang seeding" : "Thành viên trong team bạn quản lý"} — bấm vào 1 hàng để xem chi tiết.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-700">⚠️ {error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-container-low border-b border-outline-variant text-[11px] font-bold text-on-surface-variant uppercase">
              <tr>
                <th className="py-3 px-4">Người dùng</th>
                <th className="py-3 px-4">Nền tảng đang dùng</th>
                <th className="py-3 px-4 text-center">Số group cào</th>
                <th className="py-3 px-4">Lịch sử cào</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-xs text-muted-foreground">
                    Đang tải...
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-xs text-muted-foreground">
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
                      <div className="font-bold text-on-surface">{a.name}</div>
                      <div className="text-[11px] text-on-surface-variant">{a.email}</div>
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
                    <td className="py-3 px-4">
                      <div className="text-on-surface font-semibold">{a.total_fb_posts_crawled} bài</div>
                      <div className="text-[11px] text-muted-foreground">{formatRelative(a.last_crawled_at)}</div>
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
              <div className="font-bold text-base text-foreground truncate">{account.name}</div>
              <div className="text-xs text-muted-foreground truncate">{account.email}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted shrink-0">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Nhóm Facebook" value={String(account.fb_groups)} />
            <Stat label="Nhóm LinkedIn" value={String(account.li_groups)} />
            <Stat label="Bài đã cào" value={String(account.total_fb_posts_crawled)} highlight />
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
