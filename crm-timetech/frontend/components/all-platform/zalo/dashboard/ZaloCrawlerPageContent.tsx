"use client";

import { useZaloCrawlerFlow } from "@/hooks/useZaloCrawlerFlow";
import { ZaloChatView } from "./ZaloChatView";
import { useRouter } from "next/navigation";

export function ZaloCrawlerPageContent() {
  const flow = useZaloCrawlerFlow();
  const router = useRouter();

  function handleBackToDashboard() {
    router.push("/all-platform/tai-khoan");
  }

  return (
    <div className="flex flex-col gap-md h-[calc(100vh-120px)] p-2 min-h-0 overflow-hidden">
      <ZaloChatView flow={flow} onBackToDashboard={handleBackToDashboard} />
    </div>
  );
}