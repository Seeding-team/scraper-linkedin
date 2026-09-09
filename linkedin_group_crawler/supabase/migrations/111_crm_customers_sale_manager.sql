-- Them "Sale manager" cho Khach hang CRM (yeu cau rieng: filter/dropdown
-- "Sale manager" canh "Nguoi phu trach" trong form "Them khach hang" + trang
-- danh sach Khach hang). Day la 1 cot PHANG luu tay tren tung khach hang
-- (KHONG suy luan dong tu quan he team/leader) - dung y het pattern cot
-- owner_id da co san (migration 077): FK toi app_users(id), ON DELETE SET
-- NULL, khong bat buoc (nullable).
--
-- Nguon danh sach "ai la Sale manager" de chon trong dropdown KHONG phai 1
-- bang/co che moi - dung LAI dung co che "vai tro nghiep vu bao gia"
-- (app_users.quote_business_role, migration 095) da co san: goi
-- GET /users/by-quote-business-role?role=sale (list_users_by_quote_business_role())
-- da tra ve dung nguoi co quote_business_role IN ('sale','both').

ALTER TABLE public.crm_customers
    ADD COLUMN IF NOT EXISTS sale_manager_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_customers_sale_manager_id
    ON public.crm_customers(sale_manager_id)
    WHERE sale_manager_id IS NOT NULL;
