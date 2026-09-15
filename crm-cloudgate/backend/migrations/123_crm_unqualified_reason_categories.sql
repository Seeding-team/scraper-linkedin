-- Lead verification configurable CRM categories.
-- `categories` has no UNIQUE constraint on (category_type, code), so keep the
-- same idempotent NOT EXISTS pattern used by migrations 079/080.
-- No ALTER TABLE, no unique constraint, no merge/delete/backfill.

DO $$
DECLARE
    v_rows CONSTANT jsonb := '[
        {"category_type": "crm_expected_timeline", "code": "Chua_ro", "name": "Chưa rõ"},
        {"category_type": "crm_expected_timeline", "code": "Ngay", "name": "Ngay"},
        {"category_type": "crm_expected_timeline", "code": "Trong_1_thang", "name": "Trong 1 tháng"},
        {"category_type": "crm_expected_timeline", "code": "1_3_thang", "name": "1-3 tháng"},
        {"category_type": "crm_expected_timeline", "code": "3_6_thang", "name": "3-6 tháng"},
        {"category_type": "crm_expected_timeline", "code": "Sau_6_thang", "name": "Sau 6 tháng"},
        {"category_type": "crm_nurture_reason", "code": "Chua_co_ngan_sach", "name": "Chưa có ngân sách"},
        {"category_type": "crm_nurture_reason", "code": "Chua_dung_thoi_diem", "name": "Chưa đúng thời điểm"},
        {"category_type": "crm_nurture_reason", "code": "Can_them_thong_tin", "name": "Cần thêm thông tin"},
        {"category_type": "crm_nurture_reason", "code": "Dang_so_sanh", "name": "Đang so sánh nhà cung cấp"},
        {"category_type": "crm_follow_up_channel", "code": "Phone", "name": "Gọi điện"},
        {"category_type": "crm_follow_up_channel", "code": "Zalo", "name": "Zalo"},
        {"category_type": "crm_follow_up_channel", "code": "Email", "name": "Email"},
        {"category_type": "crm_follow_up_channel", "code": "Facebook", "name": "Facebook"},
        {"category_type": "crm_unqualified_reason", "code": "Sai_thong_tin", "name": "Sai thông tin"},
        {"category_type": "crm_unqualified_reason", "code": "Spam", "name": "Spam"},
        {"category_type": "crm_unqualified_reason", "code": "Khong_dung_doi_tuong", "name": "Không đúng đối tượng"},
        {"category_type": "crm_unqualified_reason", "code": "Khong_lien_he_duoc", "name": "Không liên hệ được"}
    ]'::jsonb;
    v_row jsonb;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_rows)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM public.categories
            WHERE category_type = v_row->>'category_type'
              AND code = v_row->>'code'
        ) THEN
            INSERT INTO public.categories (
                category_type,
                code,
                name,
                platform,
                is_active
            )
            VALUES (
                v_row->>'category_type',
                v_row->>'code',
                v_row->>'name',
                'all',
                true
            );
        END IF;
    END LOOP;
END $$;
