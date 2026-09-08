"use client";

import { Suspense } from "react";
import { ProfileContent } from "@/components/all-platform/profile-content";

export default function AllPlatformProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileContent />
    </Suspense>
  );
}
