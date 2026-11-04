import { QuoteFormBuilderPage } from "@/modules/quotes";

export default async function EditQuoteFormRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuoteFormBuilderPage formId={id} />;
}
