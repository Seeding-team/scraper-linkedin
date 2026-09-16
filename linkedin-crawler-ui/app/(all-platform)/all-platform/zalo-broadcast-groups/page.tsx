import { Metadata } from "next";
import { ZaloBroadcastGroupsPageContent } from "@/components/all-platform/zalo/broadcast-groups/ZaloBroadcastGroupsPageContent";

export const metadata: Metadata = {
  title: "Gửi tin nhiều nhóm Zalo",
  description: "Soạn 1 tin và gửi đồng loạt tới nhiều nhóm",
};

export default function ZaloBroadcastGroupsPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ZaloBroadcastGroupsPageContent />
    </div>
  );
}
