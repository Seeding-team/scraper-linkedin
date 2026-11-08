import { QuoteFormPreviewPage } from "@/modules/quotes";

export default async function QuoteFormPreviewRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuoteFormPreviewPage formId={id} />;
}
