import { Suspense } from "react";
import { ContractDetailPage } from "@/modules/contracts";

export default async function ContractDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ContractDetailPage contractId={id} />
    </Suspense>
  );
}
