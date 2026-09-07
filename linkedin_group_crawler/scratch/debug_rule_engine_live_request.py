import sys, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
captured = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()

    def on_response(response):
        if "quotes-email-provider" in response.url or "quote-approval-rules" in response.url:
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

    # Test 1: GET email provider settings (tab Email gui bao gia)
    page.goto(f"{BASE}/all-platform/profile?tab=quote-email", wait_until="networkidle", timeout=30000)
    time.sleep(2)

    # Test 2: mo rule card that (chi xem GET /quote-approval-rules/active -
    # KHONG bam Luu quy tac o day de tranh mutation that tren bang cau hinh
    # dung chung, chua co xac nhan rieng).
    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    page.locator("button:has-text('Yêu cầu hỗ trợ báo giá')").first.click()
    time.sleep(1.5)

    browser.close()

print("=== Requests toi quotes-email-provider / quote-approval-rules ===")
for c in captured:
    print(f"{c['method']} {c['url']} -> {c['status']}")
    print(f"  body: {c['body'][:500]}")
    print("---")
