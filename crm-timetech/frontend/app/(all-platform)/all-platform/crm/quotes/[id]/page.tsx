import { Suspense } from "react";
import { InternalQuoteWorkspacePage } from "@/modules/quotes";

export default async function CrmQuoteDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <InternalQuoteWorkspacePage quoteId={id} />
    </Suspense>
  );
}
