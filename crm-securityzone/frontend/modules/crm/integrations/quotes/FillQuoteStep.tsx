'use client';

import { QuoteFormFiller } from '@/modules/quotes';
import type { QuoteField, QuoteSchema } from '@/modules/quotes';
import { CustomBlocksEditor } from './CustomBlocksEditor';
import type { QuoteDraft } from './types';

// Section da hien o Buoc 1 (SelectCustomerStep)/Buoc 2 (IssuerCompanySection)
// hoac la khoi Tong tien rieng ngay trong QuoteFormFiller (ngoai vong lap
// section) - hien lai theo schema o day se bi trung lap, roi rac.
const REDUNDANT_SECTION_KEYS = new Set(['seller', 'customer', 'totals']);

// Buoc 3 "Hang muc bao gia" (section='combined') gop CA thong tin chung LAN
// bang hang muc vao 1 man, chia theo TUNG FIELD (khong theo section) thanh 3
// khoi, tu tren xuong:
//   1) Luon hien - dung 5 key co dinh nay (dung cho MOI mau, field nao khong
//      ton tai trong mau thi tu bo qua, khong loi).
//   2) "Thong tin nang cao" (gap lai <details>) - MOI field con lai KHONG phai
//      repeater-table/calculated/note - bao gom ca field rieng cua tung mau
//      (vd sellerBrandName/customerRecipient cua villa, hay bat ky field tuy
//      bien nao admin them vao schema_json rieng 1 mau) - khong hardcode het
//      danh sach vi mau moi/tuy bien co the co field ma code nay chua tung
//      biet ten, PHAI roi vao day thay vi bi am tham bo qua.
//   3) Bang hang muc (quoteItems/solutionItems) + khoi Tam tinh/VAT/Tong cong.
//   4) "Ghi chu & dieu khoan" - field 'notes' (neu mau co).
const ALWAYS_VISIBLE_KEYS = new Set(['quoteTitle', 'quoteDate', 'validityDays', 'currency', 'defaultVatRate']);
const NOTES_KEYS = new Set(['notes']);

function isDataField(field: QuoteField) {
  return field.type !== 'repeater-table' && field.type !== 'calculated';
}

export function FillQuoteStep({
  schema,
  value,
  onChange,
  quoteFormId,
  section,
}: {
  schema: QuoteSchema;
  value: QuoteDraft;
  onChange: (next: QuoteDraft) => void;
  quoteFormId?: string;
  /** 'combined' = Bước 3 "Hạng mục báo giá" của wizard 4 bước: khối luôn hiện
   * (tiêu đề/ngày/hiệu lực/tiền tệ/VAT mặc định) → khối "Thông tin nâng cao"
   * gấp lại (mọi field còn lại, kể cả field riêng của từng mẫu) → bảng hạng
   * mục + Tạm tính/VAT/Tổng cộng → Ghi chú & điều khoản. undefined = giữ hành
   * vi cũ, gộp hết 1 màn không chia khối gì (DealQuoteWizard vẫn dùng 1 bước
   * "Báo giá" duy nhất, không đổi để tránh ảnh hưởng luồng đó). */
  section?: 'combined';
}) {
  const withoutRedundant = schema.sections.filter(s => !REDUNDANT_SECTION_KEYS.has(s.key));

  if (!section) {
    return (
      <div className="crm-wizard-fill-step">
        <QuoteFormFiller schema={{ ...schema, sections: withoutRedundant }} value={value} onChange={onChange} quoteFormId={quoteFormId} />
      </div>
    );
  }

  const repeaterSections = withoutRedundant.filter(s => s.fields.some(f => f.type === 'repeater-table'));
  const allDataFields = withoutRedundant.flatMap(s => s.fields.filter(isDataField));
  const alwaysVisibleFields = allDataFields.filter(f => ALWAYS_VISIBLE_KEYS.has(f.key));
  const notesFields = allDataFields.filter(f => NOTES_KEYS.has(f.key));
  // "Nang cao": tat ca field con lai (bao gom auto-number nhu quoteNumber,
  // field rieng tung mau nhu sellerBrandName/customerRecipient/quoteSubtitle,
  // representative...) - PHAI hien o day, khong duoc roi mat field nao.
  const advancedFields = allDataFields.filter(f => !ALWAYS_VISIBLE_KEYS.has(f.key) && !NOTES_KEYS.has(f.key));

  return (
    <div className="crm-wizard-fill-step">
      {alwaysVisibleFields.length ? (
        <QuoteFormFiller
          schema={{ ...schema, sections: [{ key: 'combinedAlwaysVisible', title: 'Thông tin báo giá', fields: alwaysVisibleFields }] }}
          value={value}
          onChange={onChange}
          quoteFormId={quoteFormId}
          showTotals={false}
        />
      ) : null}

      {advancedFields.length ? (
        <details className="quote-section-collapsible">
          <summary className="quote-section-collapsible-summary">
            Thông tin nâng cao
            <span className="quote-section-collapsible-tag">Tuỳ chọn</span>
          </summary>
          <QuoteFormFiller
            schema={{ ...schema, sections: [{ key: 'combinedAdvanced', title: '', fields: advancedFields }] }}
            value={value}
            onChange={onChange}
            quoteFormId={quoteFormId}
            showTotals={false}
          />
        </details>
      ) : null}

      <QuoteFormFiller
        schema={{ ...schema, sections: repeaterSections }}
        value={value}
        onChange={onChange}
        quoteFormId={quoteFormId}
        showTotals
      />

      {notesFields.length ? (
        <QuoteFormFiller
          schema={{ ...schema, sections: [{ key: 'combinedNotes', title: 'Ghi chú & điều khoản', fields: notesFields }] }}
          value={value}
          onChange={onChange}
          quoteFormId={quoteFormId}
          showTotals={false}
        />
      ) : null}

      <CustomBlocksEditor
        blocks={value.data.customBlocks || []}
        onChange={blocks => onChange({ ...value, data: { ...value.data, customBlocks: blocks } })}
      />
    </div>
  );
}
