import sys, io, time, json, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"

RESULTS = []
def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")

captured_puts = []


def login(page):
    page.goto(f"{BASE}/auth/login", wait_until="networkidle", timeout=30000)
    page.locator("text=Đăng nhập bằng mật khẩu").first.click()
    time.sleep(0.5)
    page.locator("input[type='email'], input[name='email']").first.fill("admin@gmail.com")
    page.locator("input[type='password']").first.fill("Admin@123456")
    page.locator("button[type='submit']").first.click()
    page.wait_for_load_state("networkidle", timeout=20000)
    time.sleep(1.5)


def install_rule_fixtures(page, active_rule_set):
    def handle_active(route):
        if route.request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "data": active_rule_set}))
        elif route.request.method == "PUT":
            captured_puts.append(json.loads(route.request.post_data or "{}"))
            saved = {
                "id": "ruleset-1", "name": "Bộ quy tắc duyệt báo giá mặc định", "version": 1,
                "autoApproveEnabled": captured_puts[-1].get("autoApproveEnabled", False),
                "rules": [
                    {"ruleType": r["ruleType"], "operator": "gte", "thresholdValue": r["thresholdValue"], "unit": "percent", "isRequired": True, "displayOrder": i + 1, "isActive": True}
                    for i, r in enumerate(captured_puts[-1].get("rules", []))
                ],
            }
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "data": saved}))
        else:
            route.continue_()
    page.route(re.compile(r".*/api/all-platform/quote-approval-rules/active$"), handle_active)
    # rule-evaluation cho create-mode: chua co quote that -> khong goi, nhung
    # phong khi component goi nham, tra ve null an toan.
    page.route(re.compile(r".*/rule-evaluation$"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "data": None})))


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1536, "height": 864})
    page = context.new_page()
    login(page)

    # ============ Test 1: Chua cau hinh -> card hien "Chua cau hinh quy tac" (create-mode) ============
    install_rule_fixtures(page, None)
    page.goto(f"{BASE}/all-platform/quote-center", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    page.locator("button:has-text('Yêu cầu hỗ trợ báo giá')").first.click()
    time.sleep(1.2)

    rule_card = page.locator(".qc-rule-card").first
    record("Rule card render duoc trong create-mode (chua co quote that)", rule_card.count() > 0)
    record("Card hien dung text 'Chưa cấu hình quy tắc' khi active=None", "Chưa cấu hình quy tắc" in rule_card.inner_text())

    settings_btn = page.locator(".qc-rule-settings-btn").first
    record("Admin thay nut 'Cai dat'", settings_btn.count() > 0 and settings_btn.is_visible())

    # ============ Test 2: Mo modal, gia tri mac dinh dung 20/5000000/10/45 ============
    settings_btn.click()
    time.sleep(0.5)
    modal = page.locator(".qc-rule-modal").first
    record("Modal 'Cai dat quy tac bao gia' mo duoc", modal.count() > 0 and modal.is_visible())
    inputs = modal.locator(".qc-rule-modal-row-input input")
    values = [inputs.nth(i).input_value() for i in range(4)]
    record("Gia tri mac dinh prefill dung 20/5000000/10/45", values == ["20", "5000000", "10", "45"], str(values))

    # ============ Test 3: Huy khong goi PUT ============
    page.locator("button:has-text('Hủy')").last.click()
    time.sleep(0.3)
    record("Bam Huy: KHONG co request PUT nao duoc goi", len(captured_puts) == 0)

    # ============ Test 4: Sua nguong + Luu -> goi dung API/payload, hien toast ============
    settings_btn.click()
    time.sleep(0.5)
    inputs2 = page.locator(".qc-rule-modal-row-input input")
    inputs2.nth(0).fill("25")
    page.locator("button:has-text('Lưu quy tắc')").first.click()
    time.sleep(0.8)

    record("Luu: co dung 1 request PUT", len(captured_puts) == 1)
    if captured_puts:
        margin_rule = next(r for r in captured_puts[0]["rules"] if r["ruleType"] == "gross_margin_percent")
        record("Payload PUT: gross_margin_percent threshold = 25 (dung gia tri da sua)", margin_rule["thresholdValue"] == 25)
    record("Sau khi luu: modal tu dong dong", page.locator(".qc-rule-modal").count() == 0)
    toast = page.locator(".qc-workspace-toast")
    record("Sau khi luu: hien toast (KHONG dung window.alert)", toast.count() > 0)

    browser.close()

print()
print("=== SUMMARY ===")
n_fail = sum(1 for _, ok in RESULTS if not ok)
print(f"{len(RESULTS)-n_fail}/{len(RESULTS)} PASS")
print()
print("LUU Y: Toan bo GET/PUT toi /quote-approval-rules/active da bi Playwright")
print("route interception CHAN LAI HOAN TOAN truoc khi roi trinh duyet - KHONG")
print("co byte nao toi backend/DB that cho rule-engine trong test nay.")
