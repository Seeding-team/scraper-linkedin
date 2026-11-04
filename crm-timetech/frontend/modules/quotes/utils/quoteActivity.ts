/** Nhan hanh dong trong quote_activity_log - DUNG CHUNG Quote Workspace va trang Chi tiet bao gia
 * (mot nguon duy nhat, khong sao chep). */
export const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Tạo báo giá',
  updated: 'Cập nhật báo giá',
  approved: 'Duyệt báo giá',
  cancelled: 'Huỷ báo giá',
  version_created: 'Tạo phiên bản mới',
  stage_changed: 'Chuyển bước xử lý',
  handoff_updated: 'Cập nhật bàn giao kỹ thuật',
  owner_assigned: 'Gán người phụ trách',
  version_reason: 'Ghi lý do tạo phiên bản',
  approved_with_exception: 'đã phê duyệt ngoại lệ',
  auto_approved_by_rule_engine: 'Tự động duyệt bởi Rule Engine',
};

export const PROCESSING_STAGE_LABELS: Record<string, string> = {
  request: 'Yêu cầu báo giá',
  technical: 'Thông tin kỹ thuật',
  pricing: 'Hoàn thiện giá bán',
  review: 'Chờ duyệt',
  ready_to_publish: 'Sẵn sàng phát hành',
  published: 'Đã phát hành',
};
