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
            captured.append({
                "url": response.url,
                "method": response.request.method,
                "status": response.status,
                "body": body,
            })

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

    browser.close()

print("=== Requests toi quotes-email-provider ===")
for c in captured:
    print(f"URL: {c['url']}")
    print(f"Method: {c['method']}")
    print(f"Status: {c['status']}")
    print(f"Body: {c['body']}")
    print("---")

if not captured:
    print("KHONG bat duoc request nao toi quotes-email-provider - co the frontend chua goi, hoac URL khac.")
