"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarDays, Layers } from "lucide-react";
import { TeamSessionManager } from "@/components/all-platform/kpi-setup/TeamSessionManager";
import { TemplateManager } from "@/components/all-platform/kpi-setup/TemplateManager";
import { KpiErrorBoundary } from "@/components/all-platform/kpi-setup/KpiErrorBoundary";
import type { KpiTemplate } from "@/services/kpi-setup.service";

export default function KpiSetupPage() {
  const [activeTab, setActiveTab] = useState<"sessions" | "templates">("sessions");
  const [selectedTemplateForApply, setSelectedTemplateForApply] = useState<string | undefined>(undefined);

  const handleApplyTemplateFromManager = (template: KpiTemplate) => {
    setSelectedTemplateForApply(template.id);
    setActiveTab("sessions");
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Thiết lập KPI Seeding & Đồng bộ PM
        </h1>
        <p className="text-sm text-muted-foreground">
          Định nghĩa mẫu KPI chung, áp dụng cho từng CRM Team theo tuần, tự động tính toán
          manday từ Review Nhanh và đồng bộ sang Plane.so (kpi.markeeai.com).
        </p>
      </div>

      {/* Main Tabs */}
      <KpiErrorBoundary fallbackTitle="Không thể tải giao diện Thiết lập KPI">
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "sessions" | "templates")}
          className="space-y-6"
        >
          <div className="border-b">
            <TabsList className="bg-transparent p-0 gap-6 h-auto">
              <TabsTrigger
                value="sessions"
                className="gap-2 rounded-none border-b-2 border-transparent px-2 py-3 font-semibold data-[state=active]:border-[var(--color-markee-primary)] data-[state=active]:text-[var(--color-markee-primary)] data-[state=active]:bg-transparent text-sm"
              >
                <CalendarDays className="w-4 h-4" />
                Kỳ KPI của Team (Tuần)
              </TabsTrigger>
              <TabsTrigger
                value="templates"
                className="gap-2 rounded-none border-b-2 border-transparent px-2 py-3 font-semibold data-[state=active]:border-[var(--color-markee-primary)] data-[state=active]:text-[var(--color-markee-primary)] data-[state=active]:bg-transparent text-sm"
              >
                <Layers className="w-4 h-4" />
                Mẫu KPI chung (Templates)
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="sessions" className="m-0 focus-visible:outline-none">
            <TeamSessionManager initialTemplateId={selectedTemplateForApply} />
          </TabsContent>

          <TabsContent value="templates" className="m-0 focus-visible:outline-none">
            <TemplateManager onApplyTemplate={handleApplyTemplateFromManager} />
          </TabsContent>
        </Tabs>
      </KpiErrorBoundary>
    </div>
  );
}

