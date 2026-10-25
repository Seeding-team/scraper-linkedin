-- Migration 145: Add link_comment, comment_id, and facebook_name to internal_engagement_kpi for verifiable proof of work
ALTER TABLE public.internal_engagement_kpi 
    ADD COLUMN IF NOT EXISTS link_comment TEXT,
    ADD COLUMN IF NOT EXISTS comment_id TEXT,
    ADD COLUMN IF NOT EXISTS facebook_name TEXT;

CREATE INDEX IF NOT EXISTS idx_internal_engagement_kpi_link_comment
    ON public.internal_engagement_kpi(link_comment);

CREATE INDEX IF NOT EXISTS idx_internal_engagement_kpi_comment_id
    ON public.internal_engagement_kpi(comment_id);

