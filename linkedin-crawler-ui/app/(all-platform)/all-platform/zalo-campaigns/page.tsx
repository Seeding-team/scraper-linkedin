import { Metadata } from "next";
import { ZaloCampaignsPageContent } from "@/components/all-platform/zalo/campaigns/ZaloCampaignsPageContent";

export const metadata: Metadata = {
  title: "Chiến dịch nhắn tin Zalo",
  description: "Chiến dịch nhắn tin tự động lặp lịch, gợi ý nội dung bằng AI",
};

export default function ZaloCampaignsPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ZaloCampaignsPageContent />
    </div>
  );
}
