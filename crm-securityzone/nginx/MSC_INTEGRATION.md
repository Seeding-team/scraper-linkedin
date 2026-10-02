# Cấu hình MSC (Mua Sắm Công) trong nginx của crm-securityzone

**Chỉ `crm-securityzone` có phần này.** CRM chính, `crm-module`, `crm-cloudgate` KHÔNG có.

## Để làm gì
Cho `https://crm.securityzone.vn/msc/...` và `https://crm.securityzone.vn/msc-dev/...` hiện giao diện của MSC
(menu "Quản lý CRM" trong MSC dùng dữ liệu và quyền của CRM này). Router chỉ **chuyển tiếp** sang 2 máy MSC:

| Đường dẫn | Máy MSC |
|---|---|
| `/msc/...`, `/assets/...` | `10.30.195.28:3000` (MSC chính) |
| `/msc-dev/...`, `/assets-dev/...` | `10.30.195.29:3000` (MSC dev) |

Đường dẫn CRM gốc (`/all-platform/...`, `/api/...`, trang chủ) **không bị đụng**.

## Khi port code / sửa file này — ĐỌC
- **KHÔNG copy đè `nginx/nginx.conf` từ `crm-module`/`crm-cloudgate`/main sang `crm-securityzone`.**
  Nếu lỡ đè: thêm lại 2 khối được đánh dấu `===== MSC (Mua Sắm Công) =====` trong `nginx.conf`
  (khối `upstream` trong `http { }` và các `location` trước `location / {`).
- Port frontend/backend như thường, không ảnh hưởng phần này.
- Muốn đổi IP/cổng máy MSC: sửa 2 dòng `upstream`.
- Hai danh sách trang `/msc/...` và `/msc-dev/...` khớp với danh sách trang của MSC (repo mua-sam-cong,
  `FRONTEND-WEB/src/crm/routes.ts`). MSC thêm trang CRM mới thì danh sách này phải thêm theo (bên MSC sẽ báo).

## Kiểm tra sau khi sửa
```bash
docker run --rm --add-host=backend:127.0.0.1 --add-host=frontend:127.0.0.1 \
  -v "$PWD/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t
```
Rồi `docker compose up -d --force-recreate router`.
