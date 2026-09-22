import { PublicQuotePage } from "@/modules/quotes";

// Alias ngan gon/than thien voi khach hang cho "/public/quotes/[token]" -
// render dung 1 component, khong trung logic. Ly do them route nay: link
// cu "<domain>/public/quotes/{token}" dung domain CRM noi bo (vd
// crm.markee.vn) - theo yeu cau doi sang duong dan "/baogia/{token}" tren
// domain cong khai rieng cua tung workspace (xem modules/quotes/utils/publicQuoteUrl.ts).
export default async function PublicQuoteBaoGiaRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicQuotePage token={token} />;
}
