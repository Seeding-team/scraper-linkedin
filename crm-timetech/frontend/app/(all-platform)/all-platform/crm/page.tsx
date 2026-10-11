import { Suspense } from "react";
import { redirect } from "next/navigation";
import CrmCustomersPage from "@/components/all-platform/customers/CrmCustomersPage";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "CRM — Quản lý Pipeline Bán hàng - Markee",
  description: "Trang CRM quản lý pipeline khách hàng với 8 stages và kéo-thả có validation.",
};

export default async function CrmRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Vào /all-platform/crm trần -> trang Lead. Các link sâu (?openDeal=...) vẫn
  // vào board Cơ hội như cũ.
  const params = await searchParams;
  if (Object.keys(params).length === 0) redirect("/all-platform/crm/leads");
  return (
    <Suspense fallback={null}>
      <CrmCustomersPage />
    </Suspense>
  );
}
