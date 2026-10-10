# Viber Chat — Walkthrough & kết quả test (2026-10-07)

Tài liệu này mô tả cách bản Viber Chat (Viber Bot API) được test và chạy thử end-to-end ở local,
kèm kết quả. Để setup/deploy thật xem `docs/VIBER_CHAT_SETUP.md`.

## 1. Các lớp test

| Lớp | File | Chạy | Số case |
|---|---|---|---|
| Unit (service + API giả) | `linkedin_group_crawler/tests/test_viber_service.py` | `pytest` | 6 |
| Edge case (webhook/biên/RBAC) | `linkedin_group_crawler/tests/test_viber_extra.py` | `pytest` | 14 |
| Migration trên Postgres thật | `supabase/migrations/177_viber_module.sql` | chạy 2 lần + cascade | ✔ |
| Repo layer trên Supabase thật | (thủ công) | PostgREST local | ✔ |
| **E2E backend thật + HTTP** | `tests/viber_local/` | `walkthrough.py` | **24** |

`pytest tests/test_viber_service.py tests/test_viber_extra.py` → **20 passed**.

## 2. Luồng hoạt động (bản Bot)

```
Khách Viber ──nhắn──▶ Viber Cloud ──webhook (HMAC)──▶ /api/all-platform/viber/webhook/{account_id}
                                                              │ xác thực chữ ký, ghi DB, tải+rehost media
                                                              ▼
Nhân viên ◀── SSE realtime ──  backend  ◀── GET dialogs/messages ── Trang Viber Chat
Nhân viên ──gửi trả lời──▶ POST messages/send(-media) ──▶ Viber REST ──▶ Khách nhận trên Viber
```

Điểm quan trọng: webhook trả **200 ngay**, phần tải media + ghi DB chạy **nền** (Viber sẽ retry nếu
chậm). Vì vậy test E2E dùng *polling* chứ không sleep cố định.

## 3. Kết quả E2E (24/24 PASS)

Chạy `tests/viber_local/walkthrough.py` với backend thật + Supabase local + mock Viber:

```
[PASS] TC01 GET /accounts ban đầu rỗng
[PASS] TC02 POST connect -> connected            (bot=Markee CSKH uri=markeecskh)
[PASS] TC03 connect KHÔNG lộ auth_token
[PASS] TC04 webhook đã đăng ký với Viber          (.../viber/webhook/{account_id})
[PASS] TC05 connect lại cùng bot -> không tạo trùng
[PASS] TC06 webhook tin đến (chữ ký đúng) -> 200
[PASS] TC07 webhook sai chữ ký -> 401
[PASS] TC08 GET dialogs hiện khách + unread
[PASS] TC09 GET messages trả tin đến
[PASS] TC10 mở hội thoại -> unread về 0
[PASS] TC11 tin ảnh đến -> media rehost về storage
[PASS] TC12 ảnh rehost tải lại được
[PASS] TC13 POST send text -> gửi 1 tin outgoing
[PASS] TC14 mock Viber nhận đúng receiver + sender
[PASS] TC15 text 7001 ký tự -> chia 2 tin
[PASS] TC16 send-media ảnh nhỏ -> type picture + caption
[PASS] TC17 send-media PDF -> type file
[PASS] TC18 send-media > 50MB -> 400
[PASS] TC19 trạng thái seen giữ nguyên dù delivered tới sau (atomic, không race)
[PASS] TC20 SSE đẩy event khi có tin mới
[PASS] TC21 reconnect -> đăng ký lại webhook
[PASS] TC22 DELETE account -> 200
[PASS] TC23 gỡ webhook khỏi Viber (set url rỗng)
[PASS] TC24 account đã biến mất

===== KẾT QUẢ: 24/24 PASS, 0 FAIL =====  (ổn định qua 3 lần chạy)
```

### Nhóm testcase

- **Kết nối (TC01–05, 21–24):** kết nối bot bằng token, tự đăng ký webhook, giấu `auth_token` khỏi API,
  chống tạo trùng khi kết nối lại cùng bot, reconnect, gỡ (xoá account + xoá webhook).
- **Nhận tin / bảo mật webhook (TC06–08, 11–12):** đúng chữ ký HMAC mới nhận (sai → 401), tạo hội thoại +
  đếm chưa đọc, tải media Viber host rồi rehost về Storage (link Viber hết hạn sau một lúc).
- **Đọc & đánh dấu đã đọc (TC09–10):** trả tin, mở hội thoại thì unread về 0.
- **Gửi tin (TC13–18):** gửi text (đúng sender/receiver), chia tin > 7000 ký tự, gửi ảnh kèm caption,
  tệp lớn tự chuyển "file", chặn > 50MB.
- **Trạng thái & realtime (TC19–20):** đã nhận/đã xem không bị hạ cấp; SSE đẩy tin mới xuống client ngay.

## 4. Bug phát hiện & đã sửa trong lúc test

**Race condition ở cập nhật trạng thái tin gửi đi.** Viber bắn `delivered` và `seen` gần như đồng thời;
mỗi webhook xử lý ở 1 task nền song song. Code cũ (`update_message_status`) đọc trạng thái rồi mới ghi
(read-modify-write) nên 2 task cùng đọc `sent` rồi ghi đè nhau → có lúc `seen` bị `delivered` (tới sau)
ghi đè ngược. Đã sửa thành **1 câu UPDATE có điều kiện** `... WHERE status IN (<các trạng thái thấp hơn>)`,
nguyên tử ở cấp dòng — thứ tự nào thì kết quả cuối vẫn là trạng thái cao nhất. (TC19 bắt đúng bug này.)

## 5. Giới hạn của lần chạy local

- Supabase local không bật service **Storage** → harness thay `upload_media` bằng kho file trong mock.
  Production dùng Supabase Storage thật (code upload y hệt, đã có unit test riêng cho nhánh media).
- Chưa test với **bot Viber thật** (chưa có token) và webhook HTTPS công khai thật — cần làm khi deploy.
