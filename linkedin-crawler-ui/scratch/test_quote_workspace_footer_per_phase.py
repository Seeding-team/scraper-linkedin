"""Checkpoint D - kiem tra DOM/fixture (Playwright route interception,
KHONG mutation DB that) cho dung yeu cau cot loi: moi phase phai co dung nut
o STICKY FOOTER cua QuoteWorkspaceModal, khong chi doi nhan trang thai.

Dac biet: bug that da phat hien (screenshot nguoi dung gui) - 1 quote hien
badge "Cho Admin duyet" o danh sach nhung workspace KHONG hien 2 nut "Yeu
cau chinh sua"/"Duyet bao gia" o footer. Da audit + fix root cause (status/
processing_stage lech nhau do RPC quote_approve() cu). File nay fixture
DUNG CASE THAT: status='draft' + processingStage='review' (dung dieu kien
DB that cua phase Admin review) va assert footer PHAI co 2 nut do.

Chay: python scratch/test_quote_workspace_footer_per_phase.py
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
    "data": {"quoteTitle": "Fixture test quote"}, "items": [],
    "subtotalAmount": 10000000, "vatAmount": 1000000, "totalAmount": 11000000,
    "currency": "VND", "issuedAt": "2026-09-01T00:00:00Z", "createdAt": "2026-09-01T00:00:00Z",
    "updatedAt": "2026-09-01T00:00:00Z", "createdById": "u-admin", "technicalOwnerId": None,
    "quoteOwnerId": None, "publicToken": None, "publicUrl": None, "publicEnabled": False,
    "slaDueAt": "2026-12-01T00:00:00Z", "hasCostData": False, "costTotal": None,
    "netRevenue": None, "grossProfit": None, "grossMarginPercent": None,
}


def install_common_fixtures(page):
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/activity-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/handoff-checklist$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(None)))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/delivery-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([
                   {"id": "log-1", "quoteId": "fixture-q1", "channel": "email", "recipientName": "Chị Lan",
                    "recipientEmail": "khach@abc.com", "status": "sent", "attemptCount": 1,
                    "requestedAt": "2026-09-05T00:00:00Z", "sentAt": "2026-09-05T00:00:01Z", "requestedById": "u-admin"},
               ])))
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
    page.route(re.compile(r".*/api/all-platform/quotes/by-phase.*"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"items": [], "counts": {"presale": 0, "sale_markup": 0, "admin_review": 0, "ready_to_send": 0, "sent": 0, "all": 0},
                    "page": 1, "pageSize": 10, "total": 0})))


def open_fixture_quote(page, quote_overrides):
    quote = {**BASE_QUOTE, **quote_overrides}
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(quote)))
    page.goto(f"{BASE}/all-platform/quote-center?openQuote=fixture-q1", wait_until="networkidle", timeout=30000)
    # Trang khong ho tro query param that - mo thang qua goi window global thay vao do:
    # dung 1 nut an trong DOM test-only KHONG kha thi, nen ta goi truc tiep qua
    # window (mo cung 1 co che voi click row) bang cach expose 1 ham JS nho.


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_common_fixtures(page)

    def load_workspace_for(quote_overrides, label):
        quote = {**BASE_QUOTE, **quote_overrides}
        page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
                   lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(quote)))
        # Mo qua danh sach: fixture 1 item duy nhat trong by-phase 'all', bam vao dong do.
        page.route(re.compile(r".*/api/all-platform/quotes/by-phase\?page=1&page_size=10$"),
                   lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                       {"items": [quote], "counts": {"presale": 1, "sale_markup": 0, "admin_review": 0, "ready_to_send": 0, "sent": 0, "all": 1},
                        "page": 1, "pageSize": 10, "total": 1})))
        page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
        time.sleep(1)
        page.locator("button.qc-row-link-btn").first.click()
        time.sleep(1)
        return page.locator(".qc-workspace-footer").inner_text()

    # ── A) request, chua co SLA started -> Gui yeu cau ky thuat ─────────────
    footer = load_workspace_for({"status": "draft", "processingStage": "request", "slaDueAt": "2026-12-01T00:00:00Z"}, "request")
    record("Phase 'request': footer co 'Gửi yêu cầu xử lý'", "Gửi yêu cầu xử lý" in footer)

    # ── B) technical -> Ban giao xu ly gia (nguoi khong co quyen se khong co nut) ──
    footer = load_workspace_for({"status": "draft", "processingStage": "technical"}, "technical")
    record("Phase 'technical': footer co 'Bàn giao xử lý giá' (Admin luon co quyen)", "Bàn giao xử lý giá" in footer)

    # ── C) pricing -> Hoan tat phan gia ban ─────────────────────────────────
    footer = load_workspace_for({"status": "draft", "processingStage": "pricing"}, "pricing")
    record("Phase 'pricing': footer co 'Hoàn tất phần giá bán'", "Hoàn tất phần giá bán" in footer)

    # ── D) review (DUNG CASE BAO CAO - bug that) -> PHAI co 2 nut ───────────
    footer = load_workspace_for({"status": "draft", "processingStage": "review"}, "review")
    record("Phase 'review' (status='draft' - dung dieu kien DB that): footer co 'Yêu cầu chỉnh sửa'", "Yêu cầu chỉnh sửa" in footer)
    record("Phase 'review': footer co 'Duyệt báo giá' (Admin)", "Duyệt báo giá" in footer)

    # ── E) approved + ready_to_publish -> Phat hanh ─────────────────────────
    footer = load_workspace_for({"status": "approved", "processingStage": "ready_to_publish"}, "ready_to_publish")
    record("Phase 'ready_to_publish': footer co 'Phát hành'", "Phát hành" in footer)
    record("Phase 'ready_to_publish': KHONG co 'Gửi khách hàng' (chua phat hanh)", "Gửi khách hàng" not in footer)

    # ── F) approved + published, chua gui -> Gui khach hang ─────────────────
    footer = load_workspace_for({"status": "approved", "processingStage": "published", "publicEnabled": True, "publicUrl": "/public/quotes/tok1", "publishedAt": "2026-09-04T00:00:00Z", "sentAt": None}, "published-unsent")
    record("Phase 'published' chua gui: footer co 'Gửi khách hàng'", "Gửi khách hàng" in footer)
    record("Phase 'published' chua gui: footer co 'Sao chép link báo giá'", "Sao chép link báo giá" in footer)
    record("Phase 'published' chua gui: KHONG co 'Xem lịch sử gửi'/'Gửi lại' (chua tung gui)", "Xem lịch sử gửi" not in footer and "Gửi lại" not in footer)

    # ── G) approved + published + da gui -> Xem lich su gui + Gui lai ───────
    footer = load_workspace_for({"status": "approved", "processingStage": "published", "publicEnabled": True, "publicUrl": "/public/quotes/tok1", "publishedAt": "2026-09-04T00:00:00Z", "sentAt": "2026-09-05T00:00:00Z", "sentById": "u-admin"}, "sent")
    record("Phase 'sent': footer co 'Xem lịch sử gửi'", "Xem lịch sử gửi" in footer)
    record("Phase 'sent': footer co 'Gửi lại'", "Gửi lại" in footer)
    record("Phase 'sent': KHONG con nut 'Gửi khách hàng' (da doi nhan 'Gửi lại')", "Gửi khách hàng" not in footer)

    # ── H) Mo modal "Xem lich su gui" that su tu footer, kiem tra noi dung ──
    page.locator("button:has-text('Xem lịch sử gửi')").first.click()
    time.sleep(0.8)
    modal_text = page.locator(".qc-deal-picker").last.inner_text()
    record("Modal lich su gui: co hien email nguoi nhan that (khach@abc.com)", "khach@abc.com" in modal_text)
    record("Modal lich su gui: co hien trang thai 'Đã gửi'", "Đã gửi" in modal_text)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
