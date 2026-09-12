'use client';

import { useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { formatCurrencyDisplay, parseCurrencyInput, type CurrencyLocale } from '@/lib/currency';

type Props = {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  locale?: CurrencyLocale;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/** Ô nhập tiền dùng chung cho toàn app: format có dấu phân cách hàng nghìn
 * NGAY LÚC đang gõ (không chờ blur), hỗ trợ paste cả 3 dạng
 * ("5000000"/"5.000.000"/"5,000,000" — parseCurrencyInput tự nhận diện),
 * state/onChange luôn trả numeric raw (không dấu chấm/phẩy). Không tự thêm
 * ký hiệu tiền tệ (đ/VND/USD) — nơi gọi tự đặt prefix/suffix quanh input này.
 *
 * `type="text"` (không phải `type="number"`) vì input số gốc của trình duyệt
 * không cho hiển thị dấu phân cách trong lúc gõ. */
export function CurrencyInput({ value, onChange, locale = 'vi-VN', onBlur, ...inputProps }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaretDigits = useRef<number | null>(null);
  const displayValue = formatCurrencyDisplay(value ?? null, locale);

  function countDigitsBefore(text: string, caretPos: number): number {
    let count = 0;
    for (let i = 0; i < caretPos && i < text.length; i += 1) {
      if (/\d/.test(text[i])) count += 1;
    }
    return count;
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const el = event.target;
    const rawInput = el.value;
    const caretPos = el.selectionStart ?? rawInput.length;
    pendingCaretDigits.current = countDigitsBefore(rawInput, caretPos);
    onChange(parseCurrencyInput(rawInput));
  }

  // Sau khi `value` (prop, do parent set lại sau onChange) khiến displayValue
  // đổi -> chuỗi hiển thị đã format lại, có thể lệch độ dài so với chuỗi vừa
  // gõ (thêm/bớt dấu phân cách) -> đặt lại con trỏ ngay SAU đúng số chữ số đã
  // đếm được trước đó, thay vì để React mặc định đẩy con trỏ về cuối chuỗi.
  useLayoutEffect(() => {
    const el = inputRef.current;
    const targetDigits = pendingCaretDigits.current;
    if (!el || targetDigits === null) return;
    let seen = 0;
    let pos = displayValue.length;
    for (let i = 0; i < displayValue.length; i += 1) {
      if (/\d/.test(displayValue[i])) {
        seen += 1;
        if (seen === targetDigits) {
          pos = i + 1;
          break;
        }
      }
    }
    if (seen === 0 && targetDigits === 0) pos = 0;
    el.setSelectionRange(pos, pos);
    pendingCaretDigits.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue]);

  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onBlur={onBlur}
    />
  );
}
