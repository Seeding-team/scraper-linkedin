-- Seed Vietnam 63 provinces/cities for CRM city master data.
-- Idempotent: public.categories has no unique constraint on (category_type, code),
-- so guard every row with NOT EXISTS. Names are JSON unicode-escaped to avoid
-- Windows/editor encoding corruption (for example Dak Lak accents).
DO $$
DECLARE
    v_row jsonb;
BEGIN
    FOR v_row IN
        SELECT * FROM jsonb_array_elements('[
            {
                        "code": "An_Giang",
                        "name": "An Giang",
                        "sort_order": 10
            },
            {
                        "code": "Ba_Ria_Vung_Tau",
                        "name": "B\u00e0 R\u1ecba - V\u0169ng T\u00e0u",
                        "sort_order": 20
            },
            {
                        "code": "Bac_Lieu",
                        "name": "B\u1ea1c Li\u00eau",
                        "sort_order": 30
            },
            {
                        "code": "Bac_Giang",
                        "name": "B\u1eafc Giang",
                        "sort_order": 40
            },
            {
                        "code": "Bac_Kan",
                        "name": "B\u1eafc K\u1ea1n",
                        "sort_order": 50
            },
            {
                        "code": "Bac_Ninh",
                        "name": "B\u1eafc Ninh",
                        "sort_order": 60
            },
            {
                        "code": "Ben_Tre",
                        "name": "B\u1ebfn Tre",
                        "sort_order": 70
            },
            {
                        "code": "Binh_Dinh",
                        "name": "B\u00ecnh \u0110\u1ecbnh",
                        "sort_order": 80
            },
            {
                        "code": "Binh_Duong",
                        "name": "B\u00ecnh D\u01b0\u01a1ng",
                        "sort_order": 90
            },
            {
                        "code": "Binh_Phuoc",
                        "name": "B\u00ecnh Ph\u01b0\u1edbc",
                        "sort_order": 100
            },
            {
                        "code": "Binh_Thuan",
                        "name": "B\u00ecnh Thu\u1eadn",
                        "sort_order": 110
            },
            {
                        "code": "Ca_Mau",
                        "name": "C\u00e0 Mau",
                        "sort_order": 120
            },
            {
                        "code": "Cao_Bang",
                        "name": "Cao B\u1eb1ng",
                        "sort_order": 130
            },
            {
                        "code": "Can_Tho",
                        "name": "C\u1ea7n Th\u01a1",
                        "sort_order": 140
            },
            {
                        "code": "Da_Nang",
                        "name": "\u0110\u00e0 N\u1eb5ng",
                        "sort_order": 150
            },
            {
                        "code": "Dak_Lak",
                        "name": "\u0110\u1eafk L\u1eafk",
                        "sort_order": 160
            },
            {
                        "code": "Dak_Nong",
                        "name": "\u0110\u1eafk N\u00f4ng",
                        "sort_order": 170
            },
            {
                        "code": "Dien_Bien",
                        "name": "\u0110i\u1ec7n Bi\u00ean",
                        "sort_order": 180
            },
            {
                        "code": "Dong_Nai",
                        "name": "\u0110\u1ed3ng Nai",
                        "sort_order": 190
            },
            {
                        "code": "Dong_Thap",
                        "name": "\u0110\u1ed3ng Th\u00e1p",
                        "sort_order": 200
            },
            {
                        "code": "Gia_Lai",
                        "name": "Gia Lai",
                        "sort_order": 210
            },
            {
                        "code": "Ha_Giang",
                        "name": "H\u00e0 Giang",
                        "sort_order": 220
            },
            {
                        "code": "Ha_Nam",
                        "name": "H\u00e0 Nam",
                        "sort_order": 230
            },
            {
                        "code": "Ha_Noi",
                        "name": "H\u00e0 N\u1ed9i",
                        "sort_order": 240
            },
            {
                        "code": "Ha_Tinh",
                        "name": "H\u00e0 T\u0129nh",
                        "sort_order": 250
            },
            {
                        "code": "Hai_Duong",
                        "name": "H\u1ea3i D\u01b0\u01a1ng",
                        "sort_order": 260
            },
            {
                        "code": "Hai_Phong",
                        "name": "H\u1ea3i Ph\u00f2ng",
                        "sort_order": 270
            },
            {
                        "code": "Hau_Giang",
                        "name": "H\u1eadu Giang",
                        "sort_order": 280
            },
            {
                        "code": "Hoa_Binh",
                        "name": "H\u00f2a B\u00ecnh",
                        "sort_order": 290
            },
            {
                        "code": "Hung_Yen",
                        "name": "H\u01b0ng Y\u00ean",
                        "sort_order": 300
            },
            {
                        "code": "Khanh_Hoa",
                        "name": "Kh\u00e1nh H\u00f2a",
                        "sort_order": 310
            },
            {
                        "code": "Kien_Giang",
                        "name": "Ki\u00ean Giang",
                        "sort_order": 320
            },
            {
                        "code": "Kon_Tum",
                        "name": "Kon Tum",
                        "sort_order": 330
            },
            {
                        "code": "Lai_Chau",
                        "name": "Lai Ch\u00e2u",
                        "sort_order": 340
            },
            {
                        "code": "Lam_Dong",
                        "name": "L\u00e2m \u0110\u1ed3ng",
                        "sort_order": 350
            },
            {
                        "code": "Lang_Son",
                        "name": "L\u1ea1ng S\u01a1n",
                        "sort_order": 360
            },
            {
                        "code": "Lao_Cai",
                        "name": "L\u00e0o Cai",
                        "sort_order": 370
            },
            {
                        "code": "Long_An",
                        "name": "Long An",
                        "sort_order": 380
            },
            {
                        "code": "Nam_Dinh",
                        "name": "Nam \u0110\u1ecbnh",
                        "sort_order": 390
            },
            {
                        "code": "Nghe_An",
                        "name": "Ngh\u1ec7 An",
                        "sort_order": 400
            },
            {
                        "code": "Ninh_Binh",
                        "name": "Ninh B\u00ecnh",
                        "sort_order": 410
            },
            {
                        "code": "Ninh_Thuan",
                        "name": "Ninh Thu\u1eadn",
                        "sort_order": 420
            },
            {
                        "code": "Phu_Tho",
                        "name": "Ph\u00fa Th\u1ecd",
                        "sort_order": 430
            },
            {
                        "code": "Phu_Yen",
                        "name": "Ph\u00fa Y\u00ean",
                        "sort_order": 440
            },
            {
                        "code": "Quang_Binh",
                        "name": "Qu\u1ea3ng B\u00ecnh",
                        "sort_order": 450
            },
            {
                        "code": "Quang_Nam",
                        "name": "Qu\u1ea3ng Nam",
                        "sort_order": 460
            },
            {
                        "code": "Quang_Ngai",
                        "name": "Qu\u1ea3ng Ng\u00e3i",
                        "sort_order": 470
            },
            {
                        "code": "Quang_Ninh",
                        "name": "Qu\u1ea3ng Ninh",
                        "sort_order": 480
            },
            {
                        "code": "Quang_Tri",
                        "name": "Qu\u1ea3ng Tr\u1ecb",
                        "sort_order": 490
            },
            {
                        "code": "Soc_Trang",
                        "name": "S\u00f3c Tr\u0103ng",
                        "sort_order": 500
            },
            {
                        "code": "Son_La",
                        "name": "S\u01a1n La",
                        "sort_order": 510
            },
            {
                        "code": "Tay_Ninh",
                        "name": "T\u00e2y Ninh",
                        "sort_order": 520
            },
            {
                        "code": "Thai_Binh",
                        "name": "Th\u00e1i B\u00ecnh",
                        "sort_order": 530
            },
            {
                        "code": "Thai_Nguyen",
                        "name": "Th\u00e1i Nguy\u00ean",
                        "sort_order": 540
            },
            {
                        "code": "Thanh_Hoa",
                        "name": "Thanh H\u00f3a",
                        "sort_order": 550
            },
            {
                        "code": "Thua_Thien_Hue",
                        "name": "Th\u1eeba Thi\u00ean Hu\u1ebf",
                        "sort_order": 560
            },
            {
                        "code": "Tien_Giang",
                        "name": "Ti\u1ec1n Giang",
                        "sort_order": 570
            },
            {
                        "code": "Ho_Chi_Minh",
                        "name": "TP. H\u1ed3 Ch\u00ed Minh",
                        "sort_order": 580
            },
            {
                        "code": "Tra_Vinh",
                        "name": "Tr\u00e0 Vinh",
                        "sort_order": 590
            },
            {
                        "code": "Tuyen_Quang",
                        "name": "Tuy\u00ean Quang",
                        "sort_order": 600
            },
            {
                        "code": "Vinh_Long",
                        "name": "V\u0129nh Long",
                        "sort_order": 610
            },
            {
                        "code": "Vinh_Phuc",
                        "name": "V\u0129nh Ph\u00fac",
                        "sort_order": 620
            },
            {
                        "code": "Yen_Bai",
                        "name": "Y\u00ean B\u00e1i",
                        "sort_order": 630
            }
]'::jsonb)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.categories
            WHERE category_type = 'crm_city' AND code = v_row->>'code'
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
                'crm_city',
                v_row->>'code',
                v_row->>'name',
                'crm',
                true,
                COALESCE((v_row->>'sort_order')::int, 0)
            );
        ELSE
            UPDATE public.categories
            SET
                name = v_row->>'name',
                platform = COALESCE(platform, 'crm'),
                is_active = true,
                sort_order = COALESCE((v_row->>'sort_order')::int, sort_order, 0),
                updated_at = now()
            WHERE category_type = 'crm_city' AND code = v_row->>'code';
        END IF;
    END LOOP;
END $$;
