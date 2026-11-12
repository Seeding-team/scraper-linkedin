-- Hạn mức ngày Messenger lấy theo warm_up_tier trong code (constants.WARM_UP_TIERS).
-- Bỏ giá trị mặc định cũ 8 đang lưu cứng trên từng nick; cột chỉ còn dùng khi admin muốn đặt riêng.
ALTER TABLE fb_messenger_accounts ALTER COLUMN daily_sent_limit DROP DEFAULT;
UPDATE fb_messenger_accounts SET daily_sent_limit = NULL WHERE daily_sent_limit = 8;
