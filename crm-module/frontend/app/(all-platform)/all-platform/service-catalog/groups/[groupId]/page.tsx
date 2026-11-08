import { Suspense } from "react";
import { ServiceCatalogGroupDetailPage } from "@/modules/service-catalog/ServiceCatalogGroupDetailPage";

export default async function ServiceCatalogGroupDetailRoute({
  params,
}: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return (
    <Suspense fallback={null}>
      <ServiceCatalogGroupDetailPage groupId={groupId} />
    </Suspense>
  );
}
