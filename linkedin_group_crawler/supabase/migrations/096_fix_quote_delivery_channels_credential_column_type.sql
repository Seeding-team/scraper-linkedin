-- FIX BUG THAT: cot encrypted_app_password duoc khai bao BYTEA o migration
-- 092 (DA APPLY), nhung code Python luon luu/doc no nhu 1 CHUOI TEXT (Fernet
-- token da la ASCII base64-urlsafe, luu bang .decode("ascii") truoc khi
-- insert, giai ma bang .encode("ascii") truoc khi decrypt - xem
-- quote_email_provider_service.py _encrypt_password/_decrypt_password).
--
-- Hau qua that (da tai hien truc tiep, khong doan): PostgREST/Postgres tra
-- ve cot BYTEA duoi dang HEX co tien to "\x..." (bytea_output mac dinh =
-- 'hex'), KHONG PHAI chuoi base64 goc da luu - vi vay moi lan doc lai deu
-- ra 1 chuoi sai dinh dang, Fernet.decrypt() raise InvalidToken (exception
-- KHONG CO message - str(exc) rong), roi rot xuong handler chung cua router
-- (`except Exception as e: return BaseResponse(success=False,
-- message=str(e))`) tao ra dung loi "HTTP 200 + success=false + message
-- rong" ma nguoi dung thay ("Lỗi máy chủ (200)" o frontend, vi frontend tu
-- dien text do khi message rong).
--
-- Doi cot ve TEXT (dung voi thuc te code da lam tu dau). Credential DANG CO
-- (neu co) da BI HONG KHONG THE GIAI MA DUOC ROI (vi bug tren) - KHONG the
-- cuu duoc, an toan de xoa (WIPE) ve NULL cung luc doi kieu, nguoi dung se
-- thay "Chua cau hinh" va can nhap lai App Password 1 lan (chi 1 lan, sau
-- migration nay se luu/doc dung).
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

ALTER TABLE public.quote_delivery_channels
    ALTER COLUMN encrypted_app_password TYPE TEXT USING NULL::text;
