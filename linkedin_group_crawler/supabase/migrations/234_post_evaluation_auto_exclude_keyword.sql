-- Migration 234: Mo rong whitelist action_type cua post_evaluation_history de ho tro
-- tu dong gan 'khong-phu-hop' cho bai MOI cao khop tu khoa loai tru, ngay sau khi insert
-- vao facebook_posts/linkedin_posts/threads_posts (xem
-- crawl_exclude_service.auto_reject_if_excluded(), hook o post_ingest_service.py,
-- supabase_linkedin_extension_crawl_service.py, supabase_threads_extension_crawl_service.py).
-- CHI ap dung cho bai moi di qua dung diem insert nay, khong dung quet lai bai cu co san.
--
-- CHECK constraint truoc (migration 232) chi cho phep
-- ('manual', 'batch_reject', 'undo', 'auto_contact_signal') - insert 'auto_exclude_keyword'
-- se bi chan neu khong noi rong truoc.

ALTER TABLE public.post_evaluation_history
    DROP CONSTRAINT IF EXISTS post_evaluation_history_action_type_check,
    ADD CONSTRAINT post_evaluation_history_action_type_check CHECK (
        action_type IN ('manual', 'batch_reject', 'undo', 'auto_contact_signal', 'auto_exclude_keyword')
    );
