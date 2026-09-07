"""Block 1 - kiem tra THAT (Playwright route interception, KHONG mutation DB
that) rang cac nut "Tạo cơ hội"/"Tạo báo giá" tren Ho so khach hang/Project
card THAT SU doc + ap dung query param (khong chi navigate roi bo qua), va
tab Cơ hội/Báo giá trong Ho so khach hang hien dung du lieu that.

Chay: python scratch/test_block1_cross_entity_wiring.py
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
PROJECT_A = "proj-fixture-A"
PROJECT_B = "proj-fixture-B"
DEAL_1 = "deal-fixture-1"

PROJECTS_LIST = [
    {"id": PROJECT_A, "projectCode": "DA-A", "name": "Website A", "customerId": CUSTOMER_ID, "description": None, "status": "active", "managerId": None, "teamId": None},
    {"id": PROJECT_B, "projectCode": "DA-B", "name": "App B", "customerId": CUSTOMER_ID, "description": None, "status": "active", "managerId": None, "teamId": None},
]

RELATED_FIXTURE = {
    "customer": {"id": CUSTOMER_ID, "customer_name": "Đăng Việt", "company_name": "Công ty Đăng Việt", "status": "following"},
    "deals": [
        {"id": DEAL_1, "customer_name": "Đăng Việt", "deal_stage": "negotiation", "estimated_budget": 50000000, "updated_at": "2026-09-01T00:00:00Z", "project_id": PROJECT_A},
        {"id": "deal-fixture-2", "customer_name": "Đăng Việt", "deal_stage": "new_lead", "estimated_budget": 0, "updated_at": "2026-09-01T00:00:00Z", "project_id": None},
    ],
    "quotes": [
        # 1 chuoi 2 version (V1 pricing, V2 review - MOI HON) thuoc PROJECT_A -> CHI hien 1 dong dai dien V2
        {"id": "q1v1", "quote_number": "BG-001", "status": "draft", "total_amount": 10000000, "deal_id": DEAL_1, "project_id": PROJECT_A, "version_chain_id": "chain-X", "version_number": 1, "processing_stage": "pricing"},
        {"id": "q1v2", "quote_number": "BG-001", "status": "draft", "total_amount": 12000000, "deal_id": DEAL_1, "project_id": PROJECT_A, "version_chain_id": "chain-X", "version_number": 2, "processing_stage": "review"},
        # 1 bao gia khac thuoc PROJECT_B
        {"id": "q2", "quote_number": "BG-002", "status": "approved", "total_amount": 8000000, "deal_id": None, "project_id": PROJECT_B, "version_chain_id": "chain-Y", "version_number": 1, "processing_stage": "pricing", "approved_at": "2026-09-01T00:00:00Z"},
    ],
    "contracts": [],
    "kpi": {"deal_count": 2, "quote_count": 3, "contract_count": 0, "total_value": 50000000},
}

PROJECTS_SUMMARY_FIXTURE = {
    "projectCount": 2, "activeProjectCount": 2, "opportunityCount": 2, "quoteCaseCount": 2, "currentQuoteValue": 20000000,
    "projects": [
        {**PROJECTS_LIST[0], "opportunityCount": 1, "quoteCaseCount": 1, "versionCount": 2, "processingCount": 1, "sentCount": 0, "currentQuoteValue": 12000000},
        {**PROJECTS_LIST[1], "opportunityCount": 0, "quoteCaseCount": 1, "versionCount": 1, "processingCount": 0, "sentCount": 0, "currentQuoteValue": 8000000},
    ],
}


def install_customer_profile_fixtures(page):
    # Catch-all [] cho MOI endpoint chua liet ke rieng - TRU /auth/* (AppAuthContext
    # can du lieu user THAT/role that de cac nut gate theo quyen hien dung).
    page.route(re.compile(r".*/api/all-platform/(?!auth/).*"), lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(rf".*/api/all-platform/crm/customers/{CUSTOMER_ID}/related$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(RELATED_FIXTURE)))
    page.route(re.compile(rf".*/api/all-platform/crm/customers/{CUSTOMER_ID}/contacts$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(rf".*/api/all-platform/crm/customers/{CUSTOMER_ID}/projects-summary$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(PROJECTS_SUMMARY_FIXTURE)))
    page.route(re.compile(r".*/api/all-platform/users/member-options.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": []})))


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── PART A: Ho so khach hang - header du 4 nut, Project card actions
    # THAT (chuyen tab local + filter), Bao gia tab gom version-chain, Co hoi
    # tab hien Project ──────────────────────────────────────────────────────
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_customer_profile_fixtures(page)
    page.goto(f"{BASE}/all-platform/crm/customers/{CUSTOMER_ID}", wait_until="networkidle", timeout=30000)
    time.sleep(1.2)

    header_text = page.locator(".crm-header-actions").inner_text()
    record("A1) Header co du 4 nut: Sửa khách hàng/Tạo dự án/Tạo cơ hội/Tạo báo giá",
           all(t in header_text for t in ["Sửa khách hàng", "Tạo dự án", "Tạo cơ hội", "Tạo báo giá"]), header_text)

    quote_link_href = page.locator(".crm-header-actions a:has-text('Tạo báo giá')").first.get_attribute("href")
    record("A2) Nut 'Tạo báo giá' header mang dung customerId (khong projectId)",
           quote_link_href is not None and f"customerId={CUSTOMER_ID}" in quote_link_href and "projectId" not in quote_link_href, quote_link_href)

    deal_link_href = page.locator(".crm-header-actions a:has-text('Tạo cơ hội')").first.get_attribute("href")
    record("A3) Nut 'Tạo cơ hội' header mang dung customerId", deal_link_href is not None and f"customerId={CUSTOMER_ID}" in deal_link_href, deal_link_href)

    # Project card links mang dung ca projectId LAN customerId (khong chi navigate suong)
    create_quote_href = page.locator(".crm-project-card").first.locator("a:has-text('Tạo báo giá')").get_attribute("href")
    record("A4) Project card 'Tạo báo giá' mang du projectId+customerId",
           create_quote_href is not None and f"projectId={PROJECT_A}" in create_quote_href and f"customerId={CUSTOMER_ID}" in create_quote_href, create_quote_href)
    create_deal_href = page.locator(".crm-project-card").first.locator("a:has-text('Tạo cơ hội')").get_attribute("href")
    record("A5) Project card 'Tạo cơ hội' mang du projectId+customerId",
           create_deal_href is not None and f"projectId={PROJECT_A}" in create_deal_href and f"customerId={CUSTOMER_ID}" in create_deal_href, create_deal_href)

    # "Xem báo giá" tren Project card - CHUYEN TAB THAT (khong navigate), loc dung Project
    page.locator(".crm-project-card").first.locator("button:has-text('Xem báo giá')").click()
    time.sleep(0.5)
    record("A6) Bam 'Xem báo giá' tren card -> CHUYEN sang tab Báo giá that (khong doi URL)",
           "quote-center" not in page.url and page.locator("button.crm-segment-button--active").inner_text().startswith("Báo giá"))
    filter_pill = page.locator(".crm-quote-filter-pill").inner_text()
    record("A7) Hien pill loc dung theo Project A (DA-A)", "DA-A" in filter_pill, filter_pill)

    quote_rows = page.locator(".crm-table tbody tr.crm-row")
    record("A8) Bao gia tab: chi hien 1 dong (chuoi V1+V2 gom lai, loc theo Project A)", quote_rows.count() == 1, quote_rows.count())
    row_text = quote_rows.first.inner_text()
    record("A9) Dong dai dien la BAN CURRENT (V2), hien '2 version'", "V2" in row_text and "2 version" in row_text, row_text)
    record("A10) Cot Du an/Co hoi/Phase/Presale->Sale/SLA co du du lieu (khong 'undefined')", "undefined" not in row_text and "DA-A" in row_text)

    # Bo loc -> quay lai TOAN BO quote cua Customer (ca 2 chuoi)
    page.locator(".crm-quote-filter-pill button:has-text('Bỏ lọc')").click()
    time.sleep(0.4)
    record("A11) Bo loc -> hien lai 2 chuoi (Project A + Project B)", page.locator(".crm-table tbody tr.crm-row").count() == 2)

    # Tab Co hoi: cot Du an dung ma/ten hoac 'Chưa thuộc dự án'
    page.locator("button.crm-segment-button:has-text('Cơ hội')").click()
    time.sleep(0.4)
    deals_table_text = page.locator(".crm-table").inner_text()
    record("A12) Tab Co hoi hien Project code cho deal co project_id (DA-A)", "DA-A" in deals_table_text)
    record("A13) Tab Co hoi hien 'Chưa thuộc dự án' cho deal khong co project_id", "Chưa thuộc dự án" in deals_table_text)
    context.close()

    # ── PART B: CrmShell (/all-platform/crm?openDeal=new&customerId=&projectId=)
    # - Customer/Project PHAI THAT SU tu dien + khoa, khong chi mang query
    # param roi bo qua ─────────────────────────────────────────────────────
    context2 = browser.new_context(viewport={"width": 1536, "height": 864})
    page2 = context2.new_page()
    login(page2)
    page2.route(re.compile(r".*/api/all-platform/(?!auth/).*"), lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page2.route(re.compile(r".*/api/all-platform/projects\?customer_id=.*"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(PROJECTS_LIST)))
    page2.goto(f"{BASE}/all-platform/crm?openDeal=new&customerId={CUSTOMER_ID}&customerName=%C4%90%C4%83ng%20Vi%E1%BB%87t&projectId={PROJECT_A}",
               wait_until="networkidle", timeout=30000)
    time.sleep(1.2)
    modal_text = page2.locator(".crm-modal--deal-compact").inner_text()
    record("B1) Modal 'Thêm deal nhanh' tu mo dung tu query param", "Thêm deal nhanh" in modal_text)
    customer_input_value = page2.locator("#crm-deal-customer-name").input_value()
    record("B2) Customer tu dien DUNG ten (Đăng Việt) tu query param", customer_input_value == "Đăng Việt", customer_input_value)
    customer_input_disabled = page2.locator("#crm-deal-customer-name").is_disabled()
    record("B3) Customer bi KHOA that (input disabled, khong the doi)", customer_input_disabled)
    doi_button_count = page2.locator("button:has-text('Đổi')").count()
    record("B4) KHONG con nut 'Đổi' Customer khi da khoa", doi_button_count == 0)
    time.sleep(0.6)  # doi ProjectPicker load xong tu API /projects?customer_id=
    project_field = page2.locator(".crm-field:has-text('Dự án')")
    project_input_value = project_field.locator("input").input_value()
    record("B5) Project THAT SU tu dien dung (DA-A · Website A), khong phai dropdown rong",
           "DA-A" in project_input_value and "Website A" in project_input_value, project_input_value)
    context2.close()

    # ── PART C: QuoteCenterPage (/all-platform/quote-center?openQuote=new&
    # customerId=&projectId=) - workspace mo CHE DO TAO MOI, Customer/Project
    # khoa, Co hoi CHI hien cua DUNG Project ─────────────────────────────────
    context3 = browser.new_context(viewport={"width": 1536, "height": 864})
    page3 = context3.new_page()
    login(page3)
    # KHONG dung catch-all [] o day - QuoteCenterPage con goi nhieu endpoint
    # khac (dashboard/kpi/accounts...) mong doi SHAPE khac nhau (object, khong
    # phai array) - de BACKEND THAT tra ve nhu binh thuong (chi doc, KHONG
    # mutation), CHI ghi de dung 3 endpoint lien quan truc tiep den fixture
    # nay (customer-leads de co deal, crm/customers de co ten Khach hang,
    # projects de co Du an cua DUNG Khach hang).
    page3.route(re.compile(r".*/api/all-platform/customer-leads.*"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": [
                    {"id": DEAL_1, "customer_id": CUSTOMER_ID, "customer_name": "Đăng Việt", "project_id": PROJECT_A, "deal_stage": "negotiation", "stage_entered_at": "2026-09-01T00:00:00Z"},
                    {"id": "deal-fixture-3", "customer_id": CUSTOMER_ID, "customer_name": "Đăng Việt (dự án khác)", "project_id": PROJECT_B, "deal_stage": "negotiation", "stage_entered_at": "2026-09-01T00:00:00Z"},
                ]})))
    page3.route(re.compile(r".*/api/all-platform/crm/customers\?page=1&page_size=200"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": [{"id": CUSTOMER_ID, "customer_name": "Đăng Việt", "company_name": "Công ty Đăng Việt"}]})))
    page3.route(re.compile(rf".*/api/all-platform/projects\?customer_id={CUSTOMER_ID}"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(PROJECTS_LIST)))
    page3.goto(f"{BASE}/all-platform/quote-center?openQuote=new&customerId={CUSTOMER_ID}&projectId={PROJECT_A}",
               wait_until="networkidle", timeout=30000)
    time.sleep(1.5)
    workspace_text = page3.locator(".qc-workspace-info-strip").inner_text()
    record("C1) Workspace tu mo CHE DO TAO MOI voi Customer/Project tu dien",
           "Đăng Việt" in workspace_text, workspace_text)
    time.sleep(0.6)
    workspace_text2 = page3.locator(".qc-workspace-info-strip").inner_text()
    record("C2) Project THAT SU khoa, hien dung ten (DA-A · Website A)", "DA-A" in workspace_text2, workspace_text2)

    # Co hoi CRM CHI hien cua DUNG Project A (khong hien deal thuoc Project B)
    deal_trigger = page3.locator(".qc-workspace-info-strip .crm-searchable-select-trigger").first
    deal_trigger.click()
    time.sleep(0.4)
    deal_menu_text = page3.locator(".crm-searchable-select-menu").last.inner_text()
    record("C3) Co hoi CRM CHI hien deal thuoc DUNG Project (khong hien 'dự án khác')",
           "dự án khác" not in deal_menu_text, deal_menu_text)
    context3.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
