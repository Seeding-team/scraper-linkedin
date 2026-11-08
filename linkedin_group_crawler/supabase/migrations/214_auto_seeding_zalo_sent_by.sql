-- Migration 214: Luu thong tin nguoi gui tin Zalo (zalo_sent_by) va tao index tim kiem theo SDT + zalo_status
-- Giup UI post card hien thi nguoi da gui tin nhan Zalo tu van (vd: "Gui boi: Dung Pham")
-- va dong bo trang thai da nhan tin Zalo cho tat ca cac bai viet co cung SDT tren feed.

ALTER TABLE auto_seeding_comments
  ADD COLUMN IF NOT EXISTS zalo_sent_by TEXT;

CREATE INDEX IF NOT EXISTS idx_auto_seeding_comments_phone_zalo_status
  ON auto_seeding_comments (phone_number, zalo_status);
