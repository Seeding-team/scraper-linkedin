"use client";

import { Suspense } from "react";
import { QuoteSettingsContent } from "@/components/all-platform/quote-settings-content";

export default function AllPlatformQuoteSettingsPage() {
  return (
    <Suspense fallback={null}>
      <QuoteSettingsContent />
    </Suspense>
  );
}
