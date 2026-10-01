'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import {
  evaluateIcpFitAuto,
  evaluateLeadConditions,
  hasAnyProduct,
  type IcpFit,
  type LeadRuleFields,
  type VerificationOutcome,
} from '../utils/leadQualificationRules';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

/** Dùng chung giữa LeadDetailDrawer (Xác minh Lead) và CreateOpportunityDrawer
 * (Tạo cơ hội trực tiếp) - "1 form 1 luôn" (leader, 2026-09-27): card "Kết quả
 * Lead" tự tính y hệt nhau ở cả 2 form, kể cả khi Tạo cơ hội không có Lead
 * thật để phân loại (tự tính như 1 Lead ảo, theo đúng feedback leader). */
export function useLeadQualificationEngine(params: {
  open: boolean;
  /** "Khách đang quan tâm gì?" - chuỗi nhiều sản phẩm/dịch vụ nối bằng ", "
   * (xem CrmProductMultiSelect) - dùng để tính CẢ has_product LẪN ICP tự
   * động, thay cho `icpFit` cố định SDR chọn tay trước đây. */
  productValue: string;
  knownProductLabels: string[];
  hasInterestLevel: boolean;
  hasValue: boolean;
  hasTeam: boolean;
  hasNext: boolean;
  hasFollow: boolean;
  hasContact: boolean;
}) {
  const [ruleConditions, setRuleConditions] = useState<Record<string, boolean> | null>(null);
  const [verificationOutcome, setVerificationOutcome] = useState<VerificationOutcome>('pending');
  const [outcomeReasons, setOutcomeReasons] = useState<string[]>([]);
  const [outcomeMissing, setOutcomeMissing] = useState<string[]>([]);
  const [sqlProgress, setSqlProgress] = useState<{ ok: number; total: number }>({ ok: 0, total: 0 });

  useEffect(() => {
    if (!params.open) return;
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads/classification-rules`, { credentials: 'include', headers: headers() })
      .then(res => res.json())
      .then(body => {
        if (!alive || body.success === false) return;
        setRuleConditions((body.data?.conditions as Record<string, boolean>) || null);
      })
      .catch(() => {
        // Im lang - khong co rule thi giu hanh vi cu, khong chan luong chinh.
      });
    return () => { alive = false; };
  }, [params.open]);

  const icpFit: IcpFit = useMemo(
    () => evaluateIcpFitAuto(params.productValue, params.knownProductLabels, ruleConditions),
    [params.productValue, params.knownProductLabels, ruleConditions],
  );

  useEffect(() => {
    if (!ruleConditions) return;
    const fields: LeadRuleFields = {
      has_product: hasAnyProduct(params.productValue),
      has_interest_level: params.hasInterestLevel,
      has_value: params.hasValue,
      has_team: params.hasTeam,
      has_next: params.hasNext,
      has_follow: params.hasFollow,
      has_contact: params.hasContact,
      fit_unfit: icpFit === 'unfit',
      fit_known: icpFit !== 'unknown',
    };
    const computed = evaluateLeadConditions(fields, ruleConditions);
    setVerificationOutcome(computed.outcome);
    setOutcomeReasons(computed.reasons);
    setOutcomeMissing(computed.missing);
    setSqlProgress({ ok: computed.sqlOk, total: computed.sqlTotal });
  }, [
    ruleConditions, params.productValue, params.hasInterestLevel, params.hasValue,
    params.hasTeam, params.hasNext, params.hasFollow, params.hasContact, icpFit,
  ]);

  return { ruleConditions, verificationOutcome, outcomeReasons, outcomeMissing, sqlProgress, icpFit };
}
