'use client';

/**
 * MemberSearchSelect — dropdown gán thành viên DUY NHẤT dùng chung cho mọi
 * field member/user trong CRM (Lead owner, Deal leaded_by/sdr_id, Project
 * manager_id, Customer owner_id, Quote quote_owner_id/technical_owner_id,
 * Presale...). Wrap lại SearchableSelect (đã có sẵn: portal menu, đóng khi
 * click ngoài/Escape, bỏ dấu khi tìm) — KHÔNG viết lại logic dropdown/tìm
 * kiếm lần 2 (đã có 1 bản trùng lặp là OwnerPicker trong ProjectFormModal.tsx,
 * việc chuẩn hoá này thay OwnerPicker bằng chính component này).
 *
 * Search khớp theo displayName + email + code (username/mã nhân viên, nếu
 * caller có) - route qua `searchText` của SearchableSelect. Điều phối
 * eligible-set (vd quote_business_role IN ('sale','both')) vẫn do CALLER tự
 * lọc trước khi truyền vào `members` — component này không mở rộng quyền,
 * chỉ tìm kiếm TRONG đúng tập đã được lọc.
 */

import { initialsOf } from '../utils/quoteDisplay';
import { SearchableSelect } from './SearchableSelect';

export type MemberSearchOption = {
  id: string;
  displayName: string;
  email?: string | null;
  /** username/mã nhân viên, khi hệ thống hiện có (vd telegram_username). */
  code?: string | null;
  /** Dòng phụ hiện dưới tên (vd vai trò hệ thống · team) - thuần hiển thị. */
  subtitle?: string | null;
  /** false => hiện badge "Đã ngưng hoạt động", NHƯNG vẫn chọn được nếu đang
   * là giá trị hiện tại (không được phép "biến mất" khỏi UI với dữ liệu cũ). */
  isActive?: boolean;
};

export function MemberSearchSelect({
  value,
  onChange,
  members,
  placeholder = 'Chưa gán',
  searchPlaceholder = 'Tìm kiếm thành viên...',
  disabled = false,
  loading = false,
  emptyText = 'Không tìm thấy thành viên.',
  hideClearOption = false,
  showAvatar = true,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MemberSearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  hideClearOption?: boolean;
  /** Tắt avatar/subtitle khi field chỉ cần 1 dòng gọn (giữ true cho các
   * picker "nặng" như Project owner - đúng UX OwnerPicker cũ). */
  showAvatar?: boolean;
  testId?: string;
}) {
  const options = members.map(member => {
    const label = member.displayName;
    const searchText = [member.displayName, member.email, member.code].filter(Boolean).join(' ');
    const richLabel = showAvatar ? (
      <span className="crm-owner-option">
        <span className="crm-owner-option-avatar">{initialsOf(member.displayName)}</span>
        <span className="crm-owner-option-meta">
          <span className="crm-owner-option-name">{member.displayName}</span>
          {member.subtitle ? <span className="crm-owner-option-sub">{member.subtitle}</span> : null}
        </span>
        {member.isActive === false ? <span className="crm-owner-inactive-badge">Đã ngưng hoạt động</span> : null}
      </span>
    ) : (
      <>
        {member.displayName}
        {member.isActive === false ? ' (đã ngưng hoạt động)' : ''}
      </>
    );
    return { value: member.id, label, richLabel, searchText };
  });

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      disabled={disabled}
      loading={loading}
      emptyText={emptyText}
      hideClearOption={hideClearOption}
      testId={testId}
    />
  );
}
