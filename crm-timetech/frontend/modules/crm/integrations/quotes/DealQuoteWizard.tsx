'use client';

import { useState } from 'react';
import type { QuoteForm } from '@/modules/quotes';
import { DealFormFields, emptyDealForm, validateDealForm } from '../../components/DealFormFields';
import type { DealFormState } from '../../components/DealFormFields';
import { CheckCircle2, Loader2, X } from '../../components/icons';
import type { CrmUserOption, Deal } from '../../types';
import { FillQuoteStep } from './FillQuoteStep';
import { ReviewQuoteStep } from './ReviewQuoteStep';
import { SelectQuoteFormStep } from './SelectQuoteFormStep';
import { emptyQuoteDraft, quoteDraftFromForm } from './types';
import type { QuoteDraft, WizardStep } from './types';
import { useDealQuoteSubmit } from './useDealQuoteSubmit';
import { useAppAuth } from '@/contexts/AppAuthContext';

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Khách hàng',
  2: 'Chọn mẫu',
  3: 'Báo giá',
  4: 'Xác nhận',
};

export function DealQuoteWizard({
  open,
  onClose,
  onCreated,
  agents = [],
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (deal: Deal) => void;
  agents?: CrmUserOption[];
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [dealDraft, setDealDraft] = useState<DealFormState>(emptyDealForm);
  const [selectedForm, setSelectedForm] = useState<QuoteForm | null>(null);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft>(emptyQuoteDraft);
  const { submit, submitting, submitError, resetError } = useDealQuoteSubmit();
  const { user: currentUser } = useAppAuth();

  function setDealValue<K extends keyof DealFormState>(key: K, value: DealFormState[K]) {
    setDealDraft(current => ({ ...current, [key]: value }));
  }

  function resetAndClose() {
    if (submitting) return;
    setStep(1);
    setDealDraft(emptyDealForm());
    setSelectedForm(null);
    setQuoteDraft(emptyQuoteDraft());
    resetError();
    onClose();
  }

  function handleStep1Submit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateDealForm(dealDraft);
    if (validationError) {
      window.alert(validationError);
      return;
    }
    setStep(2);
  }

  function handlePreviewForm(form: QuoteForm) {
    setSelectedForm(form);
  }

  function handleSelectForm(form: QuoteForm) {
    setSelectedForm(form);
    setQuoteDraft(quoteDraftFromForm(form, dealDraft, undefined, currentUser?.name));
    setStep(3);
  }

  async function handleSkipQuote() {
    const deal = await submit({ dealDraft, agents, selectedForm: null, quoteDraft, skipQuote: true });
    if (deal) {
      onCreated(deal);
      resetAndClose();
    }
  }

  async function handleFinalSubmit() {
    const deal = await submit({ dealDraft, agents, selectedForm, quoteDraft, skipQuote: false });
    if (deal) {
      onCreated(deal);
      resetAndClose();
    }
  }

  function goToStep(index: WizardStep) {
    if (index < step) setStep(index);
  }

  if (!open) return null;

  return (
    <div className="crm-modal-backdrop" onClick={resetAndClose}>
      <div className="crm-modal crm-wizard-modal" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">Thêm deal và báo giá</h2>
            <p className="crm-modal-subtitle">Tạo deal CRM cùng báo giá thật từ mẫu đang hoạt động.</p>
          </div>
          <button type="button" className="crm-modal-close" onClick={resetAndClose} aria-label="Đóng" disabled={submitting}>
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-wizard-stepper-container">
          <div className="crm-wizard-stepper-inner">
            {([1, 2, 3, 4] as WizardStep[]).map((item, index) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  className={`crm-wizard-step-item ${item === step ? 'crm-wizard-step-item--active' : ''} ${item < step ? 'crm-wizard-step-item--done' : ''}`}
                  onClick={() => goToStep(item)}
                >
                  <div className="crm-wizard-step-circle">
                    {item < step ? <CheckCircle2 className="w-3 h-3" /> : <span>{item}</span>}
                  </div>
                  <span className="crm-wizard-step-label">{STEP_LABELS[item]}</span>
                </div>
                {index < 3 ? (
                  <div className={`crm-wizard-step-line ${item < step ? 'crm-wizard-step-line--done' : ''}`} />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="crm-modal-body crm-wizard-body">
          <div className="crm-wizard-content">
            {step === 1 ? (
              <form id="crmWizardStep1" onSubmit={handleStep1Submit}>
                <DealFormFields form={dealDraft} setValue={setDealValue} agents={agents} variant="wizard" />
              </form>
            ) : null}
            {step === 2 ? (
              <SelectQuoteFormStep
                selectedFormId={selectedForm?.id}
                previewForm={selectedForm}
                onPreview={handlePreviewForm}
                onSelect={handleSelectForm}
                onSkip={() => void handleSkipQuote()}
                skipping={submitting}
              />
            ) : null}
            {step === 3 && selectedForm ? (
              <FillQuoteStep schema={selectedForm.schemaJson} value={quoteDraft} onChange={setQuoteDraft} />
            ) : null}
            {step === 4 && selectedForm ? <ReviewQuoteStep schema={selectedForm.schemaJson} draft={quoteDraft} /> : null}
            {submitError ? <p className="crm-error">{submitError}</p> : null}
          </div>
        </div>

        <footer className="crm-modal-footer">
          <div className="crm-footer-left">
            <button type="button" className="crm-cancel-button" onClick={resetAndClose} disabled={submitting}>
              Hủy
            </button>
          </div>
          <div className="crm-footer-right">
            {step > 1 ? (
              <button
                type="button"
                className="crm-cancel-button"
                disabled={submitting}
                onClick={() => setStep(current => (current - 1) as WizardStep)}
              >
                Quay lại
              </button>
            ) : null}
            {step === 1 ? (
              <button type="submit" form="crmWizardStep1" className="crm-save-button">
                Tiếp theo
              </button>
            ) : null}
            {step === 3 ? (
              <button type="button" className="crm-save-button" onClick={() => setStep(4)}>
                Tiếp theo
              </button>
            ) : null}
            {step === 4 ? (
              <button type="button" className="crm-save-button crm-save-button--large" disabled={submitting} onClick={() => void handleFinalSubmit()}>
                {submitting ? <Loader2 className="crm-save-spinner" /> : null}
                {submitting ? 'Đang tạo...' : 'Xác nhận và tạo deal'}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
