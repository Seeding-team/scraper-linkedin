import { ContractTemplatesPage } from "@/modules/contract-templates";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mẫu hợp đồng — Markee",
  description: "Thư viện mẫu hợp đồng để AI Contract Copilot tham chiếu khi soạn thảo.",
};

export default function ContractTemplatesRoute() {
  return <ContractTemplatesPage />;
}
