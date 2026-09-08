import sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
captured = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()

    def on_response(response):
        if "quotes-email-provider" in response.url:
            try:
                body = response.text()
            except Exception as e:
                body = f"<could not read body: {e}>"
            captured.append({"url": response.url, "method": response.request.method, "status": response.status, "body": body})

    page.on("response", on_response)

    page.goto(f"{BASE}/auth/login", wait_until="networkidle", timeout=30000)
    page.locator("text=Đăng nhập bằng mật khẩu").first.click()
    time.sleep(0.5)
    page.locator("input[type='email'], input[name='email']").first.fill("admin@gmail.com")
    page.locator("input[type='password']").first.fill("Admin@123456")
    page.locator("button[type='submit']").first.click()
    page.wait_for_load_state("networkidle", timeout=20000)
    time.sleep(1.5)

    page.goto(f"{BASE}/all-platform/profile?tab=quote-email", wait_until="networkidle", timeout=30000)
    time.sleep(2)

    # Chup lai TOAN BO text banner (.text-primary-container hoac tuong tu) tren trang neu co
    banners = page.locator("text=/Lỗi máy chủ/i")
    print(f"So banner 'Loi may chu' thay tren trang (chi GET, chua bam nut nao): {banners.count()}")
    for i in range(banners.count()):
        print(f"  banner {i}: {banners.nth(i).inner_text()}")

    print()
    print("=== Click 'Kiểm tra IMAP' (khong nhap App Password moi - dung credential da luu) ===")
    imap_btn = page.locator("button:has-text('Kiểm tra IMAP')").first
    if imap_btn.count() > 0:
        imap_btn.click()
        time.sleep(2)
        banners2 = page.locator("text=/Lỗi máy chủ/i")
        print(f"So banner sau khi bam Kiem tra IMAP: {banners2.count()}")
        for i in range(banners2.count()):
            print(f"  banner {i}: {banners2.nth(i).inner_text()}")
        real_msg = page.locator("text=/giải mã/i")
        print(f"So banner co dung message that (chua 'giai ma'): {real_msg.count()}")
        for i in range(real_msg.count()):
            print(f"  real banner {i}: {real_msg.nth(i).inner_text()}")

    browser.close()

print()
print("=== TOAN BO request/response toi quotes-email-provider ===")
for c in captured:
    print(f"{c['method']} {c['url']} -> {c['status']}")
    print(f"  body: {c['body'][:600]}")
    print("---")
