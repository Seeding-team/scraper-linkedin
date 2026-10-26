import { PublicQuoteFormPage } from "@/modules/quotes";

export default async function PublicQuoteFormRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicQuoteFormPage token={token} />;
}
