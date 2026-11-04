import { Metadata } from "next";
import { ZaloAccountsPageContent } from "@/components/all-platform/zalo/dashboard/ZaloAccountsPageContent";

export const metadata: Metadata = {
  title: "Quản lý tài khoản Zalo",
  description: "Quản lý đa tài khoản Zalo",
};

export default function AccountsPage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ZaloAccountsPageContent />
    </div>
  );
}
