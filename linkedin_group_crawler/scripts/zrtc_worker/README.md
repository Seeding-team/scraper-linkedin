# ZRTC Media Worker (Hướng A — Server-Side Native ZRTC Bridge)

Worker chạy trên máy chủ/VPS Windows (nơi cài `zcall_ia32.node` + thiết bị âm thanh ảo) và kết nối outbound tới:
`wss://seeding.markeeai.com/api/all-platform/zalo/conversations/zrtc-worker-ws`

Nhờ đó nhân viên Sale chỉ cần mở trình duyệt web `seeding.markeeai.com` (không cần cài/đăng nhập Zalo) mà vẫn thực hiện cuộc gọi thoại 2 chiều qua nick Zalo công ty.

## Biến môi trường
- `ZRTC_WORKER_WS_URL`: URL WebSocket backend (mặc định `wss://seeding.markeeai.com/api/all-platform/zalo/conversations/zrtc-worker-ws`)
- `ZRTC_WORKER_TOKEN`: Khớp `ZRTC_WORKER_TOKEN` (hoặc `JWT_SECRET_KEY`) trên backend
- `ZALO_ZCALL_DIR`: Thư mục chứa `zcall/index.js` và `zcall_ia32.node` (Windows 32-bit Electron ABI 110 + `node.dll`)
