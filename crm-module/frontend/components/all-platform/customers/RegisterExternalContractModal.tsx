"use client";

/**
 * "Ghi nhận hợp đồng có sẵn" — đăng ký 1 Hợp đồng đã ký/tạo BÊN NGOÀI CRM
 * (file scan, Google Drive/Docs link,...) thành 1 Contract canonical THẬT
 * (bảng `contracts`, migration 136: source='external'). KHÔNG redirect,
 * KHÔNG mở "Sửa thông tin Deal" - day la drawer rieng, doc lap.
 *
 * Dùng LẠI đúng endpoint tạo Contract hiện có (POST /contracts, cùng 1 bảng/
 * 1 API với "+ Tạo hợp đồng") - chỉ khác ở source + cho phép nhập tay
 * contract_number (hợp đồng ngoài đã có số riêng, không dùng số tự sinh của
 * CRM). Nhờ vậy Customer 360/module Hợp đồng toàn cục tự động resolve ĐÚNG
 * CÙNG 1 Contract ID, không có khái niệm "hợp đồng ngoài" tách biệt.
 *
 * File upload dùng lại NGUYÊN endpoint upload đính kèm đã có sẵn
 * (customerLeadService.uploadAttachment, prefix="contract") - không tạo
 * storage/endpoint mới.
 */

import { useEffect, useMemo, useState } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import { seedingContractRepository } from "@/modules/contracts/repositories/SeedingContractRepository";
import { CONTRACT_STATUS_LABELS } from "@/modules/contracts/constants/contractConfig";
import { CurrencyInput } from "@/components/CurrencyInput";
import type { Contract, ContractStatus } from "@/modules/contracts";

interface DealOption {
  id: string;
  customer_name?: string | null;
  project_id?: string | null;
  primary_contact_id?: string | null;
}

interface Props {
  open: boolean;
  deal: Customer; // "Customer" type ở đây thực chất là 1 dòng Deal (xem customer-lead.service.ts)
  onClose: () => void;
  onCreated: (contract: Contract) => void;
  /** Ten Khach hang CRM CANONICAL that (crm_customers.company_name/
   * customer_name) - BUG THAT DA GAP: truoc day field "Khách hàng" doc nham
   * deal.customer_name (do la ten CƠ HỘI, khong phai ten Khach hang - trung
   * ten voi field "Cơ hội" ben duoi gay nham lan "sao 2 o giong het nhau").
   * Neu khong truyen, fallback ve deal.company_name nhu cu. */
  customerLabel?: string;
  /** BUG THAT DA GAP: truoc day Cơ hội bi CUNG 1 gia tri (readonly, khong sua
   * duoc) - neu Khach hang co NHIEU Co hoi/Du an/Lien he, nguoi dung khong
   * the chon dung Co hoi can ghi nhan hop dong. Danh sach cac Deal cua CUNG
   * 1 Khach hang (Customer 360 da fetch san qua /related, tai su dung KHONG
   * goi lai API) - > 1 phan tu moi hien dropdown, <=1 van hien readonly nhu
   * cu de khong doi UX luc chi co dung 1 lua chon. */
  dealOptions?: DealOption[];
  /** Danh sach Nguoi lien he cua Khach hang (Customer 360 da fetch san qua
   * allContacts) - dropdown moi, chon 1 Lien he se loc lai dropdown "Cơ hội"
   * ben duoi CHI con cac Deal co primary_contact_id = lien he do (nguoc lai
   * khi doi Cơ hội truc tiep thi Lien he cung tu dong khop theo). */
  contactOptions?: Array<{ id: string; name: string }>;
  /** Danh sach Du an cua Khach hang (Customer 360 da fetch san qua
   * projectsSummary.projects) - dropdown moi, cung vai tro loc "Cơ hội" nhu
   * Lien he o tren (giao 2 dieu kien loc). Contract KHONG co cot project_id
   * rieng - field nay CHI dung de loc "Cơ hội", khong luu them gi khac. */
  projectOptions?: Array<{ id: string; projectCode: string; name: string }>;
  /** "Thuộc báo giá nào" (feedback 2026-09-25, PDF mục 7) - danh sách Báo giá
   * của khách hàng (Customer 360 đã fetch sẵn qua allQuoteChains). Chọn 1 báo
   * giá sẽ ghi vào `quote_id` của hợp đồng (đã có sẵn trong CreateContractInput/
   * Contract type, chỉ chưa từng được set từ UI này) - khi báo giá đó đã
   * duyệt xong, hợp đồng sẽ tự hiện trong "Bản tóm tắt báo giá" của báo giá đó. */
  quoteOptions?: Array<{ id: string; label: string; dealId?: string | null }>;
}

const STATUS_OPTIONS: ContractStatus[] = ["signed", "active", "completed", "draft", "pending_signature", "terminated"];
const ALL = "__all__";
const NONE_QUOTE = "__none__";

export function RegisterExternalContractModal({ open, deal, onClose, onCreated, customerLabel, dealOptions, contactOptions, projectOptions, quoteOptions }: Props) {
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractValue, setContractValue] = useState<number | null>(null);
  const [status, setStatus] = useState<ContractStatus>("signed");
  const [signedAt, setSignedAt] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedDealId, setSelectedDealId] = useState(deal.id);
  const [activeContactId, setActiveContactId] = useState(deal.primary_contact_id || ALL);
  const [activeProjectId, setActiveProjectId] = useState(deal.project_id || ALL);
  const [selectedQuoteId, setSelectedQuoteId] = useState(NONE_QUOTE);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContractNumber("");
    setContractValue(null);
    setStatus("signed");
    setSignedAt("");
    setEndDate("");
    setFileUrl("");
    setLinkInput("");
    setNote("");
    setError("");
    setSelectedDealId(deal.id);
    setActiveContactId(deal.primary_contact_id || ALL);
    setActiveProjectId(deal.project_id || ALL);
    setSelectedQuoteId(NONE_QUOTE);
  }, [open, deal.id, deal.primary_contact_id, deal.project_id]);

  // Chi goi y bao gia THUOC dung Co hoi dang chon (giong cach loc Cơ hội theo
  // Lien he/Du an o tren) - neu doi Cơ hội sang cai khac, bao gia da chon (neu
  // khong thuoc Cơ hội moi) se bi bo chon lai o effect ben duoi thay vi gui
  // nham quote_id cua 1 Cơ hội khac.
  const filteredQuotes = useMemo(
    () => (quoteOptions || []).filter(q => !q.dealId || q.dealId === selectedDealId),
    [quoteOptions, selectedDealId]
  );

  useEffect(() => {
    if (!open) return;
    if (selectedQuoteId !== NONE_QUOTE && !filteredQuotes.some(q => q.id === selectedQuoteId)) {
      setSelectedQuoteId(NONE_QUOTE);
    }
  }, [open, filteredQuotes, selectedQuoteId]);

  // Danh sach Cơ hội hien theo dung 2 bo loc Lien he/Du an dang chon (giao 2
  // dieu kien) - "Tất cả" (ALL) o 1 hoac ca 2 bo loc thi coi nhu khong loc
  // theo dieu kien do. Neu giao rong (vd doi Lien he sang 1 nguoi chua gan
  // Cơ hội nao) thi fallback ve toan bo dealOptions - KHONG duoc de dropdown
  // Cơ hội trong rong khong co gi de chon.
  const filteredDeals = useMemo(() => {
    const all = dealOptions || [];
    const byContact = activeContactId === ALL ? all : all.filter(d => d.primary_contact_id === activeContactId);
    const byBoth = activeProjectId === ALL ? byContact : byContact.filter(d => d.project_id === activeProjectId);
    return byBoth.length > 0 ? byBoth : all;
  }, [dealOptions, activeContactId, activeProjectId]);

  // Neu Cơ hội dang chon khong con thuoc danh sach da loc (doi Lien he/Du an
  // lam thu hep lua chon), tu dong nhay sang phan tu dau tien hop le - tranh
  // gui dealId khong khop voi bo loc dang hien thi tren UI.
  useEffect(() => {
    if (!open) return;
    if (!filteredDeals.some(d => d.id === selectedDealId) && filteredDeals.length > 0) {
      setSelectedDealId(filteredDeals[0].id);
    }
  }, [open, filteredDeals, selectedDealId]);

  function handleDealChange(newDealId: string) {
    setSelectedDealId(newDealId);
    const found = (dealOptions || []).find(d => d.id === newDealId);
    if (found) {
      setActiveContactId(found.primary_contact_id || ALL);
      setActiveProjectId(found.project_id || ALL);
    }
  }

  if (!open) return null;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await customerLeadService.uploadAttachment(file, "contract", deal.customer_id || undefined);
      setFileUrl(result.url);
      setLinkInput("");
      toast.success("Đã tải file lên");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Tải file thất bại");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Vui lòng nhập tên hợp đồng.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const contract = await seedingContractRepository.createContract({
        dealId: selectedDealId,
        quoteId: selectedQuoteId === NONE_QUOTE ? undefined : selectedQuoteId,
        contractNumber: contractNumber.trim() || undefined,
        title: title.trim(),
        status,
        signedAt: signedAt || undefined,
        contractValue: contractValue ?? 0,
        endDate: endDate || undefined,
        source: "external",
        fileUrl: fileUrl || linkInput.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success("Đã ghi nhận hợp đồng");
      onCreated(contract);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không ghi nhận được hợp đồng.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[99984] bg-black/40 backdrop-blur-sm" />
      <aside className="fixed right-0 top-0 z-[99985] flex h-screen w-full max-w-[30rem] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Ghi nhận hợp đồng có sẵn</h2>
            <p className="mt-0.5 text-xs text-slate-500">Thêm hợp đồng đã ký bên ngoài vào CRM</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X className="size-4" />
          </button>
        </header>

        <form id="registerExternalContractForm" className="crm-scroll-hidden flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm" onSubmit={handleSubmit}>
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
            Hợp đồng này đã được ký/làm bên ngoài. Vui lòng nhập các thông tin cơ bản và đính kèm file hoặc link.
          </div>

          {error ? <p className="text-red-600">{error}</p> : null}

          {/* Nhóm field đã có sẵn giá trị mặc định (feedback 2026-09-25, PDF
           * mục 7: "những phần được set là điền mặc định, sẽ cho lên hàng
           * trên hết") - đứng trước nhóm phải nhập tay bên dưới. */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Khách hàng</span>
            <input value={customerLabel || deal.customer_name || deal.company_name || ""} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
          </label>

          {contactOptions && contactOptions.length > 0 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Người liên hệ</span>
              <select
                value={activeContactId}
                onChange={e => setActiveContactId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value={ALL}>Tất cả liên hệ</option>
                {contactOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Cơ hội</span>
            {dealOptions && dealOptions.length > 1 ? (
              <select
                value={selectedDealId}
                onChange={e => handleDealChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {filteredDeals.map(d => (
                  <option key={d.id} value={d.id}>{d.customer_name || d.id}</option>
                ))}
              </select>
            ) : (
              <input value={deal.customer_name || ""} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
            )}
          </label>

          {projectOptions && projectOptions.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Dự án</span>
              <select
                value={activeProjectId}
                onChange={e => setActiveProjectId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value={ALL}>Tất cả dự án</option>
                {projectOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>
                ))}
              </select>
            </label>
          ) : activeProjectId !== ALL ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Dự án</span>
              <input value={projectOptions?.find(p => p.id === activeProjectId) ? `${projectOptions.find(p => p.id === activeProjectId)!.projectCode} · ${projectOptions.find(p => p.id === activeProjectId)!.name}` : "Đang tải..."} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
            </label>
          ) : null}

          {/* "Thuộc báo giá nào" (feedback 2026-09-25, PDF mục 7) - tuỳ chọn,
           * khi chọn 1 báo giá đã duyệt xong, hợp đồng này sẽ tự hiện trong
           * "Bản tóm tắt báo giá" của báo giá đó (xem QuoteWorkspaceModal.tsx). */}
          {quoteOptions && quoteOptions.length > 0 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Thuộc báo giá nào</span>
              <select
                value={selectedQuoteId}
                onChange={e => setSelectedQuoteId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value={NONE_QUOTE}>Không gắn báo giá</option>
                {filteredQuotes.map(q => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Trạng thái</span>
            <select value={status} onChange={e => setStatus(e.target.value as ContractStatus)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>

          {/* Nhóm field phải nhập tay (feedback 2026-09-25, PDF mục 7). */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Tên hợp đồng *</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Hợp đồng triển khai..."
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Số hợp đồng</span>
            <input
              value={contractNumber}
              onChange={e => setContractNumber(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="HD-2025-021"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Giá trị hợp đồng</span>
            {/* CurrencyInput: tu dong them dau cham ngan 3 so luc go (feedback
             * 2026-09-25) - day la tien VND, dung chung component format tien
             * da co san trong app thay vi input number tho. */}
            <CurrencyInput
              value={contractValue}
              onChange={setContractValue}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="0"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Ngày ký</span>
              <input type="date" value={signedAt} onChange={e => setSignedAt(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Hiệu lực đến</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-xs font-semibold text-slate-600">File hợp đồng</span>
              <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 text-center text-xs text-slate-500 hover:bg-slate-50">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                <span>{fileUrl ? "Đã tải file — chọn lại" : "Chọn file"}</span>
                <input type="file" className="hidden" onChange={handleFileChange} disabled={uploading} />
              </label>
              {fileUrl ? <p className="mt-1 truncate text-[11px] text-emerald-600">Đã đính kèm file</p> : null}
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Link hợp đồng</span>
              <input
                value={linkInput}
                onChange={e => {
                  setLinkInput(e.target.value);
                  setFileUrl("");
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="https://drive.google.com/..."
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Ghi chú</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </form>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Hủy
          </button>
          <button type="submit" form="registerExternalContractForm" disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu hợp đồng"}
          </button>
        </footer>
      </aside>
    </>
  );
}
