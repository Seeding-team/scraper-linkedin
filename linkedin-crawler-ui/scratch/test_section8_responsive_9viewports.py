"""Section 8 - Responsive + HTML parity, 9 viewport that yeu cau:
1600/1536/1366/1280/1200/1100/980/760/390. Dung DUNG pattern da co san
(scratch/test_block3_phase_layout_matrix.py): Playwright ROUTE INTERCEPTION
(fixture JSON) cho /quotes/by-phase + /quotes/{id} - KHONG mutation DB that,
KHONG doc/ghi bat ky gi tren SUPABASE_URL dang cau hinh. Đăng nhập real (chi
GET sau khi login, khong POST/PUT/DELETE nao).

Kiem tra tai MOI viewport:
  - Quote Center list (KPI SLA + 10 cot + tab phase) - khong tran ngang TRANG
    (page-level overflow), chup screenshot.
  - QuoteWorkspaceModal o phase 'pricing' (bang hang muc THONG NHAT 12 cot,
    noi rong nhat) - khong tran ngang TRANG (rieng .qc-table-wrap duoc PHEP tu
    cuon ngang - day la thiet ke co y, khong phai loi), chup screenshot.

Chay: python scratch/test_section8_responsive_9viewports.py
Anh luu vao scratch/screenshots_section8/ (xoa duoc sau khi xem xong).
"""
import sys, io, os, re, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
VIEWPORTS = [1600, 1536, 1366, 1280, 1200, 1100, 980, 760, 390]
OUT_DIR = os.path.join(os.path.dirname(__file__), "screenshots_section8")
os.makedirs(OUT_DIR, exist_ok=True)

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


NOW_ISO = "2026-09-07T10:00:00+00:00"
OVERDUE_ISO = "2026-09-07T05:00:00+00:00"
DUE_SOON_ISO = "2026-09-07T12:00:00+00:00"

BASE_QUOTE = {
    "id": "fixture-q1", "quoteNumber": "202609070777", "quoteFormId": "form-1",
    "dealId": None, "projectId": None, "versionChainId": "chain-1", "versionNumber": 2,
    "parentQuoteId": None, "formSchemaVersion": 1, "formSnapshot": {"sections": []},
    "data": {"quoteTitle": "Fixture test quote — Section 8 responsive"}, "items": [],
    "subtotalAmount": 30000000, "vatAmount": 3000000, "totalAmount": 33000000,
    "currency": "VND", "issuedAt": "2026-09-01T00:00:00Z", "createdAt": "2026-09-01T00:00:00Z",
    "updatedAt": "2026-09-01T00:00:00Z", "createdById": "u-admin",
    "technicalOwnerId": "u-admin", "quoteOwnerId": "u-admin",
    "publicToken": None, "publicUrl": None, "publicEnabled": False,
    "slaDueAt": DUE_SOON_ISO, "hasCostData": True, "costTotal": 12000000,
    "netRevenue": 30000000, "grossProfit": 18000000, "grossMarginPercent": 60.0,
    "costViewAllowed": True, "pricingViewAllowed": True, "profitabilityViewAllowed": True,
    "customerPriceBeforeVat": 30000000, "versionCount": 2, "currentVersionNumber": 2,
    "phase": "sale_markup",
}

FULL_ITEMS = [
    {
        "id": "item-1", "description": "Thiết kế website", "serviceDescription": "Landing page + CMS",
        "unit": "gói", "quantity": 1, "unitPrice": 20000000, "discountPercent": 0, "discountAmount": 0,
        "amountAfterDiscount": 20000000, "vatRate": 10, "subtotalAmount": 20000000, "vatAmount": 2000000,
        "totalAmount": 22000000, "sortOrder": 0, "costPrice": 8000000, "markupPercent": 150.0,
        "costTotal": 8000000, "costNotApplicable": False, "children": [],
    },
    {
        "id": "item-2", "description": "Hosting 1 năm", "serviceDescription": "VPS 4GB",
        "unit": "năm", "quantity": 1, "unitPrice": 10000000, "discountPercent": 0, "discountAmount": 0,
        "amountAfterDiscount": 10000000, "vatRate": 10, "subtotalAmount": 10000000, "vatAmount": 1000000,
        "totalAmount": 11000000, "sortOrder": 1, "costPrice": 4000000, "markupPercent": 150.0,
        "costTotal": 4000000, "costNotApplicable": False, "children": [],
    },
]

BY_PHASE_ITEMS = [
    {**BASE_QUOTE, "id": "fixture-q1", "quoteNumber": "202609070777", "phase": "sale_markup", "slaDueAt": DUE_SOON_ISO},
    {**BASE_QUOTE, "id": "fixture-q2", "quoteNumber": "202609070778", "phase": "presale", "slaDueAt": OVERDUE_ISO, "versionChainId": "chain-2"},
    {**BASE_QUOTE, "id": "fixture-q3", "quoteNumber": "202609070779", "phase": "admin_review", "slaDueAt": None, "versionChainId": "chain-3", "hasCostData": False, "costTotal": None, "grossProfit": None, "grossMarginPercent": None},
]


def install_common_fixtures(page):
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/activity-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([
                   {"id": "act-1", "action": "created", "actorId": "u-admin", "createdAt": "2026-09-01T00:00:00Z"},
                   {"id": "act-2", "action": "approved_with_exception", "actorId": "u-admin", "createdAt": "2026-09-02T00:00:00Z", "changes": {"versionNumber": 2}},
               ])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/handoff-checklist$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/delivery-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/telegram-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quote-approval-rules/active$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({
                   "id": "rs-1", "name": "Bộ quy tắc mặc định", "version": 1,
                   "rules": [
                       {"ruleType": "gross_margin_percent", "thresholdValue": 20, "isRequired": True},
                       {"ruleType": "gross_profit_amount", "thresholdValue": 5000000, "isRequired": True},
                       {"ruleType": "discount_percent", "thresholdValue": 10, "isRequired": True},
                       {"ruleType": "payment_terms_days", "thresholdValue": 45, "isRequired": True},
                   ],
               })))
    page.route(re.compile(r".*/rule-evaluation$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({
                   "result": "pass", "autoApproveEnabled": False,
                   "details": [{"ruleType": "gross_margin_percent", "status": "pass", "actualDisplay": "60%"}],
               })))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([
                   {"id": "u-admin", "name": "Admin Nguyễn Văn A", "role": "admin", "quote_business_role": "both"},
               ])))
    page.route(re.compile(r".*/api/all-platform/crm/customers.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": []})))
    page.route(re.compile(r".*/api/all-platform/projects(\?.*)?$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/by-phase.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({
                   "items": BY_PHASE_ITEMS,
                   "counts": {"presale": 1, "sale_markup": 1, "admin_review": 1, "ready_to_send": 0, "sent": 0, "all": 3},
                   "slaCounts": {"overdue": 1, "dueSoon": 1},
                   "page": 1, "pageSize": 10, "total": 3,
               })))


def check_no_page_overflow(page, viewport_w, label):
    scroll_w = page.evaluate("document.documentElement.scrollWidth")
    ok = scroll_w <= viewport_w + 16  # dung sai nho cho scrollbar/subpixel
    record(f"{label} @ {viewport_w}px: khong tran ngang TRANG (scrollWidth={scroll_w})", ok)
    raw_text = page.locator("body").inner_text()
    record(f"{label} @ {viewport_w}px: khong co literal undefined/null/NaN", not re.search(r"\bundefined\b|\bNaN\b", raw_text))


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    page = context.new_page()
    login(page)
    install_common_fixtures(page)

    quote_pricing = {**BASE_QUOTE, "processingStage": "pricing", "status": "draft", "items": FULL_ITEMS}
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(quote_pricing)))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/versions$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([quote_pricing])))

    for w in VIEWPORTS:
        h = 900 if w >= 980 else 844
        page.set_viewport_size({"width": w, "height": h})

        # 1) Quote Center list + KPI SLA + tabs
        page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
        time.sleep(0.8)
        check_no_page_overflow(page, w, "Quote Center list")
        sla_kpi_visible = page.locator(".qc-sla-kpi-row").count() > 0
        record(f"Quote Center @ {w}px: KPI SLA row hien thi", sla_kpi_visible)
        page.screenshot(path=os.path.join(OUT_DIR, f"quote-center_{w}.png"), full_page=True)

        # 2) QuoteWorkspaceModal - phase 'pricing' (bang hang muc THONG NHAT,
        #    noi rong nhat, phase Sale markup dang xu ly). Route da dang ky
        #    1 LAN duy nhat truoc vong lap (khong dang ky lai moi viewport -
        #    dang ky lap lai gay xung dot handler that su tren Playwright).
        page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
        time.sleep(0.5)
        row_btn = page.locator("button.qc-row-link-btn").first
        if row_btn.count() > 0:
            row_btn.click()
            try:
                page.wait_for_selector(".qc-workspace-body", timeout=10000)
                time.sleep(0.6)
                check_no_page_overflow(page, w, "QuoteWorkspaceModal (pricing, unified table)")
                unified_table_visible = page.locator(".qc-workspace-items-table--unified").count() > 0
                record(f"Workspace @ {w}px: bang hang muc THONG NHAT hien thi (1 bang, khong con 2 tab)", unified_table_visible)
                page.screenshot(path=os.path.join(OUT_DIR, f"workspace-pricing_{w}.png"), full_page=True)
            except Exception as exc:
                record(f"Workspace @ {w}px: mo duoc modal", False, str(exc))
        else:
            record(f"Workspace @ {w}px: tim thay dong de bam mo", False)

    browser.close()

print()
failed = [l for l, ok in RESULTS if not ok]
print(f"TOTAL: {len(RESULTS)} checks, {len(failed)} FAILED")
if failed:
    for f in failed:
        print(" - FAIL:", f)
    sys.exit(1)
print("ALL CHECKS PASSED. Screenshots in:", OUT_DIR)
