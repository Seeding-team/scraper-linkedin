# Deploy Messenger bridge lên production — từng bước (cho người làm lần đầu)

Tài liệu đi kèm: `docs/MESSENGER_BRIDGE_HANDOFF_2026-11-12.md` (kiến trúc, những gì đã kiểm chứng).

> Không ghi IP, mật khẩu, khoá vào file này hay bất kỳ file nào trong repo. Trong tài liệu dùng chỗ trống:
> `<IP_APP>`, `<USER_APP>` (host APP/production), `<IP_DB>` (host DB production), `<UID_CLONE>` (UID Facebook nick clone).
> Lấy giá trị thật từ trưởng nhóm / sổ thông tin truy cập.

## Bức tranh tổng thể (đọc 1 phút)

```
Máy bạn (Windows)                GitHub                       Host APP (production)
  git push nhánh  ───────────►  PR → merge vào main  ───────►  runner tự chạy "Deploy App (Production)":
                                                               pull code, build frontend+backend,
                                                               áp migration (có 230), khởi động lại
                                                               ── tới đây bridge CHƯA chạy, app như cũ ──
  ssh vào host APP  ─────────────────────────────────────────►  (bạn làm tay) đặt khoá, build + chạy bridge,
                                                               khởi động lại backend, kiểm tra, thêm nick clone
```

- Merge vào `main` = **tự động deploy production** (workflow chạy khi có push lên `main`).
- Workflow **không** build/chạy bridge. Bridge chỉ chạy khi bạn làm Phần 5–7 bằng tay. Chưa có khoá thì backend giữ
  hành vi cũ → Phần 1–2 an toàn.
- **Không bật bridge trên host Dev**: DB Dev được chép đè từ DB production mỗi lần deploy Dev, nên bridge Dev sẽ đăng
  nhập trùng các nick thật của production → Facebook đá phiên của cả hai. Đừng đặt `MESSENGER_BRIDGE_KEY` trên host Dev.

## Phần 0 — Chuẩn bị

1. Bạn cần: IP + user + mật khẩu SSH host APP; IP + mật khẩu DB production (user `postgres.seeding`); quyền merge PR
   trên GitHub repo `Seeding-team/scraper-linkedin`; 1 nick Facebook **clone** để thử (không dùng nick thật của nhân viên).
2. Trên Windows mở **PowerShell** (bấm Start, gõ `PowerShell`). Lệnh `ssh` và `git` có sẵn.
3. IP host dạng `10.x.x.x` là IP mạng nội bộ: nếu `ssh` báo *timed out* thì bạn đang ở ngoài mạng nội bộ → bật VPN /
   vào mạng công ty (hỏi trưởng nhóm).

## Phần 1 — Đưa code lên GitHub và merge (trên máy bạn)

```powershell
cd "D:\scraper-linkedin\.claude\worktrees\pull-latest-code-task-ab1b0f"
git status            # chỉ được còn dòng "?? .agy-tasks/" (không commit thư mục này)
git push -u origin claude/messenger-feature-testing-b43be2
```

Mở `https://github.com/Seeding-team/scraper-linkedin` → nút **Compare & pull request** → base: `main`,
compare: `claude/messenger-feature-testing-b43be2` → **Create pull request**. Kiểm tra tab *Files changed* chỉ gồm phần
Messenger (2 commit). Đợi check `pr-check` xanh → **Merge pull request**.

## Phần 2 — Theo dõi deploy tự động

1. GitHub → tab **Actions** → workflow **Deploy App (Production)** vừa chạy. Bấm vào để xem log từng bước.
2. Đợi tất cả bước có dấu ✓ xanh (thường 10–20 phút vì build backend lớn). Bước "Ap dung migration database"
   cũng áp luôn migration 230.
3. Mở `https://seeding.markeeai.com`, đăng nhập, vào **Hộp thư Messenger** — trang phải mở bình thường như trước.
4. Nếu job đỏ: đọc bước bị đỏ; lỗi hay gặp là hết dung lượng đĩa ("No space left on device") → báo trưởng nhóm. App vẫn
   chạy bản cũ khi job hỏng giữa chừng ở bước build.

## Phần 3 — SSH vào host APP

```powershell
ssh <USER_APP>@<IP_APP>
```

- Lần đầu hỏi `Are you sure you want to continue connecting (yes/no)?` → gõ `yes`, Enter.
- Gõ mật khẩu khi được hỏi: **màn hình không hiện ký tự nào khi gõ, đó là bình thường** → Enter.
- Vào thư mục repo và xác nhận code mới đã về:

```bash
cd /opt/apps/seeding_markeeai/scraper-linkedin
git log -1 --oneline          # phải là commit merge PR vừa rồi (hoặc commit 'fix(messenger): ...')
docker ps --format '{{.Names}}\t{{.Status}}' | grep seeding-
```

- Nếu lệnh `docker` báo `permission denied ... docker.sock` → thêm `sudo ` vào đầu mọi lệnh `docker` bên dưới.
- Thoát SSH bất cứ lúc nào: gõ `exit`.

## Phần 4 — Kiểm tra DB (migration 230 + danh sách nick đang bật)

Vẫn trên host APP, mở psql (công cụ dòng lệnh của Postgres) qua Docker:

```bash
docker run --rm -it -v "$PWD:/repo" postgres:alpine psql "postgresql://postgres.seeding@<IP_DB>:5432/postgres"
```

Nhập mật khẩu DB khi được hỏi (không hiện ký tự). Dấu nhắc đổi thành `postgres=>`. Dán từng câu:

```sql
-- 1) Migration 230 đã áp chưa? Phải ra đúng 1 dòng: fb_message_id
SELECT column_name FROM information_schema.columns
WHERE table_name = 'fb_messenger_messages' AND column_name = 'fb_message_id';
```

Nếu ra `(0 rows)` → áp tay (an toàn khi chạy lại nhiều lần): `\i /repo/linkedin_group_crawler/supabase/migrations/230_fb_messenger_bridge.sql`
rồi chạy lại câu 1. Vẫn 0 dòng → **DỪNG**, không làm tiếp (đặt khoá khi chưa có cột sẽ làm mất tin).

```sql
-- 2) Những nick nào đang bật? Khi có khoá, server sẽ đăng nhập 24/7 vào TẤT CẢ các nick này.
SELECT name, fb_user_id, status, (coalesce(proxy_url, '') <> '') AS co_proxy, created_at
FROM fb_messenger_accounts WHERE is_active ORDER BY created_at;
```

Gõ `\q` để thoát psql.

**Quyết định trước khi đi tiếp:** nếu danh sách có nick thật của nhân viên (không phải nick clone), khi bật bridge
server sẽ đăng nhập các nick đó từ IP datacenter (dễ bị checkpoint, nhất là nick không có proxy), và mỗi lần chủ nick mở
Facebook trên trình duyệt thì cookie đổi → bridge báo `expired`. **Hỏi trưởng nhóm** trước. Nếu đồng ý chỉ thử với nick
clone, tạm tắt các nick khác (ghi lại danh sách ở trên để bật lại sau):

```sql
UPDATE fb_messenger_accounts SET is_active = false WHERE is_active AND fb_user_id <> '<UID_CLONE>';
```

## Phần 5 — Tạo khoá bí mật cho bridge

Khoá nằm trong `linkedin_group_crawler/.env` (file này không thuộc git, deploy không ghi đè). **Không** đặt vào file
`.env` ở gốc repo — file đó bị workflow reset mỗi lần deploy.

```bash
cd /opt/apps/seeding_markeeai/scraper-linkedin
cp linkedin_group_crawler/.env linkedin_group_crawler/.env.bak-$(date +%F)     # sao lưu trước khi sửa
sed -i '/^MESSENGER_BRIDGE_KEY=/d' linkedin_group_crawler/.env                    # xoá dòng cũ nếu có
echo "MESSENGER_BRIDGE_KEY=$(openssl rand -hex 32)" >> linkedin_group_crawler/.env  # khoá ngẫu nhiên 64 ký tự
grep -c '^MESSENGER_BRIDGE_KEY=' linkedin_group_crawler/.env                      # phải in ra: 1
```

Không cần ghi khoá ra đâu khác; backend và bridge cùng đọc từ file này. Đừng dán khoá vào chat/issue.

## Phần 6 — Build và chạy bridge

```bash
docker compose --profile messenger-bridge build messenger-bridge     # lần đầu 3–10 phút
docker compose --profile messenger-bridge up -d messenger-bridge
docker logs --tail 20 seeding-messenger-bridge
```

Log phải có dòng `"message":"messenger-bridge started"`. Nếu thấy `BRIDGE_KEY (or MESSENGER_BRIDGE_KEY) is required`
→ Phần 5 chưa đúng.

## Phần 7 — Khởi động lại backend để nhận khoá

```bash
docker compose up -d --no-deps --force-recreate backend
sleep 30
docker exec seeding-backend curl -s http://messenger-bridge:8090/health
docker exec seeding-backend curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/api/all-platform/messenger/webhook/bridge
docker logs --tail 100 seeding-backend 2>&1 | grep -i "bridge"
```

Kết quả đúng:
- health: `{"accounts":N,"ok":true}` (N = số nick đang bật ở Phần 4).
- lệnh thứ hai in `401` (webhook từ chối khi không có khoá — đúng).
- log backend có `Messenger bridge active accounts auto-reconnect finished`.

## Phần 8 — Thử thật với nick clone

1. Lấy cookie nick clone (cùng cách đã làm khi test local: chuỗi dạng `c_user=...; xs=...; datr=...`). Sau khi lấy
   cookie: **không bấm "Đăng xuất"** (đăng xuất làm cookie chết ngay), chỉ đóng cửa sổ trình duyệt (tốt nhất lấy cookie
   trong cửa sổ ẩn danh rồi đóng hẳn), và từ đó đừng mở lại Facebook bằng nick này — mở lại sẽ làm cookie đổi.
2. `https://seeding.markeeai.com` → **Hộp thư Messenger** → **Thêm nick**: điền tên, dán cookie, điền proxy dân cư VN
   cố định nếu có (`http://user:pass@ip:port`) → lưu. Nick phải hiện trạng thái đang kết nối/`connected`.
3. Trên SSH xem log bridge trực tiếp (Ctrl+C để dừng xem, bridge vẫn chạy):
   ```bash
   docker logs -f seeding-messenger-bridge 2>&1 | grep -E 'E2EE socket connected|Successfully authenticated|"level":"error"'
   ```
   Phải thấy `Successfully authenticated` và `E2EE socket connected`.
4. Dùng nick chính nhắn cho nick clone → tin hiện ngay trong Hộp thư (không cần tải lại trang).
5. Từ Hộp thư trả lời lại (có dấu tiếng Việt) → nick chính nhận được. Giữa 2 lần gửi phải cách ~3 phút (cơ chế giãn
   cách chống spam sẽ báo "Vui lòng đợi ... giây" — không phải lỗi).
6. Kiểm tra DB (mở psql như Phần 4):
   ```sql
   SELECT created_at, is_self, left(content, 40), fb_message_id IS NOT NULL AS co_id
   FROM fb_messenger_messages ORDER BY created_at DESC LIMIT 5;
   ```
   Mỗi tin 1 dòng (không trùng), `co_id` = `t`.

Xong Phần 8 là bridge đã chạy trên production.

## Vận hành hằng ngày / sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Nick báo "Cookie hết hạn" / `expired` | Chủ nick mở Facebook trên trình duyệt, hoặc Facebook thu hồi phiên | Lấy cookie mới → **Thêm nick** lại cùng nick (ghi đè) |
| Nick báo `checkpoint` | Facebook bắt xác minh (thường do IP datacenter) | Chủ nick xác minh trên điện thoại, gắn proxy dân cư, kết nối lại |
| Tin đến không hiện | Backend không nhận webhook | `docker exec seeding-messenger-bridge sh -c 'ls /data/outbox \| wc -l'` — số > 0 kéo dài nghĩa là tin đang chờ; xem `docker logs --tail 100 seeding-backend`. Tin chờ được giữ 24h và tự gửi khi backend ổn lại |
| Muốn xem bridge còn sống | | `docker ps \| grep messenger-bridge` (phải `Up ... (healthy)`) |

- Các lần deploy sau (merge vào `main`): workflow tự khởi động lại backend, khoá vẫn giữ, backend tự nối lại các nick
  vào bridge. **Bridge không tự build lại** — chỉ khi có sửa code trong `messenger-bridge/` thì chạy lại Phần 6.
- Không xoá volume `scraper-linkedin_messenger-bridge-data` (chứa cookie, thiết bị E2EE và tin đang chờ). Không chạy
  `docker volume prune` trên host này.

## Rollback (tắt bridge, quay về hành vi cũ)

```bash
cd /opt/apps/seeding_markeeai/scraper-linkedin
docker compose --profile messenger-bridge stop messenger-bridge
sed -i '/^MESSENGER_BRIDGE_KEY=/d' linkedin_group_crawler/.env
docker compose up -d --no-deps --force-recreate backend
```

Migration 230 chỉ thêm 1 cột, không cần gỡ. Nếu ở Phần 4 đã tắt nick khác, bật lại bằng
`UPDATE fb_messenger_accounts SET is_active = true WHERE fb_user_id IN ('...','...');` với danh sách đã ghi.
