-- "báo giá cũ, phần giới hạn lọc link pdf chưa được mặc định là số điện
-- thoại" (feedback 2026-09-24): migration 118 tao cot public_access_mode
-- NOT NULL DEFAULT 'none' - MOI quote (ca cu lan moi) deu luu san 'none' nen
-- fallback `publicAccessMode || 'phone'` o frontend (QuoteWorkspaceModal)
-- KHONG BAO GIO chay duoc ('none' la chuoi truthy) - UI luon hien "Không giới
-- hạn" va link cong khai THAT SU mo cho moi nguoi.
--
-- (1) Quote tao tu nay ve sau: mac dinh 'phone'.
ALTER TABLE public.quotes ALTER COLUMN public_access_mode SET DEFAULT 'phone';

-- (2) Quote cu dang 'none' ma CHUA TUNG co ai chu dong chon "Không giới hạn"
-- (khong co log public_access_restriction_updated voi mode='none') -> doi
-- sang 'phone', tu dien danh sach SDT duoc phep = SDT khach hang da hien tren
-- bao gia (data.customerPhone - cung nguon voi backend get_public_quote()
-- fallback) neu danh sach dang rong. Chuan hoa giong het
-- normalize_public_access_phone() o supabase_quote_service.py (bo ky tu thua,
-- 0xxx -> +84xxx, thieu ma vung -> +84).
--
-- CHI doi quote CO SDT de doi chieu (danh sach da luu HOAC data.customerPhone)
-- - quote khong co SDT nao ca ma bi ep 'phone' se KHOA HAN link da gui cho
-- khach (khong ai nhap dung duoc SDT nao), nen giu nguyen 'none' cho nhom nay
-- de Sale tu nhap SDT roi bam "Lưu giới hạn xem link".
WITH candidates AS (
    SELECT
        q.id,
        NULLIF(regexp_replace(COALESCE(q.data->>'customerPhone', ''), '[^0-9+]', '', 'g'), '') AS raw_phone,
        COALESCE(array_length(q.public_allowed_phones, 1), 0) AS stored_count
    FROM public.quotes q
    WHERE q.public_access_mode = 'none'
      AND NOT EXISTS (
          SELECT 1
          FROM public.quote_activity_log l
          WHERE l.quote_id = q.id
            AND l.action = 'public_access_restriction_updated'
            AND l.changes->>'mode' = 'none'
      )
)
UPDATE public.quotes q
SET public_access_mode = 'phone',
    public_allowed_phones = CASE
        WHEN c.stored_count > 0 THEN q.public_allowed_phones
        WHEN c.raw_phone LIKE '0%' THEN ARRAY['+84' || substr(c.raw_phone, 2)]
        WHEN c.raw_phone LIKE '+%' THEN ARRAY[c.raw_phone]
        ELSE ARRAY['+84' || c.raw_phone]
    END
FROM candidates c
WHERE q.id = c.id
  AND (c.stored_count > 0 OR c.raw_phone IS NOT NULL);
