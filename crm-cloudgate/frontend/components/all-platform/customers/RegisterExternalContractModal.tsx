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

import { useEffect, useState } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import { seedingContractRepository } from "@/modules/contracts/repositories/SeedingContractRepository";
import { CONTRACT_STATUS_LABELS } from "@/modules/contracts/constants/contractConfig";
import type { Contract, ContractStatus } from "@/modules/contracts";
import { projectsService } from "@/services/all-platform.service";

interface Props {
  open: boolean;
  deal: Customer; // "Customer" type ở đây thực chất là 1 dòng Deal (xem customer-lead.service.ts)
  onClose: () => void;
  onCreated: (contract: Contract) => void;
}

const STATUS_OPTIONS: ContractStatus[] = ["signed", "active", "completed", "draft", "pending_signature", "terminated"];

export function RegisterExternalContractModal({ open, deal, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [status, setStatus] = useState<ContractStatus>("signed");
  const [signedAt, setSignedAt] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [projectLabel, setProjectLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContractNumber("");
    setContractValue("");
    setStatus("signed");
    setSignedAt("");
    setEndDate("");
    setFileUrl("");
    setLinkInput("");
    setNote("");
    setError("");
    setProjectLabel("");
    if (deal.project_id) {
      projectsService
        .get(deal.project_id)
        .then(res => {
          if (res.success && res.data) setProjectLabel(`${res.data.projectCode} · ${res.data.name}`);
        })
        .catch(() => undefined);
    }
  }, [open, deal.project_id]);

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
        dealId: deal.id,
        contractNumber: contractNumber.trim() || undefined,
        title: title.trim(),
        status,
        signedAt: signedAt || undefined,
        contractValue: contractValue ? Number(contractValue) : 0,
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
            <span className="mb-1 block text-xs font-semibold text-slate-600">Khách hàng</span>
            <input value={deal.customer_name || deal.company_name || ""} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Cơ hội</span>
            <input value={deal.customer_name || ""} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
          </label>

          {deal.project_id ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Dự án</span>
              <input value={projectLabel || "Đang tải..."} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
            </label>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Giá trị hợp đồng</span>
              <input
                type="number"
                value={contractValue}
                onChange={e => setContractValue(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="0"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Trạng thái</span>
              <select value={status} onChange={e => setStatus(e.target.value as ContractStatus)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </label>
          </div>

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
