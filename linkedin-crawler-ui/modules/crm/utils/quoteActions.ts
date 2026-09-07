/** Nguon DUY NHAT cho "phase nay hien nut gi, disable vi sao" (Checkpoint D,
 * yeu cau tranh dieu kien footer bi phan tan ra nhieu noi trong JSX). Ham
 * THUAN (khong goi API, khong doc DOM) - nhan vao cac gia tri DA duoc tinh
 * dung o QuoteWorkspaceModal.tsx (deal/checklist/items/SLA...), tra ve
 * primary/secondary/menu action + ly do disable. Component chi viec RENDER
 * theo output nay, khong tu quyet dinh lai dieu kien.
 *
 * Backend van tu kiem tra permission/state doc lap (RPC quote_*), selector
 * nay KHONG thay the security backend - chi dieu khien UI hien/an/disable
 * nut cho dung, tranh nguoi dung thay nut nhung bam vao lai bi 403/409 vo
 * ly do. */

export type QuoteAction =
  | "saveDraft"
  | "submitRequest"
  | "handoffToPricing"
  | "completePricing"
  | "requestChanges"
  | "approve"
  | "publish"
  | "send"
  | "resend"
  | "viewDeliveryHistory"
  | "createVersion"
  | "continueDraftVersion"
  | "copyPublicLink"
  | "revokePublic";

export type QuoteProcessingStageLike = "request" | "technical" | "pricing" | "review" | "ready_to_publish" | "published";

export interface QuoteActionsInput {
  /** false khi dang o che do TAO MOI (quoteId=null) - chua co record that. */
  hasQuote: boolean;
  /** true = quote.status==='draft' (con sua duoc), false = approved/khoa. */
  isDraft: boolean;
  stage: QuoteProcessingStageLike;
  /** uu tien Da chot/Da huy (deal won/lost hoac quote.status==='cancelled'),
   * dung CHINH XAC thu tu da co trong quoteDisplayStatus(). */
  statusKey: "draft" | "sent" | "won" | "lost";
  canEdit: boolean;
  canApprove: boolean;
  /** true = du dieu kien "Gui yeu cau xu ly" (co hoi/SLA/nguoi phu trach...). */
  canSubmitRequest: boolean;
  submitRequestDisabledReason?: string;
  /** true = checklist Scope/Cost/Timeline/Assumption da xac nhan du + het
   * hang muc thieu gia von. */
  canHandoffToPricing: boolean;
  handoffDisabledReason?: string;
  /** true = it nhat 1 hang muc + tong tien > 0 (du de gui duyet). */
  canCompletePricing: boolean;
  completePricingDisabledReason?: string;
  canPreview: boolean;
  previewDisabledReason?: string;
  sendDisabledReason?: string;
  /** publicEnabled thuc su dang bat (cho revokePublic/copyPublicLink). */
  publicEnabled: boolean;
  /** co sentAt hay chua (phan biet "published chua gui" vs "da gui"). */
  hasSentAt: boolean;
  /** co delivery log nao tu truoc (cho "Xem lich su gui" trong menu o cac
   * phase KHAC "sent" - vd published-unsent tung gui loi truoc do). */
  hasDeliveryLog: boolean;
  /** so version cua 1 draft MOI HON dang ton tai san trong chuoi (vd V3
   * draft trong khi dang xem V2 approved) - null/undefined = chua co. */
  existingDraftVersionNumber?: number | null;
}

export interface QuoteActionsResult {
  primary: QuoteAction | null;
  secondary: QuoteAction[];
  menu: QuoteAction[];
  disabledReasons: Partial<Record<QuoteAction, string>>;
}

function empty(): QuoteActionsResult {
  return { primary: null, secondary: [], menu: [], disabledReasons: {} };
}

export function getQuoteAvailableActions(input: QuoteActionsInput): QuoteActionsResult {
  const result = empty();

  // ── Che do TAO MOI (chua co quote that) ─────────────────────────────────
  if (!input.hasQuote) {
    result.secondary.push("saveDraft");
    result.primary = "submitRequest";
    if (!input.canSubmitRequest) result.disabledReasons.submitRequest = input.submitRequestDisabledReason;
    return result;
  }

  // ── Deal won/lost hoac quote cancelled - khoa hoan toan, chi xem ────────
  if (input.statusKey === "won" || input.statusKey === "lost") {
    result.secondary.push("viewDeliveryHistory");
    return result;
  }

  // ── Quote da duyet (khong con isDraft) - review/ready_to_publish/
  // published/sent deu roi vao day (status != 'draft') ────────────────────
  if (!input.isDraft) {
    result.secondary.push("copyPublicLink");
    if (input.publicEnabled) result.secondary.push("revokePublic");

    if (input.existingDraftVersionNumber) {
      result.menu.push("continueDraftVersion");
    } else {
      result.menu.push("createVersion");
    }

    if (input.stage !== "published") {
      // approved, chua phat hanh -> ready_to_publish.
      result.primary = "publish";
      return result;
    }

    if (!input.hasSentAt) {
      // da phat hanh, chua gui -> Gui khach hang la primary.
      result.primary = "send";
      if (input.sendDisabledReason) result.disabledReasons.send = input.sendDisabledReason;
      if (input.hasDeliveryLog) result.secondary.push("viewDeliveryHistory");
      return result;
    }

    // da gui khach -> Gui lai la primary, luon co lich su gui.
    result.secondary.push("viewDeliveryHistory");
    result.primary = "resend";
    if (input.sendDisabledReason) result.disabledReasons.resend = input.sendDisabledReason;
    return result;
  }

  // ── Con la draft (status='draft') - phan theo processingStage ───────────
  if (input.stage === "request") {
    if (input.canEdit) {
      result.primary = "submitRequest";
      if (!input.canSubmitRequest) result.disabledReasons.submitRequest = input.submitRequestDisabledReason;
    }
    return result;
  }

  if (input.stage === "technical") {
    if (input.canEdit) {
      result.secondary.push("saveDraft");
      result.primary = "handoffToPricing";
      if (!input.canHandoffToPricing) result.disabledReasons.handoffToPricing = input.handoffDisabledReason;
    }
    return result;
  }

  if (input.stage === "pricing") {
    if (input.canEdit) {
      result.secondary.push("saveDraft");
      result.primary = "completePricing";
      if (!input.canCompletePricing) result.disabledReasons.completePricing = input.completePricingDisabledReason;
    }
    return result;
  }

  if (input.stage === "review") {
    if (input.canEdit) result.secondary.push("requestChanges");
    if (input.canApprove) result.primary = "approve";
    return result;
  }

  return result;
}
