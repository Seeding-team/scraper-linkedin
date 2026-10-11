/**
 * State machine cho CRM Sales Pipeline.
 *
 * Quy tắc nghiệp vụ (rút gọn từ tài liệu vận hành):
 *   - Mỗi stage chỉ được chuyển sang 1 tập stage kế tiếp nhất định.
 *   - Mỗi lần đổi stage phải ghi log (audit trail) — server-side đã xử lý,
 *     client chỉ cần biết khi nào hợp lệ để drag/click.
 *   - Một số stage BẮT BUỘC có data kèm theo (lost→lý do, qualified→budget…).
 *   - Won / Lost là TERMINAL: không cho đổi tiếp qua drag; chỉ "reopen"
 *     bằng cách tạo deal mới hoặc qua quy trình reopen riêng.
 *   - On Hold có prev_stage: khi resume phải quay về đúng stage trước.
 */

import type { Customer } from "./customer-lead.service";
import {
  DEAL_STAGE_META,
  DEAL_STAGE_TRANSITIONS,
  type DealStage,
  LOST_REASON_OPTIONS,
  PAUSABLE_FROM,
  PIPELINE_COLUMNS,
  STAGE_REQUIREMENTS,
  STAGE_REQUIREMENTS as REQ,
  TERMINAL_STAGES,
  type StageRequirements,
  type StageTransitionPayload,
} from "./customer-lead.service";

export interface ValidationResult {
  ok: boolean;
  /** Mô tả ngắn gọn để hiển thị toast nếu fail. */
  reason?: string;
  /** Field bị thiếu → highlight trong modal. */
  missing?: (keyof StageTransitionPayload | "note" | "attachment")[];
}

/** Trả về danh sách stage được phép chuyển sang (kể cả lost/pause từ stages giữa). */
export function allowedNextStages(from: DealStage): DealStage[] {
  return DEAL_STAGE_TRANSITIONS[from] ?? [];
}

/** Stage có hợp lệ trong pipeline không (phòng data cũ). */
export function isValidDealStage(s: unknown): s is DealStage {
  return typeof s === "string" && s in DEAL_STAGE_META;
}

/** Lấy stage hiện tại của 1 customer — fallback về new_lead nếu không có. */
export function getCurrentStage(c: Pick<Customer, "deal_stage" | "status">): DealStage {
  if (c.deal_stage && isValidDealStage(c.deal_stage)) return c.deal_stage;
  return "new_lead";
}

/**
 * Validate 1 lần chuyển stage TRƯỚC khi mở modal.
 * Trả về { ok, reason } — nếu !ok thì hiện toast và không mở modal.
 */
export function validateTransition(
  from: DealStage,
  to: DealStage,
  customer: Pick<Customer, "deal_stage" | "status" | "prev_stage">,
  payload: Partial<StageTransitionPayload> = {},
): ValidationResult {
  // 1. Không cho rời terminal stage
  if (TERMINAL_STAGES.includes(from)) {
    return {
      ok: false,
      reason: `Deal đã ở trạng thái "${DEAL_STAGE_META[from].label}" — trạng thái kết thúc. Để tiếp tục, hãy tạo deal mới.`,
    };
  }

  // 2. Về cùng stage thì thôi
  if (from === to) return { ok: true };

  // 3. Check state machine
  const allowed = DEAL_STAGE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Không thể chuyển trực tiếp từ "${DEAL_STAGE_META[from].label}" → "${DEAL_STAGE_META[to].label}". Các bước hợp lệ: ${allowed
        .map((s) => DEAL_STAGE_META[s].label)
        .join(", ")}.`,
    };
  }

  // 4. On Hold: chỉ vào từ các stage chính (không vào từ Won/Lost)
  if (to === "on_hold" && !PAUSABLE_FROM.includes(from)) {
    return {
      ok: false,
      reason: `"${DEAL_STAGE_META[from].label}" không thể vào On Hold.`,
    };
  }

  // 5. On Hold → quay lại đúng prev_stage
  if (from === "on_hold" && to !== "lost") {
    return {
      ok: false,
      reason: `Deal đang On Hold cần resume về đúng stage trước (${
        customer.prev_stage ? DEAL_STAGE_META[customer.prev_stage].label : "chưa xác định"
      }), không thể nhảy sang stage khác.`,
    };
  }

  // 6. Validate required fields cho stage đích
  const req = STAGE_REQUIREMENTS[to];
  const missing: ValidationResult["missing"] = [];

  if (req.requireNote && !(payload.note && payload.note.trim())) {
    missing.push("note");
  }
  if (req.requireAttachment && !payload.attachment_url) {
    missing.push("attachment");
  }
  if (req.requireRejectReason && !payload.reject_reason_type) {
    missing.push("reject_reason_type");
  }
  if (req.requireDecisionMaker && !payload.decision_maker) {
    missing.push("decision_maker");
  }
  if (req.requireBudget && (payload.estimated_budget ?? 0) <= 0) {
    missing.push("estimated_budget");
  }
  // On Hold cần follow_up_date
  if (to === "on_hold" && !payload.follow_up_date) {
    missing.push("follow_up_date");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Thiếu thông tin bắt buộc để chuyển sang "${DEAL_STAGE_META[to].label}".`,
      missing,
    };
  }

  return { ok: true };
}

/** Map trạng thái thân thiện cho UI badge. */
export function stageLabel(s: DealStage): string {
  return DEAL_STAGE_META[s]?.label ?? s;
}

/** Style classes cho badge stage. */
export function stageBadgeClass(s: DealStage): string {
  return DEAL_STAGE_META[s]?.badgeClass ?? "bg-muted text-muted-foreground border-border";
}

/** Màu header cho cột Kanban. */
export function stageHeaderClass(s: DealStage): string {
  return DEAL_STAGE_META[s]?.headerClass ?? "bg-slate-500";
}

/** Khách còn nợ (chưa/một phần) VÀ đã qua hạn thanh toán → cần nhắc thu tiền gấp. */
export function isPaymentOverdue(
  c: Pick<Customer, "payment_status" | "payment_due_date">,
): boolean {
  if (!c.payment_due_date || c.payment_status === "paid") return false;
  return new Date(c.payment_due_date).getTime() < Date.now();
}

export { DEAL_STAGE_META, DEAL_STAGE_TRANSITIONS, LOST_REASON_OPTIONS, PIPELINE_COLUMNS, REQ as STAGE_REQ_MAP, TERMINAL_STAGES };
export type { DealStage, StageRequirements, StageTransitionPayload };
