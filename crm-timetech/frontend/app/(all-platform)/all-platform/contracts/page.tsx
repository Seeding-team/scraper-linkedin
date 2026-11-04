import { ContractHomePage } from "@/modules/contracts";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hợp đồng — Markee",
  description: "Quản lý hợp đồng, ký kết và soạn thảo hợp đồng bằng AI Contract Copilot.",
};

export default function ContractsRoute() {
  return <ContractHomePage />;
}
