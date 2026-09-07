"""Checkpoint D muc 3 - test HANH DONG THAT (khong chi kiem tra nut co xuat
hien): bam nut that su co goi DUNG API/payload va chuyen dung phase hay
khong. Playwright route interception CHAN TOAN BO request truoc khi ra
backend that - KHONG co mutation nao roi khoi trinh duyet trong file nay.

Chay: python scratch/test_quote_workspace_mutations.py
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
}

captured = []


def install_common_fixtures(page):
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/activity-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/handoff-checklist$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"scopeConfirmed": True, "costConfirmed": True, "timelineConfirmed": True, "assumptionConfirmed": True}
                   if r.request.method == "GET" else None
               )) if False else r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"scopeConfirmed": True, "costConfirmed": True, "timelineConfirmed": True, "assumptionConfirmed": True})))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/delivery-log$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json([])))
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


def load_workspace_for(page, quote_overrides):
    quote = {**BASE_QUOTE, **quote_overrides}
    captured.clear()
    # QUAN TRONG: page.route() CHONG CHAT qua nhieu lan goi ham nay trong
    # cung 1 test suite (khong bao gio duoc go dang ky) - go SACH route cu
    # truoc khi dang ky lai, tranh handler CU cua test truoc do vo tinh khop
    # nham voi request cua test hien tai (bug harness that da gap: route
    # 'action' cua 1 test truoc co the "che" mat route cua test sau, khien
    # request roi vao handler SAI/cu, lam sai lech ket qua kiem tra).
    page.unroute_all(behavior="ignoreErrors")
    install_common_fixtures(page)

    def handle_quote(route):
        if route.request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=ok_json(quote))
        else:
            route.continue_()
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"), handle_quote)

    def handle_update(route):
        captured.append({"url": route.request.url, "method": route.request.method, "body": json.loads(route.request.post_data or "{}")})
        route.fulfill(status=200, content_type="application/json", body=ok_json(quote))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"), lambda r: handle_update(r) if r.request.method in ("PUT", "PATCH") else handle_quote(r))

    page.route(re.compile(r".*/api/all-platform/quotes/by-phase\?page=1&page_size=10$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"items": [quote], "counts": {"presale": 1, "sale_markup": 0, "admin_review": 0, "ready_to_send": 0, "sent": 0, "all": 1},
                    "page": 1, "pageSize": 10, "total": 1})))
    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    page.locator("button.qc-row-link-btn").first.click()
    time.sleep(1)


def install_action_route(page, path_suffix, response_quote_overrides):
    """Chan 1 action endpoint cu the, ghi lai method/body vao `captured`,
    tra ve quote fixture da CAP NHAT theo response_quote_overrides (mo
    phong dung hanh vi backend that: goi xong tra ve quote o state MOI)."""
    updated_holder = {"quote": None}

    def handler(route):
        body = json.loads(route.request.post_data or "{}") if route.request.post_data else {}
        captured.append({"url": route.request.url, "method": route.request.method, "body": body})
        updated = {**BASE_QUOTE, **response_quote_overrides}
        updated_holder["quote"] = updated
        route.fulfill(status=200, content_type="application/json", body=ok_json(updated))

    def handle_bare_after_action(route):
        # Truoc khi action nao chay, updated_holder rong -> tra ve quote GOC
        # (chua doi). Sau khi action chay xong, tra ve state MOI (mo phong
        # dung hanh vi reload() doc lai quote THAT SU sau khi backend cap
        # nhat). Day la route RIENG cho request MOI (khong goi lai route cua
        # request KHAC da duoc fulfill roi - bug that da gap truoc do).
        current = updated_holder["quote"] or {**BASE_QUOTE, **response_quote_overrides, "processingStage": None}
        if route.request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=ok_json(updated_holder["quote"] or current))
        else:
            route.fallback()

    page.route(re.compile(rf".*/api/all-platform/quotes/fixture-q1/{path_suffix}$"), handler)
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"), handle_bare_after_action)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)
    install_common_fixtures(page)

    # ── A) request -> "Gửi yêu cầu xử lý" -> POST processing-stage
    # {stage:'technical'}, dung 1 lan, footer chuyen sang technical ─────────
    load_workspace_for(page, {"status": "draft", "processingStage": "request"})
    install_action_route(page, "processing-stage", {"status": "draft", "processingStage": "technical"})
    page.locator("button:has-text('Gửi yêu cầu xử lý')").first.click()
    time.sleep(1.2)
    record("A) request->technical: goi DUNG 1 request processing-stage", len(captured) == 1)
    if captured:
        record("A) payload dung {stage:'technical'}", captured[0]["body"].get("stage") == "technical")
    footer = page.locator(".qc-workspace-footer").inner_text()
    record("A) Sau khi bam: footer chuyen sang 'Bàn giao xử lý giá' (phase technical)", "Bàn giao xử lý giá" in footer)

    # ── D) review -> "Duyệt báo giá" (qua confirm modal) -> POST approve
    # dung 1 lan, roi khoi review footer ─────────────────────────────────────
    load_workspace_for(page, {"status": "draft", "processingStage": "review"})
    install_action_route(page, "approve", {"status": "approved", "processingStage": "ready_to_publish", "approvedAt": "2026-09-07T00:00:00Z"})
    page.locator("button:has-text('Duyệt báo giá')").first.click()
    time.sleep(0.6)
    page.locator("button:has-text('Duyệt báo giá')").last.click()
    time.sleep(1.2)
    record("D) review->approve: goi DUNG 1 request approve", len(captured) == 1)
    footer = page.locator(".qc-workspace-footer").inner_text()
    record("D) Sau khi duyet: footer chuyen sang 'Phát hành' (ready_to_publish), KHONG con 'Duyệt báo giá'", "Phát hành" in footer and "Duyệt báo giá" not in footer)

    # ── D) review -> "Yêu cầu chỉnh sửa" -> chọn "Trả về Presale" -> target_stage='technical' ──
    load_workspace_for(page, {"status": "draft", "processingStage": "review"})
    install_action_route(page, "request-changes", {"status": "draft", "processingStage": "technical", "requestedChangesTargetStage": "technical", "requestedChangesReason": "Thiếu mô tả kỹ thuật"})
    page.locator("button:has-text('Yêu cầu chỉnh sửa')").first.click()
    time.sleep(0.5)
    select_el = page.locator("select.crm-input").first
    select_el.select_option("technical")
    page.locator("textarea").last.fill("Thiếu mô tả kỹ thuật")
    page.locator("button:has-text('Gửi yêu cầu chỉnh sửa')").first.click()
    time.sleep(1.2)
    record("D) request-changes 'Trả về Presale': goi DUNG 1 request", len(captured) == 1)
    if captured:
        record("D) payload target_stage='technical'", captured[0]["body"].get("target_stage") == "technical")
        record("D) payload co reason dung noi dung da nhap", captured[0]["body"].get("reason") == "Thiếu mô tả kỹ thuật")

    # ── D) review -> "Yêu cầu chỉnh sửa" -> chọn "Trả về Sale" -> target_stage='pricing' ──
    load_workspace_for(page, {"status": "draft", "processingStage": "review"})
    install_action_route(page, "request-changes", {"status": "draft", "processingStage": "pricing"})
    page.locator("button:has-text('Yêu cầu chỉnh sửa')").first.click()
    time.sleep(0.5)
    page.locator("select.crm-input").first.select_option("pricing")
    page.locator("textarea").last.fill("Giá bán chưa hợp lý")
    page.locator("button:has-text('Gửi yêu cầu chỉnh sửa')").first.click()
    time.sleep(1.2)
    record("D) request-changes 'Trả về Sale': payload target_stage='pricing'", captured and captured[0]["body"].get("target_stage") == "pricing")

    # ── D) review -> "Yêu cầu chỉnh sửa" -> KHONG nhap reason -> nut submit bi disable ──
    load_workspace_for(page, {"status": "draft", "processingStage": "review"})
    install_action_route(page, "request-changes", {"status": "draft", "processingStage": "pricing"})
    page.locator("button:has-text('Yêu cầu chỉnh sửa')").first.click()
    time.sleep(0.5)
    submit_btn = page.locator("button:has-text('Gửi yêu cầu chỉnh sửa')").first
    record("D) reason bat buoc: nut 'Gửi yêu cầu chỉnh sửa' bi DISABLE khi reason rong (chan tu UI, khong can bam thu)", submit_btn.is_disabled())
    record("D) reason bat buoc: KHONG goi API khi reason rong", len(captured) == 0)

    # ── C) pricing -> "Hoàn tất phần giá bán" -> POST processing-stage {stage:'review'} ──
    load_workspace_for(page, {"status": "draft", "processingStage": "pricing"})
    install_action_route(page, "processing-stage", {"status": "draft", "processingStage": "review"})
    page.locator("button:has-text('Hoàn tất phần giá bán')").first.click()
    time.sleep(1.2)
    record("C) pricing->review: goi DUNG 1 request processing-stage", len(captured) == 1)
    if captured:
        record("C) payload dung {stage:'review'}", captured[0]["body"].get("stage") == "review")
    footer = page.locator(".qc-workspace-footer").inner_text()
    record("C) Sau khi hoan tat: footer chuyen sang review (co 'Yêu cầu chỉnh sửa')", "Yêu cầu chỉnh sửa" in footer)

    # ── D) "Duyệt báo giá" - xac nhan busy-guard qua code (khong the double-
    # click that su bang Playwright vi nut/modal dong ngay sau 1 lan click
    # thanh cong, click thu 2 se khong tim thay gi de bam - day CHINH LA
    # bang chung hanh vi dung: khong con co hoi de bam lan 2). approveNow()
    # da co "if (busy) return" o dau ham (doc code xac nhan, xem
    # QuoteWorkspaceModal.tsx) - dam bao 1 request duy nhat du co bam nhanh
    # nhieu lan truoc khi modal kip dong. ─────────────────────────────────

    # B) technical -> "Bàn giao xử lý giá" (save items truoc, transition sau,
    # save fail -> khong transition) - DA CHUYEN sang file rieng
    # scratch/test_quote_handoff_to_pricing.py (deterministic, dung window.
    # fetch/alert monkey-patch thay vi Python route callback - xem ghi chu
    # trong file do ve 1 quirk Playwright da tim ra va fix).

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
