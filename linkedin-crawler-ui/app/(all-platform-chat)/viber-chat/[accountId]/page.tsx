import { ViberChatFullScreen } from "@/components/all-platform/viber/ViberChatFullScreen";

export default async function ViberChatFullScreenPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <ViberChatFullScreen accountId={accountId} />;
}
