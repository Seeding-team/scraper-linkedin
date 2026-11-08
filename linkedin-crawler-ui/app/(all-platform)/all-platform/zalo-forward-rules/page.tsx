import { Metadata } from "next";
import { ZaloForwardRulesPageContent } from "@/components/all-platform/zalo/forward-rules/ZaloForwardRulesPageContent";

export const metadata: Metadata = {
  title: "Chuyển tiếp tin nhắn Zalo",
  description: "Tự động chuyển tiếp tin nhắn từ 1 nhóm sang nhiều nhóm khác",
};

export default function ZaloForwardRulesPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ZaloForwardRulesPageContent />
    </div>
  );
}
