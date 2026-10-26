import { Suspense } from "react";
import { QuoteDetailPage, InternalQuoteWorkspacePage } from "@/modules/quotes";

export default async function QuoteDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const sParams = searchParams ? await searchParams : {};
  const isDocumentView = sParams.view === "document" || sParams.view === "pdf" || sParams.view === "print";

  return (
    <Suspense fallback={null}>
      {isDocumentView ? (
        <QuoteDetailPage quoteId={id} />
      ) : (
        <InternalQuoteWorkspacePage quoteId={id} />
      )}
    </Suspense>
  );
}
