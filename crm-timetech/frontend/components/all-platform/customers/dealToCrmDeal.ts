import type { Customer } from "@/services/customer-lead.service";
import type { Deal, DealStage as CrmDealStage } from "@/modules/crm/types";

/**
 * Adapter: live Deal (`customer_leads` row, `Customer` type in
 * services/customer-lead.service.ts) → the `Deal` shape `CreateQuoteModal`
 * (modules/crm) expects.
 *
 * These are TWO INCOMPATIBLE type systems with different `DealStage`
 * vocabularies (live: new_lead/contacted/.../contract_sent/on_hold/won/lost;
 * modules/crm: dealing/contract_signed/payment_1/.../post_sale_care/...) —
 * confirmed by reading both enums, not assumed. `CreateQuoteModal`'s own code
 * only ever reads `lockedDeal.stage` once, to check `=== 'won'`
 * (`SelectCustomerStep.tsx`), which is a value that exists identically in
 * both enums — so a raw string pass-through is safe for that one comparison
 * even though the two enums don't otherwise overlap. Every other Deal field
 * CreateQuoteModal actually reads from a locked deal is a plain string
 * (customerId/customerName/companyName/phone/email/address/id) or an
 * all-optional nested object (contract/outcome/assignment), which this
 * adapter fills with real values where available and safe empty defaults
 * otherwise (never fabricated data).
 */
export function customerToCrmDeal(customer: Customer): Deal {
  return {
    id: customer.id,
    contactId: customer.id,
    dealId: customer.id,
    customerId: customer.customer_id || undefined,
    projectId: customer.project_id ?? null,
    customerName: customer.customer_name,
    companyName: customer.company_name || undefined,
    phone: customer.phone || undefined,
    email: customer.email || undefined,
    address: customer.address || undefined,
    city: customer.city || undefined,
    industry: customer.industry || undefined,
    sourcePlatform: customer.source_platform,
    servicePackage: customer.service_package || undefined,
    // Raw pass-through — see file-level comment. Only ever compared against
    // the literal 'won', which is spelled identically in both enums.
    stage: (customer.deal_stage || "new_lead") as unknown as CrmDealStage,
    stageEnteredAt: customer.stage_entered_at || customer.created_at,
    daysInStage: customer.days_in_stage ?? 0,
    stageHistory: [],
    decisionMaker: customer.decision_maker || undefined,
    estimatedBudget: customer.estimated_budget ?? undefined,
    lifetimeValue: customer.lifetime_value ?? undefined,
    followUpDate: customer.follow_up_date || undefined,
    contract: {},
    outcome: {},
    assignment: {
      sdrId: customer.sdr_id || undefined,
      sdrName: customer.sdr_name || undefined,
      leadedById: customer.leaded_by || undefined,
      leadName: customer.leader_name || undefined,
    },
    note: customer.note || undefined,
    createdAt: customer.created_at,
    updatedAt: customer.updated_at,
    teamId: undefined,
    teamName: customer.team_name || undefined,
    teamType: customer.team_type || undefined,
  };
}
