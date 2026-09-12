import type { QuoteField, QuoteFormStatus, QuoteLayoutType, QuoteSchema } from '../types';
import { DEFAULT_SUMMARY_FIELDS } from '../utils/quoteSummaryFields';

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: '🟠 Chưa duyệt',
  confirmed: 'Đã xác nhận',
  approved: '🟢 Đã duyệt',
  cancelled: 'Đã hủy',
};

/** Dùng cho các màn hình NỘI BỘ (trang chi tiết báo giá, card CRM...) - khác
 * QUOTE_STATUS_LABELS ở chỗ 'confirmed' (báo giá cũ tạo trước luồng duyệt)
 * hiển thị "Chưa duyệt" thay vì "Đã xác nhận", khớp đúng luồng duyệt mới:
 * confirmed vẫn sửa/duyệt được, không nên trông như đã khoá. Trang public
 * (khách xem) vẫn dùng QUOTE_STATUS_LABELS nguyên bản vì với khách thì
 * confirmed/approved đều là đã nhận được báo giá thật. */
export function internalQuoteStatusLabel(status: string): string {
  if (status === 'approved') return '🟢 Đã duyệt';
  if (status === 'cancelled') return 'Đã hủy';
  return '🟠 Chưa duyệt';
}

export function internalQuoteStatusClass(status: string): string {
  if (status === 'approved') return 'status-approved';
  if (status === 'cancelled') return 'status-cancelled';
  return 'status-draft';
}

export const FORM_STATUS_LABELS: Record<QuoteFormStatus, string> = {
  active: 'Đang hoạt động',
  inactive: 'Tạm dừng',
  archived: 'Lưu trữ',
};

export const FORM_STATUS_OPTIONS: Array<{ value: QuoteFormStatus; label: string }> = [
  { value: 'active', label: 'Đang hoạt động' },
  { value: 'inactive', label: 'Tạm dừng' },
  { value: 'archived', label: 'Lưu trữ' },
];

export const LAYOUT_OPTIONS: Array<{ value: QuoteLayoutType; label: string }> = [
  { value: 'cloudgate_standard_quote', label: 'Mẫu báo giá tiêu chuẩn' },
  { value: 'villa_solution_package', label: 'Mẫu giải pháp Markee' },
  { value: 'blank_quote', label: 'Mẫu trống' },
];

export const fieldLibrary: QuoteField[] = [
  {
    key: 'customerCompanyName',
    label: 'Tên công ty',
    type: 'text',
    placeholder: 'Ví dụ: Công ty TNHH Markee',
    helpText: 'Nhập đúng tên công ty hoặc dự án của khách hàng.',
    required: true,
    visible: true,
    editable: true,
  },
  {
    key: 'customerContactName',
    label: 'Người liên hệ',
    type: 'text',
    placeholder: 'Ví dụ: Nguyễn Văn An',
    helpText: 'Nhập người đang trao đổi trực tiếp với bộ phận kinh doanh.',
    visible: true,
    editable: true,
  },
  {
    key: 'customerPhone',
    label: 'Số điện thoại khách hàng',
    type: 'phone',
    placeholder: 'Ví dụ: 0906 750 554',
    helpText: 'Dùng số điện thoại khách đang sử dụng để liên hệ trực tiếp.',
    required: true,
    visible: true,
    editable: true,
  },
  {
    key: 'customerEmail',
    label: 'Email khách hàng',
    type: 'email',
    placeholder: 'Ví dụ: khachhang@congty.com',
    helpText: 'Nhập email nhận báo giá hoặc email người phụ trách.',
    visible: true,
    editable: true,
  },
  {
    key: 'customerAddress',
    label: 'Địa chỉ',
    type: 'textarea',
    placeholder: 'Ví dụ: 12 Nguyễn Huệ, Quận 1, TP.HCM',
    helpText: 'Nhập địa chỉ xuất hóa đơn hoặc địa chỉ dự án nếu có.',
    visible: true,
    editable: true,
  },
  {
    key: 'customerTaxCode',
    label: 'Mã số thuế',
    type: 'text',
    placeholder: 'Ví dụ: 0312345678',
    helpText: 'Nhập mã số thuế nếu khách cần xuất hóa đơn.',
    visible: true,
    editable: true,
  },
  {
    key: 'quoteDate',
    label: 'Ngày báo giá',
    type: 'date',
    helpText: 'Chọn ngày phát hành báo giá.',
    required: true,
    visible: true,
    editable: true,
  },
  {
    key: 'validityDays',
    label: 'Thời hạn hiệu lực',
    type: 'number',
    placeholder: 'Ví dụ: 30',
    helpText: 'Nhập số ngày báo giá còn hiệu lực.',
    required: true,
    defaultValue: 30,
    visible: true,
    editable: true,
  },
  {
    key: 'notes',
    label: 'Ghi chú',
    type: 'textarea',
    placeholder: 'Ví dụ: Giá chưa bao gồm chi phí phát sinh ngoài phạm vi.',
    helpText: 'Ghi điều kiện áp dụng, thanh toán hoặc lưu ý đặc biệt.',
    visible: true,
    editable: true,
  },
  {
    key: 'currency',
    label: 'Đơn vị tiền tệ',
    type: 'text',
    defaultValue: 'VND',
    visible: true,
    editable: true,
  },
  {
    key: 'defaultVatRate',
    label: 'Thuế VAT mặc định',
    type: 'number',
    defaultValue: 10,
    visible: true,
    editable: true,
  },
];

export const serviceColumns: QuoteField[] = [
  ['serviceDescription', 'Tên dịch vụ', 'textarea', 'Ví dụ: Thiết kế website doanh nghiệp', 'Nhập tên sản phẩm hoặc dịch vụ khách cần.'],
  ['description', 'Mô tả', 'textarea', 'Ví dụ: Thiết kế UI, lập trình, bàn giao source', 'Mô tả phạm vi công việc và nội dung bàn giao.'],
  ['unit', 'ĐVT', 'text', 'Ví dụ: Gói, Tháng, Người dùng', 'Nhập đơn vị tính phù hợp với dịch vụ.'],
  ['quantity', 'Số lượng', 'number', 'Ví dụ: 1', 'Nhập số lượng khách đăng ký.'],
  ['unitPrice', 'Đơn giá', 'currency', 'Ví dụ: 15000000', 'Nhập giá cho một đơn vị, chưa gồm VAT.'],
  ['discountPercent', 'Giảm giá (%)', 'number', 'Ví dụ: 10', 'Nhập phần trăm giảm giá riêng cho dòng này, từ 0 đến 100.'],
  ['vatRate', 'VAT', 'number', 'Ví dụ: 10', 'Nhập phần trăm thuế, ví dụ 10.'],
].map(([key, label, type, placeholder, helpText]) => ({
  key,
  label,
  type: type as QuoteField['type'],
  placeholder,
  helpText,
  required: !['description'].includes(key),
  visible: true,
  editable: true,
}));

export function ensureFieldFlags(field: QuoteField): QuoteField {
  return {
    ...field,
    required: Boolean(field.required),
    visible: field.visible ?? true,
    editable: field.editable ?? true,
  };
}

export function createDefaultCloudgateSchema(): QuoteSchema {
  return {
    version: 1,
    layoutType: 'cloudgate_standard_quote',
    summaryFields: DEFAULT_SUMMARY_FIELDS,
    sections: [
      {
        key: 'seller',
        title: 'Thông tin công ty',
        fields: [
          { key: 'sellerCompanyName', label: 'Tên công ty', type: 'text' as const, required: true, visible: true, editable: true, defaultValue: 'Markee CRM' },
          { key: 'sellerAddress', label: 'Địa chỉ công ty', type: 'text' as const, visible: true, editable: true, defaultValue: 'TP. Hồ Chí Minh' },
          { key: 'sellerContactName', label: 'Người liên hệ', type: 'text' as const, visible: true, editable: true, defaultValue: 'Lan Anh' },
          { key: 'sellerPhone', label: 'Số điện thoại', type: 'phone' as const, visible: true, editable: true, defaultValue: '0901 111 222' },
          { key: 'sellerEmail', label: 'Email', type: 'email' as const, visible: true, editable: true, defaultValue: 'sales@markee.vn' },
          { key: 'sellerWebsite', label: 'Website', type: 'text' as const, visible: true, editable: true, defaultValue: 'markee.vn' },
        ],
      },
      {
        key: 'customer',
        title: 'Thông tin khách hàng',
        fields: [
          fieldLibrary[0],
          fieldLibrary[1],
          fieldLibrary[2],
          fieldLibrary[3],
          fieldLibrary[4],
          fieldLibrary[5],
        ].map(field => ensureFieldFlags({ ...field })),
      },
      {
        key: 'quoteInfo',
        title: 'Thông tin báo giá',
        fields: [
          { key: 'quoteTitle', label: 'Tiêu đề báo giá', type: 'text' as const, required: true, visible: true, editable: true, defaultValue: 'Bảng báo giá' },
          { key: 'quoteNumber', label: 'Số báo giá', type: 'auto-number' as const, visible: true, editable: false },
          fieldLibrary[6],
          fieldLibrary[7],
          fieldLibrary[9],
          fieldLibrary[10],
        ].map(field => ensureFieldFlags({ ...field })),
      },
      {
        key: 'quoteItems',
        title: 'Bảng dịch vụ',
        fields: [
          {
            key: 'quoteItems',
            label: 'Bảng dịch vụ',
            type: 'repeater-table',
            required: true,
            visible: true,
            editable: true,
            helpText: 'Nhập từng dịch vụ hoặc sản phẩm khách cần báo giá.',
            config: {
              allowAddRows: true,
              allowDeleteRows: true,
              allowReorderRows: true,
              initialRows: 0,
              columns: serviceColumns,
            },
          },
        ],
      },
      {
        key: 'summary',
        title: 'Tổng tiền và ký xác nhận',
        fields: [
          { key: 'subtotalAmount', label: 'Tổng tiền trước thuế', type: 'calculated' as const, visible: true, editable: false },
          { key: 'totalVatAmount', label: 'Tổng tiền thuế', type: 'calculated' as const, visible: true, editable: false },
          { key: 'totalAmount', label: 'Tổng cộng', type: 'calculated' as const, visible: true, editable: false },
          fieldLibrary[8],
          { key: 'companyRepresentative', label: 'Đại diện công ty', type: 'text' as const, visible: true, editable: true, defaultValue: 'Markee CRM' },
          { key: 'customerRepresentative', label: 'Đại diện khách hàng', type: 'text' as const, visible: true, editable: true },
        ].map(field => ensureFieldFlags({ ...field })),
      },
    ],
  };
}

export function createVillaSchema(): QuoteSchema {
  return {
    version: 1,
    layoutType: 'villa_solution_package',
    summaryFields: DEFAULT_SUMMARY_FIELDS,
    sections: [
      {
        key: 'villaHeader',
        title: 'Thông tin gói giải pháp',
        fields: [
          { key: 'sellerBrandName', label: 'Thương hiệu', type: 'text', defaultValue: 'MARKEE SOLUTION', visible: true, editable: true },
          { key: 'quoteTitle', label: 'Tiêu đề báo giá', type: 'text', defaultValue: 'Gói giải pháp tăng trưởng', required: true, visible: true, editable: true },
          { key: 'quoteSubtitle', label: 'Phụ đề', type: 'textarea', defaultValue: 'Thiết kế riêng cho mục tiêu kinh doanh của khách hàng', visible: true, editable: true },
          { key: 'quoteBenefitLine', label: 'Dòng lợi ích', type: 'text', defaultValue: 'Tối ưu chi phí triển khai, rõ phạm vi và tiến độ.', visible: true, editable: true },
          { key: 'customerRecipient', label: 'Kính gửi', type: 'text', defaultValue: 'Quý khách hàng', visible: true, editable: true },
          { key: 'quoteNumber', label: 'Số báo giá', type: 'auto-number', visible: true, editable: false },
          { key: 'quoteDate', label: 'Ngày báo giá', type: 'date', required: true, visible: true, editable: true },
        ].map(field => ensureFieldFlags(field as QuoteField)),
      },
      {
        key: 'solutions',
        title: 'Danh sách giải pháp',
        fields: [
          {
            key: 'solutionItems',
            label: 'Gói giải pháp',
            type: 'repeater-table',
            required: true,
            visible: true,
            editable: true,
            defaultValue: [
              { name: 'Gói triển khai CRM', description: 'Tư vấn, cấu hình pipeline và bàn giao vận hành.', originalPrice: 320000000, offerPrice: 260000000, note: 'Ưu đãi cho khách ký trong tháng.' },
            ],
            config: {
              columns: [
                { key: 'name', label: 'Tên giải pháp', type: 'text', required: true, visible: true, editable: true },
                { key: 'description', label: 'Mô tả', type: 'textarea', visible: true, editable: true },
                { key: 'originalPrice', label: 'Giá gốc', type: 'currency', visible: true, editable: true },
                { key: 'offerPrice', label: 'Giá đề xuất', type: 'currency', required: true, visible: true, editable: true },
                { key: 'note', label: 'Ghi chú', type: 'text', visible: true, editable: true },
              ],
            },
          },
        ],
      },
      {
        key: 'villaTerms',
        title: 'Thanh toán và triển khai',
        fields: [
          { key: 'monthlyAmount', label: 'Phí duy trì hàng tháng', type: 'currency', defaultValue: 0, visible: true, editable: true },
          { key: 'paymentPhaseOnePercent', label: 'Thanh toán đợt 1', type: 'number', defaultValue: 50, visible: true, editable: true },
          { key: 'paymentPhaseTwoPercent', label: 'Thanh toán đợt 2', type: 'number', defaultValue: 50, visible: true, editable: true },
          { key: 'commitments', label: 'Cam kết', type: 'repeatable-textarea', defaultValue: ['Bàn giao đúng phạm vi thống nhất.', 'Đồng hành tối ưu trong giai đoạn vận hành.'], visible: true, editable: true },
          { key: 'implementationStepOne', label: 'Bước triển khai 1', type: 'text', defaultValue: 'Khảo sát và chốt phạm vi.', visible: true, editable: true },
          { key: 'implementationStepTwo', label: 'Bước triển khai 2', type: 'text', defaultValue: 'Triển khai, kiểm thử và bàn giao.', visible: true, editable: true },
          { key: 'sellerZalo', label: 'Zalo tư vấn', type: 'text', defaultValue: '0901 111 222', visible: true, editable: true },
          { key: 'sellerEmail', label: 'Email tư vấn', type: 'email', defaultValue: 'sales@markee.vn', visible: true, editable: true },
          { key: 'offerExpiryText', label: 'Ghi chú hiệu lực', type: 'text', defaultValue: 'Báo giá có hiệu lực đến', visible: true, editable: true },
          { key: 'offerExpiryDate', label: 'Ngày hết hiệu lực', type: 'date', visible: true, editable: true },
        ].map(field => ensureFieldFlags(field as QuoteField)),
      },
    ],
  };
}

export function createBlankSchema(): QuoteSchema {
  return {
    version: 1,
    layoutType: 'blank_quote',
    summaryFields: DEFAULT_SUMMARY_FIELDS,
    sections: [
      {
        key: 'general',
        title: 'Thông tin báo giá',
        fields: [ensureFieldFlags({ ...fieldLibrary[0] })],
      },
    ],
  };
}

export function schemaForLayout(layoutType: QuoteLayoutType) {
  if (layoutType === 'villa_solution_package') return createVillaSchema();
  if (layoutType === 'blank_quote') return createBlankSchema();
  return createDefaultCloudgateSchema();
}
