import type { Metadata } from "next";
import { WhatsAppAccountsPageContent } from "@/components/all-platform/whatsapp/WhatsAppAccountsPageContent";

export const metadata: Metadata = {
  title: "WhatsApp Chat & Call",
  description:
    "Kết nối WhatsApp Multi-Device (QR & mã ghép nối 8 ký tự), trò chuyện thời gian thực và gọi thoại WebRTC 2 chiều.",
};

export default function WhatsAppChatPage() {
  return (
    <div className="h-[calc(100svh-5.25rem)] min-h-[560px] w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
      <WhatsAppAccountsPageContent />
    </div>
  );
}
