import type { Metadata } from "next";
import { OmnichannelInboxView } from "@/modules/omnichannel/components/OmnichannelInboxView";

export const metadata: Metadata = {
  title: "Omnichannel Inbox | Hợp nhất Facebook, Zalo, Telegram, LinkedIn",
  description: "Hộp thư hợp nhất 4 kênh tương tác xã hội và CRM 360",
};

export default function OmnichannelInboxPage() {
  return (
    <div className="h-[calc(100vh-3.25rem)] w-full overflow-hidden">
      <OmnichannelInboxView />
    </div>
  );
}
