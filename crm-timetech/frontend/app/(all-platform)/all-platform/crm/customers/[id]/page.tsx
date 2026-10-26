import { Suspense } from "react";
import { CrmCustomerDetailPage } from "@/modules/crm";

export default async function CrmCustomerDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CrmCustomerDetailPage customerId={id} />
    </Suspense>
  );
}

// HMR Touch 1790529500.0000000