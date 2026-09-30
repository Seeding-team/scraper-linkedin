import { Metadata } from "next";
import { TelegramChatShell } from "@/components/all-platform/telegram/TelegramChatShell";

export const metadata: Metadata = {
  title: "Telegram Chat",
  description: "Kết nối tài khoản Telegram và trò chuyện ngay trong tool",
};

export default function TelegramChatPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <TelegramChatShell />
    </div>
  );
}
