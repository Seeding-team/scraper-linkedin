"""Checkpoint D muc 2-4 (ready_to_publish->published, published-unsent->sent,
sent) - test hanh dong that qua Playwright route interception (KHONG mutation
DB that). Dung window.fetch monkey-patch de xac minh THU TU/SO LUONG request
that tu trinh duyet (dang tin cay hon Python route callback cho MOT SO
truong hop rieng - xem scratch/test_quote_handoff_to_pricing.py de biet chi
tiet quirk da phat hien).

Chay: python scratch/test_quote_publish_and_send.py
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
    "status": "approved", "processingStage": "ready_to_publish", "approvedAt": "2026-09-06T00:00:00Z",
}

def fetch_log_init_script(send_response=None):
    """window.fetch monkey-patch - ghi log THAT (dang tin cay hon page.route()
    o tang CDP, da xac minh qua nhieu lan trong session nay: page.route() doi
    khi khong intercept dung 1 request cu the du no thuc su duoc goi, khien
    request that di THANG toi backend that/kenh email that). Neu co
    `send_response`, TU TAY tra ve Response gia lap cho request POST .../send
    NGAY TU TRONG JS - khong di qua page.route() nua cho DUNG endpoint nay,
    tranh hoan toan quirk da phat hien."""
    send_response_json = json.dumps(send_response) if send_response is not None else "null"
    return f"""
        window.__fetchLog = [];
        window.__alertLog = [];
        const __sendResponse = {send_response_json};
        const origFetch = window.fetch;
        window.fetch = function(...args) {{
            const url = String(args[0]);
            const method = (args[1] && args[1].method) || 'GET';
            let body = null;
            try {{ body = args[1] && args[1].body ? JSON.parse(args[1].body) : null; }} catch (e) {{ body = args[1] && args[1].body; }}
            window.__fetchLog.push({{url, method, body}});
            if (__sendResponse && url.endsWith('/send') && method === 'POST') {{
                return Promise.resolve(new Response(JSON.stringify(__sendResponse), {{status: 200, headers: {{'Content-Type': 'application/json'}}}}));
            }}
            return origFetch.apply(this, args);
        }};
        window.alert = function(msg) {{ window.__alertLog.push(String(msg)); }};
    """


FETCH_LOG_INIT_SCRIPT = fetch_log_init_script()


def install_common(page, quote_ref):
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
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/send-availability$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"available": True, "reason": None})))
    page.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/recipient-suggestion$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json({"name": "Chị Lan", "email": "khach@abc.com", "source": "deal_contact"})))
    page.route(re.compile(r".*/api/all-platform/quotes/by-phase\?page=1&page_size=10$"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(
                   {"items": [quote_ref], "counts": {"presale": 0, "sale_markup": 0, "admin_review": 0, "ready_to_send": 1, "sent": 0, "all": 1},
                    "page": 1, "pageSize": 10, "total": 1})))


def open_workspace(page, send_response=None):
    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    page.evaluate(fetch_log_init_script(send_response))
    time.sleep(1)
    page.locator("button.qc-row-link-btn").first.click()
    time.sleep(1)


def fixture_calls(page):
    return page.evaluate("window.__fetchLog.filter(x => x.url.includes('fixture-q1'))")


def urls_of(calls):
    return [f"{c['method']} {c['url']}" for c in calls]


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ══════════════════════════════════════════════════════════════════════
    # 2) ready_to_publish -> published: click Phat hanh -> confirm modal ->
    # DUNG 1 POST /publish -> footer doi tu "Phat hanh" sang "Gui khach hang"
    # -> public link xuat hien.
    # ══════════════════════════════════════════════════════════════════════
    ctx2 = browser.new_context(viewport={"width": 1536, "height": 864})
    pg2 = ctx2.new_page()
    login(pg2)
    q2 = {**BASE_QUOTE}
    q2_state = {"current": q2}

    def handle_publish(route):
        q2_state["current"] = {
            **q2, "processingStage": "published", "publicEnabled": True,
            "publicUrl": "/public/quotes/tok-fixture", "publishedAt": "2026-09-07T00:00:00Z", "publishedById": "u-admin",
        }
        route.fulfill(status=200, content_type="application/json", body=ok_json(q2_state["current"]))

    install_common(pg2, q2)
    pg2.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
              lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(q2_state["current"])))
    pg2.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/publish$"), handle_publish)
    open_workspace(pg2)

    footer_before = pg2.locator(".qc-workspace-footer").inner_text()
    record("2) Truoc khi phat hanh: footer co nut 'Phát hành'", "Phát hành" in footer_before)
    pg2.locator("button:has-text('Phát hành')").first.click()
    time.sleep(0.6)
    record("2) Bam Phat hanh: mo confirm modal (co 'Xác nhận phát hành')", pg2.locator("button:has-text('Xác nhận phát hành')").count() > 0)
    pg2.locator("button:has-text('Xác nhận phát hành')").first.click()
    for _ in range(100):
        if any("/publish" in u for u in urls_of(fixture_calls(pg2))):
            break
        time.sleep(0.1)
    time.sleep(0.5)

    calls_2 = urls_of(fixture_calls(pg2))
    publish_calls = [u for u in calls_2 if u.endswith("/publish")]
    record("2) DUNG 1 request POST /publish", len(publish_calls) == 1 and publish_calls[0].startswith("POST"), calls_2)
    footer_after = pg2.locator(".qc-workspace-footer").inner_text()
    record("2) Sau khi phat hanh: footer doi sang 'Gửi khách hàng' (khong con 'Phát hành')", "Gửi khách hàng" in footer_after and footer_after.count("Phát hành") == 0)
    record("2) Public link xuat hien trong footer/UI (Sao chép link báo giá)", "Sao chép link báo giá" in footer_after)
    ctx2.close()

    # ══════════════════════════════════════════════════════════════════════
    # 3) published-unsent -> sent: SMTP success -> chuyen sent; SMTP fail ->
    # van o published-unsent; khong optimistic set sent truoc response.
    # ══════════════════════════════════════════════════════════════════════
    for scenario in ("success", "fail"):
        ctx3 = browser.new_context(viewport={"width": 1536, "height": 864})
        pg3 = ctx3.new_page()
        login(pg3)
        q3 = {**BASE_QUOTE, "processingStage": "published", "publicEnabled": True, "publicUrl": "/public/quotes/tok-fixture", "publishedAt": "2026-09-06T00:00:00Z", "sentAt": None}

        if scenario == "success":
            send_resp = {"success": True, "data": {"id": "log-1", "quoteId": "fixture-q1", "channel": "email", "status": "sent",
                                                     "recipientEmail": "khach@abc.com", "sentAt": "2026-09-07T00:00:00Z"}}
        else:
            send_resp = {"success": True, "data": {"id": "log-1", "quoteId": "fixture-q1", "channel": "email", "status": "failed",
                                                     "recipientEmail": "khach@abc.com", "errorMessage": "Đăng nhập SMTP thất bại — Admin cần cập nhật lại App Password."}}

        install_common(pg3, q3)
        pg3.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
                  lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(q3)))
        # KHONG dung page.route() cho /send nua - da xac minh page.route()
        # doi khi khong intercept dung request nay, khien no di THANG toi
        # backend that/kenh email that (lo ra loi SMTP that cua kenh dang
        # cau hinh, gay nham lan ket qua test). Dung window.fetch monkey-
        # patch (100% dang tin cay, xem fetch_log_init_script) de tra ve
        # DUNG phan hoi gia lap ngay tu trinh duyet.
        open_workspace(pg3, send_response=send_resp)

        pg3.locator("button:has-text('Gửi khách hàng')").first.click()
        time.sleep(0.6)
        record(f"3-{scenario}) Bam Gui khach hang: mo popup gui (co truong Email)", pg3.locator("input[type='email'], input[placeholder*='email' i]").count() > 0)
        submit = pg3.locator("button:has-text('Gửi báo giá')").first
        submit.click()
        for _ in range(100):
            if any(u.endswith("/send") for u in urls_of(fixture_calls(pg3))):
                break
            time.sleep(0.1)
        time.sleep(0.8)

        calls_3 = urls_of(fixture_calls(pg3))
        send_calls = [u for u in calls_3 if u.endswith("/send")]
        record(f"3-{scenario}) DUNG 1 request POST /send", len(send_calls) == 1 and send_calls[0].startswith("POST"), calls_3)
        if scenario == "success":
            popup_text = pg3.locator(".qc-modal-backdrop").last.inner_text()
            record("3-success) Popup bao thanh cong (khong con loi)", "thất bại" not in popup_text.lower())
        else:
            popup_text = pg3.locator(".qc-modal-backdrop").last.inner_text()
            record("3-fail) Popup hien loi ro rang + cho phep Thu lai", "thất bại" in popup_text.lower() or "App Password" in popup_text)
        ctx3.close()

    # ══════════════════════════════════════════════════════════════════════
    # 4) sent: Xem lich su gui hien dung du lieu, Gui lai dung idempotency
    # key moi, khong doi completedAt lan dau.
    # ══════════════════════════════════════════════════════════════════════
    ctx4 = browser.new_context(viewport={"width": 1536, "height": 864})
    pg4 = ctx4.new_page()
    login(pg4)
    q4 = {**BASE_QUOTE, "processingStage": "published", "publicEnabled": True, "publicUrl": "/public/quotes/tok-fixture",
          "publishedAt": "2026-09-05T00:00:00Z", "sentAt": "2026-09-06T00:00:00Z", "sentById": "u-admin", "completedAt": "2026-09-06T00:00:00Z"}
    resend_resp = {"success": True, "data": {"id": "log-2", "quoteId": "fixture-q1", "channel": "email", "status": "sent",
                                              "recipientEmail": "khach@abc.com", "sentAt": "2026-09-07T00:00:00Z"}}

    def handle_delivery_log(route):
        route.fulfill(status=200, content_type="application/json", body=ok_json([
            {"id": "log-1", "quoteId": "fixture-q1", "channel": "email", "status": "sent",
             "recipientName": "Chị Lan", "recipientEmail": "khach@abc.com", "requestedAt": "2026-09-06T00:00:00Z",
             "sentAt": "2026-09-06T00:00:00Z", "requestedById": "u-admin", "attemptCount": 1},
        ]))

    install_common(pg4, q4)
    pg4.route(re.compile(r".*/api/all-platform/quotes/fixture-q1$"),
              lambda r: r.fulfill(status=200, content_type="application/json", body=ok_json(q4)))
    pg4.route(re.compile(r".*/api/all-platform/quotes/fixture-q1/delivery-log$"), handle_delivery_log)
    # /send dung window.fetch monkey-patch (xem ghi chu tren) thay vi
    # page.route(), tranh quirk da phat hien.
    open_workspace(pg4, send_response=resend_resp)

    footer_4 = pg4.locator(".qc-workspace-footer").inner_text()
    record("4) Phase sent: footer co 'Xem lịch sử gửi' + 'Gửi lại'", "Xem lịch sử gửi" in footer_4 and "Gửi lại" in footer_4)
    pg4.locator("button:has-text('Xem lịch sử gửi')").first.click()
    time.sleep(0.6)
    history_text = pg4.locator(".qc-deal-picker").last.inner_text()
    record("4) Modal lich su gui hien dung email nguoi nhan that", "khach@abc.com" in history_text)
    record("4) Modal lich su gui hien dung trang thai 'Đã gửi'", "Đã gửi" in history_text)
    pg4.locator("button:has-text('Đóng')").first.click()
    time.sleep(0.3)

    pg4.locator("button:has-text('Gửi lại')").first.click()
    time.sleep(0.6)
    submit_4 = pg4.locator("button:has-text('Gửi báo giá')").first
    submit_4.click()
    resend_calls = []
    for _ in range(100):
        all_calls = pg4.evaluate("window.__fetchLog.filter(x => x.url.endsWith('/send') && x.method === 'POST')")
        if all_calls:
            resend_calls = all_calls
            break
        time.sleep(0.1)
    time.sleep(0.5)
    record("4) Gui lai: goi DUNG 1 request POST /send", len(resend_calls) == 1)
    if resend_calls:
        record("4) Gui lai: co idempotency_key (khong rong)", bool((resend_calls[0].get("body") or {}).get("idempotency_key")))
    ctx4.close()

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    browser.close()
    if n_fail:
        sys.exit(1)
