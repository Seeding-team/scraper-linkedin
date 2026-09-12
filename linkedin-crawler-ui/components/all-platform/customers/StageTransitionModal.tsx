"use client";

/**
 * StageTransitionModal — mở khi user muốn chuyển 1 deal từ stage A → B.
 *
 * UI động theo `to_stage`: chỉ hiện field mà state-machine yêu cầu
 * cho stage đó (xem `STAGE_REQUIREMENTS` trong customer-lead.service.ts).
 *
 *   - contacted            → note buộc
 *   - qualified            → note + decision_maker + estimated_budget
 *   - requirement          → note + attachment_url
 *   - proposal_sent        → attachment_url
 *   - negotiation          → note
 *   - contract_sent        → attachment_url
 *   - on_hold              → note + follow_up_date
 *   - lost                 → reject_reason_type (cố định, không tự do) + note
 *
 * Submit → trả về StageTransitionPayload qua callback onSubmit() để parent
 * gọi API `transitionStage()`. Parent sẽ xử lý optimistic update + audit log.
 *
 * ─── TẠI SAO CODE NÀY KỲ LẠ ───
 *
 * Bình thường modal dùng `position: fixed inset-0`. Nhưng CSS có 1 quy tắc:
 * nếu ancestor có `transform` / `filter` / `backdrop-filter` / `perspective`
 * / `will-change` / `contain` → nó tạo "containing block" mới cho descendants
 * có `position: fixed`, làm `fixed` neo vào ancestor thay vì viewport.
 *
 * Trong CRM:
 *   - Card có `hover:-translate-y-0.5` → CSS `transform` khi hover/drag.
 *   - Column có `transition` + ring-state trong lúc drag.
 * Kéo thả card qua lại giữa các stage → chính lúc đó CSS `transform`
 * đang được apply → modal `position: fixed` bị neo vào card/column → bị bóp
 * ngang thành cột vài chục pixel, không thấy modal trên UI.
 *
 * Cách fix đã thử:
 *   ✗ `createPortal(..., document.body)` — lỗi SSR/hydration với React 19.
 *   ✗ `<dialog>` native — top-layer nhưng `useEffect` showModal bị flacky
 *     với React 19 strict-mode dev double-invoke + drop event timing.
 *
 * Cách fix hiện tại (robust nhất):
 *   ✓ Render `<div>` modal **trực tiếp vào `<body>`** bằng `createPortal`,
 *     đồng thời **đảm bảo parent của body không có CSS issue** bằng cách
 *     set `document.body.style.isolation = "isolate"` (tạo containing
 *     block mới ngay tại body, cách ly khỏi mọi ancestor CSS).
 *   Ngoài ra dùng `console.warn` nếu chưa mount để dễ debug.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  AlertTriangle,
  Paperclip,
  CalendarDays,
  Wallet,
  UserCog,
  MessageSquareWarning,
  FileText,
  Upload,
  File as FileIcon,
  Image as ImageIcon,
  XCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { CurrencyInput } from "@/components/CurrencyInput";
import type { Customer } from "@/services/customer-lead.service";
import {
  LOST_REASON_OPTIONS,
  DEAL_STAGE_META,
  STAGE_REQUIREMENTS,
  customerLeadService,
  type DealStage,
  type RejectReasonType,
  type StageTransitionPayload,
} from "@/services/customer-lead.service";
import { getCurrentStage } from "@/services/crm-pipeline.helpers";
import { cn } from "@/lib/utils";
import { useCrmCategoryCodeOptions } from "@/modules/crm/components/CrmCategorySelect";
import { TerminalReviewForm } from "./TerminalReviewForm";

interface Props {
  customer: Customer;
  toStage: DealStage;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: StageTransitionPayload) => Promise<void> | void;
  /**
   * Khi true, modal cho phép user chọn lại `to_stage` bằng dropdown (mặc định
   * theo giá trị `toStage` ban đầu). Dùng cho flow "Resume deal On Hold" —
   * tránh user phải kéo-thả card từ list On Hold (cuối trang) lên cột stage
   * ở đầu trang (kéo dài qua viewport dễ đứt drag-over).
   */
  allowStageSelect?: boolean;
}

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

const labelCls = "mb-1 block text-xs font-semibold text-slate-600";

export function StageTransitionModal({
  customer,
  toStage: initialToStage,
  isOpen,
  onClose,
  onSubmit,
  allowStageSelect = false,
}: Props) {
  const fromStage = getCurrentStage(customer);

  // Khi `allowStageSelect=true`, user có thể đổi toStage trong modal (dùng cho
  // resume on_hold → chọn prev_stage hoặc lost). Mặc định lấy `prev_stage` nếu
  // hợp lệ, fallback về `initialToStage`.
  const [toStage, setToStage] = useState<DealStage>(initialToStage);
  useEffect(() => {
    if (allowStageSelect && fromStage === "on_hold") {
      const fallback = customer.prev_stage ?? initialToStage;
      setToStage(fallback);
    } else {
      setToStage(initialToStage);
    }
  }, [allowStageSelect, fromStage, customer.prev_stage, initialToStage, isOpen]);

  const req = STAGE_REQUIREMENTS[toStage];
  const targetMeta = DEAL_STAGE_META[toStage];

  const [note, setNote] = useState("");
  const [attachUrl, setAttachUrl] = useState("");
  const [attachName, setAttachName] = useState("");
  // File thực tế user vừa chọn (sẽ được upload lên Supabase Storage khi submit).
  // Tách bạch với attachUrl — attachUrl là URL sau upload, attachFile là object.
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attaching, setAttaching] = useState(false);
  // Optional: cho user paste URL trực tiếp thay vì chọn file (giữ UX cũ).
  const [attachInputMode, setAttachInputMode] = useState<"file" | "url">("file");
  const [rejectReason, setRejectReason] = useState<RejectReasonType | "">("");
  const [rejectText, setRejectText] = useState("");
  const [decisionMaker, setDecisionMaker] = useState(customer.decision_maker ?? "");
  const [estBudget, setEstBudget] = useState<string>(String(customer.estimated_budget ?? ""));
  const [followUpDate, setFollowUpDate] = useState("");
  const [busy, setBusy] = useState(false);
  const { options: lostReasonOptions } = useCrmCategoryCodeOptions("crm_lost_reason", LOST_REASON_OPTIONS);

  // Chỉ portal sau khi đã mount trên client — tránh hydration mismatch với React 19.
  // Server render `null`, client lần đầu render `null`, useEffect set mounted=true
  // → lần render kế tiếp portal mới gắn vào <body>.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state khi mở modal mới (customer hoặc stage đích đổi)
  useEffect(() => {
    if (!isOpen) return;
    setNote("");
    setAttachUrl("");
    setAttachName("");
    setAttachFile(null);
    setAttaching(false);
    setAttachInputMode("file");
    setRejectReason("");
    setRejectText("");
    setDecisionMaker(customer.decision_maker ?? "");
    setEstBudget(String(customer.estimated_budget ?? ""));
    setFollowUpDate("");
    setBusy(false);
  }, [isOpen, customer.id, toStage, customer.decision_maker, customer.estimated_budget]);

  /**
   * Validate phía client trước khi submit (server vẫn validate lại).
   * Attachment: chấp nhận 1 trong 3 — file vừa chọn (chưa upload thì chưa có URL),
   * URL user paste tay, hoặc file đã được upload thành công (attachUrl có sẵn).
   */
  function validateClient(): string | null {
    if (req.requireNote && !note.trim()) return "Vui lòng nhập ghi chú";
    if (req.requireAttachment) {
      if (attachInputMode === "url") {
        if (!attachUrl.trim()) return "Vui lòng dán URL hoặc chọn tab 'Upload file'";
      } else {
        if (!attachFile && !attachUrl) return "Vui lòng chọn file (PDF/ảnh/Office…)";
      }
    }
    if (req.requireRejectReason && !rejectReason) return "Vui lòng chọn lý do rớt";
    if (req.requireDecisionMaker && !decisionMaker.trim()) return "Vui lòng nhập người ra quyết định";
    if (req.requireBudget && (!estBudget || Number(estBudget) <= 0)) return "Vui lòng nhập ngân sách dự kiến (>0)";
    if (toStage === "on_hold" && !followUpDate) return "Vui lòng chọn ngày follow-up lại";
    return null;
  }

  /**
   * Xác định prefix upload lên Supabase Storage theo stage đích.
   * - contract_sent → contract
   * - requirement    → brief
   * - proposal_sent  → proposal
   */
  function uploadPrefix(): "brief" | "proposal" | "contract" {
    if (toStage === "contract_sent") return "contract";
    if (toStage === "requirement") return "brief";
    return "proposal";
  }

  /** Khi user chọn file → upload ngay để có URL, nhưng KHÔNG block modal.
   *  Nếu upload fail → giữ file, báo toast, để user retry.
   */
  async function handleFileSelect(file: File) {
    setAttachFile(file);
    setAttachName(file.name);
    setAttachUrl(""); // clear URL cũ khi chọn file mới
    setAttaching(true);
    try {
      const result = await customerLeadService.uploadAttachment(
        file,
        uploadPrefix(),
        customer.id,
      );
      setAttachUrl(result.url);
      toast.success(`Đã upload "${file.name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload thất bại";
      toast.error(`Upload thất bại: ${msg}`);
      // Không reset — để user bấm nút "Upload lại" hoặc chọn file khác
    } finally {
      setAttaching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clientErr = validateClient();
    if (clientErr) {
      toast.error(clientErr);
      return;
    }
    setBusy(true);
    // Nếu còn file chưa upload (chọn nhưng lỗi trước đó) → upload lại ngay submit
    let finalUrl = attachUrl.trim();
    if (
      req.requireAttachment &&
      attachInputMode === "file" &&
      attachFile &&
      !finalUrl
    ) {
      try {
        setAttaching(true);
        const result = await customerLeadService.uploadAttachment(
          attachFile,
          uploadPrefix(),
          customer.id,
        );
        finalUrl = result.url;
        setAttachUrl(result.url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload thất bại";
        toast.error(`Không thể upload file: ${msg}`);
        setBusy(false);
        setAttaching(false);
        return;
      } finally {
        setAttaching(false);
      }
    }
    const payload: StageTransitionPayload = {
      to_stage: toStage,
      note: note.trim() || undefined,
      attachment_url: finalUrl || undefined,
      attachment_name: attachName.trim() || undefined,
      reject_reason_type: rejectReason || undefined,
      reject_reason_text: rejectText.trim() || undefined,
      prev_stage: fromStage === "on_hold" ? fromStage : undefined,
      decision_maker: decisionMaker.trim() || undefined,
      estimated_budget: estBudget ? Number(estBudget) : undefined,
      follow_up_date: followUpDate || undefined,
    };
    try {
      await onSubmit(payload);
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  // Dùng `createPortal` để render modal ra <body> — escape khỏi mọi ancestor
  // CSS issue (`transform` / `filter` / `backdrop-filter`) của KanbanBoard.
  //
  // `position: fixed` neo vào viewport khi ancestor gần nhất KHÔNG có
  // `transform` / `filter`. Nhưng card trong CRM có `hover:-translate-y-0.5`
  // và column có `backdrop-blur` → ancestor CSS phá vỡ giả định của `fixed`,
  // làm modal bị bóp ngang thành vài chục pixel. Portal ra `<body>` là cách
  // triệt để: lúc đó ancestor của modal chỉ còn `<body>` / `<html>` không
  // có CSS phá vỡ → `position: fixed` hoạt động đúng.
  //
  // Đợi `mounted` để tránh hydration mismatch (server render `null` chứ không
  // phải portal — vì `document` không tồn tại trên server).
  const modalContent = (
    <div
      className="fixed inset-0 z-[99999] isolate bg-black/50 px-4 py-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
      tabIndex={-1}
      data-testid="stage-transition-modal"
    >
      <div className="w-[480px] max-w-full rounded-2xl bg-white shadow-2xl absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[90vh] overflow-y-auto">
        {/* Header — nền theo màu stage đích */}
        <div className={`flex shrink-0 items-center justify-between px-5 py-3 ${targetMeta.headerClass} text-white`}>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wider opacity-80">
              {DEAL_STAGE_META[fromStage].label} →{" "}
              {allowStageSelect && fromStage === "on_hold" ? (
                <select
                  value={toStage}
                  onChange={(e) => setToStage(e.target.value as DealStage)}
                  className="ml-1 rounded bg-white/20 px-2 py-0.5 text-xs font-semibold text-white outline-none ring-1 ring-white/40 focus:bg-white/30"
                >
                  {customer.prev_stage && (
                    <option value={customer.prev_stage} className="text-slate-800">
                      {DEAL_STAGE_META[customer.prev_stage].label} (quay lại)
                    </option>
                  )}
                  <option value="lost" className="text-slate-800">
                    {DEAL_STAGE_META.lost.label}
                  </option>
                </select>
              ) : (
                targetMeta.label
              )}
            </div>
            <h3 className="mt-0.5 truncate text-base font-bold">{customer.customer_name}</h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Mô tả ngắn của stage đích */}
            <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <FileText className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
              <span>{targetMeta.description}</span>
            </div>

            {/* ─────────── LOST: chọn lý do + ghi chú ─────────── */}
            {toStage === "lost" && (
              <>
                <div>
                  <label className={labelCls}>
                    Lý do rớt <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value as RejectReasonType | "")}
                    className={inputCls}
                  >
                    <option value="">— Chọn lý do —</option>
                    {lostReasonOptions.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Lý do từ danh sách cố định để thống kê sau này.
                  </p>
                </div>
                {rejectReason === "Khac" && (
                  <div>
                    <label className={labelCls}>Mô tả lý do khác</label>
                    <input
                      type="text"
                      value={rejectText}
                      onChange={(e) => setRejectText(e.target.value)}
                      className={inputCls}
                      placeholder="Ghi rõ lý do..."
                    />
                  </div>
                )}
              </>
            )}

            {/* ─────────── QUALIFIED: ngân sách + decision maker ─────────── */}
            {req.requireDecisionMaker && (
              <div>
                <label className={labelCls}>
                  <UserCog className="mr-1 inline size-3.5" /> Người ra quyết định (Decision Maker){" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={decisionMaker}
                  onChange={(e) => setDecisionMaker(e.target.value)}
                  className={inputCls}
                  placeholder="Họ tên / chức danh"
                />
              </div>
            )}
            {req.requireBudget && (
              <div>
                <label className={labelCls}>
                  <Wallet className="mr-1 inline size-3.5" /> Ngân sách dự kiến (VNĐ){" "}
                  <span className="text-red-500">*</span>
                </label>
                <CurrencyInput
                  required
                  min={1}
                  value={estBudget ? Number(estBudget) : null}
                  onChange={(n) => setEstBudget(n != null ? String(n) : "")}
                  className={inputCls}
                  placeholder="VD: 50.000.000"
                />
              </div>
            )}

            {/* ─────────── ATTACHMENT (brief / proposal / contract / requirement) ─────────── */}
            {req.requireAttachment && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <label className={labelCls}>
                    <Paperclip className="mr-1 inline size-3.5" />
                    {toStage === "contract_sent"
                      ? "File / link hợp đồng"
                      : toStage === "requirement"
                        ? "File / link brief yêu cầu"
                        : "File / link proposal"}
                    <span className="text-red-500"> *</span>
                  </label>
                  {/* Toggle file ↔ url */}
                  <div className="inline-flex rounded-md border border-amber-300 bg-white p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setAttachInputMode("file")}
                      className={cn(
                        "rounded px-2 py-1 font-medium transition",
                        attachInputMode === "file"
                          ? "bg-amber-500 text-white shadow-sm"
                          : "text-amber-700 hover:bg-amber-50",
                      )}
                    >
                      <Upload className="mr-1 inline size-3" />
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttachInputMode("url")}
                      className={cn(
                        "rounded px-2 py-1 font-medium transition",
                        attachInputMode === "url"
                          ? "bg-amber-500 text-white shadow-sm"
                          : "text-amber-700 hover:bg-amber-50",
                      )}
                    >
                      <FileText className="mr-1 inline size-3" />
                      Dán URL
                    </button>
                  </div>
                </div>

                {attachInputMode === "file" ? (
                  <AttachmentFilePicker
                    file={attachFile}
                    uploading={attaching}
                    uploadedUrl={attachUrl}
                    onSelect={handleFileSelect}
                    onRemove={() => {
                      setAttachFile(null);
                      setAttachUrl("");
                      setAttachName("");
                    }}
                  />
                ) : (
                  <>
                    <input
                      type="url"
                      required={req.requireAttachment}
                      value={attachUrl}
                      onChange={(e) => setAttachUrl(e.target.value)}
                      className={inputCls}
                      placeholder="https://drive.google.com/... hoặc link nội bộ"
                    />
                    <input
                      type="text"
                      value={attachName}
                      onChange={(e) => setAttachName(e.target.value)}
                      className={`${inputCls} mt-2`}
                      placeholder="Tên file (VD: Proposal_ACME_2026.pdf)"
                    />
                  </>
                )}
              </div>
            )}

            {/* ─────────── ON HOLD: yêu cầu follow-up date ─────────── */}
            {toStage === "on_hold" && (
              <div>
                <label className={labelCls}>
                  <CalendarDays className="mr-1 inline size-3.5" /> Ngày dự kiến follow-up lại{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className={inputCls}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Sẽ tự nhắc nhở khi đến hạn — tránh deal "chết" âm thầm trong On Hold.
                </p>
              </div>
            )}

            {/* ─────────── NOTE ghi chú (gần như mọi stage) ─────────── */}
            {(req.requireNote || note) && (
              <div>
                <label className={labelCls}>
                  <MessageSquareWarning className="mr-1 inline size-3.5" /> Ghi chú{" "}
                  {req.requireNote && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  required={req.requireNote}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={`${inputCls} min-h-[80px] max-h-[200px]`}
                  placeholder={
                    toStage === "contacted"
                      ? "Nội dung buổi liên hệ / ngày liên hệ..."
                      : toStage === "negotiation"
                        ? "Các điều khoản đang đàm phán (giá, timeline, scope)..."
                        : toStage === "on_hold"
                          ? "Lý do tạm dừng..."
                          : "Ghi chú thêm..."
                  }
                />
              </div>
            )}

            {/* Cảnh báo terminal */}
            {targetMeta.label === "Won" || targetMeta.label === "Lost" ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <b>Trạng thái kết thúc.</b> Sau khi lưu, deal sẽ đóng và không cho đổi tiếp qua thao tác
                  thường. Muốn mở lại phải tạo deal mới.
                </span>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:opacity-50"
            >
            {busy ? "Đang lưu..." : `Chuyển → ${targetMeta.label}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  let finalContent = modalContent;
  if (toStage === "won" || toStage === "lost") {
    finalContent = (
      <div 
        className="fixed inset-0 z-[99999] isolate flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" 
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        <div onClick={e => e.stopPropagation()}>
          <TerminalReviewForm
            toStage={toStage}
            customerName={customer.customer_name}
            onCancel={onClose}
            onSubmit={async (payload) => {
              setBusy(true);
              try {
                await onSubmit(payload);
              } finally {
                setBusy(false);
              }
            }}
            busy={busy}
          />
        </div>
      </div>
    );
  }

  return mounted && typeof document !== "undefined"
    ? createPortal(finalContent, document.body)
    : null;
}

/* ─────────── AttachmentFilePicker — drag & drop + preview + upload progress ─────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentFilePicker({
  file,
  uploading,
  uploadedUrl,
  onSelect,
  onRemove,
}: {
  file: File | null;
  uploading: boolean;
  uploadedUrl: string;
  onSelect: (f: File) => void;
  onRemove: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Tạo object URL preview cho ảnh (cleanup khi unmount/file đổi).
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Trạng thái:
  //   - chưa có file        → dropzone lớn (drag & drop + click)
  //   - file + uploading    → progress spinner overlay preview
  //   - file + uploadedUrl  → green check, link xem
  //   - file + no URL (lỗi) → warning, cho retry / remove / chọn lại

  if (!file) {
    return (
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onSelect(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-6 text-xs transition",
          dragOver
            ? "border-amber-500 bg-amber-100"
            : "border-amber-300 bg-white hover:border-amber-500 hover:bg-amber-50",
        )}
      >
        <Upload className="size-5 text-amber-600" />
        <span className="font-medium text-amber-900">
          Kéo file vào đây hoặc click để chọn
        </span>
        <span className="text-[10px] text-amber-700/70">
          PDF, ảnh, Word/Excel/PowerPoint, video… tối đa 25MB
        </span>
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onSelect(f);
          }}
          accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.7z,.rar"
        />
      </label>
    );
  }

  const isImage = file.type.startsWith("image/");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ok = !!uploadedUrl;

  return (
    <div className="rounded-lg border border-amber-200 bg-white p-2">
      <div className="flex items-start gap-3">
        {/* Thumbnail / icon */}
        <div className="shrink-0">
          {isImage && previewUrl ? (
            <img
              src={previewUrl}
              alt={file.name}
              className="size-14 rounded-md border border-amber-200 object-cover"
            />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700">
              <FileIcon className="size-6" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-slate-800" title={file.name}>
              {file.name}
            </p>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-500">
              {ext || "file"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {formatBytes(file.size)} {file.type && `· ${file.type}`}
          </p>

          {/* Status */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
            {uploading ? (
              <>
                <Loader2 className="size-3 animate-spin text-amber-600" />
                <span className="text-amber-700">Đang upload...</span>
              </>
            ) : ok ? (
              <>
                <ImageIcon className="size-3 text-emerald-600" />
                <a
                  href={uploadedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:underline"
                >
                  Đã upload
                  <ExternalLink className="size-2.5" />
                </a>
              </>
            ) : (
              <>
                <AlertTriangle className="size-3 text-red-500" />
                <span className="text-red-600">Upload lỗi — chọn lại</span>
              </>
            )}
          </div>
        </div>

        {/* Remove */}
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          title="Bỏ file"
          disabled={uploading}
        >
          <XCircle className="size-4" />
        </button>
      </div>
    </div>
  );
}
