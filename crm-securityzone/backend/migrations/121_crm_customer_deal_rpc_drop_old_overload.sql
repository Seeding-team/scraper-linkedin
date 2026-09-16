-- BUG THAT DA GAP: migration 120 dung CREATE OR REPLACE FUNCTION de them
-- tham so p_instance cho crm_create_customer_with_deal/crm_convert_lead,
-- nhung them 1 tham so moi doi CHU KY HAM (parameter signature) -> Postgres
-- KHONG replace ham cu, ma tao them 1 OVERLOAD moi song song. Ket qua: co 2
-- ham trung ten khac chu ky cung ton tai, PostgREST khong biet chon ham nao
-- khi goi RPC -> loi PGRST203 "Could not choose the best candidate function"
-- ngay khi bam "+ Them deal" tren FE (da thay tan mat qua screenshot that).
--
-- Fix: DROP tuong minh 2 chu ky CU (khong co p_instance) truoc, chi giu lai
-- đúng 1 ham (chu ky MOI, co p_instance DEFAULT NULL) ma migration 120 da
-- tao. Cac noi con goi RPC ma CHUA truyen p_instance (vd main app, khong co
-- khai niem crm_instance) van goi duoc binh thuong vi p_instance co DEFAULT.

DROP FUNCTION IF EXISTS public.crm_create_customer_with_deal(
    jsonb, jsonb, uuid, text, boolean
);

DROP FUNCTION IF EXISTS public.crm_convert_lead(
    uuid, jsonb, uuid, jsonb, uuid, jsonb, uuid, text, boolean
);
