'use client';

import { CrmCategoryIdSelect, invalidateCrmCategoryCache } from './CrmCategorySelect';

export function invalidatePositionOptionsCache() {
  invalidateCrmCategoryCache('crm_position');
}

export function PositionSelect({
  value,
  labelSnapshot,
  onChange,
  disabled = false,
  placeholder = '-- Chọn chức vụ --',
}: {
  value: string;
  labelSnapshot?: string | null;
  onChange: (positionCategoryId: string, label: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <CrmCategoryIdSelect
      categoryType="crm_position"
      value={value}
      labelSnapshot={labelSnapshot}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}
