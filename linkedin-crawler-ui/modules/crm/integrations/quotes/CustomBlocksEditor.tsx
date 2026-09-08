'use client';

import { useState } from 'react';
import type { CustomBlock, CustomBlockKind } from '@/modules/quotes';

const MAX_BLOCKS = 10;
const TITLE_MAX_LENGTH = 150;
const CONTENT_MAX_LENGTH = 5000;

const BLOCK_CATALOG: { kind: CustomBlockKind; defaultTitle: string; singleton: boolean }[] = [
  { kind: 'scope_of_work', defaultTitle: 'Phạm vi công việc', singleton: true },
  { kind: 'timeline', defaultTitle: 'Tiến độ', singleton: true },
  { kind: 'handover', defaultTitle: 'Bàn giao', singleton: true },
  { kind: 'payment_terms', defaultTitle: 'Thanh toán', singleton: true },
  { kind: 'warranty', defaultTitle: 'Bảo hành', singleton: true },
  { kind: 'note', defaultTitle: 'Ghi chú', singleton: true },
  { kind: 'custom_field', defaultTitle: 'Trường tuỳ chỉnh', singleton: false },
];

function newBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `block_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Sale thêm khối nội dung tự do (Phạm vi công việc/Tiến độ/Bàn giao/Thanh toán/
 * Bảo hành/Ghi chú/Trường tuỳ chỉnh) ngay lúc tạo báo giá — chỉ lưu vào chính báo
 * giá đang tạo (QuoteData.customBlocks), KHÔNG đụng tới mẫu gốc. Sale chỉ nhập
 * tiêu đề + nội dung, không tự chỉnh layout (layout cố định lúc render PDF, xem
 * renderCustomBlocks trong QuoteDocumentRenderer.tsx).
 *
 * CỐ Ý không lọc khối rỗng ở đây — khối vừa thêm chưa kịp gõ gì sẽ bị coi là
 * "rỗng" nếu lọc ngay trong onChange, biến mất trước khi Sale kịp nhập. Lọc bỏ
 * khối rỗng chỉ làm ở bước lưu thật sự (buildDraftPayload() trong
 * CreateQuoteModal.tsx), không phải ở đây. */
export function CustomBlocksEditor({
  blocks,
  onChange,
}: {
  blocks: CustomBlock[];
  onChange: (next: CustomBlock[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const usedSingletonKinds = new Set(blocks.filter(b => b.kind !== 'custom_field').map(b => b.kind));
  const atLimit = blocks.length >= MAX_BLOCKS;

  function addBlock(entry: (typeof BLOCK_CATALOG)[number]) {
    onChange([...blocks, { id: newBlockId(), kind: entry.kind, title: entry.defaultTitle, content: '' }]);
    setPickerOpen(false);
  }

  function updateBlock(id: string, patch: Partial<CustomBlock>) {
    onChange(blocks.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeBlock(id: string) {
    onChange(blocks.filter(b => b.id !== id));
  }

  return (
    <div className="crm-custom-blocks">
      <div className="crm-custom-blocks-head">
        <h3 className="crm-custom-blocks-title">Nội dung thêm cho báo giá này</h3>
        <div className="crm-custom-blocks-add">
          <button
            type="button"
            className="crm-secondary-inline"
            disabled={atLimit}
            title={atLimit ? `Tối đa ${MAX_BLOCKS} khối/báo giá` : undefined}
            onClick={() => setPickerOpen(open => !open)}
          >
            + Thêm nội dung
          </button>
          {pickerOpen ? (
            <div className="crm-custom-blocks-picker">
              {BLOCK_CATALOG.map(entry => {
                const disabled = entry.singleton && usedSingletonKinds.has(entry.kind);
                return (
                  <button
                    key={entry.kind}
                    type="button"
                    disabled={disabled}
                    title={disabled ? 'Báo giá này đã có khối loại này' : undefined}
                    onClick={() => addBlock(entry)}
                  >
                    {entry.defaultTitle}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="crm-empty-log">Chưa có khối nội dung nào — bấm "+ Thêm nội dung" nếu cần thêm điều khoản riêng cho báo giá này.</p>
      ) : (
        <div className="crm-custom-blocks-list">
          {blocks.map(block => (
            <article className="crm-custom-block-card" key={block.id}>
              <div className="crm-custom-block-row">
                <input
                  type="text"
                  value={block.title}
                  maxLength={TITLE_MAX_LENGTH}
                  onChange={event => updateBlock(block.id, { title: event.target.value })}
                  className="crm-custom-block-title-input"
                  placeholder="Tiêu đề khối"
                />
                <button type="button" className="crm-quote-btn crm-quote-btn--danger" onClick={() => removeBlock(block.id)}>
                  Xoá
                </button>
              </div>
              <textarea
                value={block.content}
                maxLength={CONTENT_MAX_LENGTH}
                onChange={event => updateBlock(block.id, { content: event.target.value })}
                className="crm-custom-block-content"
                rows={4}
                placeholder="Nội dung..."
              />
              <span className="crm-custom-block-counter">{block.content.length}/{CONTENT_MAX_LENGTH} ký tự</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
