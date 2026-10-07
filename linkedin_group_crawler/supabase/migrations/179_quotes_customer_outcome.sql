-- Ket qua bao gia sau phat hanh: "Khong chot / OUT" (ket qua cua KHACH, KHONG phai buoc cua workflow Presale -> Sale -> Duyet).
-- customer_outcome: NULL = dang cho phan hoi khach; 'lost' = Khong chot. Ly do chon tu danh sach backend (quote_outcome_service),
-- 'other' kem lost_reason_other (nhap tu do). Khong doi quotes.status / processing_stage.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS customer_outcome TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason_other TEXT,
  ADD COLUMN IF NOT EXISTS lost_note TEXT,
  ADD COLUMN IF NOT EXISTS lost_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lost_by_name TEXT,
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_customer_outcome_check') THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_customer_outcome_check CHECK (customer_outcome IS NULL OR customer_outcome IN ('lost'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quotes_customer_outcome ON public.quotes (deal_id) WHERE customer_outcome = 'lost';
