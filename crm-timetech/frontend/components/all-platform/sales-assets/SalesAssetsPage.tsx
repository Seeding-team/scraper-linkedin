"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, FileText, Plus, Search, Upload, X } from "lucide-react";
import { ActionMenu } from "@/modules/crm/components/ActionMenu";

import {
  getSalesAssetSourceLabel,
  getSalesAssetStatusLabel,
  getSalesAssetTypeLabel,
  SALES_ASSET_SOURCE_OPTIONS,
  SALES_ASSET_STATUS_OPTIONS,
  SALES_ASSET_TYPE_OPTIONS,
  salesAssetService,
  type SalesAsset,
  type SalesAssetInput,
  type SalesAssetSourceType,
  type SalesAssetStatus,
  type SalesAssetType,
} from "@/services/sales-asset.service";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import { cn } from "@/lib/utils";

type FormState = SalesAssetInput & {
  note: string;
};

const emptyForm: FormState = {
  customerLeadId: "",
  dealId: "",
  projectName: "",
  type: "proposal",
  title: "",
  version: "v1",
  sourceType: "canva",
  sourceUrl: "",
  description: "",
  note: "",
  status: "active",
};

function customerKey(customer: Customer): string {
  return (customer.phone || customer.email || customer.customer_name || customer.id).trim().toLowerCase();
}

function customerLabel(customer?: Customer | null) {
  if (!customer) return "";
  return [customer.customer_name, customer.company_name].filter(Boolean).join(" - ");
}

function dealProjectName(deal?: Customer | null) {
  if (!deal) return "";
  return deal.company_name || deal.customer_name || deal.service_package || "";
}

function toForm(asset?: SalesAsset): FormState {
  if (!asset) return { ...emptyForm };
  return {
    customerLeadId: asset.customerLeadId || "",
    dealId: asset.dealId || "",
    projectName: asset.projectName || "",
    type: asset.type,
    title: asset.title,
    version: asset.version || "v1",
    sourceType: asset.sourceType || "external",
    sourceUrl: asset.sourceUrl || asset.shareUrl || "",
    fileUrl: asset.fileUrl || "",
    description: asset.description,
    note: asset.description,
    status: asset.status,
  };
}

// Tai file len truoc (goi API upload co san), sau do link tra ve duoc dung lam
// ca sourceUrl (de "Mo link"/"Copy link"/gui CRM van hoat dong khong doi backend)
// lan fileUrl (de biet day la file tai len, khong phai link ngoai).
function isUploadedAsset(asset?: SalesAsset | null): boolean {
  return Boolean(asset?.fileUrl);
}

function toInput(form: FormState): SalesAssetInput {
  return {
    customerLeadId: form.customerLeadId || null,
    dealId: form.dealId || null,
    projectName: form.projectName?.trim(),
    type: form.type,
    title: form.title.trim(),
    version: form.version?.trim() || "v1",
    sourceType: form.sourceType,
    sourceUrl: form.sourceUrl?.trim(),
    description: form.note?.trim() || form.description?.trim(),
    status: form.status,
  };
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function SalesAssetsPage() {
  const [assets, setAssets] = useState<SalesAsset[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<SalesAssetType | "">("");
  const [statusFilter, setStatusFilter] = useState<SalesAssetStatus | "">("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<SalesAsset | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  // "link" = dien URL co san (Canva/Docs/Drive...). "upload" = chon file tu may,
  // tai len truoc roi moi luu ban ghi - khong con bat dien URL bang tay nua.
  const [mode, setMode] = useState<"link" | "upload">("link");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const uniqueCustomers = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((customer) => {
      const key = customerKey(customer);
      if (!map.has(key)) map.set(key, customer);
    });
    return [...map.values()];
  }, [customers]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerLeadId) || null,
    [customers, form.customerLeadId],
  );
  const selectedCustomerKey = selectedCustomer ? customerKey(selectedCustomer) : "";
  const dealOptions = useMemo(
    () => customers.filter((customer) => selectedCustomerKey && customerKey(customer) === selectedCustomerKey),
    [customers, selectedCustomerKey],
  );
  const projectOptions = useMemo(
    () => [...new Set(assets.map((asset) => asset.projectName).filter(Boolean))],
    [assets],
  );

  const loadAssets = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await salesAssetService.list({
        search,
        customerLeadId: customerFilter,
        projectName: projectFilter,
        type: typeFilter,
        status: statusFilter,
        includeArchived: true,
      });
      setAssets(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        const response = await customerLeadService.getAll({ page: 1, page_size: 500 });
        setCustomers(response.items || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được danh sách khách hàng CRM.");
      }
    });
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadAssets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerFilter, projectFilter, typeFilter, statusFilter]);

  const openCreate = (initialMode: "link" | "upload" = "link") => {
    setEditing(null);
    setForm(toForm());
    setMode(initialMode);
    setUploadFile(null);
    setFormOpen(true);
  };

  const openEdit = (asset: SalesAsset) => {
    setEditing(asset);
    setForm(toForm(asset));
    setMode(isUploadedAsset(asset) ? "upload" : "link");
    setUploadFile(null);
    setFormOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    let fileUrl = form.fileUrl || "";
    if (mode === "upload") {
      if (uploadFile) {
        setUploading(true);
        try {
          const uploaded = await salesAssetService.upload(uploadFile, editing?.id);
          fileUrl = uploaded.url;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Tải file lên thất bại.");
          setUploading(false);
          return;
        }
        setUploading(false);
      }
      if (!fileUrl) {
        setError("Chọn file để tải lên.");
        return;
      }
    } else if (!isValidUrl(form.sourceUrl || "")) {
      setError("URL phải hợp lệ và bắt đầu bằng http:// hoặc https://");
      return;
    }

    setSaving(true);
    try {
      const input = toInput(form);
      if (mode === "upload") {
        input.fileUrl = fileUrl;
        input.sourceUrl = fileUrl;
        input.sourceType = "external";
      }
      if (editing) {
        await salesAssetService.update(editing.id, input);
        setNotice(mode === "upload" ? "Đã lưu tài liệu tải lên." : "Đã lưu link tài liệu.");
      } else {
        await salesAssetService.create(input);
        setNotice(mode === "upload" ? "Đã tải lên tài liệu." : "Đã thêm link tài liệu.");
      }
      setFormOpen(false);
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (asset: SalesAsset) => {
    if (!window.confirm(`Lưu trữ "${asset.title}"?`)) return;
    try {
      await salesAssetService.archive(asset.id);
      setNotice("Đã lưu trữ tài liệu.");
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (asset: SalesAsset) => {
    if (!window.confirm(`Xóa vĩnh viễn "${asset.title}"? Không thể hoàn tác.`)) return;
    try {
      await salesAssetService.remove(asset.id);
      setNotice("Đã xóa tài liệu.");
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyLink = async (asset: SalesAsset) => {
    if (!asset.shareUrl) return;
    await navigator.clipboard.writeText(asset.shareUrl);
    setNotice("Đã copy link.");
  };

  const handleCustomerChange = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    setForm((current) => ({
      ...current,
      customerLeadId: customerId,
      dealId: "",
      projectName: current.projectName || dealProjectName(customer),
    }));
  };

  const handleDealChange = (dealId: string) => {
    const deal = customers.find((item) => item.id === dealId);
    setForm((current) => ({
      ...current,
      dealId,
      projectName: dealProjectName(deal) || current.projectName,
    }));
  };

  return (
    <main className="min-h-screen bg-white px-4 py-5 text-slate-950 md:px-6">
      <div className="mx-auto w-full max-w-none space-y-5">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">Lưu link Proposal, Sale Kit theo khách hàng, dự án và phiên bản.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => openCreate("upload")} className="crm-secondary-button">
              <Upload size={17} />
              Tải lên
            </button>
            <button type="button" onClick={() => openCreate("link")} className="crm-primary-button">
              <Plus size={17} />
              Thêm link
            </button>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* flex-wrap thay vi grid cot co dinh - moi input co min-width rieng, tu
             xuong hang 2 khi khong du cho o man laptop thay vi bi bop het chu. */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void loadAssets();
                }}
                placeholder="Tìm khách hàng, dự án, tên tài liệu, phiên bản..."
                className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
              />
            </label>
            <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-11 min-w-[160px] flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none">
              <option value="">Tất cả khách hàng</option>
              {uniqueCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
            </select>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-11 min-w-[150px] flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none">
              <option value="">Tất cả dự án</option>
              {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as SalesAssetType | "")} className="h-11 min-w-[130px] flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none">
              <option value="">Tất cả loại</option>
              {SALES_ASSET_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SalesAssetStatus | "")} className="h-11 min-w-[140px] flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none">
              <option value="">Tất cả trạng thái</option>
              {SALES_ASSET_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" onClick={() => void loadAssets()} className="crm-primary-button h-11 shrink-0">
              Tìm kiếm
            </button>
          </div>
        </section>

        {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</div> : null}
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

        {/* Man hinh hep: the/card doc thay vi bang nhieu cot cuon ngang trong 1
           container be (kho doc, cot bi cat) - xem yeu cau "mobile/tablet". */}
        <section className="md:hidden space-y-2.5">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Đang tải tài liệu...</div>
          ) : assets.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Chưa có link Proposal / Sale Kit.</div>
          ) : (
            assets.map((asset) => (
              <div key={asset.id} className={cn("rounded-2xl border border-slate-200 bg-white p-4 shadow-sm", asset.status === "archived" && "bg-slate-50 text-slate-400")}>
                <div className="flex items-start justify-between gap-2">
                  {asset.shareUrl ? (
                    <a href={asset.shareUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-bold text-slate-950 hover:text-rose-600">
                      <FileText size={16} className="shrink-0 text-slate-400" />
                      {asset.title}
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 font-bold text-slate-950">
                      <FileText size={16} className="shrink-0 text-slate-400" />
                      {asset.title}
                    </div>
                  )}
                  <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold", asset.status === "active" ? "bg-emerald-100 text-emerald-700" : asset.status === "inactive" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>
                    {getSalesAssetStatusLabel(asset.status)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {asset.customerName || "-"}{asset.projectName ? ` · ${asset.projectName}` : ""}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{getSalesAssetTypeLabel(asset.type)}</span>
                  <span>{asset.version || "-"}</span>
                  <span>{getSalesAssetSourceLabel(asset.sourceType)}</span>
                  <span>{formatDate(asset.updatedAt)}</span>
                </div>
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-2">
                  <button type="button" onClick={() => void copyLink(asset)} disabled={!asset.shareUrl} className="crm-icon-action" title="Copy link">
                    <Copy size={16} />
                  </button>
                  <ActionMenu
                    items={[
                      { key: "edit", label: "Chỉnh sửa", onSelect: () => openEdit(asset) },
                      {
                        key: "archive",
                        label: "Lưu trữ",
                        disabled: asset.status === "archived",
                        onSelect: () => void archive(asset),
                      },
                      { key: "delete", label: "Xóa", danger: true, onSelect: () => void remove(asset) },
                    ]}
                  />
                </div>
              </div>
            ))
          )}
        </section>

        <section className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Khách hàng</th>
                  <th className="px-4 py-3">Dự án</th>
                  <th className="px-4 py-3">Tên tài liệu</th>
                  <th className="px-4 py-3">Loại</th>
                  <th className="px-4 py-3">Phiên bản</th>
                  <th className="px-4 py-3">Nguồn</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Cập nhật</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">Đang tải tài liệu...</td></tr>
                ) : assets.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">Chưa có link Proposal / Sale Kit.</td></tr>
                ) : (
                  assets.map((asset) => (
                    <tr key={asset.id} className={cn(asset.status === "archived" && "bg-slate-50 text-slate-400")}>
                      <td className="px-4 py-4">
                        <div className="font-bold text-slate-950">{asset.customerName || "-"}</div>
                        {asset.customerCompanyName ? <div className="text-xs text-slate-500">{asset.customerCompanyName}</div> : null}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{asset.projectName || "-"}</td>
                      <td className="px-4 py-4">
                        {asset.shareUrl ? (
                          <a
                            href={asset.shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="flex items-center gap-2 font-bold text-slate-950 hover:text-rose-600 hover:underline"
                            title="Bấm để mở link tài liệu"
                          >
                            <FileText size={16} className="text-slate-400" />
                            {asset.title}
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 font-bold text-slate-950">
                            <FileText size={16} className="text-slate-400" />
                            {asset.title}
                          </div>
                        )}
                        {asset.description ? <div className="mt-1 line-clamp-1 text-xs text-slate-500">{asset.description}</div> : null}
                      </td>
                      <td className="px-4 py-4 font-semibold">{getSalesAssetTypeLabel(asset.type)}</td>
                      <td className="px-4 py-4 font-semibold text-slate-700">{asset.version || "-"}</td>
                      <td className="px-4 py-4 text-slate-600">{getSalesAssetSourceLabel(asset.sourceType)}</td>
                      <td className="px-4 py-4">
                        <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold", asset.status === "active" ? "bg-emerald-100 text-emerald-700" : asset.status === "inactive" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>
                          {getSalesAssetStatusLabel(asset.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-500">{formatDate(asset.updatedAt)}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end items-center gap-1">
                          <button type="button" onClick={() => void copyLink(asset)} disabled={!asset.shareUrl} className="crm-icon-action" title="Copy link">
                            <Copy size={16} />
                          </button>
                          <ActionMenu
                            items={[
                              { key: "edit", label: "Chỉnh sửa", onSelect: () => openEdit(asset) },
                              {
                                key: "archive",
                                label: "Lưu trữ",
                                disabled: asset.status === "archived",
                                onSelect: () => void archive(asset),
                              },
                              { key: "delete", label: "Xóa", danger: true, onSelect: () => void remove(asset) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {formOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4">
          <form onSubmit={submit} className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">
                  {mode === "upload"
                    ? editing ? "Chỉnh sửa tài liệu tải lên" : "Tải lên tài liệu"
                    : editing ? "Chỉnh sửa link tài liệu" : "Thêm link tài liệu"}
                </h2>
                <p className="text-sm text-slate-500">
                  {mode === "upload"
                    ? "Tải file từ máy lên, gắn với khách hàng và dự án."
                    : "Gắn link Canva, Docs, Drive hoặc link ngoài với khách hàng và dự án."}
                </p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">Đóng</button>
            </div>
            <div className="max-h-[68vh] overflow-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-bold">Khách hàng CRM</span>
                  <select value={form.customerLeadId || ""} onChange={(event) => handleCustomerChange(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500">
                    <option value="">Chọn khách hàng</option>
                    {uniqueCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-bold">Deal / dự án có sẵn</span>
                  <select value={form.dealId || ""} onChange={(event) => handleDealChange(event.target.value)} disabled={!form.customerLeadId} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500 disabled:bg-slate-50">
                    <option value="">Không gắn deal</option>
                    {dealOptions.map((deal) => <option key={deal.id} value={deal.id}>{dealProjectName(deal) || deal.id}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-sm font-bold">Tên dự án</span>
                  <input value={form.projectName || ""} onChange={(event) => setForm({ ...form, projectName: event.target.value })} placeholder="VD: Chatbot CSKH Q3, Website mới..." className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" />
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-sm font-bold">Tên tài liệu</span>
                  <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-bold">Loại</span>
                  <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as SalesAssetType })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none">
                    {SALES_ASSET_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-bold">Phiên bản</span>
                  <input value={form.version || ""} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="v1, v2, Final" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500" />
                </label>
                {mode === "link" ? (
                  <label className="space-y-1.5">
                    <span className="text-sm font-bold">Nguồn</span>
                    <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as SalesAssetSourceType })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none">
                      {SALES_ASSET_SOURCE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                ) : null}
                <label className="space-y-1.5">
                  <span className="text-sm font-bold">Trạng thái</span>
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as SalesAssetStatus })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none">
                    {SALES_ASSET_STATUS_OPTIONS.filter((item) => item.value !== "archived").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                {mode === "upload" ? (
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-bold">File tài liệu</span>
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 px-3 py-3">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">
                        <Upload size={15} />
                        Chọn file
                        <input
                          type="file"
                          className="hidden"
                          onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                        />
                      </label>
                      {uploadFile ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                          <FileText size={15} className="text-slate-400" />
                          {uploadFile.name}
                          <button type="button" onClick={() => setUploadFile(null)} className="text-slate-400 hover:text-slate-600">
                            <X size={14} />
                          </button>
                        </span>
                      ) : form.fileUrl ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                          <FileText size={15} className="text-slate-400" />
                          Đã có file - chọn file mới để thay thế
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">Chưa chọn file</span>
                      )}
                    </div>
                  </label>
                ) : (
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-bold">Link tài liệu</span>
                    <input required value={form.sourceUrl || ""} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://www.canva.com/..." className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500" />
                  </label>
                )}
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-sm font-bold">Ghi chú</span>
                  <textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-500" />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Hủy</button>
              <button
                type="submit"
                disabled={saving || uploading || !form.title.trim() || (mode === "link" ? !form.sourceUrl?.trim() : !uploadFile && !form.fileUrl)}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? "Đang tải file..." : saving ? "Đang lưu..." : mode === "upload" ? "Lưu tài liệu" : "Lưu link"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
