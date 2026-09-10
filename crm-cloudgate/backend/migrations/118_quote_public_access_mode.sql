-- "Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" - thay THE cho
-- co che cu (chi co 1 checkbox bat/tat + danh sach email, migration 116) da
-- bi bao lỗi thật: "tắt giới hạn nhưng vẫn yêu cầu Email". Doi sang 3 CHE DO
-- RO RANG (khong con la 1 boolean rieng + danh sach - de gay nham lan trang
-- thai): 'none' (mac dinh, khong doi hanh vi so voi truoc khi co tinh nang
-- nay) / 'email' / 'phone'. CHỈ 1 CHE DO duy nhat co hieu luc tai 1 thoi
-- diem - loai bo hoan toan kha nang "vua tat vua con sot lai co che cu" gay
-- ra bug tren, vi gio CHI CON DUNG 1 cot enum quyet dinh, khong con boolean
-- rieng de co the "quen" cap nhat.
--
-- Tinh nang nay MOI THEM trong CHINH phien lam viec nay (migration 116),
-- CHUA co du lieu that nao trong production dua vao no - an toan de doi han
-- cau truc thay vi giu ca 2 lop du lieu song song (tranh code phai doc/ghi 2
-- noi dan den chinh loi "tat roi ma con hoi" nhu da xay ra).
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS public_access_mode TEXT NOT NULL DEFAULT 'none'
        CHECK (public_access_mode IN ('none', 'email', 'phone')),
    ADD COLUMN IF NOT EXISTS public_allowed_phones TEXT[] NOT NULL DEFAULT '{}';

-- Migrate du lieu cu (neu co quote nao da tung bat gate email o migration
-- 116 truoc khi phat hien bug) sang che do moi tuong duong, KHONG mat du
-- lieu danh sach email da nhap.
UPDATE public.quotes
SET public_access_mode = 'email'
WHERE public_email_gate_enabled = true AND public_access_mode = 'none';

-- Bo han 2 cot cu (public_email_gate_enabled) - KHONG con dung nua, gop
-- thanh public_access_mode duy nhat de tranh chinh nguyen nhan gay bug
-- ("tắt qua đường này nhưng code khác vẫn đọc cờ boolean cũ"). GIU LAI
-- public_allowed_emails (doi ten y nghia: van la danh sach email duoc phep,
-- chi ap dung khi public_access_mode='email' - khong can doi ten cot).
ALTER TABLE public.quotes DROP COLUMN IF EXISTS public_email_gate_enabled;
