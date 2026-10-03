import type { Metadata } from "next";
import { ZaloInboxAdminShell } from "@/components/all-platform/zalo/admin-inbox/ZaloInboxAdminShell";

export const metadata: Metadata = {
  title: "Zalo Inbox Admin | Quản lý hội thoại đa tài khoản",
  description:
    "Quản lý hội thoại Zalo của tất cả nhân viên theo team. Xem trạng thái online/offline, theo dõi KPI inbox.",
};

export default function ZaloInboxAdminPage() {
  return (
    <div className="h-[calc(100vh-3.25rem)] w-full overflow-hidden bg-white">
      <ZaloInboxAdminShell />
    </div>
  );
}
