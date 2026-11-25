-- Migration 235: Them cot note (ghi chu ly do) vao post_call_results.
--
-- Viec 3 (2026-11-21): sau khi chon 1 ket qua lien he, nguoi dung co the ghi them ly do
-- (vd "khach bao de 1 tuan nua goi lai") va xem/sua lai ngay tai bai (khong tao ban ghi
-- moi, khong doi result_code). Bang nay chi co 1 dong/post (post_id, platform) nen note
-- luon la GHI CHU CUA LAN GOI GAN NHAT, khong phai lich su tung lan.
--
-- Khong can RLS/grant moi - cot thuong, da nam trong bang/policy/grant co san o migration 215.

ALTER TABLE public.post_call_results
    ADD COLUMN IF NOT EXISTS note TEXT;

NOTIFY pgrst, 'reload schema';
