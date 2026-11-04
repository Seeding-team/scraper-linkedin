import { QuoteHomePage } from "@/modules/quotes";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mẫu báo giá — Markee",
  description: "Quản lý mẫu báo giá và danh sách báo giá đã tạo từ CRM.",
};

export default function QuotesRoute() {
  return <QuoteHomePage />;
}
