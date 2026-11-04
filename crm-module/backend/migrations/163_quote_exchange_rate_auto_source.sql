-- Ty gia USD/VND he thong: tu dong lay tu nguon uy tin (Vietcombank, du phong open.er-api) + override thu cong.
--  * source          : nguon cua rate hien tai ("Vietcombank (bán ra)", "ExchangeRate-API", "Nhập tay").
--  * is_manual       : true = Admin override thu cong (tu dong KHONG ghi de cho toi khi bam "Cap nhat ty gia"
--                      hoac "Dung tu dong"); false = rate lay tu dong.
--  * last_attempt_at / last_error : lan goi nguon gan nhat (de han che goi day + hien loi cho Admin);
--                      loi KHONG xoa rate cu (fallback rate gan nhat).
--  * quote_exchange_rate_history : nhat ky bat bien moi lan rate doi (audit + fallback).
-- Bao gia da tao KHONG doc bang nay (dung quotes.exchange_rate / currency_snapshot da chot).

ALTER TABLE public.quote_exchange_rates
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Dong cu (truoc khi co tu dong) deu do Admin nhap tay.
UPDATE public.quote_exchange_rates
SET source = COALESCE(source, 'Nhập tay'), is_manual = true
WHERE source IS NULL;

CREATE TABLE IF NOT EXISTS public.quote_exchange_rate_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'USD',
    quote_currency TEXT NOT NULL DEFAULT 'VND',
    rate NUMERIC NOT NULL CHECK (rate > 0),
    source TEXT NOT NULL,
    is_manual BOOLEAN NOT NULL DEFAULT false,
    note TEXT,
    actor_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_exchange_rate_history_idx
    ON public.quote_exchange_rate_history (instance, base_currency, quote_currency, created_at DESC);

NOTIFY pgrst, 'reload schema';
