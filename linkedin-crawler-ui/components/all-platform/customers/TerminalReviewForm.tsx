"use client";

import { useState } from "react";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { DealStage, StageTransitionPayload, RejectReasonType, LOST_REASON_OPTIONS } from "@/services/customer-lead.service";
import { cn } from "@/lib/utils";
import { CurrencyInput } from "@/components/CurrencyInput";
import { useCrmCategoryCodeOptions } from "@/modules/crm/components/CrmCategorySelect";

interface Props {
  toStage: "won" | "lost";
  customerName: string;
  onCancel: () => void;
  onSubmit: (payload: StageTransitionPayload) => Promise<void>;
  busy: boolean;
}

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";
const labelCls = "mb-1.5 block text-[13px] font-semibold text-slate-700";
const sectionTitleCls = "mb-4 text-[13px] font-black uppercase tracking-wider text-slate-400";

const WIN_REASONS = [
  "Giải pháp phù hợp use case / pain point",
  "Uy tín, năng lực và case study thuyết phục",
  "Giá / điều khoản thương mại cạnh tranh",
  "Sale hiểu nhu cầu và phản hồi nhanh",
  "Demo / PoC tạo niềm tin",
  "Quan hệ / referral / hệ sinh thái",
];

const LOST_REASONS = [
  "Giá quá cao / Không đủ ngân sách",
  "Thiếu tính năng quan trọng",
  "Chọn đối thủ cạnh tranh",
  "Dừng dự án / Thay đổi kế hoạch",
  "Không liên lạc được (Ghosting)",
  "Lý do khác",
];

const toOptions = (labels: string[]) => labels.map((label) => ({ value: label, label }));

const CONFIDENCE_OPTIONS = toOptions([
  "Cao - C? kh?ch h?ng x?c nh?n",
  "Trung b?nh - D?a tr?n t?n hi?u",
  "Th?p - Ph?ng ?o?n c?a Sale",
]);

const TRIGGER_OPTIONS = toOptions([
  "C?n go-live theo deadline",
  "?ang g?p s? c? c?n x? l?",
]);

const OBJECTION_OPTIONS = toOptions([
  "Lo ng?i ti?n ?? tri?n khai",
  "Gi? cao h?n ng?n s?ch",
]);

const REUSE_LEVEL_OPTIONS = toOptions([
  "Cao - C? th? th?nh playbook",
  "Trung b?nh",
]);

const KB_OWNER_OPTIONS = toOptions(["Sale ph? tr?ch deal"]);
const KB_STATUS_OPTIONS = toOptions(["Draft - Ch? duy?t"]);


const SCORES = [
  "5 — Rất mạnh",
  "4 — Mạnh",
  "3 — Trung bình",
  "2 — Yếu",
  "1 — Rất yếu",
];

export function TerminalReviewForm({ toStage, customerName, onCancel, onSubmit, busy }: Props) {
  const isWon = toStage === "won";
  const { options: wonReasonOptions } = useCrmCategoryCodeOptions("crm_won_reason", toOptions(WIN_REASONS));
  const { options: lostReasonOptions } = useCrmCategoryCodeOptions("crm_lost_reason", LOST_REASON_OPTIONS);
  const { options: confidenceOptions } = useCrmCategoryCodeOptions("crm_outcome_confidence", CONFIDENCE_OPTIONS);
  const { options: triggerOptions } = useCrmCategoryCodeOptions("crm_outcome_trigger", TRIGGER_OPTIONS);
  const { options: objectionOptions } = useCrmCategoryCodeOptions("crm_outcome_objection", OBJECTION_OPTIONS);
  const { options: reuseLevelOptions } = useCrmCategoryCodeOptions("crm_kb_reuse_level", REUSE_LEVEL_OPTIONS);
  const { options: kbOwnerOptions } = useCrmCategoryCodeOptions("crm_kb_owner", KB_OWNER_OPTIONS);
  const { options: kbStatusOptions } = useCrmCategoryCodeOptions("crm_kb_status", KB_STATUS_OPTIONS);

  // State
  const [reviewResult, setReviewResult] = useState(isWon ? "Won — Đã ký / chốt mua" : "Lost — Thất bại");
  const [rejectReasonType, setRejectReasonType] = useState<RejectReasonType | "">(""); // Dành riêng cho lost
  const [confidence, setConfidence] = useState("Cao — Có khách hàng xác nhận");
  const [reasons, setReasons] = useState<string[]>([]);
  const [rootCause, setRootCause] = useState("");

  const [competitor, setCompetitor] = useState("");
  const [influencer, setInfluencer] = useState("");
  const [trigger, setTrigger] = useState("Cần go-live theo deadline");
  const [objection, setObjection] = useState("Lo ngại tiến độ triển khai");
  const [evidence, setEvidence] = useState("");

  const [scoreProduct, setScoreProduct] = useState("5 — Rất mạnh");
  const [scoreConsulting, setScoreConsulting] = useState("4 — Mạnh");
  const [scorePrice, setScorePrice] = useState("3 — Trung bình");
  const [scoreReputation, setScoreReputation] = useState("4 — Mạnh");
  const [scoreSpeed, setScoreSpeed] = useState("5 — Rất mạnh");

  const [lessonRepeat, setLessonRepeat] = useState("");
  const [lessonImprove, setLessonImprove] = useState("");
  const [usecase, setUsecase] = useState("");
  const [reusability, setReusability] = useState("Cao — Có thể thành playbook");
  const [tags, setTags] = useState("");

  const [owner, setOwner] = useState("Sale phụ trách deal");
  const [reviewer, setReviewer] = useState("Sales Leader");
  const [kbStatus, setKbStatus] = useState("Draft — Chờ duyệt");
  const [scope, setScope] = useState("Nội bộ Markee + AI Sales Coach");

  const [decisionMaker, setDecisionMaker] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [quoteLink, setQuoteLink] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");

  const handleToggleReason = (r: string) => {
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  const handleSubmit = () => {
    if (!isWon && !rejectReasonType) {
      alert("Vui lòng chọn Loại lý do thất bại (bắt buộc cho hệ thống)");
      return;
    }

    const lines = [
      `[1. KẾT QUẢ & LÝ DO CHÍNH]`,
      `• Kết quả xác nhận: ${reviewResult}`,
      ...(isWon ? [] : [`• Phân loại thất bại: ${lostReasonOptions.find(x => x.value === rejectReasonType)?.label || rejectReasonType}`]),
      `• Mức độ chắc chắn: ${confidence}`,
      `• Lý do chính: ${reasons.join(", ")}`,
      `• Diễn giải: ${rootCause}`,
      ``,
      `[2. BẰNG CHỨNG & BỐI CẢNH]`,
      `• Đối thủ / thay thế: ${competitor}`,
      `• Người ảnh hưởng: ${influencer}`,
      `• Trigger: ${trigger}`,
      `• Objection: ${objection}`,
      `• Bằng chứng: ${evidence}`,
      ``,
      `[3. CHẤM ĐIỂM]`,
      `• Sản phẩm: ${scoreProduct} | Tư vấn: ${scoreConsulting} | Giá: ${scorePrice} | Uy tín: ${scoreReputation} | Tốc độ: ${scoreSpeed}`,
      ``,
      `[4. BÀI HỌC]`,
      `• Nên lặp lại: ${lessonRepeat}`,
      `• Cần cải thiện: ${lessonImprove}`,
      `• Use case: ${usecase}`,
      `• Tái sử dụng: ${reusability}`,
      `• Tags: ${tags}`,
      ``,
      `[5. QUY TRÌNH]`,
      `• Owner: ${owner} | Reviewer: ${reviewer} | Status: ${kbStatus} | Scope: ${scope}`,
      `• Decision Maker: ${decisionMaker}`,
      `• Ngân sách: ${budget ?? ""}`,
      `• Báo giá: ${quoteName || "Link"} (${quoteLink || "No link"})`,
    ];

    const notePayload = lines.join("\n");

    const payload: StageTransitionPayload = {
      to_stage: toStage,
      note: notePayload,
      ...(decisionMaker ? { decision_maker: decisionMaker } : {}),
      ...(budget !== null ? { estimated_budget: budget } : {}),
      ...(followUpDate ? { follow_up_date: followUpDate } : {}),
      ...(rejectReasonType ? { reject_reason_type: rejectReasonType as RejectReasonType } : {}),
    };

    onSubmit(payload);
  };

  const reasonsList = (isWon ? wonReasonOptions : lostReasonOptions).map((option) => option.label);

  return (
    <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-xl bg-emerald-600 px-6 py-4 text-white"
        style={{ backgroundColor: isWon ? "#059669" : "#dc2626" }}>
        <div>
          <div className="text-xs font-semibold tracking-wider text-emerald-100 opacity-80"
            style={{ color: "rgba(255,255,255,0.8)" }}>
            {isWon ? "WON -> WON" : "LOST -> LOST"}
          </div>
          <h2 className="text-xl font-black">{isWon ? "WIN REVIEW" : "LOST REVIEW"}</h2>
          <div className="text-sm opacity-90">{customerName}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl space-y-8 rounded-xl bg-white p-8 shadow-sm border border-slate-100">
          
          {/* Banner */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-6 py-4 text-slate-800">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-800">
                {isWon ? "WIN REVIEW" : "LOST REVIEW"} — BẮT BUỘC KHI ĐÓNG DEAL
              </h3>
              <p className="text-sm text-slate-500">Dữ liệu được chuẩn hóa để học nội bộ và huấn luyện AI Sales Coach.</p>
            </div>
            <div className={cn("rounded-full px-4 py-1.5 text-xs font-bold text-white", isWon ? "bg-emerald-600" : "bg-red-600")}>
              {isWon ? "WIN REVIEW" : "LOST REVIEW"}
            </div>
          </div>

          {/* 1. KẾT QUẢ */}
          <section>
            <h4 className={sectionTitleCls}>1. KẾT QUẢ & LÝ DO CHÍNH</h4>
            
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Kết quả xác nhận *</label>
                <select className={inputCls} value={reviewResult} onChange={(e) => setReviewResult(e.target.value)}>
                  <option>{isWon ? "Won — Đã ký / chốt mua" : "Lost — Thất bại"}</option>
                  <option>{isWon ? "Won — Thanh toán ngay" : "Lost — Mất liên lạc"}</option>
                </select>
              </div>
              
              {!isWon ? (
                <div>
                  <label className={labelCls}>Phân loại lý do hệ thống (Bắt buộc) *</label>
                  <select className={inputCls} value={rejectReasonType} onChange={(e) => setRejectReasonType(e.target.value as any)}>
                    <option value="">-- Chọn lý do hệ thống --</option>
                    {lostReasonOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className={labelCls}>Mức độ chắc chắn của kết luận *</label>
                  <select className={inputCls} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                    {confidenceOptions.map((opt) => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className={labelCls}>Lý do {isWon ? "thắng" : "thua"} deal *</label>
              <div className="grid grid-cols-2 gap-3">
                {reasonsList.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                    <input type="checkbox" className="mt-1" checked={reasons.includes(r)} onChange={() => handleToggleReason(r)} />
                    <span className="text-sm font-medium text-slate-700">{r}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Diễn giải nguyên nhân gốc *</label>
              <textarea 
                className={cn(inputCls, "h-24 resize-none")} 
                placeholder="Ví dụ: Khách hàng cần triển khai nhanh..."
                value={rootCause} onChange={e => setRootCause(e.target.value)}
              />
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* 2. BẰNG CHỨNG */}
          <section>
            <h4 className={sectionTitleCls}>2. BẰNG CHỨNG & BỐI CẢNH QUYẾT ĐỊNH</h4>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Đối thủ / phương án thay thế</label>
                <input className={inputCls} placeholder="Tự làm nội bộ, freelancer..." value={competitor} onChange={e => setCompetitor(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Người ảnh hưởng chính</label>
                <input className={inputCls} placeholder="Giám đốc kỹ thuật..." value={influencer} onChange={e => setInfluencer(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Trigger khiến khách hàng hành động</label>
                <select className={inputCls} value={trigger} onChange={e => setTrigger(e.target.value)}>
                  {triggerOptions.map((opt) => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Objection lớn nhất</label>
                <select className={inputCls} value={objection} onChange={e => setObjection(e.target.value)}>
                  {objectionOptions.map((opt) => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Bằng chứng xác thực *</label>
              <textarea className={cn(inputCls, "h-20")} placeholder="Nên gắn link email, tin nhắn..." value={evidence} onChange={e => setEvidence(e.target.value)} />
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* 3. CHẤM ĐIỂM */}
          <section>
            <h4 className={sectionTitleCls}>3. CHẤM ĐIỂM YẾU TỐ QUYẾT ĐỊNH</h4>
            <div className="grid gap-4">
              {[
                { label: "Mức độ phù hợp sản phẩm / giải pháp", val: scoreProduct, set: setScoreProduct },
                { label: "Năng lực tư vấn của Sale", val: scoreConsulting, set: setScoreConsulting },
                { label: "Giá & điều khoản thương mại", val: scorePrice, set: setScorePrice },
                { label: "Uy tín / case study / thương hiệu", val: scoreReputation, set: setScoreReputation },
                { label: "Tốc độ phản hồi & triển khai", val: scoreSpeed, set: setScoreSpeed },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between border-b border-slate-50 pb-2">
                  <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                  <select className={cn(inputCls, "w-48")} value={item.val} onChange={e => item.set(e.target.value)}>
                    {SCORES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* 4. BÀI HỌC */}
          <section>
            <h4 className={sectionTitleCls}>4. BÀI HỌC CÓ THỂ TÁI SỬ DỤNG</h4>
            <div className="mb-4">
              <label className={labelCls}>Điều gì nên lặp lại? *</label>
              <textarea className={cn(inputCls, "h-20")} value={lessonRepeat} onChange={e => setLessonRepeat(e.target.value)} />
            </div>
            <div className="mb-4">
              <label className={labelCls}>Điều gì cần cải thiện?</label>
              <textarea className={cn(inputCls, "h-20")} value={lessonImprove} onChange={e => setLessonImprove(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelCls}>Use case / phân khúc áp dụng</label>
                <input className={inputCls} placeholder="SME CNTT..." value={usecase} onChange={e => setUsecase(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Khả năng tái sử dụng</label>
                <select className={inputCls} value={reusability} onChange={e => setReusability(e.target.value)}>
                  {reuseLevelOptions.map((opt) => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Tags Knowledge Base</label>
              <input className={inputCls} placeholder="SME, CNTT, website..." value={tags} onChange={e => setTags(e.target.value)} />
            </div>
          </section>

          <hr className="border-slate-100" />

          {/* 5. QUY TRÌNH */}
          <section>
            <h4 className={sectionTitleCls}>5. QUY TRÌNH & THÔNG TIN KHÁC</h4>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className={labelCls}>Owner bài học</label>
                <select className={inputCls} value={owner} onChange={e => setOwner(e.target.value)}>
                  {kbOwnerOptions.map((opt) => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Người duyệt</label>
                <select className={inputCls} value={reviewer} onChange={e => setReviewer(e.target.value)}><option>Sales Leader</option></select>
              </div>
              <div>
                <label className={labelCls}>Trạng thái tri thức</label>
                <select className={inputCls} value={kbStatus} onChange={e => setKbStatus(e.target.value)}>
                  {kbStatusOptions.map((opt) => <option key={opt.value} value={opt.label}>{opt.label}</option>)}
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelCls}>Phạm vi sử dụng</label>
                <select className={inputCls} value={scope} onChange={e => setScope(e.target.value)}><option>Nội bộ Markee + AI Sales Coach</option></select>
              </div>
              <div>
                <label className={labelCls}>Người ra quyết định</label>
                <input className={inputCls} value={decisionMaker} onChange={e => setDecisionMaker(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelCls}>Ngân sách dự kiến (VND)</label>
                <CurrencyInput className={inputCls} value={budget} onChange={setBudget} />
              </div>
              <div>
                <label className={labelCls}>Ngày follow-up lại</label>
                <input className={inputCls} type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Báo giá đã tạo từ form</label>
              <div className="space-y-2">
                <input className={inputCls} placeholder="Link báo giá..." value={quoteLink} onChange={e => setQuoteLink(e.target.value)} />
                <input className={inputCls} placeholder="Tên báo giá..." value={quoteName} onChange={e => setQuoteName(e.target.value)} />
              </div>
            </div>
          </section>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <AlertTriangle className="mr-2 inline-block size-4 text-amber-500" />
            Trạng thái kết thúc. Sau khi lưu, deal sẽ đóng vòng pipeline.
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 rounded-b-xl border-t border-slate-200 bg-slate-50 p-4">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Hủy
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy}
          className={cn("flex min-w-[120px] items-center justify-center rounded-lg px-5 py-2 text-sm font-medium text-white transition", isWon ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Xác nhận"}
        </button>
      </div>
    </div>
  );
}
