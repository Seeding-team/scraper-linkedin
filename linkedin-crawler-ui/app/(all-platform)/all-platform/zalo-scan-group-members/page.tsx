import { Metadata } from "next";
import { ZaloScanGroupMembersPageContent } from "@/components/all-platform/zalo/scan-group-members/ZaloScanGroupMembersPageContent";

export const metadata: Metadata = {
  title: "Quét thành viên nhóm Zalo",
  description: "Quét đầy đủ thành viên 1 nhóm để tạo job gửi hàng loạt",
};

export default function ZaloScanGroupMembersPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ZaloScanGroupMembersPageContent />
    </div>
  );
}
