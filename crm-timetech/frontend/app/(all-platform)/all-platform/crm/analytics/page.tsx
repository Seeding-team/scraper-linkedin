import { CrmAnalyticsGuard } from "@/modules/crm/components/CrmAnalyticsGuard";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "CRM Analytics - Markee",
  description: "Phan tich CRM tu du lieu Seeding hien co.",
};

export default function CrmAnalyticsRoute() {
  return <CrmAnalyticsGuard />;
}
