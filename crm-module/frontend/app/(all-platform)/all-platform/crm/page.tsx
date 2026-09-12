import { Suspense } from "react";
import CrmCustomersPage from "@/components/all-platform/customers/CrmCustomersPage";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "CRM — Quản lý Pipeline Bán hàng - Markee",
  description: "Trang CRM quản lý pipeline khách hàng với 8 stages và kéo-thả có validation.",
};

export default function CrmRoute() {
  return (
    <Suspense fallback={null}>
      <CrmCustomersPage />
    </Suspense>
  );
}
