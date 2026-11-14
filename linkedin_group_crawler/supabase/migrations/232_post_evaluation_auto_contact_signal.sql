-- Migration 232: Mo rong whitelist action_type cua post_evaluation_history de ho tro
-- tu dong nang danh gia bai viet len 'can-lien-he' khi he thong phat hien tin hieu DA
-- lien he duoc (ghi nhan ket qua goi dien o post_call_result_service.update_call_result,
-- hoac bot tu dong nhan tin Zalo tu van thanh cong o auto_seeding_zalo_service) - xem
-- post_evaluation_service.auto_promote_to_can_lien_he().
--
-- CHECK constraint cu (migration 215) chi cho phep ('manual', 'batch_reject', 'undo') -
-- insert 'auto_contact_signal' se bi chan neu khong noi rong truoc.

ALTER TABLE public.post_evaluation_history
    DROP CONSTRAINT IF EXISTS post_evaluation_history_action_type_check,
    ADD CONSTRAINT post_evaluation_history_action_type_check CHECK (
        action_type IN ('manual', 'batch_reject', 'undo', 'auto_contact_signal')
    );
