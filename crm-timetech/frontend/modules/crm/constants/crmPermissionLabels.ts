/** Nhan hien thi dung chung cho "Nhom quyen"/Team CRM (migration 155) -
 * dung boi CrmPermissionModal, CrmPermissionGroupsTab, MemberManagementContent
 * (bang Tai khoan CRM) - tach rieng file de 3 noi khong bi lech nhan theo
 * thoi gian. Theo prototype markee_crm_account_permission_prototype_v4_full_flow.html. */
import type { CrmDataScope, CrmModuleKey } from "@/services/all-platform.service";

export const CRM_MODULE_DEFS: { key: CrmModuleKey; label: string }[] = [
  { key: "Lead", label: "Lead" },
  { key: "Customer", label: "Khách hàng" },
  { key: "Deal", label: "Deal / Cơ hội" },
  { key: "Quote", label: "Báo giá" },
  { key: "Product", label: "Sản phẩm / BOM" },
  { key: "Report", label: "Báo cáo" },
  { key: "Account", label: "Quản lý tài khoản" },
  { key: "Setting", label: "Cấu hình hệ thống" },
];

export const CRM_SCOPE_LABELS: Record<CrmDataScope, string> = {
  personal: "Cá nhân",
  team: "Team phụ trách",
  deal_assigned: "Deal được gán",
  workspace: "Workspace được chọn",
  system: "Toàn hệ thống",
};
