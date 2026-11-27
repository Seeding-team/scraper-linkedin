-- Migration 240: Mo rong whitelist action_type cua post_evaluation_history de ho tro 2 tac
-- vu backfill admin-only da code nhung CHUA co migration tuong ung (phat hien khi ra soat
-- lai truoc khi chay that tren Supabase, 2026-11-26):
--   - 'auto_exclude_low_score': auto_reject_legacy_low_lead_score_posts()
--     (crawl_exclude_service.py) - gan 'khong-phu-hop' cho bai CU co lead_score 1-39 xac
--     dinh con sot tu cua so lich su 2026-10-02 -> 2026-11-04.
--   - 'auto_exclude_null_score_backlog': auto_reject_null_lead_score_backlog()
--     (crawl_exclude_service.py) - don ton dong bai lead_score IS NULL (chua tung duoc AI
--     cham diem), quyet dinh kinh doanh da xac nhan.
--
-- CHECK constraint truoc (migration 234) chi cho phep
-- ('manual', 'batch_reject', 'undo', 'auto_contact_signal', 'auto_exclude_keyword') - insert
-- 2 gia tri moi tren se bi chan neu khong noi rong truoc. Khong co migration nay thi
-- post_quick_review van duoc ghi (khong co constraint o bang do), nhung
-- post_evaluation_history se loi moi bai -> mat audit trail (khong lam sap endpoint vi da
-- duoc try/except o tang service, chi bao loi trong summary["errors"]).

ALTER TABLE public.post_evaluation_history
    DROP CONSTRAINT IF EXISTS post_evaluation_history_action_type_check,
    ADD CONSTRAINT post_evaluation_history_action_type_check CHECK (
        action_type IN (
            'manual', 'batch_reject', 'undo', 'auto_contact_signal', 'auto_exclude_keyword',
            'auto_exclude_low_score', 'auto_exclude_null_score_backlog'
        )
    );
