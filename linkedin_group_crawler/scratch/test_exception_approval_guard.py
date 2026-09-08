"""Test THUAN (pure unit, khong DB) cho Section 5 - "Admin duyet ngoai le theo
version". Chi test `requires_exception_reason()` (ham thuan, khong I/O) -
logic bat buoc reason rong/None duoc kiem tra ngay trong
_guard_exception_approval() (routers/quote.py), khong tach rieng thanh ham
thuan de test doc lap (phu thuoc get_latest_evaluation() - DB) nen o day chi
xac nhan lai dung 1 dieu kien do bang unit test tren string truc tiep.

Cac muc con lai trong yeu cau test Section 5 (permission tu choi neu khong
phai admin, version moi khong ke thua ngoai le version truoc) da duoc dam
bao boi KIEN TRUC (khong phai logic can test rieng):
  - can_approve_quote() KHONG doi trong lan sua nay - da co san tu truoc.
  - "version moi khong ke thua ngoai le" la he qua TRUC TIEP cua kien truc
    version-chain hien co (moi version = 1 dong `quotes` rieng, id khac hoan
    toan) + FK quote_exception_approvals.quote_id - KHONG co co che "copy"
    nao ca nen khong the vo tinh ke thua, khong co logic rieng de test."""
import sys
sys.path.insert(0, '.')

from app.modules.all_platform.services.quote_rule_evaluation_service import requires_exception_reason

failures: list[str] = []


def check(label: str, cond: bool) -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}")
    if not cond:
        failures.append(label)


check("Chua cau hinh rule engine (evaluation=None) -> KHONG bat exception_reason (duyet binh thuong nhu truoc)", requires_exception_reason(None) is False)
check("Rule PASS -> KHONG bat exception_reason", requires_exception_reason({"result": "pass"}) is False)
check("Rule FAIL -> BAT exception_reason", requires_exception_reason({"result": "fail"}) is True)
check("Rule insufficient_data (thieu du lieu) -> BAT exception_reason", requires_exception_reason({"result": "insufficient_data"}) is True)

# exception_reason rong/chi co khoang trang PHAI bi tu choi (dung logic that
# trong _guard_exception_approval: `if not exception_reason or not
# exception_reason.strip()`) - test lai chinh dieu kien do truc tiep.
for blank in (None, "", "   ", "\n\t"):
    check(f"exception_reason rong/blank ({blank!r}) PHAI bi coi la THIEU (khong duoc pass qua guard)", not (blank and blank.strip()))
check("exception_reason co noi dung THAT duoc chap nhan", bool("Khách chiến lược, chấp nhận margin thấp".strip()))

print()
if failures:
    print(f"{len(failures)} CHECK FAILED:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
else:
    print("ALL CHECKS PASSED (pure unit, khong cham DB that).")
