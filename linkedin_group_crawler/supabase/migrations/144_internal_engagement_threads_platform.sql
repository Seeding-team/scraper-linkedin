-- Mo rong "Tuong tac noi bo" sang them platform Threads (threads.net), ben canh
-- Facebook + LinkedIn da co tu migration 054. Chi noi rong CHECK constraint tren
-- cot platform da co san o 2 bang custom_posts + kpi, khong doi kieu du lieu/mac dinh
-- (van la TEXT NOT NULL DEFAULT 'facebook', khong pha du lieu cu).

ALTER TABLE public.internal_engagement_custom_posts
    DROP CONSTRAINT IF EXISTS internal_engagement_custom_posts_platform_check;
ALTER TABLE public.internal_engagement_custom_posts
    ADD CONSTRAINT internal_engagement_custom_posts_platform_check
    CHECK (platform IN ('facebook', 'linkedin', 'threads'));

ALTER TABLE public.internal_engagement_kpi
    DROP CONSTRAINT IF EXISTS internal_engagement_kpi_platform_check;
ALTER TABLE public.internal_engagement_kpi
    ADD CONSTRAINT internal_engagement_kpi_platform_check
    CHECK (platform IN ('facebook', 'linkedin', 'threads'));
