import type { Metadata } from "next";
import { MessengerInboxShell } from "@/components/all-platform/messenger/MessengerInboxShell";

export const metadata: Metadata = {
  title: "Facebook Messenger Inbox | Quản lý hội thoại đa nick",
  description: "Quản lý hội thoại Facebook Messenger đa nick, đồng bộ 2 chiều thời gian thực với điện thoại và bảo vệ Anti-Checkpoint.",
};

export default function MessengerInboxPage() {
  return (
    <div className="h-[calc(100vh-3.25rem)] w-full overflow-hidden p-3 bg-surface-container-lowest">
      <MessengerInboxShell />
    </div>
  );
}
