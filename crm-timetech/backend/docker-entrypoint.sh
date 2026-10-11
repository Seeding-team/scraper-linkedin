#!/bin/sh
# Named volume Docker mặc định tạo với quyền root khi lần đầu được mount —
# app chạy bằng user "appuser" (không phải root) nên ghi file cookie vào
# /app/artifacts sẽ crash PermissionError cho tới khi chown đúng quyền
# (bug thật đã gặp trên app gốc, xem docs/ZALO_CHAT_FEATURE_EXTRACTION_GUIDE.md
# mục 6.2) — chown ngay mỗi lần container khởi động để không phải nhớ làm tay.
set -e

mkdir -p /app/artifacts/zca-auth /app/artifacts/debug
chown -R appuser:appuser /app/artifacts /app/data 2>/dev/null || true

exec su -s /bin/sh appuser -c "exec $*"
