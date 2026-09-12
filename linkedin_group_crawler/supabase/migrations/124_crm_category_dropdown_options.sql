-- 124_crm_category_dropdown_options.sql
-- Centralize configurable CRM dropdown options in public.categories.
-- Pattern intentionally matches 079/080/123: no UNIQUE constraint, no
-- ON CONFLICT, no destructive data changes. categories is shared master data
-- across Main/Module/Zone/Cloud, so no tenant backfill/duplication.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
    v_row JSONB;
    v_rows JSONB := '[
        {"category_type":"crm_city","code":"Ha_Noi","name":"Hà Nội","sort_order":10},
        {"category_type":"crm_city","code":"Ho_Chi_Minh","name":"Hồ Chí Minh","sort_order":20},
        {"category_type":"crm_city","code":"Hai_Phong","name":"Hải Phòng","sort_order":30},
        {"category_type":"crm_city","code":"a_Nang","name":"Đà Nẵng","sort_order":40},
        {"category_type":"crm_city","code":"Can_Tho","name":"Cần Thơ","sort_order":50},
        {"category_type":"crm_city","code":"An_Giang","name":"An Giang","sort_order":60},
        {"category_type":"crm_city","code":"Ba_Ria_Vung_Tau","name":"Bà Rịa - Vũng Tàu","sort_order":70},
        {"category_type":"crm_city","code":"Bac_Lieu","name":"Bạc Liêu","sort_order":80},
        {"category_type":"crm_city","code":"Bac_Giang","name":"Bắc Giang","sort_order":90},
        {"category_type":"crm_city","code":"Bac_Kan","name":"Bắc Kạn","sort_order":100},
        {"category_type":"crm_city","code":"Bac_Ninh","name":"Bắc Ninh","sort_order":110},
        {"category_type":"crm_city","code":"Ben_Tre","name":"Bến Tre","sort_order":120},
        {"category_type":"crm_city","code":"Binh_inh","name":"Bình Định","sort_order":130},
        {"category_type":"crm_city","code":"Binh_Duong","name":"Bình Dương","sort_order":140},
        {"category_type":"crm_city","code":"Binh_Phuoc","name":"Bình Phước","sort_order":150},
        {"category_type":"crm_city","code":"Binh_Thuan","name":"Bình Thuận","sort_order":160},
        {"category_type":"crm_city","code":"Ca_Mau","name":"Cà Mau","sort_order":170},
        {"category_type":"crm_city","code":"Cao_Bang","name":"Cao Bằng","sort_order":180},
        {"category_type":"crm_city","code":"ak_Lak","name":"Đắk Lắk","sort_order":190},
        {"category_type":"crm_city","code":"ak_Nong","name":"Đắk Nông","sort_order":200},
        {"category_type":"crm_city","code":"ien_Bien","name":"Điện Biên","sort_order":210},
        {"category_type":"crm_city","code":"ong_Nai","name":"Đồng Nai","sort_order":220},
        {"category_type":"crm_city","code":"ong_Thap","name":"Đồng Tháp","sort_order":230},
        {"category_type":"crm_city","code":"Gia_Lai","name":"Gia Lai","sort_order":240},
        {"category_type":"crm_city","code":"Ha_Giang","name":"Hà Giang","sort_order":250},
        {"category_type":"crm_city","code":"Ha_Nam","name":"Hà Nam","sort_order":260},
        {"category_type":"crm_city","code":"Ha_Tinh","name":"Hà Tĩnh","sort_order":270},
        {"category_type":"crm_city","code":"Hai_Duong","name":"Hải Dương","sort_order":280},
        {"category_type":"crm_city","code":"Hau_Giang","name":"Hậu Giang","sort_order":290},
        {"category_type":"crm_city","code":"Hoa_Binh","name":"Hòa Bình","sort_order":300},
        {"category_type":"crm_city","code":"Hung_Yen","name":"Hưng Yên","sort_order":310},
        {"category_type":"crm_city","code":"Khanh_Hoa","name":"Khánh Hòa","sort_order":320},
        {"category_type":"crm_city","code":"Kien_Giang","name":"Kiên Giang","sort_order":330},
        {"category_type":"crm_city","code":"Kon_Tum","name":"Kon Tum","sort_order":340},
        {"category_type":"crm_city","code":"Lai_Chau","name":"Lai Châu","sort_order":350},
        {"category_type":"crm_city","code":"Lam_ong","name":"Lâm Đồng","sort_order":360},
        {"category_type":"crm_city","code":"Lang_Son","name":"Lạng Sơn","sort_order":370},
        {"category_type":"crm_city","code":"Lao_Cai","name":"Lào Cai","sort_order":380},
        {"category_type":"crm_city","code":"Long_An","name":"Long An","sort_order":390},
        {"category_type":"crm_city","code":"Nam_inh","name":"Nam Định","sort_order":400},
        {"category_type":"crm_city","code":"Nghe_An","name":"Nghệ An","sort_order":410},
        {"category_type":"crm_city","code":"Ninh_Binh","name":"Ninh Bình","sort_order":420},
        {"category_type":"crm_city","code":"Ninh_Thuan","name":"Ninh Thuận","sort_order":430},
        {"category_type":"crm_city","code":"Phu_Tho","name":"Phú Thọ","sort_order":440},
        {"category_type":"crm_city","code":"Phu_Yen","name":"Phú Yên","sort_order":450},
        {"category_type":"crm_city","code":"Quang_Binh","name":"Quảng Bình","sort_order":460},
        {"category_type":"crm_city","code":"Quang_Nam","name":"Quảng Nam","sort_order":470},
        {"category_type":"crm_city","code":"Quang_Ngai","name":"Quảng Ngãi","sort_order":480},
        {"category_type":"crm_city","code":"Quang_Ninh","name":"Quảng Ninh","sort_order":490},
        {"category_type":"crm_city","code":"Quang_Tri","name":"Quảng Trị","sort_order":500},
        {"category_type":"crm_city","code":"Soc_Trang","name":"Sóc Trăng","sort_order":510},
        {"category_type":"crm_city","code":"Son_La","name":"Sơn La","sort_order":520},
        {"category_type":"crm_city","code":"Tay_Ninh","name":"Tây Ninh","sort_order":530},
        {"category_type":"crm_city","code":"Thai_Binh","name":"Thái Bình","sort_order":540},
        {"category_type":"crm_city","code":"Thai_Nguyen","name":"Thái Nguyên","sort_order":550},
        {"category_type":"crm_city","code":"Thanh_Hoa","name":"Thanh Hóa","sort_order":560},
        {"category_type":"crm_city","code":"Thua_Thien_Hue","name":"Thừa Thiên Huế","sort_order":570},
        {"category_type":"crm_city","code":"Tien_Giang","name":"Tiền Giang","sort_order":580},
        {"category_type":"crm_city","code":"Tra_Vinh","name":"Trà Vinh","sort_order":590},
        {"category_type":"crm_city","code":"Tuyen_Quang","name":"Tuyên Quang","sort_order":600},
        {"category_type":"crm_city","code":"Vinh_Long","name":"Vĩnh Long","sort_order":610},
        {"category_type":"crm_city","code":"Vinh_Phuc","name":"Vĩnh Phúc","sort_order":620},
        {"category_type":"crm_city","code":"Yen_Bai","name":"Yên Bái","sort_order":630},

        {"category_type":"crm_contract_status","code":"moi_tiep_nhan","name":"Mới tiếp nhận","sort_order":10},
        {"category_type":"crm_contract_status","code":"dang_xu_ly","name":"Đang xử lý","sort_order":20},
        {"category_type":"crm_contract_status","code":"da_bao_gia","name":"Đã báo giá","sort_order":30},
        {"category_type":"crm_contract_status","code":"dang_dam_phan","name":"Đang đàm phán","sort_order":40},
        {"category_type":"crm_contract_status","code":"da_chot","name":"Đã chốt","sort_order":50},
        {"category_type":"crm_contract_status","code":"tam_dung","name":"Tạm dừng","sort_order":60},
        {"category_type":"crm_contract_status","code":"khong_hoat_dong","name":"Không hoạt động","sort_order":70},

        {"category_type":"crm_payment_status","code":"chua_thanh_toan","name":"Chưa thanh toán","sort_order":10},
        {"category_type":"crm_payment_status","code":"thanh_toan_mot_phan","name":"Thanh toán một phần","sort_order":20},
        {"category_type":"crm_payment_status","code":"da_thanh_toan","name":"Đã thanh toán","sort_order":30},
        {"category_type":"crm_payment_status","code":"qua_han","name":"Quá hạn","sort_order":40},

        {"category_type":"crm_billing_type","code":"one_time","name":"Một lần","sort_order":10},
        {"category_type":"crm_billing_type","code":"monthly","name":"Theo tháng","sort_order":20},
        {"category_type":"crm_billing_type","code":"yearly","name":"Theo năm","sort_order":30},

        {"category_type":"crm_won_reason","code":"solution_fit","name":"Giải pháp phù hợp","sort_order":10},
        {"category_type":"crm_won_reason","code":"trust_case_study","name":"Uy tín / case study thuyết phục","sort_order":20},
        {"category_type":"crm_won_reason","code":"competitive_price","name":"Giá hợp lý","sort_order":30},
        {"category_type":"crm_won_reason","code":"fast_response","name":"Phản hồi nhanh","sort_order":40},

        {"category_type":"crm_lost_reason","code":"no_budget","name":"Khách chưa có ngân sách","sort_order":10},
        {"category_type":"crm_lost_reason","code":"competitor","name":"Chọn đối thủ","sort_order":20},
        {"category_type":"crm_lost_reason","code":"timing","name":"Chưa phù hợp thời điểm","sort_order":30},
        {"category_type":"crm_lost_reason","code":"no_response","name":"Không phản hồi","sort_order":40},

        {"category_type":"crm_outcome_confidence","code":"high_confirmed","name":"Cao - Có khách hàng xác nhận","sort_order":10},
        {"category_type":"crm_outcome_confidence","code":"medium_inferred","name":"Trung bình - Suy luận từ trao đổi","sort_order":20},
        {"category_type":"crm_outcome_confidence","code":"low_unclear","name":"Thấp - Cần kiểm chứng thêm","sort_order":30},

        {"category_type":"crm_outcome_trigger","code":"deadline","name":"Cần go-live theo deadline","sort_order":10},
        {"category_type":"crm_outcome_trigger","code":"growth","name":"Cần tăng trưởng doanh thu","sort_order":20},
        {"category_type":"crm_outcome_trigger","code":"operation","name":"Cần tối ưu vận hành","sort_order":30},
        {"category_type":"crm_outcome_trigger","code":"replacement","name":"Thay thế giải pháp cũ","sort_order":40},
        {"category_type":"crm_outcome_trigger","code":"unknown","name":"Chưa rõ","sort_order":50},

        {"category_type":"crm_outcome_objection","code":"timeline","name":"Lo ngại tiến độ triển khai","sort_order":10},
        {"category_type":"crm_outcome_objection","code":"price","name":"Lo ngại giá / ngân sách","sort_order":20},
        {"category_type":"crm_outcome_objection","code":"trust","name":"Cần thêm bằng chứng tin cậy","sort_order":30},
        {"category_type":"crm_outcome_objection","code":"authority","name":"Chưa có người quyết định","sort_order":40},
        {"category_type":"crm_outcome_objection","code":"none","name":"Không có objection lớn","sort_order":50},

        {"category_type":"crm_kb_reuse_level","code":"high_playbook","name":"Cao - Có thể thành playbook","sort_order":10},
        {"category_type":"crm_kb_reuse_level","code":"medium_reference","name":"Trung bình - Dùng làm tham chiếu","sort_order":20},
        {"category_type":"crm_kb_reuse_level","code":"low_context","name":"Thấp - Chỉ dùng theo bối cảnh","sort_order":30},

        {"category_type":"crm_kb_owner","code":"deal_sdr","name":"Sale phụ trách deal","sort_order":10},
        {"category_type":"crm_kb_owner","code":"sales_manager","name":"Quản lý sales","sort_order":20},
        {"category_type":"crm_kb_owner","code":"marketing","name":"Marketing","sort_order":30},

        {"category_type":"crm_kb_status","code":"draft","name":"Draft - Chờ duyệt","sort_order":10},
        {"category_type":"crm_kb_status","code":"approved","name":"Approved - Đã duyệt","sort_order":20},
        {"category_type":"crm_kb_status","code":"rejected","name":"Rejected - Không dùng","sort_order":30}
    ]'::JSONB;
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
                is_active,
                sort_order
            )
            VALUES (
                v_row->>'category_type',
                v_row->>'code',
                v_row->>'name',
                'all',
                true,
                COALESCE((v_row->>'sort_order')::INTEGER, 0)
            );
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_type_active_sort
  ON public.categories (category_type, is_active, sort_order, code);
