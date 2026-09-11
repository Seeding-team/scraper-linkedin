'use client';

import { QuoteDocumentRenderer, calculateQuoteTotals, calculateVillaTotals } from '@/modules/quotes';
import type { QuoteSchema } from '@/modules/quotes';
import { QuoteColumnVisibilityPicker } from './QuoteColumnVisibilityPicker';
import type { QuoteDraft } from './types';

// Cột "khoá" (STT + tên hạng mục), không bao giờ ẩn được - hiện như dòng có
// khoá trong khối "Cột hiển thị", không phải checkbox. Bộ khoá phụ thuộc bảng
// hạng mục THẬT của mẫu (quoteItems hay solutionItems...) - xem
// getLockedColumnKeys/LOCKED_COLUMN_KEYS_BY_ITEM_FIELD_KEY trong quoteColumns.ts,
// KHÔNG còn hardcode ở đây để áp dụng đúng cho mọi mẫu, kể cả villa.

export function ReviewQuoteStep({
  schema,
  draft,
  onChange,
  quoteFormId,
}: {
  schema: QuoteSchema;
  draft: QuoteDraft;
  /** Optional — không truyền thì ẩn khối "Cột hiển thị"/tuỳ chọn gửi (dùng cho
   * nơi chỉ xem trước thuần tuý, không phải bước cuối của wizard tạo báo giá). */
  onChange?: (next: QuoteDraft) => void;
  /** Id mẫu báo giá đang dùng - dùng để lưu/khôi phục nháp lựa chọn "Cột hiển
   * thị" theo localStorage (xem quoteColumnsDraft.ts), theo đúng mẫu này, không
   * lẫn với mẫu khác. Không truyền = không lưu/khôi phục nháp. */
  quoteFormId?: string;
}) {
  const isVilla = schema.layoutType === 'villa_solution_package';
  const totals = isVilla
    ? calculateVillaTotals(draft.solutionItems)
    : calculateQuoteTotals(draft.items, draft.data.discountPercent);

  return (
    <div className="crm-wizard-review-step">
      {onChange ? (
        <div className="crm-quote-review-toolbar">
          <div>
            <h3 className="crm-wizard-form-title">Bản xem trước gửi khách hàng</h3>
            <p className="crm-wizard-form-description">Tuỳ chỉnh cột hiển thị trước khi gửi.</p>
          </div>

          {/* Khối "Cột hiển thị" LUÔN hiện (không bao giờ trả về null cả khối) -
              chỉ đổi NỘI DUNG bên trong tuỳ trạng thái (mẫu không có cột tuỳ
              chọn nào / schema lỗi / có cột để chọn). */}
          <QuoteColumnVisibilityPicker
            schema={schema}
            draft={draft}
            onChange={onChange}
            quoteFormId={quoteFormId}
          />
        </div>
      ) : null}

      <QuoteDocumentRenderer
        schemaSnapshot={schema}
        quoteData={draft.data}
        quoteItems={draft.items}
        solutionItems={draft.solutionItems}
        totals={totals}
        mode="preview"
        respectVisibleColumns={Boolean(onChange)}
      />

      {onChange ? (
        <div className="crm-quote-send-options">
          <label className="crm-quote-send-option crm-quote-send-option--disabled">
            <input type="checkbox" disabled />
            Thông báo khi khách mở <em>(sắp có)</em>
          </label>
          <label className="crm-quote-send-option crm-quote-send-option--disabled">
            <input type="checkbox" disabled />
            Cho phép phản hồi trực tuyến <em>(sắp có)</em>
          </label>
          <label className="crm-quote-send-option">
            <input type="checkbox" checked disabled />
            Yêu cầu duyệt trước khi gửi
          </label>
          <p className="crm-quote-send-hint">
            Mọi báo giá mới luôn ở trạng thái chờ duyệt — duyệt là thao tác riêng, cần quyền duyệt.
          </p>
        </div>
      ) : null}
    </div>
  );
}
