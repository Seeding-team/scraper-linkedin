"""Block 3 (request phase) - kiem tra THAT (Playwright route interception,
KHONG mutation DB that): o stage 'request', workspace KHONG duoc hien
checklist "Bàn giao kỹ thuật" (chua toi luot Presale) - phai hien card
"Chuẩn bị gửi Presale" voi trang thai Có/Chưa dung theo du lieu that va nut
"Bổ sung" nhay toi dung khu vuc.

Chay: python scratch/test_quote_request_readiness_card.py
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


CUSTOMERS = {"items": [{"id": "cust-A", "customer_name": "Công ty Alpha", "company_name": "Alpha JSC"}]}
DEALS = {"items": [{"id": "deal-1", "customer_id": "cust-A", "project_id": "proj-1", "customer_name": "Công ty Alpha",
                    "company_name": "Alpha JSC", "deal_stage": "negotiation", "created_at": "2026-08-01T00:00:00Z", "updated_at": "2026-08-01T00:00:00Z"}]}
PROJECTS = [{"id": "proj-1", "projectCode": "DA-001", "name": "Website Alpha", "customerId": "cust-A", "status": "active"}]
FORMS = [{"id": "form-1", "name": "Mẫu mặc định", "status": "active"}]
PRESALE_USERS = [{"id": "u-presale-1", "name": "Presale Nam", "role": "member", "quote_business_role": "presale"}]
SALE_USERS = [{"id": "u-sale-1", "name": "Sale Lan", "role": "member", "quote_business_role": "sale"}]


def install_fixtures(page):
    page.route(re.compile(r".*/api/all-platform/crm/customers.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(CUSTOMERS)))
    page.route(re.compile(r".*/api/all-platform/customer-leads.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(DEALS)))
    page.route(re.compile(r".*/api/all-platform/projects(\?.*)?$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(PROJECTS)))
    page.route(re.compile(r".*/api/all-platform/quote-forms\?status=active$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(FORMS)))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role\?role=presale$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(PRESALE_USERS)))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role\?role=sale$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(SALE_USERS)))
    page.route(re.compile(r".*/api/all-platform/quotes/by-phase.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": [], "counts": {}, "total": 0})))
    page.route(re.compile(r".*/api/all-platform/quotes$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quote-approval-rules/active$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/teams$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/contracts$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/categories.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/customer-leads/sdrs$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))


def trigger_for(page, label):
    return page.locator(
        f"xpath=//div[span[normalize-space(text())='{label}']]//button[contains(@class,'crm-searchable-select-trigger')]"
    ).first


def select_option(page, label, option_text):
    trigger_for(page, label).click()
    time.sleep(0.25)
    page.locator(f"button.crm-searchable-select-option:has-text('{option_text}')").first.click()
    time.sleep(0.25)


def readiness_item_text(page, label):
    return page.locator(f".qc-readiness-item:has-text('{label}')").inner_text()


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_fixtures(page)

    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    page.locator("button:has-text('Yêu cầu hỗ trợ báo giá')").first.click()
    time.sleep(1)

    record("1) Stage 'request' KHONG hien checklist 'Bàn giao kỹ thuật'",
           page.locator("h3:has-text('Bàn giao kỹ thuật')").count() == 0)
    record("2) Stage 'request' CO hien card 'Chuẩn bị gửi Presale'",
           page.locator("h3:has-text('Chuẩn bị gửi Presale')").count() == 1)

    record("3) Ban dau: Khách hàng đã chọn = Chưa", "Chưa" in readiness_item_text(page, "Khách hàng đã chọn"))
    record("4) Ban dau: Presale đã gán = Chưa (chua chon Co hoi)", "Chưa" in readiness_item_text(page, "Presale đã gán"))
    record("5) Ban dau: Có ít nhất 1 hạng mục dự kiến = Chưa", "Chưa" in readiness_item_text(page, "Có ít nhất 1 hạng mục"))
    record("6) 'Dự án đã chọn hoặc xác nhận không có' luon = Co (optional-nhung-hop-le)",
           "Có" in readiness_item_text(page, "Dự án đã chọn hoặc xác nhận không có"))

    # Chon Khach hang + Co hoi -> cac muc lien quan chuyen sang "Co"
    select_option(page, "Khách hàng", "Công ty Alpha")
    time.sleep(0.5)
    select_option(page, "Cơ hội CRM", "Công ty Alpha")
    time.sleep(0.5)
    record("7) Sau khi chon Khach hang: 'Khách hàng đã chọn' = Có", "Có" in readiness_item_text(page, "Khách hàng đã chọn"))
    record("8) Sau khi chon Co hoi: 'Cơ hội đã chọn' = Có", "Có" in readiness_item_text(page, "Cơ hội đã chọn hoặc xác nhận không có"))

    # Bam "Bổ sung" o muc con thieu -> nhay THAT toi khu vuc lien quan (scope
    # card) - test THAT SU thu nho workspace body (thiet lap style truc tiep,
    # KHONG dung API gia lap) de bat buoc phai co scroll that xay ra, thay vi
    # chi assert scrollTop (co the =0 neu noi dung da vua khung hinh).
    page.evaluate("document.querySelector('.qc-workspace-body').style.maxHeight = '160px'")
    page.evaluate("document.querySelector('.qc-workspace-body').scrollTop = 0")
    scroll_before = page.evaluate("document.querySelector('.qc-workspace-body').scrollTop")
    page.locator(".qc-readiness-item:has-text('Có ít nhất 1 hạng mục') button:has-text('Bổ sung')").click()
    time.sleep(0.6)
    scroll_after = page.evaluate("document.querySelector('.qc-workspace-body').scrollTop")
    record("9) Bam 'Bổ sung' (Hạng mục) -> THAT SU cuon toi card lien quan (scrollTop doi)",
           scroll_after != scroll_before, f"{scroll_before} -> {scroll_after}")

    context.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
