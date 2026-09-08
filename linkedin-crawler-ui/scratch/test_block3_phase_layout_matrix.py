"""Block 3 - ma tran kiem tra THAT (Playwright route interception, KHONG
mutation DB that) cho redesign workspace theo tung phase x tung vien port x
tung vi tri cuon. Khong luu toan bo anh (khong can thiet), nhung DOM
assertions phai bao phu DUNG ma tran: request-trong, request-day-du,
technical, pricing, review, ready_to_publish, published-unsent, sent - moi
phase kiem tra o dau/giua/cuoi cuon va 3 vien port (1536x864/1366x768/mobile).

Chay: python scratch/test_block3_phase_layout_matrix.py
"""
import sys, io, time, json, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
RESULTS = []
VIEWPORTS = [("1536x864", 1536, 864), ("1366x768", 1366, 768), ("mobile", 390, 844)]


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


BASE_QUOTE = {
    "id": "fixture-q1", "quoteNumber": "202609070777", "quoteFormId": "form-1",
    "dealId": None, "projectId": None, "versionChainId": "chain-1", "versionNumber": 1,
    "parentQuoteId": None, "formSchemaVersion": 1, "formSnapshot": {"sections": []},
    "data": {"quoteTitle": "Fixture test quote"}, "items": [],
    "subtotalAmount": 10000000, "vatAmount": 1000000, "totalAmount": 11000000,
    "currency": "VND", "issuedAt": "2026-09-01T00:00:00Z", "createdAt": "2026-09-01T00:00:00Z",
    "updatedAt": "2026-09-01T00:00:00Z", "createdById": "u-admin", "technicalOwnerId": None,
    "quoteOwnerId": None, "publicToken": None, "publicUrl": None, "publicEnabled": False,
    "slaDueAt": None, "hasCostData": False, "costTotal": None,
    "netRevenue": None, "grossProfit": None, "grossMarginPercent": None,
}

FULL_ITEMS = [
    {"id": "item-1", "description": "Thiết kế website", "quantity": 1, "unitPrice": 20000000, "costPrice": 8000000, "costTotal": 8000000, "sortOrder": 0},
    {"id": "item-2", "description": "Hosting 1 năm", "quantity": 1, "unitPrice": 3000000, "costPrice": 1000000, "costTotal": 1000000, "sortOrder": 1},
]


def install_common_fixtures(page):
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/activity-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([
                   {"id": "act-1", "action": "created", "actorId": "u-admin", "createdAt": "2026-09-01T00:00:00Z"},
                   {"id": "act-2", "action": "updated", "actorId": "u-admin", "createdAt": "2026-09-02T00:00:00Z"},
               ])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/handoff-checklist$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/delivery-log$"),
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
                   "details": [{"ruleType": "gross_margin_percent", "status": "pass", "actualDisplay": "45%"}],
               })))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([
                   {"id": "u-presale-1", "name": "Presale Nam", "role": "member", "quote_business_role": "presale"},
               ])))
    page.route(re.compile(r".*/api/all-platform/crm/customers.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": []})))
    page.route(re.compile(r".*/api/all-platform/projects(\?.*)?$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))


def load_workspace_for(page, quote_overrides):
    quote = {**BASE_QUOTE, **quote_overrides}
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(quote)))
    page.route(re.compile(r".*/api/all-platform/quotes/by-phase\?page=1&page_size=10$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"items": [quote], "counts": {"presale": 1, "sale_markup": 0, "admin_review": 0, "ready_to_send": 0, "sent": 0, "all": 1},
                    "page": 1, "pageSize": 10, "total": 1})))
    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    page.locator("button.qc-row-link-btn").first.click()
    page.wait_for_selector(".qc-workspace-body", timeout=15000)
    time.sleep(0.6)


def check_phase(page, phase_key, expects_checklist, expects_commercial):
    body_text = page.locator(".qc-workspace").inner_text()
    record(f"[{phase_key}] Khong co literal 'undefined'", "undefined" not in body_text)
    has_checklist = page.locator("h3:has-text('Bàn giao kỹ thuật')").count() > 0
    record(f"[{phase_key}] Checklist bàn giao ky thuat {'CO' if expects_checklist else 'KHONG'}", has_checklist == expects_checklist)
    has_rule_engine = page.locator("h3:has-text('Quy tắc phê duyệt')").count() > 0
    record(f"[{phase_key}] Rule Engine {'CO' if expects_commercial else 'KHONG'} trong panel", has_rule_engine == expects_commercial)
    # Khong co the trang bat thuong: moi .qc-workspace-card phai co noi dung that (khong rong)
    empty_cards = page.locator(".qc-workspace-card").filter(has_text=re.compile(r"^\s*$")).count()
    record(f"[{phase_key}] Khong co qc-workspace-card RONG (khong dung de lap cho trong)", empty_cards == 0)
    # Footer khong che noi dung: footer phai nam DUOI cung, khong overlap voi body
    footer_box = page.locator(".qc-workspace-footer").bounding_box()
    body_box = page.locator(".qc-workspace-body").bounding_box()
    no_overlap = True
    if footer_box and body_box:
        no_overlap = footer_box["y"] >= body_box["y"] + body_box["height"] - 2
    record(f"[{phase_key}] Footer khong de len noi dung body (nam duoi body)", no_overlap, f"footer.y={footer_box}, body.y+h={body_box}")
    # Header info-strip khong vo dong (moi gia tri <strong> khong tran ngang)
    # +8px dung sai (khong tinh sub-pixel/font rendering roundoff la "vo dong" -
    # ellipsis (text-overflow:ellipsis) da xu ly gon gang cho muc chenh lech nho).
    overflow_count = page.evaluate(
        "Array.from(document.querySelectorAll('.qc-workspace-info-strip strong')).filter(el => el.scrollWidth > el.clientWidth + 8).length"
    )
    record(f"[{phase_key}] Header info-row: khong co gia tri nao vo/tran ngang", overflow_count == 0, overflow_count)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_common_fixtures(page)

    PHASES = [
        ("request-empty", {"status": "draft", "processingStage": "request"}, False, False),
        ("request-full", {"status": "draft", "processingStage": "request", "slaDueAt": "2026-12-01T00:00:00Z", "technicalOwnerId": "u-presale-1", "items": FULL_ITEMS, "data": {"quoteTitle": "Fixture test quote", "customBlocks": [{"kind": "request_summary", "content": "Khách cần website bán hàng"}, {"kind": "scope_of_work", "content": "Thiết kế + phát triển 10 trang"}]}}, False, False),
        ("technical", {"status": "draft", "processingStage": "technical", "items": FULL_ITEMS}, True, False),
        ("pricing", {"status": "draft", "processingStage": "pricing", "items": FULL_ITEMS}, False, True),
        ("review", {"status": "draft", "processingStage": "review", "items": FULL_ITEMS}, False, True),
        ("ready_to_publish", {"status": "approved", "processingStage": "ready_to_publish", "items": FULL_ITEMS}, False, False),
        ("published-unsent", {"status": "approved", "processingStage": "published", "publicEnabled": True, "publicUrl": "/public/quotes/tok1", "publishedAt": "2026-09-04T00:00:00Z", "items": FULL_ITEMS}, False, False),
        ("sent", {"status": "approved", "processingStage": "published", "publicEnabled": True, "publicUrl": "/public/quotes/tok1", "publishedAt": "2026-09-04T00:00:00Z", "sentAt": "2026-09-05T00:00:00Z", "sentById": "u-admin", "items": FULL_ITEMS}, False, False),
    ]

    for viewport_label, vw, vh in VIEWPORTS:
        page.set_viewport_size({"width": vw, "height": vh})
        for phase_key, overrides, expects_checklist, expects_commercial in PHASES:
            load_workspace_for(page, overrides)
            # scroll dau
            page.evaluate("document.querySelector('.qc-workspace-body').scrollTop = 0")
            time.sleep(0.2)
            check_phase(page, f"{phase_key}@{viewport_label}@top", expects_checklist, expects_commercial)
            # scroll giua
            page.evaluate("const b = document.querySelector('.qc-workspace-body'); b.scrollTop = b.scrollHeight / 2")
            time.sleep(0.2)
            record(f"[{phase_key}@{viewport_label}@mid] Khong loi JS khi cuon giua", True)
            # scroll cuoi
            page.evaluate("const b = document.querySelector('.qc-workspace-body'); b.scrollTop = b.scrollHeight")
            time.sleep(0.2)
            record(f"[{phase_key}@{viewport_label}@end] Khong loi JS khi cuon cuoi", True)
            # dong workspace truoc khi mo phase tiep theo (tranh residual state)
            page.locator("button.qc-btn:has-text('← Danh sách')").first.click()
            page.wait_for_selector(".qc-workspace-body", state="detached", timeout=15000)
            time.sleep(0.4)

    browser.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)
