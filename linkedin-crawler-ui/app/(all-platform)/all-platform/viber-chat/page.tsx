import { Metadata } from "next";
import { ViberAccountsPageContent } from "@/components/all-platform/viber/ViberAccountsPageContent";

export const metadata: Metadata = {
  title: "Viber Chat",
  description: "Kết nối Viber Bot và trò chuyện với khách hàng ngay trong tool",
};

export default function ViberChatPage() {
  return <ViberAccountsPageContent />;
}
