-- "Giới hạn xem link báo giá theo email" (yeu cau moi, da xac nhan luong voi
-- nguoi dung): mac dinh (public_email_gate_enabled=false) khong doi gi ca -
-- ai co link cong khai cung xem duoc nhu hien tai. Khi BAT, trang public
-- (PublicQuotePage) bat khach nhap email TRUOC khi hien noi dung bao gia -
-- backend doi chieu email do voi danh sach `public_allowed_emails` cua CHINH
-- quote nay (khong phai danh sach dung chung toan he thong).
--
-- Luu tren quotes (khong phai bang rieng) - gate + danh sach la thuoc tinh
-- CUA 1 QUOTE CU THE, gan voi vong doi phat hanh/khoa link hien co
-- (public_enabled/public_token, migration 028/089), don gian hon 1 bang
-- join rieng cho quy mo tinh nang nay (danh sach thuong chi vai email/quote).
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS public_email_gate_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS public_allowed_emails TEXT[] NOT NULL DEFAULT '{}';
