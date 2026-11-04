-- Mo rong bot "comment seeding tu dong khi bai diem AI cao" (migration 160/161/172, truoc
-- day CHI Facebook) sang ca LinkedIn. id_post_fb van giu nguyen (khong doi ten/kieu de
-- khong dung vao du lieu Facebook dang chay that) - them id_post_li song song + cot
-- platform de phan biet nhiem vu nao thuoc nen tang nao khi doc lai.
--
-- UNIQUE (id_post_li) an toan voi NULL giong UNIQUE (id_post_fb) da co (Postgres cho phep
-- nhieu dong cung NULL trong 1 cot UNIQUE) - moi dong chi dien DUNG 1 trong 2 cot id_post_*
-- tuy theo platform.

ALTER TABLE auto_seeding_comments
  ADD COLUMN IF NOT EXISTS id_post_li UUID REFERENCES linkedin_posts(id) ON DELETE CASCADE UNIQUE,
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'facebook' CHECK (platform IN ('facebook', 'linkedin'));
