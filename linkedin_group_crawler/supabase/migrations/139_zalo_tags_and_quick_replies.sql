-- Migration 139: 2 tính năng CSKH (yêu cầu 2026-09-17):
--   1. "Gắn tag phân loại khách" — tag hiện chỉ lưu localStorage (riêng từng
--      máy/browser, KHÔNG đồng bộ giữa các nhân viên cùng quản lý 1 tài khoản
--      Zalo tập trung) — chuyển sang lưu server-side trên chính zalo_groups
--      (1 hội thoại = 1 khách/nhóm = đúng đối tượng cần phân loại).
--   2. "Giữ tin nhắn mời mua hàng lại" — trước đây chỉ có 6 mẫu nhắn nhanh
--      HARDCODE trong code (QUICK_REPLIES ở ZaloChatView.tsx), không ai lưu
--      thêm được — thêm bảng lưu mẫu tự soạn, dùng lại nhiều lần.

ALTER TABLE public.zalo_groups
    ADD COLUMN IF NOT EXISTS tag TEXT;

CREATE INDEX IF NOT EXISTS idx_zalo_groups_tag
    ON public.zalo_groups (user_id, tag) WHERE tag IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.zalo_quick_replies (
    id              BIGSERIAL PRIMARY KEY,
    account_id      TEXT        NOT NULL REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    label           TEXT        NOT NULL,
    text            TEXT        NOT NULL,
    shortcut        TEXT,
    created_by      UUID        REFERENCES public.app_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_quick_replies_account
    ON public.zalo_quick_replies (account_id, created_at DESC);
