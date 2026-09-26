-- Tab "Seeding bên ngoài" (internal-engagement page) — phân biệt bài viết
-- CỦA CHÍNH CÔNG TY ("internal", mặc định — giữ nguyên hành vi cũ cho mọi
-- bài đã có từ trước) với bài viết CỦA NGUỒN BÊN NGOÀI ("external" — đối
-- tác/khách hàng/đối thủ...) mà user paste link vào để giao nhiệm vụ seeding
-- y hệt luồng nội bộ (crawl content + like/share, gán team, track tiến độ).
--
-- CHỈ bảng internal_engagement_custom_posts (bài markee-sourced tự động kéo
-- từ MarkeeAI luôn là "internal", không cần cột này) — an toàn chạy lại
-- nhiều lần (IF NOT EXISTS).

ALTER TABLE public.internal_engagement_custom_posts
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'internal';

CREATE INDEX IF NOT EXISTS idx_internal_engagement_custom_posts_scope
    ON public.internal_engagement_custom_posts (scope);

COMMENT ON COLUMN public.internal_engagement_custom_posts.scope IS
    'internal (mặc định, bài của chính công ty) | external (bài của nguồn bên ngoài) — quyết định bài này hiện ở tab "Seeding nội bộ" hay "Seeding bên ngoài" trên trang internal-engagement.';
