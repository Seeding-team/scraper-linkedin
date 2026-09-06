-- Fix migration 082: quotes.version_chain_id la NOT NULL nhung create_quote()
-- (insert bao gia MOI hoan toan, khong qua quote_create_version) khong biet
-- gia tri nay - INSERT bi loi "null value in column version_chain_id violates
-- not-null constraint" cho MOI bao gia moi tao tu wizard. Phat hien qua test
-- thuc te ngay sau khi ap dung 082 (khong phai suy doan).
--
-- Fix bang BEFORE INSERT trigger: neu client khong truyen version_chain_id,
-- tu dong dat = id cua chinh no (bao gia doc lap, tu la V1 cua chinh no) -
-- ap dung cho MOI duong insert vao quotes (create_quote() lan hien tai va bat
-- ky insert nao khac sau nay), khong chi rieng quote_create_version() (ham do
-- da tu set version_chain_id/version_number/parent_quote_id tuong minh trong
-- INSERT nen trigger khong ghi de gia tri da co).
CREATE OR REPLACE FUNCTION public.quotes_default_version_chain() RETURNS trigger AS $$
BEGIN
    IF NEW.version_chain_id IS NULL THEN
        NEW.version_chain_id := NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotes_default_version_chain ON public.quotes;
CREATE TRIGGER trg_quotes_default_version_chain
    BEFORE INSERT ON public.quotes
    FOR EACH ROW EXECUTE FUNCTION public.quotes_default_version_chain();
