#!/usr/bin/env bash
# =============================================================================
# Deploy AN TOÀN cho seeding.markeeai.com (Docker stack trên 10.30.50.29).
# Mục tiêu: KHÔNG để web chết lâu/chết ngang khi cập nhật.
#   - BUILD image mới TRƯỚC khi đụng container đang chạy  -> lúc build (lâu nhất,
#     ~1-2 phút) web CŨ vẫn phục vụ bình thường, KHÔNG downtime.
#   - Build LỖI  -> dừng luôn, KHÔNG đụng container đang chạy (web vẫn sống).
#   - Đổi sang bản mới chỉ mất ~2-3 giây (Next standalone khởi động nhanh) rồi
#     reload nginx ngay.
#   - Tự VERIFY sau khi đổi; nếu bản mới không lên -> TỰ ROLLBACK về bản cũ.
#
# Dùng:
#   bash deploy.sh frontend     # chỉ cập nhật giao diện (hay dùng nhất)
#   bash deploy.sh backend      # chỉ cập nhật API
#   bash deploy.sh all          # backend rồi frontend
#
# ⚠️ KHÔNG deploy trong lúc đang demo cho khách. Báo team trước khi chạy.
# =============================================================================
set -uo pipefail
cd /opt/apps/seeding_markeeai/scraper-linkedin || { echo "Sai thư mục dự án"; exit 1; }
SVC="${1:-frontend}"
ROUTER=seeding-router

verify() { # $1=path  $2=nhãn ; coi 200 hoặc 401 (cần auth) là "sống"
  local code
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://localhost:8080$1" 2>/dev/null || echo 000)
  echo "    verify $2 -> HTTP $code"
  [ "$code" = "200" ] || [ "$code" = "401" ]
}

deploy_one() { # $1=service  $2=path verify
  local svc="$1" check="$2" img="seeding-app-$1:latest"
  echo "==> [$svc] Đánh dấu bản rollback + BUILD bản mới (web cũ vẫn chạy)..."
  docker tag "$img" "seeding-app-$svc:rollback" 2>/dev/null || true
  if ! docker compose build "$svc"; then
    echo "!! [$svc] BUILD LỖI — KHÔNG đụng container đang chạy, web vẫn sống. Dừng."
    return 1
  fi
  echo "==> [$svc] Đổi sang container mới (~vài giây) + reload router..."
  docker compose up -d --no-deps "$svc"
  docker exec "$ROUTER" nginx -s reload 2>/dev/null || true
  local ok=0 i
  for i in $(seq 1 30); do
    if verify "$check" "$svc"; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != "1" ]; then
    echo "!! [$svc] Bản mới KHÔNG lên — ROLLBACK về bản cũ..."
    docker tag "seeding-app-$svc:rollback" "$img"
    docker compose up -d --no-deps "$svc"
    docker exec "$ROUTER" nginx -s reload 2>/dev/null || true
    verify "$check" "$svc(rollback)"
    return 1
  fi
  echo "==> [$svc] ✅ OK."
}

case "$SVC" in
  frontend) deploy_one frontend /all-platform/inbox ;;
  backend)  deploy_one backend  /api/all-platform/fb/sessions ;;
  all)      deploy_one backend /api/all-platform/fb/sessions && deploy_one frontend /all-platform/inbox ;;
  *) echo "Dùng: bash deploy.sh [frontend|backend|all]"; exit 1 ;;
esac
echo "HOÀN TẤT $SVC."
