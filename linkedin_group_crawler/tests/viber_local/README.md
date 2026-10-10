# Chạy thử Viber Chat ở local (không cần Viber thật)

Bộ harness chạy **backend thật** của module Viber (`app/modules/all_platform/viber`) trên máy local,
thay 2 phụ thuộc ngoài bằng bản giả để test được mà không cần bot Viber thật / HTTPS công khai:

| Thành phần | Thật | Giả khi chạy local |
|---|---|---|
| Router + service + repo Viber | ✅ chạy thật | |
| DB | ✅ Supabase local (`supabase_db_linkedin_group_crawler`) | |
| Viber REST Bot API | | `mock_viber.py` (127.0.0.1:8900) |
| Supabase Storage (local không bật) | | kho file trong `mock_viber.py` |
| Đăng nhập người dùng | | override `get_current_user` = 1 member thật trong DB |

Webhook do chính `walkthrough.py` ký HMAC rồi POST tới backend, mô phỏng Viber gọi về.

## Cách chạy

```bash
# 1. Supabase local phải đang chạy; áp migration Viber:
docker exec -i supabase_db_linkedin_group_crawler psql -U postgres < ../../supabase/migrations/177_viber_module.sql

# 2. Mock Viber API
python mock_viber.py            # cổng 8900

# 3. Backend Viber thật (cửa sổ khác)
PYTHONPATH="<repo>/linkedin_group_crawler" python -m uvicorn viber_local_app:app --port 8099

# 4. Driver kịch bản (24 testcase)
python walkthrough.py
```

Kết quả mong đợi: `24/24 PASS`. Xem danh sách testcase + ý nghĩa trong
`docs/VIBER_CHAT_WALKTHROUGH.md`.
