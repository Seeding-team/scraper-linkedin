import { ProgressGuard } from "@/modules/crm/components/progress/ProgressGuard";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quản lý tiến độ CRM - Markee",
  description: "Theo dõi tiến độ Lead, Khách hàng, Cơ hội, Dự án, Báo giá và Hợp đồng theo Team/Thành viên.",
};

export default function CrmProgressRoute() {
  return <ProgressGuard />;
}
