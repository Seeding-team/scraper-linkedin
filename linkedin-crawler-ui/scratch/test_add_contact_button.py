"""Kiem tra nhanh (fixture, KHONG mutation DB that): nut 'Lưu' trong modal
'Thêm Contact' o Ho so khach hang co THAT SU bam duoc va goi dung POST
/contacts hay khong (user bao cao 'thêm contact k bấm dc').

Chay: python scratch/test_add_contact_button.py
"""
import sys, io, time, json, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


def login(page):
    page.goto(f"{BASE}/auth/login", wait_until="networkidle", timeout=30000)
    page.locator("text=Đăng nhập bằng mật khẩu").first.click()
    time.sleep(0.5)
    page.locator("input[type='email'], input[name='email']").first.fill("admin@gmail.com")
    page.locator("input[type='password']").first.fill("Admin@123456")
    page.locator("button[type='submit']").first.click()
    page.wait_for_load_state("networkidle", timeout=20000)
    time.sleep(1.5)


def ok_json(data):
    return json.dumps({"success": True, "data": data})


CUSTOMER_ID = "cust-fixture-1"
RELATED_FIXTURE = {
    "customer": {"id": CUSTOMER_ID, "customer_name": "Đăng Việt", "company_name": "Công ty Đăng Việt", "status": "following"},
    "deals": [], "quotes": [], "contracts": [],
    "kpi": {"deal_count": 0, "quote_count": 0, "contract_count": 0, "total_value": 0},
}

post_calls = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    page.on("console", lambda msg: print("CONSOLE:", msg.type, msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: print("PAGEERROR:", exc))
    login(page)
    page.route(re.compile(r".*/api/all-platform/(?!auth/).*"), lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(rf".*/api/all-platform/crm/customers/{CUSTOMER_ID}/related$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(RELATED_FIXTURE)))

    def handle_contacts(route):
        if route.request.method == "POST":
            post_calls.append(json.loads(route.request.post_data or "{}"))
            route.fulfill(status=200, content_type="application/json", body=ok_json({"id": "contact-new-1", "customer_id": CUSTOMER_ID, "name": "Nguyễn Test"}))
        else:
            route.fulfill(status=200, content_type="application/json", body=ok_json([]))
    page.route(re.compile(rf".*/api/all-platform/crm/customers/{CUSTOMER_ID}/contacts$"), handle_contacts)
    page.route(re.compile(rf".*/api/all-platform/crm/customers/{CUSTOMER_ID}/projects-summary$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"projectCount": 0, "activeProjectCount": 0, "opportunityCount": 0, "quoteCaseCount": 0, "currentQuoteValue": 0, "projects": []})))

    page.goto(f"{BASE}/all-platform/crm/customers/{CUSTOMER_ID}", wait_until="networkidle", timeout=30000)
    time.sleep(1.2)
    page.locator("button:has-text('Thêm Contact')").click()
    time.sleep(0.5)
    record("1) Modal 'Thêm Contact' mo dung", page.locator(".crm-modal-title:has-text('Thêm Contact')").count() == 1)
    page.locator(".crm-modal input").first.fill("Nguyễn Test")
    save_btn = page.locator("button.crm-save-button:has-text('Lưu')")
    record("2) Nut 'Lưu' KHONG bi disable khi da nhap Ho ten", save_btn.is_enabled())
    save_btn.click()
    time.sleep(0.8)
    record("3) Bam 'Lưu' THAT SU goi POST /contacts (khong phai chi navigate/khong lam gi)", len(post_calls) == 1, post_calls)
    if post_calls:
        record("4) Payload gui dung ten da nhap", post_calls[0].get("name") == "Nguyễn Test", post_calls[0])
    record("5) Modal tu dong dong sau khi luu thanh cong", page.locator(".crm-modal-title:has-text('Thêm Contact')").count() == 0)
    browser.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)
