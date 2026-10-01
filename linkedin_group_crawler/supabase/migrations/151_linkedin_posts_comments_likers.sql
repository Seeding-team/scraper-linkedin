-- Thêm 2 cột JSONB vào linkedin_posts để lưu dữ liệu cào chi tiết qua
-- extensions/linkedin-group-crawler-extension (DOM-scraping): nội dung từng bình luận
-- và danh sách tên người đã react (like) bài viết.
ALTER TABLE linkedin_posts
    ADD COLUMN IF NOT EXISTS comments_detail JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS likers JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN linkedin_posts.comments_detail IS
    'Danh sách bình luận cào được qua extension: [{author_name, author_url, content, likes}]. Best-effort DOM scraping — có thể rỗng nếu bài không mở được khung bình luận.';
COMMENT ON COLUMN linkedin_posts.likers IS
    'Danh sách tên người đã react (like) bài viết, cào qua extension bằng cách mở popup "ai đã react". Best-effort — có thể rỗng/thiếu nếu popup không mở được hoặc LinkedIn đổi cấu trúc.';
