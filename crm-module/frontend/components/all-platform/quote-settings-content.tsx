"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { QuoteEmailProviderSettings } from "@/components/all-platform/admin/QuoteEmailProviderSettings";
import { QuoteApprovalRuleSettings } from "@/components/all-platform/admin/QuoteApprovalRuleSettings";

type Tab = "email" | "rules";
const VALID_TABS: Tab[] = ["email", "rules"];

/** Trang "Cài đặt báo giá" (submenu riêng cạnh "Quản lý CRM") - gom 2 cai dat
 * TRUOC DAY nam rai rac: tab "Email gửi báo giá" (von o Trang ca nhan) va
 * modal "Cài đặt quy tắc phê duyệt" (von la nut trong Workspace bao gia Buoc
 * 2) - dua ve 1 cho de Admin/Leader de tim, workspace Buoc 2 gio chi CON HIEN
 * THI quy tac (khong con sua duoc tai do nua). */
export function QuoteSettingsContent() {
  const { user } = useAppAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = user?.role === "admin" || user?.role === "leader";

  const requestedTab = searchParams.get("tab");
  const activeTab: Tab = useMemo(() => {
    if (requestedTab && (VALID_TABS as string[]).includes(requestedTab)) return requestedTab as Tab;
    return "email";
  }, [requestedTab]);

  function setActiveTab(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "email") params.delete("tab");
    else params.set("tab", tab);
    const qs = params.toString();
    router.replace(`/all-platform/quote-settings${qs ? `?${qs}` : ""}`);
  }

  const TABS: { key: Tab; label: string; icon: MaterialSymbolName }[] = [
    { key: "email", label: "Email gửi báo giá", icon: "mail" },
    { key: "rules", label: "Quy tắc phê duyệt", icon: "verified" },
  ];

  return (
    <div className="w-full min-w-0 space-y-6 font-sans">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-primary/10 p-3">
          <MaterialIcon name="tune" className="text-primary text-3xl" />
        </div>
        <div>
          <h1 className="text-h1 text-on-surface font-semibold">Cài đặt báo giá</h1>
          <p className="text-body-md text-on-surface-variant">
            Kênh gửi email và quy tắc phê duyệt áp dụng cho toàn bộ báo giá
          </p>
        </div>
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-red-100 bg-surface p-6 text-xs font-medium text-red-600">
          Bạn không có quyền truy cập trang này. Chỉ Admin hoặc Leader mới được cấu hình mục này.
        </div>
      ) : (
        <>
          <div className="border-b border-outline-variant overflow-x-auto whitespace-nowrap">
            <div className="flex gap-8 px-2">
              {TABS.map(tab => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "py-4 text-xs font-bold border-b-2 transition-all uppercase cursor-pointer",
                      active ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-primary",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === "email" ? <QuoteEmailProviderSettings /> : <QuoteApprovalRuleSettings />}
        </>
      )}
    </div>
  );
}
