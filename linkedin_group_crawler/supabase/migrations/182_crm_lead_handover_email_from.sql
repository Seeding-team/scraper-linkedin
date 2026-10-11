-- GD3: luu dia chi Gmail he thong da dung de gui tung email ban giao (doi Gmail sau nay khong lam doi lich su cu).
ALTER TABLE public.crm_lead_handovers
  ADD COLUMN IF NOT EXISTS email_from TEXT;
