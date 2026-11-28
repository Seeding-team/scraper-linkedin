import type { Metadata } from "next";
import { SlaMonitorShell } from "@/components/all-platform/sla-alerts/SlaMonitorShell";

export const metadata: Metadata = {
  title: "Giám sát SLA & Thông báo Nhóm",
  description:
    "Theo dõi thời gian phản hồi khách hàng đa kênh theo giờ hành chính và tự động đẩy thông báo về nhóm Zalo chung",
};

export default function SlaMonitorPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <SlaMonitorShell />
    </div>
  );
}
