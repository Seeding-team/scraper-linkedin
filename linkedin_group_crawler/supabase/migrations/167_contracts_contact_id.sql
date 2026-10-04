-- "Người liên hệ" của hợp đồng (form Thêm/Sửa hợp đồng trong tab Hợp đồng):
-- trước đây dropdown "Người liên hệ" chỉ dùng để lọc Cơ hội, không lưu lại
-- trên hợp đồng nên danh sách luôn hiện liên hệ chính của Cơ hội. Lưu thẳng
-- contact_id lên hợp đồng (NULL = hợp đồng cũ, vẫn fallback liên hệ chính của deal).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_id uuid;

COMMENT ON COLUMN contracts.contact_id IS
  'Người liên hệ được chọn khi tạo/sửa hợp đồng (crm_contacts.id). NULL = dùng liên hệ chính của deal.';
