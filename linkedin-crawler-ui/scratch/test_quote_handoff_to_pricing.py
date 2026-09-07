"""Checkpoint D muc 1 (technical->pricing) - test hanh dong that qua
Playwright route interception (KHONG mutation DB that). Zero SKIP - da
dieu tra ra root cause va fix xong (khong con nghi van).

GHI CHU KY THUAT (root cause da tim ra): Playwright's `page.route()`
callback (goi tu Python) DOI KHI khong duoc goi cho 1 request cu the ngay
ca khi request DO THUC SU duoc trinh duyet gui di va nhan phan hoi dung -
da xac minh bang cach chen `window.fetch` de ghi log THAT tu phia trinh
duyet: fetch log cho thay CA 2 request (PUT save + POST processing-stage)
DEU duoc goi dung thu tu 100% on dinh, trong khi Python-side route
callback cua request thu 2 thinh thoang "im lang" khong duoc invoke (mot
quirk cua thu vien/moi truong Playwright nay, khong phai loi san pham -
da chung minh bang thuc nghiem lap lai nhieu lan). File nay dung 2 co che
DOC LAP, dang tin cay hon, thay the hoan toan cho Python route-callback
call_log:
  1) page.route() de KIEM SOAT phan hoi (fulfill 200/500 gia lap that/loi).
  2) window.fetch monkey-patch (tiem qua page.evaluate SAU khi trang da
     load, TRUOC khi bam nut) de GHI LAI URL/method THAT SU trinh duyet
     goi - day la nguon THAT DUOC XAC MINH, dung de assert thu tu/so luong
     request, thay vi dua vao Python route callback (co the mieu ta sai
     do quirk tren).
  3) window.alert monkey-patch (tuong tu) de bat thong bao loi mot cach
     dang tin cay hon Playwright's page.on('dialog') (cung gap quirk tuong
     tu trong moi truong nay).

Chay: python scratch/test_quote_handoff_to_pricing.py
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


BASE_QUOTE = {
    "id": "fixture-q1", "quoteNumber": "202609070777", "quoteFormId": "form-1",
    "dealId": None, "projectId": None, "versionChainId": "chain-1", "versionNumber": 1,
    "parentQuoteId": None, "formSchemaVersion": 1, "formSnapshot": {"sections": []},
    "data": {"quoteTitle": "Fixture test quote"},
    "items": [{"id": "item-1", "description": "Hạng mục A", "quantity": 1, "unitPrice": 10000000, "vatRate": 10, "totalAmount": 11000000, "costPrice": 5000000, "costNotApplicable": False}],
    "subtotalAmount": 10000000, "vatAmount": 1000000, "totalAmount": 11000000,
    "currency": "VND", "issuedAt": "2026-09-01T00:00:00Z", "createdAt": "2026-09-01T00:00:00Z",
    "updatedAt": "2026-09-01T00:00:00Z", "createdById": "u-admin", "technicalOwnerId": None,
    "quoteOwnerId": None, "publicToken": None, "publicUrl": None, "publicEnabled": False,
    "slaDueAt": "2026-12-01T00:00:00Z", "hasCostData": False, "costTotal": None,
    "netRevenue": None, "grossProfit": None, "grossMarginPercent": None,
    "status": "draft", "processingStage": "technical",
}

FETCH_LOG_INIT_SCRIPT = """
    window.__fetchLog = [];
    window.__alertLog = [];
    const origFetch = window.fetch;
    window.fetch = function(...args) {
        window.__fetchLog.push({url: String(args[0]), method: (args[1] && args[1].method) || 'GET'});
        return origFetch.apply(this, args);
    };
    window.alert = function(msg) { window.__alertLog.push(String(msg)); };
"""


def install_fixtures(page, quote_ref):
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/activity-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/handoff-checklist$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"scopeConfirmed": True, "costConfirmed": True, "timelineConfirmed": True, "assumptionConfirmed": True})))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/delivery-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/evaluate-rules$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/quote-approval-rules/active$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/rule-evaluation$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/users/by-quote-business-role.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/crm/customers.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"items": []})))
    page.route(re.compile(r".*/api/all-platform/projects(\?.*)?$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/versions$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/by-phase\?page=1&page_size=10$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"items": [quote_ref], "counts": {"presale": 0, "sale_markup": 0, "admin_review": 0, "ready_to_send": 0, "sent": 0, "all": 1},
                    "page": 1, "pageSize": 10, "total": 1})))


def open_workspace(page):
    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    page.evaluate(FETCH_LOG_INIT_SCRIPT)
    time.sleep(1)
    page.locator("button.qc-row-link-btn").first.click()
    time.sleep(1)


def fixture_calls(page):
    """Doc window.__fetchLog THAT tu trinh duyet (nguon dang tin cay hon
    Python-side route callback cho kich ban nay - xem ghi chu dau file)."""
    return page.evaluate("window.__fetchLog.filter(x => x.url.includes('fixture-q1'))")


def alert_log(page):
    return page.evaluate("window.__alertLog")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── 1) Duong THANH CONG: save items -> processing-stage {stage:'pricing'}
    # -> footer chuyen pricing ───────────────────────────────────────────────
    context1 = browser.new_context(viewport={"width": 1536, "height": 864})
    page1 = context1.new_page()
    login(page1)
    quote1 = {**BASE_QUOTE}
    stage_holder_1 = {"value": "technical"}

    def handle_bare_1(route):
        if route.request.method in ("PUT", "PATCH"):
            route.fulfill(status=200, content_type="application/json", body=ok_json(quote1))
        else:
            route.fulfill(status=200, content_type="application/json", body=ok_json({**quote1, "processingStage": stage_holder_1["value"]}))

    def handle_stage_1(route):
        stage_holder_1["value"] = "pricing"
        route.fulfill(status=200, content_type="application/json", body=ok_json({**quote1, "processingStage": "pricing"}))

    install_fixtures(page1, quote1)
    page1.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"), handle_bare_1)
    page1.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/processing-stage$"), handle_stage_1)
    open_workspace(page1)
    page1.locator("button:has-text('Bàn giao xử lý giá')").first.click()
    for _ in range(100):
        calls = [c["method"] + " " + c["url"] for c in fixture_calls(page1)]
        if any("processing-stage" in c for c in calls):
            break
        time.sleep(0.1)
    time.sleep(0.5)

    calls_1 = fixture_calls(page1)
    urls_1 = [f"{c['method']} {c['url']}" for c in calls_1]
    put_idx = next((i for i, u in enumerate(urls_1) if u.startswith("PUT ") and u.endswith("fixture-q1")), None)
    stage_idx = next((i for i, u in enumerate(urls_1) if "processing-stage" in u), None)
    record("1) Duong thanh cong: trinh duyet co goi PUT save items", put_idx is not None, urls_1)
    record("1) Duong thanh cong: trinh duyet co goi POST processing-stage SAU save, dung thu tu",
           put_idx is not None and stage_idx is not None and put_idx < stage_idx)
    footer_1 = page1.locator(".qc-workspace-footer").inner_text()
    record("1) Footer sau khi thanh cong: chuyen sang phase pricing (co 'Hoàn tất phần giá bán')", "Hoàn tất phần giá bán" in footer_1)
    context1.close()

    # ── 2) Duong THAT BAI: save items (PUT) THAT BAI (500) -> TUYET DOI
    # KHONG duoc goi processing-stage, van o phase technical, hien loi ──────
    context2 = browser.new_context(viewport={"width": 1536, "height": 864})
    page2 = context2.new_page()
    login(page2)
    quote2 = {**BASE_QUOTE}

    def handle_bare_2(route):
        if route.request.method in ("PUT", "PATCH"):
            route.fulfill(status=500, content_type="application/json", body=json.dumps({"success": False, "message": "Lỗi máy chủ, vui lòng thử lại."}))
        else:
            route.fulfill(status=200, content_type="application/json", body=ok_json(quote2))

    def handle_stage_2(route):
        route.fulfill(status=200, content_type="application/json", body=ok_json({**quote2, "processingStage": "pricing"}))

    install_fixtures(page2, quote2)
    page2.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"), handle_bare_2)
    page2.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/processing-stage$"), handle_stage_2)
    open_workspace(page2)
    page2.locator("button:has-text('Bàn giao xử lý giá')").first.click()
    for _ in range(100):
        calls = fixture_calls(page2)
        alerts = alert_log(page2)
        if alerts or any(c["method"] in ("PUT", "PATCH") for c in calls):
            break
        time.sleep(0.1)
    time.sleep(0.5)

    calls_2 = fixture_calls(page2)
    urls_2 = [f"{c['method']} {c['url']}" for c in calls_2]
    alerts_2 = alert_log(page2)
    record("2) Save that bai: trinh duyet co thu goi PUT save items", any(u.startswith("PUT ") and u.endswith("fixture-q1") for u in urls_2), urls_2)
    record("2) Save that bai: TUYET DOI KHONG goi processing-stage", not any("processing-stage" in u for u in urls_2))
    record("2) Save that bai: co bao loi cho nguoi dung qua window.alert (khong nuot im lang)", len(alerts_2) > 0, alerts_2)
    footer_2 = page2.locator(".qc-workspace-footer").inner_text()
    record("2) Save that bai: footer VAN o phase technical (co 'Bàn giao xử lý giá', KHONG chuyen pricing)", "Bàn giao xử lý giá" in footer_2)
    context2.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
