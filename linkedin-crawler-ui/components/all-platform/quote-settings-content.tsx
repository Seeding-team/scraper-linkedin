"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type MaterialSymbolName } from "@/components/ui";
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
