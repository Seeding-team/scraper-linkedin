import { TelegramChatFullScreen } from "@/components/all-platform/telegram/TelegramChatFullScreen";

export default async function TelegramChatFullScreenPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <TelegramChatFullScreen accountId={accountId} />;
}
