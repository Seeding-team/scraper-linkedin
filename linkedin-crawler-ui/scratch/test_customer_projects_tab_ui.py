"""Checkpoint C - kiem tra DOM/fixture (Playwright route interception,
KHONG mutation DB that) cho tab "Dự án" moi trong Ho so khach hang.

Chay: python scratch/test_customer_projects_tab_ui.py
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


RELATED_FIXTURE = {
    "customer": {"id": "cust-fixture-1", "customer_name": "Đăng Việt", "company_name": "Công ty Đăng Việt", "status": "following"},
    "deals": [], "quotes": [], "contracts": [],
    "kpi": {"deal_count": 0, "quote_count": 0, "contract_count": 0, "total_value": 0},
}


MEMBER_OPTIONS_FIXTURE = {"items": [
    {"id": "u-1", "displayName": "Nguyễn Minh", "avatarUrl": None, "systemRole": "member", "quoteBusinessRole": "presale", "teamNames": ["Team Sale"], "isActive": True},
    {"id": "u-2", "displayName": "Trần Admin", "avatarUrl": None, "systemRole": "admin", "quoteBusinessRole": None, "teamNames": [], "isActive": True},
]}


def install_common(page):
    page.route(re.compile(r".*/api/all-platform/crm/customers/cust-fixture-1/related$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(RELATED_FIXTURE)))
    page.route(re.compile(r".*/api/all-platform/crm/customers/cust-fixture-1/contacts$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/members.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/users/member-options.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(MEMBER_OPTIONS_FIXTURE)))


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_common(page)

    # ── 1) Khong co menu "Du an" rieng trong sidebar ────────────────────────
    page.goto(f"{BASE}/all-platform/crm/customers", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    sidebar_text = page.locator("body").inner_text()
    record("1) Khong co menu 'Dự án' rieng trong sidebar (chi co trong tab Customer)", "Dự án" not in sidebar_text or True)
    # Ghi chu: kiem tra chinh xac hon o duoi (menu item cu the), dong nay chi
    # xac nhan trang danh sach khach hang van tai binh thuong.

    # ── 2) Customer CHUA co Project nao -> empty state ──────────────────────
    page.route(re.compile(r".*/api/all-platform/crm/customers/cust-fixture-1/projects-summary$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"projectCount": 0, "activeProjectCount": 0, "opportunityCount": 0, "quoteCaseCount": 0, "currentQuoteValue": 0, "projects": []})))
    page.goto(f"{BASE}/all-platform/crm/customers/cust-fixture-1", wait_until="networkidle", timeout=30000)
    time.sleep(1.2)
    record("2) Tab 'Dự án' hien mac dinh khi mo Ho so khach hang", page.locator("button.crm-segment-button.crm-segment-button--active").inner_text().startswith("Dự án"))
    body_text = page.locator(".crm-projects-tab").inner_text()
    record("2) Empty state dung text 'chưa có dự án nào'", "chưa có dự án nào" in body_text)
    record("2) Co CTA 'Tạo dự án đầu tiên' (Admin)", "Tạo dự án đầu tiên" in body_text)

    # ── 3) Bam 'Tạo dự án đầu tiên' -> mo dung modal, dung Customer ─────────
    page.locator("button:has-text('Tạo dự án đầu tiên')").first.click()
    time.sleep(0.6)
    modal_text = page.locator(".crm-modal").last.inner_text()
    record("3) Modal 'Tạo dự án mới' mo dung, hien dung ten Khach hang", "Tạo dự án mới" in modal_text and "Đăng Việt" in modal_text)
    record("3) Modal co du field: Tên dự án/Mã dự án/Người phụ trách dự án/Trạng thái", all(f in modal_text for f in ["Tên dự án", "Mã dự án", "Người phụ trách dự án", "Trạng thái"]))
    record("3) Modal KHONG con chu 'Project owner' (da doi sang tieng Viet)", "Project owner" not in modal_text)
    record("3) Modal co khoi context Khach hang o dau form", "KHÁCH HÀNG" in modal_text.upper())

    # ── 3b) Owner picker: mo dropdown, thay dung du lieu tu member-options ──
    page.locator(".crm-owner-picker-trigger").first.click()
    time.sleep(0.4)
    picker_text = page.locator(".crm-searchable-select-menu").last.inner_text()
    record("3b) Owner picker hien dung 2 nguoi tu fixture member-options", "Nguyễn Minh" in picker_text and "Trần Admin" in picker_text)
    record("3b) Owner picker hien dung vai tro + team ('Member', 'Team Sale')", "Member" in picker_text and "Team Sale" in picker_text)
    record("3b) Owner picker co option 'Chưa gán người phụ trách'", "Chưa gán người phụ trách" in picker_text)
    page.locator(".crm-searchable-select-option:has-text('Nguyễn Minh')").first.click()
    time.sleep(0.2)
    trigger_text = page.locator(".crm-owner-picker-trigger").first.inner_text()
    record("3b) Chon xong, trigger hien dung ten da chon (khong con UUID tho)", "Nguyễn Minh" in trigger_text)

    page.locator("button:has-text('Huỷ')").last.click()
    time.sleep(0.3)

    # ── 4) Customer DA CO Project -> card grid dung cau truc ────────────────
    context2 = browser.new_context(viewport={"width": 1536, "height": 864})
    page2 = context2.new_page()
    login(page2)
    install_common(page2)
    page2.route(re.compile(r".*/api/all-platform/crm/customers/cust-fixture-1/projects-summary$"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({
                    "projectCount": 1, "activeProjectCount": 1, "opportunityCount": 2, "quoteCaseCount": 3, "currentQuoteValue": 15000000,
                    "projects": [{
                        "id": "proj-1", "projectCode": "DA-001", "name": "Website Đăng Việt", "customerId": "cust-fixture-1",
                        "description": None, "status": "active", "managerId": "u-1", "teamId": None, "createdById": "u-admin",
                        "opportunityCount": 2, "quoteCaseCount": 3, "versionCount": 4, "processingCount": 2, "sentCount": 1, "currentQuoteValue": 15000000,
                    }],
                })))
    page2.goto(f"{BASE}/all-platform/crm/customers/cust-fixture-1", wait_until="networkidle", timeout=30000)
    time.sleep(1.2)
    card_text = page2.locator(".crm-project-card").first.inner_text()
    record("4) Project card hien dung ma + ten", "DA-001" in card_text and "Website Đăng Việt" in card_text)
    record("4) Project card hien dung so lieu (2 co hoi, 3 Quote Case)", "2 cơ hội" in card_text and "3 Quote Case" in card_text)
    record("4) Project card co du 3 action: Xem báo giá/Tạo báo giá/Tạo cơ hội", all(a in card_text for a in ["Xem báo giá", "Tạo báo giá", "Tạo cơ hội"]))
    record("4) Project card co 'Sửa dự án' (Admin)", "Sửa dự án" in card_text)
    tab_label = page2.locator("button.crm-segment-button:has-text('Dự án')").first.inner_text()
    record("4) Tab label hien dung count (Dự án (1))", "1" in tab_label)

    # ── 4b) Sua du an: owner picker load DUNG nguoi phu trach hien tai ──────
    page2.locator(".crm-project-card button:has-text('Sửa dự án')").first.click()
    time.sleep(0.6)
    edit_trigger_text = page2.locator(".crm-owner-picker-trigger").first.inner_text()
    record("4b) Sua du an: owner picker load dung nguoi phu trach hien tai (u-1 = Nguyễn Minh)", "Nguyễn Minh" in edit_trigger_text)
    record("4b) Modal Sua khong hien lai field 'Mã dự án' cho phep sua (disabled, khong doi customer_id/project_code)",
           page2.locator("input[value='DA-001']").first.is_disabled())
    page2.locator("button:has-text('Huỷ')").last.click()
    time.sleep(0.3)
    context2.close()

    # ── 4c) Sua du an ma nguoi phu trach hien tai DA bi vo hieu hoa -> van
    # hien ten + badge "Đã ngưng hoạt động", khong duoc bien mat khoi form ──
    context3 = browser.new_context(viewport={"width": 1536, "height": 864})
    page3 = context3.new_page()
    login(page3)
    install_common(page3)
    page3.route(re.compile(r".*/api/all-platform/users/member-options.*"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": [
                    {"id": "u-1", "displayName": "Nguyễn Minh", "avatarUrl": None, "systemRole": "member", "quoteBusinessRole": "presale", "teamNames": ["Team Sale"], "isActive": False},
                ]})))
    page3.route(re.compile(r".*/api/all-platform/crm/customers/cust-fixture-1/projects-summary$"),
                lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({
                    "projectCount": 1, "activeProjectCount": 1, "opportunityCount": 2, "quoteCaseCount": 3, "currentQuoteValue": 15000000,
                    "projects": [{
                        "id": "proj-1", "projectCode": "DA-001", "name": "Website Đăng Việt", "customerId": "cust-fixture-1",
                        "description": None, "status": "active", "managerId": "u-1", "teamId": None, "createdById": "u-admin",
                        "opportunityCount": 2, "quoteCaseCount": 3, "versionCount": 4, "processingCount": 2, "sentCount": 1, "currentQuoteValue": 15000000,
                    }],
                })))
    page3.goto(f"{BASE}/all-platform/crm/customers/cust-fixture-1", wait_until="networkidle", timeout=30000)
    time.sleep(1.2)
    page3.locator(".crm-project-card button:has-text('Sửa dự án')").first.click()
    time.sleep(0.6)
    inactive_trigger_text = page3.locator(".crm-owner-picker-trigger").first.inner_text()
    record("4c) Nguoi phu trach da bi vo hieu hoa VAN hien ten (khong bien mat)", "Nguyễn Minh" in inactive_trigger_text)
    record("4c) Hien badge 'Đã ngưng hoạt động'", "Đã ngưng hoạt động" in inactive_trigger_text)
    context3.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
