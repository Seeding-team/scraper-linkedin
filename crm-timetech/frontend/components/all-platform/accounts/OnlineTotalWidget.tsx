"use client";

import { useEffect, useState } from "react";
import { FaFacebook } from "react-icons/fa";
import { LuMessageCircle, LuCircleAlert } from "react-icons/lu";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  accountOnlineSummaryService,
  type AccountOnlineSummary,
  type PlatformOnlineTotal,
} from "@/services/all-platform.service";

const PLATFORM_META = {
  facebook: { label: "Facebook", icon: FaFacebook, className: "bg-[#0866FF]/10 text-[#0866FF]" },
  zalo: { label: "Zalo", icon: LuMessageCircle, className: "bg-sky-50 text-sky-600" },
} as const;

function PlatformCard({ data }: { data: PlatformOnlineTotal }) {
  const meta = PLATFORM_META[data.platform];
  const Icon = meta.icon;

  return (
    <div className="bg-surface rounded-xl border border-outline-variant p-5 flex flex-col justify-between min-h-[120px]">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-on-surface-variant">{meta.label.toUpperCase()}</p>
          {data.available ? (
            <p className="mt-3 text-3xl font-bold text-on-surface leading-none tabular-nums">
              {data.online}
              <span className="text-lg font-semibold text-on-surface-variant">/{data.total}</span>
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-1.5 text-amber-600">
              <LuCircleAlert className="text-lg shrink-0" />
              <p className="text-xs font-semibold leading-tight" title={data.error || undefined}>
                Không khả dụng
              </p>
            </div>
          )}
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.className}`}>
          <Icon className="text-xl" />
        </div>
      </div>
    </div>
  );
}

function AccountListTable({ data }: { data: PlatformOnlineTotal }) {
  if (!data.available) {
    return (
      <div className="flex items-center justify-center gap-1.5 py-10 text-sm text-amber-600">
        <LuCircleAlert className="text-lg shrink-0" />
        {data.error || "Không khả dụng"}
      </div>
    );
  }
  if (data.accounts.length === 0) {
    return <div className="py-10 text-center text-sm text-on-surface-variant">Chưa có tài khoản nào.</div>;
  }
  // Onl truoc, roi toi ten (khong dau/hoa thuong) de de tim trong danh sach dai.
  const sortedAccounts = [...data.accounts].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return (
    <div className="max-h-80 overflow-y-auto">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-outline-variant text-left text-[11px] font-semibold text-on-surface-variant">
            <th className="px-4 py-2">Tài khoản</th>
            <th className="px-4 py-2 text-right">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {sortedAccounts.map((acc, idx) => (
            <tr key={`${acc.label}-${idx}`} className="border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low/40">
              <td className="px-4 py-2 font-medium text-on-surface" title={acc.label}>
                {acc.label}
              </td>
              <td className="px-4 py-2 text-right">
                {acc.online ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-on-surface-variant border border-outline-variant">
                    <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant/40" />
                    Offline
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OnlineTotalWidget() {
  const [data, setData] = useState<AccountOnlineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"facebook" | "zalo">("facebook");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await accountOnlineSummaryService.get();
      if (cancelled) return;
      if (res.success && res.data) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.message || "Không tải được dữ liệu online.");
      }
      setLoading(false);
    };

    void load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
        <MaterialIcon name="radar" className="text-base text-primary" />
        Tài khoản Online/Total
      </h3>

      {loading ? (
        <div className="bg-surface rounded-xl border border-outline-variant p-5 min-h-[120px] flex items-center justify-center text-sm text-on-surface-variant">
          Đang tải...
        </div>
      ) : !data ? (
        <div className="bg-surface rounded-xl border border-outline-variant p-5 min-h-[120px] flex items-center justify-center gap-1.5 text-sm text-amber-600">
          <LuCircleAlert className="text-lg shrink-0" />
          {error || "Không tải được dữ liệu online."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PlatformCard data={data.facebook} />
            <PlatformCard data={data.zalo} />
            <div className="bg-surface rounded-xl border border-outline-variant p-5 flex flex-col justify-between min-h-[120px]">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-on-surface-variant">TỔNG (FB + ZALO)</p>
                  <p className="mt-3 text-3xl font-bold text-on-surface leading-none tabular-nums">
                    {data.total.online}
                    <span className="text-lg font-semibold text-on-surface-variant">/{data.total.total}</span>
                  </p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MaterialIcon name="link" className="text-xl" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
            <div className="flex items-center gap-1 border-b border-outline-variant px-3 pt-2">
              {(["facebook", "zalo"] as const).map((platform) => {
                const meta = PLATFORM_META[platform];
                const isActive = activeTab === platform;
                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => setActiveTab(platform)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12px] font-semibold transition cursor-pointer",
                      isActive
                        ? "bg-surface-container-low text-on-surface border-b-2 border-primary"
                        : "text-on-surface-variant hover:text-on-surface",
                    )}
                  >
                    <meta.icon className="text-sm" />
                    {meta.label}
                    <span className="text-[10px] font-normal text-on-surface-variant">
                      ({data[platform].online}/{data[platform].total})
                    </span>
                  </button>
                );
              })}
            </div>
            <AccountListTable data={data[activeTab]} />
          </div>
        </>
      )}
    </div>
  );
}
