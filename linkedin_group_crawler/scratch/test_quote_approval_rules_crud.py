"""Unit test THUAN (khong DB that) cho quote_rule_evaluation_service.py
phan CRUD rule-set (save_rule_set/get_active_rule_set_for_api) +
can_manage_quote_approval_rules - mock get_supabase_client().
Chay: python scratch/test_quote_approval_rules_crud.py
"""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


VALID_RULES = [
    {"ruleType": "gross_margin_percent", "thresholdValue": 20, "isRequired": True, "isActive": True},
    {"ruleType": "gross_profit_amount", "thresholdValue": 5_000_000, "isRequired": True, "isActive": True},
    {"ruleType": "discount_percent", "thresholdValue": 10, "isRequired": True, "isActive": True},
    {"ruleType": "payment_terms_days", "thresholdValue": 45, "isRequired": True, "isActive": True},
]


class FakeQueryResult:
    def __init__(self, data=None):
        self.data = data


class FakeRuleSetTable:
    """Mo phong bang quote_approval_rule_sets - luu 1 danh sach rule_set
    trong bo nho (store['rule_sets']), luon tra ve dong active nhat khi
    is_active=True duoc query."""
    def __init__(self, store):
        self.store = store
        self._filters = {}
        self._update_payload = None
        self._insert_payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def execute(self):
        rule_sets = self.store.setdefault("rule_sets", [])
        if self._insert_payload is not None:
            row = dict(self._insert_payload)
            row["id"] = f"ruleset-{len(rule_sets) + 1}"
            rule_sets.append(row)
            return FakeQueryResult(data=[row])
        if self._update_payload is not None:
            for row in rule_sets:
                if row["id"] == self._filters.get("id"):
                    row.update(self._update_payload)
            return FakeQueryResult(data=None)
        # select query - filter theo is_active neu co
        matches = rule_sets
        if "is_active" in self._filters:
            matches = [r for r in matches if r.get("is_active") == self._filters["is_active"]]
        if "id" in self._filters:
            matches = [r for r in matches if r["id"] == self._filters["id"]]
        if getattr(self, "_maybe_single", False) and not matches:
            # Mo phong DUNG hanh vi that cua postgrest-py: .maybe_single()
            # tra ve None THANG khi khong co dong nao khop (khong phai 1
            # response object voi .data=None) - day la bug that da gap
            # (get_active_rule_set() doc .data ma khong kiem tra None truoc).
            return None
        return FakeQueryResult(data=(matches[0] if matches else None))


class FakeRulesTable:
    def __init__(self, store):
        self.store = store
        self._filters = {}
        self._insert_payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def order(self, *_a, **_k):
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def execute(self):
        rules = self.store.setdefault("rules", [])
        if self._insert_payload is not None:
            for row in self._insert_payload:
                new_row = dict(row)
                new_row["id"] = f"rule-{len(rules) + 1}"
                rules.append(new_row)
            return FakeQueryResult(data=self._insert_payload)
        matches = rules
        if "rule_set_id" in self._filters:
            matches = [r for r in matches if r["rule_set_id"] == self._filters["rule_set_id"]]
        if "is_active" in self._filters:
            matches = [r for r in matches if r.get("is_active") == self._filters["is_active"]]
        return FakeQueryResult(data=matches)


class FakeRpcCall:
    """Mo phong DUNG logic transactional cua RPC SQL that
    (quote_save_approval_rule_set, migration 094) tren cung 1 bo nho -
    idempotency check, tang version, insert rule_set + rules, CHI deactivate
    ban cu SAU KHI insert du 4 rule thanh cong."""
    def __init__(self, store, name, params):
        self.store = store
        self.name = name
        self.params = params

    def execute(self):
        if self.name != "quote_save_approval_rule_set":
            raise AssertionError(f"RPC khong duoc mock trong test nay: {self.name}")
        rule_sets = self.store.setdefault("rule_sets", [])
        rules = self.store.setdefault("rules", [])
        key = self.params["p_idempotency_key"]
        if not key or not key.strip():
            raise Exception("idempotency_key_required")
        existing_by_key = next((rs for rs in rule_sets if rs.get("idempotency_key") == key), None)
        if existing_by_key:
            return FakeQueryResult(data=existing_by_key)

        rules_payload = self.params["p_rules"]
        if len(rules_payload) != 4:
            raise Exception("quote_approval_rules_must_have_exactly_4")

        current_active = next((rs for rs in rule_sets if rs.get("is_active")), None)
        next_version = (current_active["version"] + 1) if current_active else 1

        new_row = {
            "id": f"ruleset-{len(rule_sets) + 1}",
            "name": (self.params.get("p_name") or (current_active["name"] if current_active else "Bộ quy tắc duyệt báo giá mặc định")),
            "version": next_version,
            "is_active": True,
            "auto_approve_enabled": self.params["p_auto_approve_enabled"],
            "idempotency_key": key,
            "created_by": (current_active["created_by"] if current_active else self.params["p_actor_id"]),
            "updated_by": self.params["p_actor_id"],
        }
        rule_sets.append(new_row)
        for rule in rules_payload:
            new_rule = dict(rule)
            new_rule["id"] = f"rule-{len(rules) + 1}"
            new_rule["rule_set_id"] = new_row["id"]
            rules.append(new_rule)

        if current_active:
            current_active["is_active"] = False

        return FakeQueryResult(data=new_row)


class FakeRpcCallFunctionNotFound:
    """Mo phong dung PostgREST khi RPC CHUA ton tai (migration 094 chua
    apply) - loi 'Could not find the function ... in the schema cache'."""
    def execute(self):
        raise Exception("Could not find the function public.quote_save_approval_rule_set in the schema cache")


class FakeSupabase:
    def __init__(self, rpc_missing: bool = False):
        self.store = {}
        self.rpc_missing = rpc_missing

    def table(self, name):
        if name == "quote_approval_rule_sets":
            return FakeRuleSetTable(self.store)
        if name == "quote_approval_rules":
            return FakeRulesTable(self.store)
        raise AssertionError(f"Bang khong duoc mock trong test nay: {name}")

    def rpc(self, name, params):
        if self.rpc_missing:
            return FakeRpcCallFunctionNotFound()
        return FakeRpcCall(self.store, name, params)


def run():
    from app.modules.all_platform.services import quote_rule_evaluation_service as svc
    from app.modules.all_platform.services.crm_permission_service import can_manage_quote_approval_rules

    # ── 1. Permission matrix ────────────────────────────────────────────────
    record("Admin manage rules -> allowed", can_manage_quote_approval_rules({"role": "admin"}) is True)
    record("Leader manage rules -> allowed", can_manage_quote_approval_rules({"role": "leader"}) is True)
    record("Member manage rules -> denied", can_manage_quote_approval_rules({"role": "member"}) is False)
    record("Anonymous manage rules -> denied", can_manage_quote_approval_rules(None) is False)

    # ── 2. Chua co rule-set nao -> get_active tra ve None ──────────────────
    fake = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake):
        record("Chua co rule-set: get_active_rule_set_for_api() = None", svc.get_active_rule_set_for_api() is None)

        # ── 3. Luu lan dau -> version=1, du 4 rule ──────────────────────────
        saved = svc.save_rule_set(VALID_RULES, auto_approve_enabled=False, actor_id="u-admin", idempotency_key="key-1")
        record("Luu lan dau: version=1", saved["version"] == 1)
        record("Luu lan dau: du 4 rule", len(saved["rules"]) == 4)
        record("Luu lan dau: autoApproveEnabled=False (mac dinh)", saved["autoApproveEnabled"] is False)
        margin_rule = next(r for r in saved["rules"] if r["ruleType"] == "gross_margin_percent")
        record("Luu lan dau: gross_margin_percent threshold=20, operator='gte'", margin_rule["thresholdValue"] == 20 and margin_rule["operator"] == "gte")

        # ── 3b. Goi lai CUNG idempotency_key (double-click/network retry) -> KHONG tao them version ──
        saved_dup = svc.save_rule_set(VALID_RULES, auto_approve_enabled=False, actor_id="u-admin", idempotency_key="key-1")
        record("Idempotency: goi lai cung key -> van la version=1 (khong tao version 2)", saved_dup["version"] == 1)
        record("Idempotency: khong co rule_set thu 2 nao duoc tao", len(fake.store["rule_sets"]) == 1)

        # ── 4. Luu lan 2 (sua threshold, key MOI) -> version=2, KHONG sua de version 1 ──
        updated_rules = [dict(r) for r in VALID_RULES]
        updated_rules[0]["thresholdValue"] = 25  # gross_margin_percent 20 -> 25
        saved2 = svc.save_rule_set(updated_rules, auto_approve_enabled=True, actor_id="u-admin-2", idempotency_key="key-2")
        record("Luu lan 2: version=2 (KHONG ghi de version 1)", saved2["version"] == 2)
        record("Luu lan 2: autoApproveEnabled=True dung nhu gui len", saved2["autoApproveEnabled"] is True)
        old_row = next(r for r in fake.store["rule_sets"] if r["version"] == 1)
        record("Sau khi luu lan 2: rule-set version 1 CU bi is_active=False (khong bi XOA)", old_row["is_active"] is False)
        record("Sau khi luu lan 2: van con 2 rule_sets trong DB (version cu KHONG mat)", len(fake.store["rule_sets"]) == 2)

        # get_active bay gio phai tra ve version 2
        active_now = svc.get_active_rule_set_for_api()
        record("get_active_rule_set_for_api() sau lan luu 2 -> dung version=2", active_now["version"] == 2)

    # ── 5. Validate: threshold khong hop le -> RuleValidationError ─────────
    fake2 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake2):
        invalid_rules = [dict(r) for r in VALID_RULES]
        invalid_rules[0]["thresholdValue"] = 150  # gross_margin_percent > 100
        try:
            svc.save_rule_set(invalid_rules, False, "u-admin", "key-invalid")
            record("Threshold gross_margin_percent=150 (>100) -> phai raise RuleValidationError", False)
        except svc.RuleValidationError:
            record("Threshold gross_margin_percent=150 (>100) -> raise RuleValidationError dung", True)
        record("Sau loi validate: KHONG ghi rule_sets nao (fail truoc khi insert)", "rule_sets" not in fake2.store or len(fake2.store.get("rule_sets", [])) == 0)

    # ── 6. Thieu 1 rule_type -> RuleValidationError ─────────────────────────
    fake3 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake3):
        missing_rules = [r for r in VALID_RULES if r["ruleType"] != "payment_terms_days"]
        try:
            svc.save_rule_set(missing_rules, False, "u-admin", "key-missing")
            record("Thieu rule 'payment_terms_days' -> phai raise RuleValidationError", False)
        except svc.RuleValidationError:
            record("Thieu rule 'payment_terms_days' -> raise RuleValidationError dung", True)

    # ── 7. payment_terms_days=0 (khong > 0) -> invalid ─────────────────────
    fake4 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake4):
        zero_terms = [dict(r) for r in VALID_RULES]
        for r in zero_terms:
            if r["ruleType"] == "payment_terms_days":
                r["thresholdValue"] = 0
        try:
            svc.save_rule_set(zero_terms, False, "u-admin", "key-zero")
            record("payment_terms_days=0 -> phai raise RuleValidationError (phai >0)", False)
        except svc.RuleValidationError:
            record("payment_terms_days=0 -> raise RuleValidationError dung (phai >0)", True)

    # ── 7b. Thieu idempotency_key -> RuleValidationError (khong goi toi RPC) ──
    fake5 = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake5):
        try:
            svc.save_rule_set(VALID_RULES, False, "u-admin", "")
            record("idempotency_key rong -> phai raise RuleValidationError", False)
        except svc.RuleValidationError:
            record("idempotency_key rong -> raise RuleValidationError dung", True)

    # ── 7c. Migration 094 (RPC) CHUA apply -> fallback an toan, khong crash ──
    fake6 = FakeSupabase(rpc_missing=True)
    with patch.object(svc, "get_supabase_client", return_value=fake6):
        saved_fallback = svc.save_rule_set(VALID_RULES, False, "u-admin", "key-fallback")
        record("RPC chua ton tai: fallback KHONG crash, version=1", saved_fallback["version"] == 1)
        record("RPC chua ton tai: fallback van du 4 rule", len(saved_fallback["rules"]) == 4)

    # ── 8. should_auto_approve() - quyet dinh workflow (docs lap voi router) ──
    record("4/4 pass + autoApproveEnabled=True -> should_auto_approve=True", svc.should_auto_approve({"result": "pass", "autoApproveEnabled": True}) is True)
    record("4/4 pass + autoApproveEnabled=False -> should_auto_approve=False (mac dinh OFF)", svc.should_auto_approve({"result": "pass", "autoApproveEnabled": False}) is False)
    record("1 rule fail + autoApproveEnabled=True -> should_auto_approve=False", svc.should_auto_approve({"result": "fail", "autoApproveEnabled": True}) is False)
    record("insufficient_data + autoApproveEnabled=True -> should_auto_approve=False", svc.should_auto_approve({"result": "insufficient_data", "autoApproveEnabled": True}) is False)
    record("Chua co rule-set (evaluation=None) -> should_auto_approve=False", svc.should_auto_approve(None) is False)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
