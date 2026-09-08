// Unit test THUAN (khong DOM, khong API) cho getQuoteAvailableActions() -
// Checkpoint D selector dung chung. Chay:
//   node --experimental-strip-types scratch/test_quote_actions.ts
import { getQuoteAvailableActions, type QuoteActionsInput } from "../modules/crm/utils/quoteActions.ts";

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label} ${detail}`);
}

function base(overrides: Partial<QuoteActionsInput>): QuoteActionsInput {
  return {
    hasQuote: true,
    isDraft: true,
    stage: "request",
    statusKey: "draft",
    canEdit: true,
    canApprove: false,
    canSubmitRequest: true,
    canHandoffToPricing: true,
    canCompletePricing: true,
    canPreview: true,
    publicEnabled: false,
    hasSentAt: false,
    hasDeliveryLog: false,
    ...overrides,
  };
}

// ── 1) Create-mode ──────────────────────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ hasQuote: false, canSubmitRequest: false, submitRequestDisabledReason: "Cần SLA" }));
  record("Create-mode: primary=submitRequest", r.primary === "submitRequest");
  record("Create-mode: secondary co saveDraft", r.secondary.includes("saveDraft"));
  record("Create-mode: disabled khi thieu SLA", r.disabledReasons.submitRequest === "Cần SLA");
}

// ── 2) request (draft, canEdit) ─────────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ stage: "request" }));
  record("request: primary=submitRequest", r.primary === "submitRequest");
}
{
  const r = getQuoteAvailableActions(base({ stage: "request", canEdit: false }));
  record("request, khong co quyen: KHONG co primary nao", r.primary === null);
}

// ── 3) technical ─────────────────────────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ stage: "technical", isDraft: true }));
  record("technical: primary=handoffToPricing", r.primary === "handoffToPricing");
  record("technical: secondary co saveDraft", r.secondary.includes("saveDraft"));
}
{
  const r = getQuoteAvailableActions(base({ stage: "technical", canEdit: false }));
  record("technical, khong co quyen: KHONG co nut mutation nao", r.primary === null && r.secondary.length === 0);
}

// ── 4) pricing ───────────────────────────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ stage: "pricing" }));
  record("pricing: primary=completePricing", r.primary === "completePricing");
}
{
  const r = getQuoteAvailableActions(base({ stage: "pricing", canCompletePricing: false, completePricingDisabledReason: "Cần ít nhất 1 hạng mục" }));
  record("pricing, chua du dieu kien: disabledReasons dung", r.disabledReasons.completePricing === "Cần ít nhất 1 hạng mục");
}

// ── 5) review - dung CASE bug that da bao cao ──────────────────────────
{
  const r = getQuoteAvailableActions(base({ stage: "review", canEdit: true, canApprove: true }));
  record("review, Admin: primary=approve", r.primary === "approve");
  record("review, Admin: secondary co requestChanges", r.secondary.includes("requestChanges"));
}
{
  const r = getQuoteAvailableActions(base({ stage: "review", canEdit: false, canApprove: false }));
  record("review, Member (khong quyen): KHONG co primary/secondary nao", r.primary === null && r.secondary.length === 0);
}

// ── 6) ready_to_publish (khong con isDraft) ─────────────────────────────
{
  const r = getQuoteAvailableActions(base({ isDraft: false, stage: "ready_to_publish", statusKey: "sent" }));
  record("ready_to_publish: primary=publish", r.primary === "publish");
  record("ready_to_publish: menu co createVersion (chua co draft nao khac)", r.menu.includes("createVersion"));
}
{
  const r = getQuoteAvailableActions(base({ isDraft: false, stage: "ready_to_publish", statusKey: "sent", existingDraftVersionNumber: 3 }));
  record("ready_to_publish, DA CO draft V3: menu la continueDraftVersion (khong phai createVersion)", r.menu.includes("continueDraftVersion") && !r.menu.includes("createVersion"));
}

// ── 7) published, chua gui ──────────────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ isDraft: false, stage: "published", statusKey: "sent", hasSentAt: false, sendDisabledReason: "Cần cấu hình email" }));
  record("published chua gui: primary=send", r.primary === "send");
  record("published chua gui: disabledReasons.send dung", r.disabledReasons.send === "Cần cấu hình email");
  record("published chua gui: KHONG co resend trong ket qua", !r.secondary.includes("resend") && r.primary !== "resend");
}

// ── 8) published, da gui ────────────────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ isDraft: false, stage: "published", statusKey: "sent", hasSentAt: true }));
  record("published da gui: primary=resend", r.primary === "resend");
  record("published da gui: secondary co viewDeliveryHistory", r.secondary.includes("viewDeliveryHistory"));
}

// ── 9) publicEnabled -> revokePublic co mat trong secondary ─────────────
{
  const r1 = getQuoteAvailableActions(base({ isDraft: false, stage: "published", statusKey: "sent", hasSentAt: true, publicEnabled: true }));
  record("publicEnabled=true: secondary co revokePublic", r1.secondary.includes("revokePublic"));
  const r2 = getQuoteAvailableActions(base({ isDraft: false, stage: "published", statusKey: "sent", hasSentAt: true, publicEnabled: false }));
  record("publicEnabled=false: secondary KHONG co revokePublic", !r2.secondary.includes("revokePublic"));
}

// ── 10) won/lost - khoa hoan toan ───────────────────────────────────────
{
  const r = getQuoteAvailableActions(base({ isDraft: false, statusKey: "won" }));
  record("Deal won: KHONG co primary nao (chi xem)", r.primary === null);
}
{
  const r = getQuoteAvailableActions(base({ isDraft: false, statusKey: "lost" }));
  record("Deal lost: KHONG co primary nao (chi xem)", r.primary === null);
}

console.log();
console.log("=== SUMMARY ===");
console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
