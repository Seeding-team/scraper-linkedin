-- Cham diem "tiem nang seeding" bang LLM cho bai viet vua cao ve (yeu cau 2026-10-01):
-- chi giu lai bai cua nguoi DANG TIM don vi lam website/app/landing page, loai bai rac va
-- bai cua chinh cac don vi khac dang quang cao dich vu cua ho. Xem
-- app/modules/all_platform/services/lead_score_service.py.
--
-- lead_score: 0-100, NULL = chua cham (vd bai cu truoc khi co tinh nang nay, hoac LLM loi).
-- lead_score_reason: ly do ngan gon LLM dua ra, hien tooltip tren FE.

ALTER TABLE facebook_posts ADD COLUMN IF NOT EXISTS lead_score integer;
ALTER TABLE facebook_posts ADD COLUMN IF NOT EXISTS lead_score_reason text;

ALTER TABLE linkedin_posts ADD COLUMN IF NOT EXISTS lead_score integer;
ALTER TABLE linkedin_posts ADD COLUMN IF NOT EXISTS lead_score_reason text;

ALTER TABLE threads_posts ADD COLUMN IF NOT EXISTS lead_score integer;
ALTER TABLE threads_posts ADD COLUMN IF NOT EXISTS lead_score_reason text;
