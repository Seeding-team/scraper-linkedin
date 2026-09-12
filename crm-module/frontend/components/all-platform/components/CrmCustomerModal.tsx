"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  customerLeadService,
  type ContractStatus,
  type Customer,
  type SDRUser,
  type SourcePlatform,
  type DealStage,
  SOURCE_PLATFORM_OPTIONS,
  INDUSTRY_OPTIONS,
  CITY_OPTIONS,
  SERVICE_PACKAGE_OPTIONS,
  DEAL_STAGE_META,
  PAYMENT_STATUS_OPTIONS,
} from "@/services/customer-lead.service";
import { toast } from "sonner";
import { CurrencyInput } from "@/components/CurrencyInput";
import { useCrmCategoryCodeOptions, useCrmCategoryLabels } from "@/modules/crm/components/CrmCategorySelect";

interface CrmCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer?: Customer | null;
  /** Conv ID of the current FB/Zalo conversation (for auto-detection) */
  defaultConvId?: string;
  /** Auto-detected customer name from conversation */
  defaultCustomerName?: string;
  /** Platform context — if provided, pre-selects source_platform */
  defaultSourcePlatform?: SourcePlatform;
  onSuccess?: (customer: Customer) => void;
}

/** Khởi tạo form rỗng cho tạo lead mới. */
const emptyForm = (): Partial<Customer> => ({
  customer_name: "",
  company_name: "",
  phone: "",
  email: "",
  website: "",
  conv_id: "",
  source_platform: "FB_Inbox",
  // Gói dịch vụ — optional, không bắt buộc khi tạo lead
  service_package: null,
  lifetime_value: 0,
  contract_status: "dang_xu_ly",
  contract_signed_at: null,
  warranty_expires_at: null,
  payment_due_date: null,
  payment_status: "unpaid",
  customer_since: null,
  care_note: null,
  last_care_at: null,
  last_attachment_name: null,
  last_attachment_url: null,
  note: "",
  // CRM pipeline
  deal_stage: "new_lead",
  // Phân công
  leaded_by: "",
  sdr_id: "",
  is_assigned: false,
});

const dateInputValue = (value?: string | null) => (value ? String(value).slice(0, 10) : "");
const dateTimeInputValue = (value?: string | null) => (value ? String(value).slice(0, 16) : "");
const toIsoDate = (value: string) => (value ? new Date(value).toISOString() : null);

const CONTRACT_STATUS_OPTIONS: { value: ContractStatus; label: string }[] = [
  { value: "dang_xu_ly", label: "Đang xử lý" },
  { value: "da_bao_gia", label: "Đã báo giá" },
  { value: "da_chot", label: "Đã chốt" },
  { value: "active", label: "Đang hoạt động" },
  { value: "completed", label: "Đã hoàn thành" },
  { value: "maintenance", label: "Bảo trì / bảo hành" },
];

export function CrmCustomerModal({
  isOpen,
  onClose,
  customer,
  defaultConvId,
  defaultCustomerName,
  defaultSourcePlatform,
  onSuccess,
}: CrmCustomerModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sdrs, setSdrs] = useState<SDRUser[]>([]);
  const [leaders, setLeaders] = useState<SDRUser[]>([]);
  const [formData, setFormData] = useState<Partial<Customer>>(emptyForm());
  const { options: sourceOptions } = useCrmCategoryCodeOptions("crm_source", SOURCE_PLATFORM_OPTIONS);
  const { labels: cityOptions } = useCrmCategoryLabels("crm_city", CITY_OPTIONS);
  const { options: industryOptions } = useCrmCategoryCodeOptions(
    "crm_industry",
    INDUSTRY_OPTIONS.map((value) => ({ value, label: value })),
  );
  const { options: servicePackageOptions } = useCrmCategoryCodeOptions("crm_service_package", SERVICE_PACKAGE_OPTIONS);
  const { options: contractStatusOptions } = useCrmCategoryCodeOptions("crm_contract_status", CONTRACT_STATUS_OPTIONS);
  const { options: paymentStatusOptions } = useCrmCategoryCodeOptions("crm_payment_status", PAYMENT_STATUS_OPTIONS);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isOpen) return;

    if (customer) {
      setFormData({ ...customer });
    } else {
      const src = defaultSourcePlatform ?? "FB_Inbox";
      setFormData({
        ...emptyForm(),
        conv_id: defaultConvId ?? "",
        customer_name: defaultCustomerName ?? "",
        source_platform: src,
      });
    }

    customerLeadService.getSdrs().then(setSdrs).catch(() => {});
    // Leaders pool: cùng nguồn với SDRs (admin/leader). Tách riêng state chỉ
    // cho semantic rõ ràng — nếu sau này tách bảng leaders thì không phải sửa UI.
    customerLeadService.getSdrs().then(setLeaders).catch(() => {});
  }, [isOpen, customer, defaultConvId, defaultCustomerName, defaultSourcePlatform]);

  if (!isOpen) return null;

  const set = <K extends keyof Customer>(key: K, value: Customer[K]) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const selectedLeaderId = formData.leaded_by?.trim() || "";
  const selectedSdrId = formData.sdr_id?.trim() || "";
  const currentLeaderName = customer?.leader_name?.trim() || "";
  const currentSdrName = customer?.sdr_name?.trim() || "";

  const resolvedLeaderId =
    selectedLeaderId ||
    leaders.find((item) => item.name.trim().toLowerCase() === currentLeaderName.toLowerCase())?.id ||
    "";
  const resolvedSdrId =
    selectedSdrId ||
    sdrs.find((item) => item.name.trim().toLowerCase() === currentSdrName.toLowerCase())?.id ||
    "";

  const leaderOptions =
    resolvedLeaderId || !currentLeaderName || leaders.some((item) => item.name === currentLeaderName)
      ? leaders
      : [{ id: `current-leader-${customer?.id ?? "new"}`, name: currentLeaderName, role: "leader" }, ...leaders];

  const sdrOptions =
    resolvedSdrId || !currentSdrName || sdrs.some((item) => item.name === currentSdrName)
      ? sdrs
      : [{ id: `current-sdr-${customer?.id ?? "new"}`, name: currentSdrName, role: "SDR" }, ...sdrs];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customer_name?.trim()) {
      toast.error("Vui lòng nhập tên khách hàng");
      return;
    }
    setLoading(true);
    try {
      // CHỈ gửi các field có trong form. Tránh ghi đè các trường cũ (service_package,
      // tags, contract_*, ...) về null/empty khi user chỉnh sửa thông tin lead.
      const payload: Partial<Customer> = {
        customer_name: formData.customer_name?.trim(),
        company_name: formData.company_name?.trim() || null,
        phone: formData.phone?.trim() || null,
        email: formData.email?.trim() || null,
        website: formData.website?.trim() || null,
        address: formData.address?.trim() || null,
        city: formData.city || null,
        industry: formData.industry || null,
        tax_code: formData.tax_code?.trim() || null,
        conv_id: formData.conv_id?.trim() || null,
        source_platform: formData.source_platform,
        // Pipeline fields — form đã thu thập nhưng trước đây không gửi
        decision_maker: formData.decision_maker?.trim() || null,
        estimated_budget: formData.estimated_budget ? Number(formData.estimated_budget) : 0,
        follow_up_date: formData.follow_up_date || null,
        // Optional — chỉ gửi khi user đã chọn, tránh ghi đè deal cũ về null
        service_package: formData.service_package || null,
        lifetime_value: formData.lifetime_value ? Number(formData.lifetime_value) : 0,
        contract_status: formData.contract_status ?? "dang_xu_ly",
        contract_signed_at: formData.contract_signed_at || null,
        warranty_expires_at: formData.warranty_expires_at || null,
        payment_due_date: formData.payment_due_date || null,
        payment_status: formData.payment_status ?? "unpaid",
        customer_since: formData.customer_since || null,
        care_note: formData.care_note?.trim() || null,
        last_care_at: formData.last_care_at || null,
        last_attachment_name: formData.last_attachment_name?.trim() || null,
        last_attachment_url: formData.last_attachment_url?.trim() || null,
        note: formData.note?.trim() || null,
        deal_stage: formData.deal_stage ?? "new_lead",
        leaded_by: (formData.leaded_by?.trim() || resolvedLeaderId || "") || null,
        sdr_id: (formData.sdr_id?.trim() || resolvedSdrId || "") || null,
        is_assigned: !!(formData.sdr_id?.trim() || resolvedSdrId),
      };

      let res: any;
      if (customer?.id) {
        res = await customerLeadService.update(customer.id, payload);
      } else {
        res = await customerLeadService.create(payload);
      }

      if (res.success) {
        toast.success(customer?.id ? "Cập nhật khách hàng thành công!" : "Lưu khách hàng thành công!");
        onSuccess?.(res.data as Customer);
        onClose();
      } else {
        toast.error(res.message || "Có lỗi xảy ra");
      }
    } catch {
      toast.error("Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
      style={{ position: "fixed", inset: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] my-4"
        style={{ width: "100%", maxWidth: "672px", minWidth: "300px" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 rounded-t-2xl shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {customer ? "Chỉnh sửa Khách hàng" : "Lưu Khách hàng (CRM)"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {formData.source_platform
                ? `Nguồn: ${sourceOptions.find((o) => o.value === formData.source_platform)?.label ?? formData.source_platform}`
                : "Chưa chọn nguồn"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          <form id="crmForm" onSubmit={handleSubmit} className="space-y-5">

            {/* ── Section: Thông tin cơ bản ── */}
            <div>
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">
                Thông tin cơ bản
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* Tên KH */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Tên khách hàng <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text" required
                    value={formData.customer_name ?? ""}
                    onChange={(e) => set("customer_name", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="Nguyễn Văn A"
                  />
                </div>

                {/* Công ty */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Tên công ty / Dự án
                  </label>
                  <input
                    type="text"
                    value={formData.company_name ?? ""}
                    onChange={(e) => set("company_name", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="Công ty TNHH ABC..."
                  />
                </div>

                {/* Điện thoại */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Điện thoại</label>
                  <input
                    type="text"
                    value={formData.phone ?? ""}
                    onChange={(e) => set("phone", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="0912 345 678"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email ?? ""}
                    onChange={(e) => set("email", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="khach@email.com"
                  />
                </div>

                {/* Website */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Website</label>
                  <input
                    type="text"
                    value={formData.website ?? ""}
                    onChange={(e) => set("website", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="https://..."
                  />
                </div>

                {/* Mã số thuế */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Mã số thuế</label>
                  <input
                    type="text"
                    value={formData.tax_code ?? ""}
                    onChange={(e) => set("tax_code", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="0312345678"
                  />
                </div>
              </div>
            </div>

            {/* ── Section: Địa chỉ (tóm tắt) ── */}
            <div>
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">
                Địa chỉ
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Địa chỉ</label>
                  <input
                    type="text"
                    value={formData.address ?? ""}
                    onChange={(e) => set("address", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm"
                    placeholder="Số nhà, đường, phường/xã..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Thành phố</label>
                  <select
                    value={formData.city ?? ""}
                    onChange={(e) => set("city", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm bg-white"
                  >
                    <option value="">-- Chọn --</option>
                    {cityOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Lĩnh vực</label>
                  <select
                    value={formData.industry ?? ""}
                    onChange={(e) => set("industry", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm bg-white"
                  >
                    <option value="">-- Chọn --</option>
                    {industryOptions.map((ind) => (
                      <option key={ind.value} value={ind.value}>{ind.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Section: Nguồn & Gói dịch vụ ── */}
            <div>
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">
                Nguồn & Gói dịch vụ
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nguồn</label>
                  <select
                    value={formData.source_platform ?? "FB_Inbox"}
                    onChange={(e) => set("source_platform", e.target.value as SourcePlatform)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm bg-white"
                  >
                    {sourceOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Gói dịch vụ <span className="text-slate-400 font-normal">(tuỳ chọn)</span>
                  </label>
                  <select
                    value={formData.service_package ?? ""}
                    onChange={(e) => set("service_package", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm bg-white"
                  >
                    <option value="">-- Chưa chọn --</option>
                    {servicePackageOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Section: Quản lý Deal (CRM Pipeline) ──
                Khớp với các cột deal_stage/decision_maker/estimated_budget/follow_up_date
                trong migration 021_crm_pipeline.sql. Đặt ngay sau Nguồn để gây chú ý:
                người dùng tạo khách mới nên chọn stage phù hợp từ đầu. */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase text-indigo-700 tracking-wider">
                  Quản lý Deal (Pipeline)
                </p>
                {formData.deal_stage && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${
                      DEAL_STAGE_META[formData.deal_stage as DealStage]?.headerClass ?? "bg-slate-400"
                    }`}
                  >
                    {DEAL_STAGE_META[formData.deal_stage as DealStage]?.label ?? formData.deal_stage}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Deal stage */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Giai đoạn deal
                  </label>
                  <select
                    value={formData.deal_stage ?? "new_lead"}
                    onChange={(e) => set("deal_stage", e.target.value as DealStage)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm bg-white"
                  >
                    {(Object.entries(DEAL_STAGE_META) as [DealStage, typeof DEAL_STAGE_META[DealStage]][])
                      .sort((a, b) => a[1].order - b[1].order)
                      .map(([key, meta]) => (
                        <option key={key} value={key}>
                          {meta.label} — {meta.description}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Decision maker — chỉ cần từ qualified trở đi */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Người quyết định (DM)
                  </label>
                  <input
                    type="text"
                    value={formData.decision_maker ?? ""}
                    onChange={(e) => set("decision_maker", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                    placeholder="Giám đốc, chủ đầu tư…"
                  />
                </div>

                {/* Estimated budget */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Ngân sách ước tính (VNĐ)
                  </label>
                  <CurrencyInput
                    value={formData.estimated_budget ?? null}
                    onChange={(n) => set("estimated_budget", n ?? 0)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                    placeholder="50.000.000"
                  />
                </div>

                {/* Follow-up date — cho on_hold / dự kiến gọi lại */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Follow-up dự kiến
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      formData.follow_up_date
                        ? String(formData.follow_up_date).slice(0, 16)
                        : ""
                    }
                    onChange={(e) =>
                      set(
                        "follow_up_date",
                        e.target.value ? new Date(e.target.value).toISOString() : null,
                      )
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Bắt buộc khi chuyển sang On Hold. Có thể đặt trước để nhắc nhở.
                  </p>
                </div>

                {/* ── Hợp đồng & báo giá (gộp vào Pipeline để khớp flow SMB) ── */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tên file hợp đồng / báo giá</label>
                  <input
                    type="text"
                    value={formData.last_attachment_name ?? ""}
                    onChange={(e) => set("last_attachment_name", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                    placeholder="Bao_gia_ABC.pdf"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Link báo giá / hợp đồng</label>
                  <input
                    type="url"
                    value={formData.last_attachment_url ?? ""}
                    onChange={(e) => set("last_attachment_url", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                    placeholder="https://..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Trạng thái hợp đồng</label>
                  <select
                    value={formData.contract_status ?? "dang_xu_ly"}
                    onChange={(e) => set("contract_status", e.target.value as Customer["contract_status"])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm bg-white"
                  >
                    {contractStatusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Trạng thái thanh toán</label>
                  <select
                    value={formData.payment_status ?? "unpaid"}
                    onChange={(e) => set("payment_status", e.target.value as Customer["payment_status"])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm bg-white"
                  >
                    {paymentStatusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày cần thanh toán</label>
                  <input
                    type="date"
                    value={dateInputValue(formData.payment_due_date)}
                    onChange={(e) => set("payment_due_date", toIsoDate(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Hạn khách cần thanh toán kỳ hiện tại/tiếp theo — dùng để lọc khách còn nợ tiền.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Giá trị hợp đồng / LTV (VND)</label>
                  <CurrencyInput
                    value={formData.lifetime_value ?? null}
                    onChange={(n) => set("lifetime_value", n ?? 0)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                    placeholder="20.000.000"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày ký hợp đồng</label>
                  <input
                    type="date"
                    value={dateInputValue(formData.contract_signed_at)}
                    onChange={(e) => set("contract_signed_at", toIsoDate(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Hết hạn bảo hành</label>
                  <input
                    type="date"
                    value={dateInputValue(formData.warranty_expires_at)}
                    onChange={(e) => set("warranty_expires_at", toIsoDate(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày thành khách hàng</label>
                  <input
                    type="date"
                    value={dateInputValue(formData.customer_since)}
                    onChange={(e) => set("customer_since", toIsoDate(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Lần chăm sóc gần nhất</label>
                  <input
                    type="datetime-local"
                    value={dateTimeInputValue(formData.last_care_at)}
                    onChange={(e) => set("last_care_at", e.target.value ? new Date(e.target.value).toISOString() : null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ghi chú chăm sóc / hợp đồng</label>
                  <textarea
                    value={formData.care_note ?? ""}
                    onChange={(e) => set("care_note", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm min-h-[72px]"
                    placeholder="Tình trạng hợp đồng, ngày tháng cần theo dõi, ghi chú chăm sóc..."
                  />
                </div>
              </div>
            </div>



            {/* ── Section: Ghi chú ── */}
            <div>
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">
                Ghi chú
              </p>
              <textarea
                value={formData.note ?? ""}
                onChange={(e) => set("note", e.target.value || null)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm min-h-[90px]"
                placeholder="Yêu cầu cụ thể, ghi chú liên lạc, mục tiêu kinh doanh…"
              />
            </div>


            {/* ── Section: Phân công ── */}
            <div>
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">
                Phân công
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* Người lead (leaded_by) — KPI lead của người này sẽ +1 khi tạo deal */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Người lead
                  </label>
                  <select
                    value={resolvedLeaderId}
                    onChange={(e) => set("leaded_by", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm bg-white"
                  >
                    <option value="">-- Chưa gán --</option>
                    {leaderOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.role ? ` (${u.role})` : ""}
                      </option>
                    ))}
                  </select>
                  {!resolvedLeaderId && currentLeaderName && (
                    <p className="mt-1 text-[11px] text-slate-500">Hiện tại: {currentLeaderName}</p>
                  )}
                </div>

                {/* Người xử lý (sdr_id) — sẽ xử lý deal này */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Người xử lý (SDR)
                  </label>
                  <select
                    value={resolvedSdrId}
                    onChange={(e) => set("sdr_id", e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-sm bg-white"
                  >
                    <option value="">-- Chưa giao --</option>
                    {sdrOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.role ? ` (${s.role})` : ""}
                      </option>
                    ))}
                  </select>
                  {!resolvedSdrId && currentSdrName && (
                    <p className="mt-1 text-[11px] text-slate-500">Hiện tại: {currentSdrName}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Hidden conv_id */}
            {formData.conv_id && (
              <input type="hidden" value={formData.conv_id} />
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium transition-colors"
          >
            Hủy
          </button>
          <button
            type="submit"
            form="crmForm"
            disabled={loading}
            className="px-5 py-2 text-sm text-white bg-primary rounded-xl hover:opacity-90 font-medium transition-colors disabled:opacity-50 shadow-sm shadow-red-500/20 flex items-center gap-1"
          >
            {loading ? "Đang lưu..." : "Lưu khách hàng"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
