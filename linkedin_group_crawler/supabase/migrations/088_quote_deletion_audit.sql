-- Bang audit DOC LAP cho hard-delete bao gia - KHONG FK cascade ve
-- public.quotes(id) (co tinh, de hang audit SONG SOT sau khi quote bi xoa
-- that - day chinh la yeu cau sau su co xoa nham du lieu that: hard-delete
-- phai de lai bang chung KHONG the tu xoa theo).
--
-- CHUA APPLY len production/dev - chi chuan bi code.

CREATE TABLE IF NOT EXISTS public.quote_deletion_audit (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id     UUID NOT NULL,          -- KHONG REFERENCES - co y, xem comment tren
    quote_number TEXT NOT NULL,
    actor_id     UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    reason       TEXT NOT NULL,
    -- Snapshot toi thieu de phuc hoi thu cong sau nay (row quotes + toan bo
    -- quote_items tai thoi diem xoa) - ghi truoc khi DELETE that trong CUNG
    -- 1 transaction (xem quote_hard_delete RPC).
    snapshot     JSONB NOT NULL,
    request_id   TEXT,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_deletion_audit_quote_id ON public.quote_deletion_audit(quote_id);

ALTER TABLE public.quote_deletion_audit ENABLE ROW LEVEL SECURITY;
-- CO Y khong tao policy nao cho 'authenticated'/'anon' - RLS bat + khong co
-- policy = mac dinh KHONG ai qua PostgREST (kê ca user dang nhap that) doc/
-- ghi duoc bang nay. Chi backend Python (dung service_role key, luon BYPASS
-- RLS theo thiet ke cua Supabase) moi doc/ghi duoc - dung "chi backend admin
-- duoc doc" nhu yeu cau, khong can them logic phan quyen rieng o tang DB.
