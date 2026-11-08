-- Rà soát + dọn dữ liệu trùng (nhóm Facebook/LinkedIn, bài Facebook) rồi thêm UNIQUE
-- constraint để chặn trùng về sau. Yêu cầu 2026-10-01: "check có nhóm nào bị trùng thì
-- xóa nhóm thêm sau (check theo thời gian created_at), đảm bảo data sạch".
--
-- Thứ tự bắt buộc: RE-POINT các FK/soft-reference trỏ tới nhóm trùng sang nhóm "sống
-- sót" (created_at SỚM NHẤT) TRƯỚC khi xoá nhóm trùng — facebook_posts.group_id/
-- linkedin_posts.id_group có ON DELETE SET NULL (xoá thẳng sẽ âm thầm làm bài mất liên
-- kết nhóm, không báo lỗi), và crawl_jobs.group_id không có FK constraint nào cả (sẽ
-- trỏ tới 1 id đã xoá, trở thành rác âm thầm) — xem báo cáo điều tra 2026-10-01.
--
-- Trạng thái lúc viết migration (DB self-host, dùng chung dev+prod): facebook_groups có
-- 23 group_url trùng (38 dòng dư), facebook_posts có 90 post_url trùng (131 dòng dư),
-- linkedin_groups/linkedin_posts chưa phát hiện trùng nhưng vẫn dọn phòng hờ cùng 1 quy
-- tắc cho nhất quán.

BEGIN;

-- ── 1. Dọn bài Facebook/LinkedIn trùng post_url (giữ bản SỚM NHẤT theo created_at) ─────
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY post_url ORDER BY created_at ASC, id ASC) AS rn
  FROM facebook_posts
  WHERE post_url IS NOT NULL
)
DELETE FROM facebook_posts fp
USING ranked r
WHERE fp.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY post_url ORDER BY created_at ASC, id ASC) AS rn
  FROM linkedin_posts
  WHERE post_url IS NOT NULL
)
DELETE FROM linkedin_posts lp
USING ranked r
WHERE lp.id = r.id AND r.rn > 1;

-- ── 2. Nhóm Facebook trùng group_url: re-point FK/soft-ref sang nhóm sống sót rồi xoá ──
WITH ranked_groups AS (
  SELECT id, group_url,
         row_number() OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS rn,
         first_value(id) OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS survivor_id
  FROM facebook_groups
  WHERE group_url IS NOT NULL
),
dups AS (
  SELECT id AS dup_id, survivor_id FROM ranked_groups WHERE rn > 1
)
UPDATE facebook_posts fp
SET group_id = d.survivor_id
FROM dups d
WHERE fp.group_id = d.dup_id;

WITH ranked_groups AS (
  SELECT id, group_url,
         row_number() OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS rn,
         first_value(id) OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS survivor_id
  FROM facebook_groups
  WHERE group_url IS NOT NULL
),
dups AS (
  SELECT id AS dup_id, survivor_id FROM ranked_groups WHERE rn > 1
)
UPDATE crawl_jobs cj
SET group_id = d.survivor_id
FROM dups d
WHERE cj.platform = 'facebook' AND cj.group_id = d.dup_id;

WITH ranked_groups AS (
  SELECT id, row_number() OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS rn
  FROM facebook_groups
  WHERE group_url IS NOT NULL
)
DELETE FROM facebook_groups fg
USING ranked_groups r
WHERE fg.id = r.id AND r.rn > 1;

-- ── 3. Tương tự cho LinkedIn (phòng hờ dù hiện chưa phát hiện trùng) ────────────────────
WITH ranked_groups AS (
  SELECT id, group_url,
         row_number() OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS rn,
         first_value(id) OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS survivor_id
  FROM linkedin_groups
  WHERE group_url IS NOT NULL
),
dups AS (
  SELECT id AS dup_id, survivor_id FROM ranked_groups WHERE rn > 1
)
UPDATE linkedin_posts lp
SET id_group = d.survivor_id
FROM dups d
WHERE lp.id_group = d.dup_id;

WITH ranked_groups AS (
  SELECT id, group_url,
         row_number() OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS rn,
         first_value(id) OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS survivor_id
  FROM linkedin_groups
  WHERE group_url IS NOT NULL
),
dups AS (
  SELECT id AS dup_id, survivor_id FROM ranked_groups WHERE rn > 1
)
UPDATE crawl_jobs cj
SET group_id = d.survivor_id
FROM dups d
WHERE cj.platform = 'linkedin' AND cj.group_id = d.dup_id;

WITH ranked_groups AS (
  SELECT id, row_number() OVER (PARTITION BY group_url ORDER BY created_at ASC, id ASC) AS rn
  FROM linkedin_groups
  WHERE group_url IS NOT NULL
)
DELETE FROM linkedin_groups lg
USING ranked_groups r
WHERE lg.id = r.id AND r.rn > 1;

-- ── 4. UNIQUE constraint chặn trùng về sau (chỉ chạy được sau khi đã dọn sạch ở trên) ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facebook_posts_post_url_key') THEN
    ALTER TABLE facebook_posts ADD CONSTRAINT facebook_posts_post_url_key UNIQUE (post_url);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'linkedin_posts_post_url_key') THEN
    ALTER TABLE linkedin_posts ADD CONSTRAINT linkedin_posts_post_url_key UNIQUE (post_url);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facebook_groups_group_url_key') THEN
    ALTER TABLE facebook_groups ADD CONSTRAINT facebook_groups_group_url_key UNIQUE (group_url);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'linkedin_groups_group_url_key') THEN
    ALTER TABLE linkedin_groups ADD CONSTRAINT linkedin_groups_group_url_key UNIQUE (group_url);
  END IF;
END $$;

COMMIT;
