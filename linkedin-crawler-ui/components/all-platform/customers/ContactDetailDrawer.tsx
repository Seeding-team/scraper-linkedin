"use client";

/**
 * ContactDetailDrawer — Contact 360: sheet bên phải hiển thị context của 1
 * Người liên hệ (crm_contacts), KHÔNG phải Company 360 (Customer). Model:
 * crm_customers = Công ty/Tổ chức, crm_contacts = 1 người thuộc Customer đó,
 * customer_leads (Deal) có `primary_contact_id` (migration 134) trỏ tới
 * ĐÚNG 1 Contact phụ trách chính — Contact 360 chỉ hiện Deal/Quote/Hợp đồng
 * đi qua quan hệ nay, KHÔNG phải mọi Deal của Customer cha (đó là Company
 * 360 — xem CrmCustomerDetailPage.tsx). Quyền xem = quyền xem Customer cha
 * (server enforce qua get_customer() lồng trong mọi endpoint /crm/contacts/*),
 * không tự suy quyền riêng.
 *
 * Tab "Cơ hội" click 1 Deal -> gọi onOpenDeal(dealId), đúng callback
 * openDealWorkspace() mà CrmCustomerDetailPage.tsx đã dùng cho DealDetailDrawer
 * của chính nó — TÁI SỬ DỤNG y nguyên 1 instance đó, không mount thêm 1 Deal
 * detail UI thứ hai.
 */

import { useEffect, useState } from "react";
import { X, Phone, Mail, Building2, Briefcase, Loader2 } from "lucide-react";
import { API_BASE_URL, API_KEY } from "@/lib/env";

type ContactRow = {
  id: string;
  customer_id: string;
  name: string;
  position?: string | null;
  position_label_snapshot?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean | null;
  created_at?: string | null;
};

type CustomerRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
};

type DealRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  deal_stage?: string | null;
  estimated_budget?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type QuoteRow = {
  id: string;
  quoteNumber?: string | null;
  quote_number?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  total_amount?: number | null;
  versionNumber?: number | null;
  version_number?: number | null;
};

type ContractRow = {
  id: string;
  contract_number?: string | null;
  status?: string | null;
  contract_value?: number | null;
};

type ActivityRow = {
  id: string;
  action?: string | null;
  to_stage?: string | null;
  note?: string | null;
  actor_name?: string | null;
  created_at: string;
};

type ProjectRow = {
  id: string;
  project_code?: string | null;
  name?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type RelatedPayload = {
  contact: ContactRow;
  customer: CustomerRow;
  projects: ProjectRow[];
  deals: DealRow[];
  quotes: QuoteRow[];
  contracts: ContractRow[];
  kpi: { deal_count: number; quote_count: number; contract_count: number; total_value: number; project_count?: number };
};

type ContactTab = "overview" | "activity" | "projects" | "deals" | "quotes" | "contracts" | "documents";

const CONTACT_TABS: { key: ContactTab; label: string }[] = [
  { key: "overview", label: "Tổng quan" },
  { key: "activity", label: "Hoạt động" },
  { key: "projects", label: "Dự án" },
  { key: "deals", label: "Cơ hội" },
  { key: "quotes", label: "Báo giá" },
  { key: "contracts", label: "Hợp đồng" },
  { key: "documents", label: "Tài liệu" },
];

function headers() {
  const value: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) value["X-API-Key"] = API_KEY;
  return value;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: headers() });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(body.message || "Không tải được dữ liệu.");
  return body.data as T;
}

function formatVND(value?: number | null) {
  if (value == null) return null;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("vi-VN");
}

interface Props {
  contactId: string | null;
  open: boolean;
  onClose: () => void;
  /** Mở Deal Workspace V2 (DealDetailDrawer) - tái dùng instance đã mount ở
   * trang cha (CrmCustomerDetailPage's openDealWorkspace), KHÔNG mount Deal
   * detail UI thứ hai bên trong drawer này. */
  onOpenDeal: (dealId: string) => void;
  onOpenCompany?: (customerId: string) => void;
  /** Mo "Tạo cơ hội" voi customer_id + primary_contact_id CUNG duoc khoa san
   * (Contact 360 -> Deal moi PHAI thuoc dung Contact + Customer nay, khong
   * cho doi sang khac) - tai su dung chinh DealFormModal cua trang cha
   * (CrmCustomerDetailPage), khong tao form tao-Deal thu hai. */
  onCreateDeal?: (contactId: string) => void;
  onCreateProject?: (contactId: string) => void;
}

export function ContactDetailDrawer({ contactId, open, onClose, onOpenDeal, onOpenCompany, onCreateDeal, onCreateProject }: Props) {
  const [tab, setTab] = useState<ContactTab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<RelatedPayload | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    setTab("overview");
  }, [contactId]);

  useEffect(() => {
    if (!open || !contactId) {
      setData(null);
      setError("");
      return;
    }
    let alive = true;
    setLoading(true);
    getJson<RelatedPayload>(`${API_BASE_URL}/api/all-platform/crm/contacts/${encodeURIComponent(contactId)}/related`)
      .then(payload => {
        if (alive) {
          setData(payload);
          setError("");
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : "Không tải được người liên hệ.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, contactId]);

  useEffect(() => {
    if (!open || !contactId || tab !== "activity") return;
    let alive = true;
    setActivityLoading(true);
    getJson<ActivityRow[]>(`${API_BASE_URL}/api/all-platform/crm/contacts/${encodeURIComponent(contactId)}/activity`)
      .then(rows => {
        if (alive) setActivity(rows || []);
      })
      .catch(() => {
        if (alive) setActivity([]);
      })
      .finally(() => {
        if (alive) setActivityLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, contactId, tab]);

  const contact = data?.contact;
  const customer = data?.customer;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[99980] bg-black/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed right-0 top-0 z-[99981] flex h-screen w-full max-w-[42rem] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-start justify-between bg-slate-800 px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider opacity-80">Chi tiết người liên hệ</div>
            <h2 className="mt-1 truncate text-lg font-bold">{contact?.name || (loading ? "Đang tải..." : "")}</h2>
            <div className="mt-0.5 truncate text-sm opacity-90">
              {(contact?.position_label_snapshot || contact?.position) ? `${contact?.position_label_snapshot || contact?.position} · ` : ""}
              {customer?.company_name || customer?.customer_name || ""}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-90">
              {contact?.phone ? <span><Phone className="mr-1 inline size-3" />{contact.phone}</span> : null}
              {contact?.email ? <span><Mail className="mr-1 inline size-3" />{contact.email}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {onCreateDeal && contactId ? (
              <button
                type="button"
                onClick={() => onCreateDeal(contactId)}
                className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                + Tạo cơ hội
              </button>
            ) : null}
            <button onClick={onClose} className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {CONTACT_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {t.label}
              {t.key === "projects" && data ? ` (${data.projects?.length || 0})` : ""}
              {t.key === "deals" && data ? ` (${data.deals?.length || 0})` : ""}
              {t.key === "quotes" && data ? ` (${data.quotes?.length || 0})` : ""}
              {t.key === "contracts" && data ? ` (${data.contracts?.length || 0})` : ""}
            </button>
          ))}
        </nav>

        <div className="crm-scroll-hidden flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {error ? <p className="text-red-600">{error}</p> : null}
          {loading && !data ? (
            <p className="text-slate-400"><Loader2 className="mr-1 inline size-3.5 animate-spin" /> Đang tải...</p>
          ) : null}

          {tab === "overview" && data && (
            <>
              <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-slate-700">
                  <Building2 className="size-3.5 text-slate-400" />
                  <span>{customer?.company_name || customer?.customer_name}</span>
                  {onOpenCompany && customer ? (
                    <button
                      type="button"
                      className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                      onClick={() => onOpenCompany(customer.id)}
                    >
                      Mở công ty
                    </button>
                  ) : null}
                </div>
                {(contact?.position_label_snapshot || contact?.position) ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Briefcase className="size-3.5 text-slate-400" />
                    <span>{contact?.position_label_snapshot || contact?.position}</span>
                  </div>
                ) : null}
                {contact?.phone ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Phone className="size-3.5 text-slate-400" />
                    <span>{contact.phone}</span>
                  </div>
                ) : null}
                {contact?.email ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Mail className="size-3.5 text-slate-400" />
                    <span className="truncate">{contact.email}</span>
                  </div>
                ) : null}
                {contact?.is_primary ? (
                  <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    Người liên hệ chính
                  </span>
                ) : null}
              </section>

              <section className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">Cơ hội</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-700">{data.kpi.deal_count}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">Báo giá</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-700">{data.kpi.quote_count}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">Hợp đồng</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-700">{data.kpi.contract_count}</div>
                </div>
              </section>

              {data.deals.length > 0 ? (
                <section>
                  <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Cơ hội gần đây</h4>
                  {data.deals.slice(0, 1).map(deal => (
                    <button
                      key={deal.id}
                      type="button"
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => onOpenDeal(deal.id)}
                    >
                      <div className="font-medium text-slate-700">{deal.customer_name || deal.id}</div>
                      <div className="text-xs text-slate-500">
                        {deal.deal_stage} {deal.estimated_budget != null ? `· ${formatVND(deal.estimated_budget)}` : ""}
                      </div>
                    </button>
                  ))}
                </section>
              ) : (
                <p className="text-slate-400">Chưa có cơ hội liên kết.</p>
              )}
            </>
          )}

          {tab === "activity" && (
            activityLoading ? (
              <p className="text-slate-400"><Loader2 className="mr-1 inline size-3.5 animate-spin" /> Đang tải...</p>
            ) : activity.length === 0 ? (
              <p className="text-slate-400">Chưa có hoạt động nào được ghi nhận cho người liên hệ này (phạm vi: hoạt động của Cơ hội do người này phụ trách chính).</p>
            ) : (
              <ul className="space-y-2">
                {activity.map(entry => (
                  <li key={entry.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs text-slate-500">{formatDate(entry.created_at)} · {entry.actor_name || "Hệ thống"}</div>
                    <div className="mt-0.5 text-slate-700">
                      {entry.action}{entry.to_stage ? ` → ${entry.to_stage}` : ""}
                    </div>
                    {entry.note ? <div className="mt-0.5 text-xs text-slate-500">{entry.note}</div> : null}
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === "projects" && data && (
            <div className="space-y-3">
              {onCreateProject && contact ? (
                <button
                  type="button"
                  className="w-full rounded border border-primary/20 bg-primary/5 py-2 text-sm font-medium text-primary hover:bg-primary/10"
                  onClick={() => onCreateProject(contact.id)}
                >
                  + Tạo dự án mới
                </button>
              ) : null}

              {(data.projects || []).length === 0 ? (
                <p className="text-slate-400">Chưa có dự án liên kết.</p>
              ) : (
                <div className="space-y-2">
                  {(data.projects || []).map(project => (
                    <div
                      key={project.id}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left"
                    >
                      <div className="font-medium text-slate-700">{project.name || project.project_code || project.id}</div>
                      <div className="text-xs text-slate-500">
                        {project.status} {project.created_at ? `— Tạo ${formatDate(project.created_at)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "deals" && data && (
            data.deals.length === 0 ? (
              <p className="text-slate-400">Chưa có cơ hội liên kết.</p>
            ) : (
              <div className="space-y-2">
                {data.deals.map(deal => (
                  <button
                    key={deal.id}
                    type="button"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => onOpenDeal(deal.id)}
                  >
                    <div className="font-medium text-slate-700">{deal.customer_name || deal.id}</div>
                    <div className="text-xs text-slate-500">
                      {deal.deal_stage} {deal.estimated_budget != null ? `· ${formatVND(deal.estimated_budget)}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}

          {tab === "quotes" && data && (
            data.quotes.length === 0 ? (
              <p className="text-slate-400">Chưa có báo giá liên kết.</p>
            ) : (
              <div className="space-y-2">
                {data.quotes.map(quote => (
                  <div key={quote.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="font-medium text-slate-700">
                      {quote.quote_number || quote.quoteNumber || quote.id}
                      {(quote.version_number || quote.versionNumber) ? ` (v${quote.version_number || quote.versionNumber})` : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      {quote.status} {(quote.total_amount ?? quote.totalAmount) != null ? `· ${formatVND(quote.total_amount ?? quote.totalAmount)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "contracts" && data && (
            data.contracts.length === 0 ? (
              <p className="text-slate-400">Chưa có hợp đồng liên kết.</p>
            ) : (
              <div className="space-y-2">
                {data.contracts.map(contract => (
                  <div key={contract.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="font-medium text-slate-700">{contract.contract_number || contract.id}</div>
                    <div className="text-xs text-slate-500">
                      {contract.status} {contract.contract_value != null ? `· ${formatVND(contract.contract_value)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "documents" && (
            <p className="text-slate-400">
              Chưa có tài liệu nào có thể xác định rõ ràng thuộc về người liên hệ này qua các quan hệ hiện có (Deal/Báo giá/Hợp đồng liên kết).
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
