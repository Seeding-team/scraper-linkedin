-- Mo rong auto_seeding_comments de luu ket qua "tu van qua Zalo" khi bai FB diem cao co
-- so dien thoai lien he (yeu cau 2026-10-02): LLM cham diem bai se tach them contact_phone
-- khi bai yeu cau inbox/nhan tin ve 1 SDT. Neu tim thay SDT -> he thong tu tim user Zalo
-- (bang tai khoan "Markee" da dang nhap san) va nhan tin tu van, khong can nguoi bam.
--
-- Khong tao bang moi - gop vao auto_seeding_comments vi day van la "cong viec seeding tu
-- dong cho 1 bai" (1 bai = 1 dong), chi la co them nhanh Zalo ben canh nhanh comment FB.

ALTER TABLE auto_seeding_comments
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS zalo_status TEXT CHECK (zalo_status IN ('sent', 'failed')),
  ADD COLUMN IF NOT EXISTS zalo_message_content TEXT,
  ADD COLUMN IF NOT EXISTS zalo_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS zalo_error TEXT,
  ADD COLUMN IF NOT EXISTS zalo_sent_at TIMESTAMPTZ;
