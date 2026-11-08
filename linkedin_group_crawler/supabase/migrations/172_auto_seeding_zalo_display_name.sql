-- Luu them ten Zalo (display_name) cua nguoi dung tim duoc qua SDT khi he thong tu nhan
-- tin tu van (auto_seeding_zalo_service.py, migration 161) - truoc day chi dung display_name
-- de dat ten group hoi thoai (upsert_group) roi bo, khong luu lai nen UI post-card khong co
-- gi de hien ngoai SDT. Yeu cau 2026-10-06: hien ro SDT + ten Zalo tren post card, kem nut
-- tao lead.

ALTER TABLE auto_seeding_comments
  ADD COLUMN IF NOT EXISTS zalo_display_name TEXT;
