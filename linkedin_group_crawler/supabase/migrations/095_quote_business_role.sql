-- Vai tro NGHIEP VU bao gia (Presale/Sale) - TACH BIET HOAN TOAN voi system
-- role (admin/leader/member, cot `role` co san tu 001_auth_social_accounts.sql).
-- Khong them role he thong thu 4 nao (khong co 'presale'/'sale'/'ceo' o cot
-- `role`) - dung theo yeu cau "chi giu 3 system role". Ca Leader va Member
-- deu co the duoc gan quote_business_role.
--
-- Da audit truoc khi viet migration nay (khong doan): chi DUY NHAT 1 cot
-- tung duoc them vao app_users truoc gio la can_approve_quotes (migration
-- 059) - KHONG co cot nao ten giong "business_role"/"presale"/"sale" da
-- ton tai. An toan de them moi, khong trung.
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

ALTER TABLE public.app_users
    ADD COLUMN IF NOT EXISTS quote_business_role TEXT;

ALTER TABLE public.app_users
    DROP CONSTRAINT IF EXISTS app_users_quote_business_role_check;
ALTER TABLE public.app_users
    ADD CONSTRAINT app_users_quote_business_role_check
    CHECK (quote_business_role IS NULL OR quote_business_role IN ('presale', 'sale', 'both'));

CREATE INDEX IF NOT EXISTS app_users_quote_business_role_idx
    ON public.app_users (quote_business_role) WHERE quote_business_role IS NOT NULL;
