import { Metadata } from "next";
import { ZaloBulkSendPageContent } from "@/components/all-platform/zalo/bulk-send/ZaloBulkSendPageContent";

export const metadata: Metadata = {
  title: "Gửi tin nhắn hàng loạt Zalo",
  description: "Gửi tin/kết bạn/mời vào nhóm hàng loạt theo danh sách SĐT hoặc UID",
};

export default function ZaloBulkSendPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ZaloBulkSendPageContent />
    </div>
  );
}
