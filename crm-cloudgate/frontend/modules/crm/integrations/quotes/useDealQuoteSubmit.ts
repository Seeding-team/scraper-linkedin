import { useCallback, useState } from 'react';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { QuoteForm } from '@/modules/quotes';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import { humanizeCrmError } from '../../constants/crmConfig';
import { buildDealPayload } from '../../components/DealFormFields';
import type { DealFormState } from '../../components/DealFormFields';
import type { CreateDealInput, CrmUserOption, Deal } from '../../types';
import type { QuoteDraft } from './types';

interface SubmitArgs {
  dealDraft: DealFormState;
  agents: CrmUserOption[];
  selectedForm: QuoteForm | null;
  quoteDraft: QuoteDraft;
  skipQuote: boolean;
}

export function useDealQuoteSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const submit = useCallback(async ({ dealDraft, agents, selectedForm, quoteDraft, skipQuote }: SubmitArgs): Promise<Deal | null> => {
    setSubmitting(true);
    setSubmitError('');
    let createdDealId: string | null = null;
    let createdQuoteId: string | null = null;
    try {
      const deal = await seedingCrmRepository.createDeal(buildDealPayload(dealDraft, agents) as CreateDealInput);
      createdDealId = deal.id;
      if (skipQuote || !selectedForm) return deal;

      const isVilla = selectedForm.schemaJson.layoutType === 'villa_solution_package';
      const quote = await seedingQuoteRepository.createQuote({
        quoteFormId: selectedForm.id,
        dealId: deal.id,
        data: isVilla ? { ...quoteDraft.data, solutionItems: quoteDraft.solutionItems } : quoteDraft.data,
        items: isVilla ? [] : quoteDraft.items,
      });
      createdQuoteId = quote.id;

      // createQuote đã tự gắn quote_id thẳng lên customer_leads (backend auto-link,
      // xem create_quote()) - báo giá luôn tạo ra ở trạng thái "draft" (chưa duyệt,
      // chưa có link public), không còn tự publish ngay sau khi tạo nữa. Đọc lại
      // deal để card hiện đúng dữ liệu mới (tag "Chưa duyệt").
      return await seedingCrmRepository.getDeal(deal.id);
    } catch (err) {
      if (createdQuoteId) await seedingQuoteRepository.deleteQuote(createdQuoteId).catch(() => {});
      if (createdDealId) await seedingCrmRepository.deleteDeal(createdDealId, true).catch(() => {});
      setSubmitError(
        err instanceof Error ? humanizeCrmError(err.message) : 'Không thể tạo deal và báo giá. Đã hoàn tác các thay đổi.'
      );
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const resetError = useCallback(() => setSubmitError(''), []);

  return { submit, submitting, submitError, resetError };
}
