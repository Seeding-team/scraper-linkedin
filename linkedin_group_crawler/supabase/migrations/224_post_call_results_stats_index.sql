-- Index composite phuc vu endpoint thong ke "Ket qua lien he" (GET
-- /api/all-platform/posts/call-results/stats): group theo result_code (loai)
-- VA theo ngay VN cung luc. 2 index cua migration 222 (idx_post_call_results_user_time,
-- idx_post_call_results_day_vn) chi phu theo updated_by, chua co index phu theo
-- result_code + ngay.
CREATE INDEX IF NOT EXISTS idx_post_call_results_code_day_vn
    ON public.post_call_results (result_code, ((last_call_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
    WHERE last_call_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
