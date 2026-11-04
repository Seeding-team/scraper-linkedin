import { AllPlatformShell } from "@/components/all-platform/layout/AllPlatformShell";

/**
 * Layout dành riêng cho route group (all-platform).
 * Hoàn toàn tách biệt khỏi (dashboard) layout cũ.
 */
export default function AllPlatformRouteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AllPlatformShell>{children}</AllPlatformShell>;
}
