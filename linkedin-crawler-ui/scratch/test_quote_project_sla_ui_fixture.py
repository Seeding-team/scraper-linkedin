"""Checkpoint B - kiem tra DOM/fixture (Playwright route interception, KHONG
mutation DB that) cho cascade Khach hang -> Du an -> Co hoi CRM va SLA trong
QuoteWorkspaceModal.tsx. Moi endpoint GET/POST/PUT lien quan deu bi chan lai
bang route interception truoc khi roi trinh duyet - khong co byte nao that
toi backend/DB cho phan tao/sua bao gia trong test nay (chi login la that,
dung tai khoan test co san giong cac fixture test khac trong repo).

Chay: python scratch/test_quote_project_sla_ui_fixture.py
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


# ── Fixture data ─────────────────────────────────────────────────────────────
CUSTOMERS = {"items": [
    {"id": "cust-A", "customer_name": "Công ty Alpha", "company_name": "Alpha JSC"},
    {"id": "cust-B", "customer_name": "Công ty Beta", "company_name": None},
]}

DEALS = {"items": [
    {"id": "deal-1", "customer_id": "cust-A", "project_id": "proj-1", "customer_name": "Công ty Alpha",
     "company_name": "Alpha JSC", "deal_stage": "negotiation", "created_at": "2026-08-01T00:00:00Z", "updated_at": "2026-08-01T00:00:00Z"},
    {"id": "deal-2", "customer_id": "cust-B", "project_id": None, "customer_name": "Công ty Beta",
     "company_name": None, "deal_stage": "negotiation", "created_at": "2026-08-01T00:00:00Z", "updated_at": "2026-08-01T00:00:00Z"},
]}

PROJECTS_BY_CUSTOMER = {
    "cust-A": [
        {"id": "proj-1", "projectCode": "DA-001", "name": "Website Alpha", "customerId": "cust-A", "status": "active"},
        {"id": "proj-2", "projectCode": "DA-002", "name": "App Alpha", "customerId": "cust-A", "status": "planning"},
    ],
    "cust-B": [
        {"id": "proj-3", "projectCode": "DA-003", "name": "App Beta", "customerId": "cust-B", "status": "active"},
    ],
}

FORMS = [{"id": "form-1", "name": "Mẫu mặc định", "status": "active"}]
PRESALE_USERS = [{"id": "u-presale-1", "name": "Presale Nam", "role": "member", "quote_business_role": "presale"}]
SALE_USERS = [{"id": "u-sale-1", "name": "Sale Lan", "role": "member", "quote_business_role": "sale"}]

created_payloads = []


def ok_json(data):
    return json.dumps({"success": True, "data": data})


def install_fixtures(page):
    page.route(re.compile(r".*/api/all-platform/crm/customers.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "data": CUSTOMERS})))
    page.route(re.compile(r".*/api/all-platform/customer-leads.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "data": DEALS})))

    def handle_projects(route):
        url = route.request.url
        m = re.search(r"customer_id=([^&]+)", url)
        cust_id = m.group(1) if m else None
        rows = PROJECTS_BY_CUSTOMER.get(cust_id, [])
        route.fulfill(status=200, content_type="application/json", body=ok_json(rows))
    page.route(re.compile(r".*/api/all-platform/projects(\?.*)?$"), handle_projects)

    page.route(re.compile(r".*/api/all-platform/quote-forms\?status=active$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(FORMS)))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role\?role=presale$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(PRESALE_USERS)))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role\?role=sale$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(SALE_USERS)))
    # Danh sach bao gia cua trang (KPI/bang) - rong la du, khong lien quan test nay.
    page.route(re.compile(r".*/api/all-platform/quotes$"), lambda r: (
        created_payloads.append(json.loads(r.request.post_data or "{}")) if r.request.method == "POST" else None,
        r.fulfill(status=200, content_type="application/json", body=ok_json(
            {
                "id": "quote-created-1", "quoteNumber": "202609070099", "status": "draft",
                "processingStage": "request", "dealId": (created_payloads[-1] or {}).get("deal_id") if created_payloads else None,
                "projectId": (created_payloads[-1] or {}).get("project_id") if created_payloads else None,
                "slaDueAt": (created_payloads[-1] or {}).get("sla_due_at") if created_payloads else None,
                "versionNumber": 1, "data": {"quoteTitle": "Yêu cầu hỗ trợ báo giá"},
            }
        ) if r.request.method == "POST" else ok_json([])),
    )[-1])

    def handle_quote_detail(route):
        # GET /quotes/quote-created-1 (goi lai SAU KHI tao - mo phong "reload").
        payload = created_payloads[-1] if created_payloads else {}
        route.fulfill(status=200, content_type="application/json", body=ok_json({
            "id": "quote-created-1", "quoteNumber": "202609070099", "status": "draft",
            "processingStage": "request", "dealId": payload.get("deal_id"),
            "projectId": payload.get("project_id"), "slaDueAt": payload.get("sla_due_at"),
            "versionNumber": 1, "quoteOwnerId": None, "technicalOwnerId": None,
            "data": {"quoteTitle": "Yêu cầu hỗ trợ báo giá"},
        }))
    page.route(re.compile(r".*/api/all-platform/quotes/quote-created-1$"), handle_quote_detail)
    page.route(re.compile(r".*/api/all-platform/quotes/quote-created-1/activity-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/quote-created-1/handoff-checklist$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/quotes/service-catalog-options.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"products": [], "packages": []})))
    page.route(re.compile(r".*/api/all-platform/quotes/issuer-companies.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quote-approval-rules/active$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))


def trigger_for(page, label):
    return page.locator(
        f"xpath=//div[span[normalize-space(text())='{label}']]//button[contains(@class,'crm-searchable-select-trigger')]"
    ).first


def select_option(page, label, option_text):
    trigger_for(page, label).click()
    time.sleep(0.25)
    page.locator(f"button.crm-searchable-select-option:has-text('{option_text}')").first.click()
    time.sleep(0.25)


def trigger_text(page, label):
    return trigger_for(page, label).locator("span").first.inner_text()


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_fixtures(page)

    projects_requests = []
    page.on("request", lambda req: projects_requests.append(req.url) if "/api/all-platform/projects" in req.url else None)

    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    page.locator("button:has-text('Yêu cầu hỗ trợ báo giá')").first.click()
    time.sleep(1)

    # ── 1) Chua chon gi -> nut "Gửi yêu cầu xử lý" bi disable (chua co SLA) ──
    send_btn = page.locator("button:has-text('Gửi yêu cầu xử lý')").first
    record("Chua co SLA: nut 'Gửi yêu cầu xử lý' bi disable", send_btn.is_disabled())

    # ── 2) Chon Khach hang A -> chi load Du an cua khach hang A ─────────────
    select_option(page, "Khách hàng", "Công ty Alpha")
    time.sleep(0.6)
    record("Chon Khach hang A: co goi GET /projects?customer_id=cust-A",
           any("customer_id=cust-A" in u for u in projects_requests))
    trigger_for(page, "Dự án").click()
    time.sleep(0.3)
    menu_text = page.locator(".crm-searchable-select-menu").inner_text()
    page.keyboard.press("Escape")
    time.sleep(0.2)
    record("Du an cua khach hang A: co DA-001/DA-002, KHONG co DA-003 (dung khach hang)",
           "DA-001" in menu_text and "DA-002" in menu_text and "DA-003" not in menu_text)

    # ── 3) Chon Co hoi deal-1 (co project_id=proj-1) -> Du an tu dien dung ──
    select_option(page, "Cơ hội CRM", "Công ty Alpha")
    time.sleep(0.5)
    record("Chon Co hoi co project_id -> Du an tu dien dung 'DA-001'",
           "DA-001" in trigger_text(page, "Dự án"))

    # ── 4) Doi Khach hang sang B -> reset Co hoi + Du an, load lai Du an B ──
    projects_requests.clear()
    select_option(page, "Khách hàng", "Công ty Beta")
    time.sleep(0.6)
    record("Doi Khach hang: Co hoi CRM bi reset ve placeholder",
           trigger_text(page, "Cơ hội CRM") == "Chọn cơ hội...")
    record("Doi Khach hang: Du an bi reset ve 'Chưa thuộc dự án'",
           trigger_text(page, "Dự án") == "Chưa thuộc dự án")
    record("Doi Khach hang: co goi lai GET /projects?customer_id=cust-B",
           any("customer_id=cust-B" in u for u in projects_requests))

    # ── 5) Quay lai Khach hang A + Co hoi A, roi CHU DONG bo chon Du an ─────
    select_option(page, "Khách hàng", "Công ty Alpha")
    time.sleep(0.4)
    select_option(page, "Cơ hội CRM", "Công ty Alpha")
    time.sleep(0.4)
    record("Truoc khi bo chon: Du an dang la DA-001 (tu dong dien)",
           "DA-001" in trigger_text(page, "Dự án"))
    select_option(page, "Dự án", "Chưa thuộc dự án")
    time.sleep(0.3)
    record("Sau khi bo chon: Du an hien 'Chưa thuộc dự án'",
           trigger_text(page, "Dự án") == "Chưa thuộc dự án")

    # ── 6) Dien SLA tuong lai -> nut duoc bat ────────────────────────────────
    from datetime import datetime, timedelta
    future = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M")
    sla_input = page.locator("input[type='datetime-local']").first
    sla_input.fill(future)
    time.sleep(0.3)
    record("Co SLA tuong lai: nut 'Gửi yêu cầu xử lý' duoc bat", not send_btn.is_disabled())

    # ── 7) SLA qua khu -> validation ro rang khi bam gui (window.alert) ─────
    past = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
    sla_input.fill(past)
    time.sleep(0.3)
    # Dien du dieu kien khac de chac chan validation dung la ve SLA (khong
    # phai bi chan som hon boi thieu content/nguoi phu trach).
    page.locator("textarea").first.fill("Mo ta scope test fixture.")
    select_option(page, "Người phụ trách kỹ thuật", "Presale Nam")
    dialog_messages = []
    page.on("dialog", lambda d: (dialog_messages.append(d.message), d.accept()))
    page.locator("button:has-text('Gửi yêu cầu xử lý')").first.click()
    time.sleep(0.5)
    record("SLA qua khu: co alert ro rang 'phải là thời điểm trong tương lai'",
           any("tương lai" in m for m in dialog_messages))

    # ── 8) Luu nhap (chi can dealId) voi Du an da bo chon -> payload gui
    # projectId=null RO RANG (khong phai "khong gui gi") ─────────────────────
    sla_input.fill(future)
    time.sleep(0.2)
    page.locator("button:has-text('Lưu nháp')").first.click()
    time.sleep(1)
    record("Da goi POST tao bao gia dung 1 lan", len(created_payloads) == 1)
    if created_payloads:
        payload = created_payloads[0]
        record("Payload tao bao gia: co key 'project_id' VA gia tri la null (bo gan RO RANG)",
               "project_id" in payload and payload["project_id"] is None)

    # ── 9) "Reload" (workspace tu GET lai quote vua tao) van hien dung
    # 'Chưa thuộc dự án' - khong bi "hoi phuc" nham Du an cu ──────────────────
    time.sleep(1)
    body_text = page.locator(".qc-workspace").inner_text()
    record("Sau khi 'tao xong + tu reload': van hien 'Chưa thuộc dự án' (khong hien du an cu)",
           "Chưa thuộc dự án" in body_text)

    # ── 10) Khong bao gio render literal 'undefined' o bat ky dau trong modal ──
    full_text = page.locator(".qc-workspace").inner_text()
    record("Khong co literal 'undefined' nao render trong workspace", "undefined" not in full_text)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
