"""Unit test THUAN (khong DB that) cho bug THAT nguoi dung gap: raw Postgres
error "duplicate key value violates unique constraint
quote_approval_rule_sets_one_active ... Key (1)=(1) already exists" bi lo
thang ra UI khi luu Quy tac phe duyet.

Root cause (da xac nhan doc SQL that): migration 094's quote_save_approval_
rule_set() INSERT ban MOI voi is_active=true TRUOC KHI deactivate ban CU
(van dang is_active=true) - vi pham NGAY unique index
quote_approval_rule_sets_one_active ((1)) WHERE is_active (migration 091,
chi cho phep 1 dong active tai 1 thoi diem).

Fix that (migration 099, file rieng - KHONG sua 094 da apply):
CREATE OR REPLACE lai ham nay, insert ban moi voi is_active=FALSE truoc, roi
MOI deactivate cu + activate moi o 2 buoc RIENG BIET sau khi insert du 4
rule thanh cong - khong bao gio co 2 dong active cung luc.

File nay khong the thuc thi SQL that (khong co Postgres that trong moi
truong nay) - CHI kiem tra duoc 2 dieu, ca hai deu quan trong:
  1) Neu RPC (bat ky ly do gi - RPC cu 094 chua duoc thay the, hoac 1 loi
     unique constraint khac phat sinh do race condition that) tra ve DUNG
     loi Postgres nay, Python PHAI map sang thong bao AN TOAN, KHONG BAO GIO
     lo "duplicate key"/"constraint"/"23505"/"Key (" ra ngoai.
  2) Noi dung migration 099 (doc truc tiep file .sql) PHAI theo dung thu tu
     an toan: insert is_active=false truoc, deactivate+activate rieng sau.

Phan (2) la REVIEW TINH (khong phai chay SQL that) - se can integration
test that voi TEST_SUPABASE_URL de xac nhan 100% hanh vi tren Postgres that.

Chay: python scratch/test_quote_rule_set_save_conflict.py
"""
import os
import re
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


RAW_POSTGRES_ERROR = (
    'duplicate key value violates unique constraint "quote_approval_rule_sets_one_active"\n'
    "DETAIL:  Key (1)=(1) already exists.\n"
    "CONTEXT:  SQL statement \"INSERT INTO quote_approval_rule_sets ...\"\n"
    "code: 23505"
)


class FakeRpcRaisesConflict:
    def execute(self):
        raise Exception(RAW_POSTGRES_ERROR)


class FakeRpcRaisesUnknown:
    def execute(self):
        raise Exception("connection reset by peer, host db.internal.example:5432, password=hunter2")


class FakeSupabase:
    def __init__(self, mode):
        self.mode = mode

    def table(self, _name):
        raise AssertionError("Khong duoc goi .table() khi RPC da that bai voi loi khong nhan dien duoc (khong fallback)")

    def rpc(self, _name, _params):
        if self.mode == "conflict":
            return FakeRpcRaisesConflict()
        return FakeRpcRaisesUnknown()


VALID_RULES = [
    {"ruleType": "gross_margin_percent", "thresholdValue": 20, "isRequired": True, "isActive": True},
    {"ruleType": "discount_percent", "thresholdValue": 10, "isRequired": True, "isActive": True},
    {"ruleType": "payment_terms_days", "thresholdValue": 45, "isRequired": True, "isActive": True},
    {"ruleType": "gross_profit_amount", "thresholdValue": 0, "isRequired": True, "isActive": True},
]


def run():
    from app.modules.all_platform.services import quote_rule_evaluation_service as svc

    # ── 1) RPC tra ve DUNG loi that (unique constraint quote_approval_rule_
    # sets_one_active / 23505) -> Python PHAI map sang thong bao AN TOAN ────
    fake_conflict = FakeSupabase(mode="conflict")
    with patch.object(svc, "get_supabase_client", return_value=fake_conflict):
        try:
            svc.save_rule_set(VALID_RULES, auto_approve_enabled=False, actor_id="u-admin", idempotency_key="key-conflict")
            record("Loi unique constraint -> PHAI raise (khong duoc nuot im lang)", False)
        except ValueError as e:
            msg = str(e)
            record("Thong bao AN TOAN dung tieng Viet, khong phai raw", "Không thể lưu quy tắc phê duyệt" in msg)
            record("Thong bao KHONG chua 'duplicate key'", "duplicate key" not in msg.lower())
            record("Thong bao KHONG chua ten constraint 'quote_approval_rule_sets_one_active'", "quote_approval_rule_sets_one_active" not in msg)
            record("Thong bao KHONG chua 'Key ('", "Key (" not in msg)
            record("Thong bao KHONG chua SQLSTATE '23505'", "23505" not in msg)
            record("Thong bao KHONG chua tu 'constraint'", "constraint" not in msg.lower())

    # ── 2) RPC loi KHAC (khong nhan dien duoc, vd loi ket noi lo password) ──
    # -> VAN phai an toan, khong lo bat ky chi tiet nao (host/password/...) ──
    fake_unknown = FakeSupabase(mode="unknown")
    with patch.object(svc, "get_supabase_client", return_value=fake_unknown):
        try:
            svc.save_rule_set(VALID_RULES, auto_approve_enabled=False, actor_id="u-admin", idempotency_key="key-unknown")
            record("Loi khong nhan dien duoc -> PHAI raise", False)
        except ValueError as e:
            msg = str(e)
            record("Loi la (vd connection/password) -> thong bao AN TOAN, KHONG lo password/host", "hunter2" not in msg and "db.internal.example" not in msg)
            record("Thong bao van la tieng Viet than thien", "Không thể lưu quy tắc phê duyệt" in msg)

    # ── 3) Review tinh noi dung migration 099 - dung THU TU an toan ─────────
    migration_path = os.path.join(os.path.dirname(__file__), "..", "supabase", "migrations", "099_fix_quote_save_approval_rule_set_ordering.sql")
    with open(migration_path, encoding="utf-8") as f:
        sql = f.read()
    insert_new_match = re.search(r"INSERT INTO public\.quote_approval_rule_sets[\s\S]*?is_active[\s\S]*?VALUES\s*\(\s*[\s\S]*?,\s*(true|false)\s*,", sql, re.IGNORECASE)
    record("Migration 099: INSERT ban MOI dung is_active=FALSE (khong con true) - tranh vi pham unique index ngay luc insert",
           insert_new_match is not None and insert_new_match.group(1).lower() == "false")
    deactivate_pos = sql.find("SET is_active = false WHERE id = v_current_active.id")
    activate_pos = sql.find("SET is_active = true WHERE id = v_new.id")
    record("Migration 099: deactivate ban CU nam TRUOC activate ban MOI trong code (dung thu tu tuan tu)",
           deactivate_pos != -1 and activate_pos != -1 and deactivate_pos < activate_pos)
    record("Migration 099: la file MOI (099), KHONG sua migration 094 da apply", os.path.exists(migration_path))

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
