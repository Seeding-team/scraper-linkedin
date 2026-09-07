"""Unit test THUAN (khong DB that) cho quote_business_role (migration 095):
- update_user_quote_business_role() / list_users_by_quote_business_role()
  (supabase_user_service.py) - mock supabase.
- Permission Admin-only cho POST /users/update-quote-business-role (goi
  THANG ham router, kiem tra HTTPException(403) dung nhu FastAPI se lam).
Chay: python scratch/test_quote_business_role.py
"""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


class FakeQueryResult:
    def __init__(self, data=None):
        self.data = data


class FakeTable:
    def __init__(self, store):
        self.store = store
        self._update_payload = None
        self._filters = {}
        self._in_field = None
        self._in_values = None
        self._select_columns = None

    def update(self, payload):
        self._update_payload = payload
        return self

    def select(self, columns="*", *_a, **_k):
        # Mo phong DUNG hanh vi that cua Supabase: .select("a, b") CHI tra ve
        # dung cac cot duoc liet ke (server-side projection) - khong tra
        # nguyen ca row. Thieu buoc nay se KHONG bat duoc bug lo email/field
        # nhay cam neu code sau nay lo doi .select("*").
        if columns and columns.strip() != "*":
            self._select_columns = [c.strip() for c in columns.split(",")]
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def in_(self, field, values):
        self._in_field = field
        self._in_values = values
        return self

    def order(self, *_a, **_k):
        return self

    def execute(self):
        users = self.store.setdefault("users", [])
        if self._update_payload is not None:
            for u in users:
                if u.get("email") == self._filters.get("email"):
                    u.update(self._update_payload)
            matched = [u for u in users if u.get("email") == self._filters.get("email")]
            return FakeQueryResult(data=matched)
        matches = users
        if "is_active" in self._filters:
            matches = [u for u in matches if u.get("is_active") == self._filters["is_active"]]
        if self._in_field == "quote_business_role":
            matches = [u for u in matches if u.get("quote_business_role") in self._in_values]
        if self._select_columns:
            matches = [{col: u.get(col) for col in self._select_columns} for u in matches]
        return FakeQueryResult(data=matches)


class FakeSupabase:
    def __init__(self, users):
        self.store = {"users": users}

    def table(self, name):
        assert name == "app_users"
        return FakeTable(self.store)


def run():
    from app.modules.all_platform.services import supabase_user_service as svc

    users = [
        {"id": "u-presale", "email": "presale@test.com", "name": "Nguyễn A", "role": "member", "is_active": True, "quote_business_role": "presale"},
        {"id": "u-sale", "email": "sale@test.com", "name": "Trần B", "role": "member", "is_active": True, "quote_business_role": "sale"},
        {"id": "u-both", "email": "both@test.com", "name": "Lê C", "role": "leader", "is_active": True, "quote_business_role": "both"},
        {"id": "u-none", "email": "none@test.com", "name": "Phạm D", "role": "member", "is_active": True, "quote_business_role": None},
        {"id": "u-inactive-presale", "email": "inactive@test.com", "name": "Vũ E", "role": "member", "is_active": False, "quote_business_role": "presale"},
    ]
    fake = FakeSupabase(users)

    with patch.object(svc, "get_supabase_client", return_value=fake), \
         patch.object(svc, "_clear_people_caches", return_value=None), \
         patch.object(svc, "_clear_auth_cache", return_value=None):

        # ── 1) list_users_by_quote_business_role ────────────────────────────
        presale_list = svc.list_users_by_quote_business_role("presale")
        presale_ids = {u["id"] for u in presale_list}
        record("presale picker: gom dung 'presale' + 'both'", presale_ids == {"u-presale", "u-both"})
        record("presale picker: KHONG gom user is_active=False", "u-inactive-presale" not in presale_ids)
        record("presale picker: KHONG gom 'sale' thuan", "u-sale" not in presale_ids)

        sale_list = svc.list_users_by_quote_business_role("sale")
        sale_ids = {u["id"] for u in sale_list}
        record("sale picker: gom dung 'sale' + 'both'", sale_ids == {"u-sale", "u-both"})
        record("sale picker: KHONG gom 'presale' thuan", "u-presale" not in sale_ids)

        record("Response KHONG chua email (allowlist)", all("email" not in u for u in presale_list))

        try:
            svc.list_users_by_quote_business_role("invalid")
            record("target khong hop le -> phai raise ValueError", False)
        except ValueError:
            record("target khong hop le -> raise ValueError dung", True)

        # ── 2) update_user_quote_business_role ──────────────────────────────
        updated = svc.update_user_quote_business_role("none@test.com", "both")
        record("Gan 'both' cho user truoc do None -> thanh cong", updated.get("quote_business_role") == "both")

        cleared = svc.update_user_quote_business_role("presale@test.com", None)
        record("Gan None (bo gan) -> thanh cong", cleared.get("quote_business_role") is None)

        try:
            svc.update_user_quote_business_role("sale@test.com", "invalid_role")
            record("Gia tri khong hop le -> phai raise ValueError", False)
        except ValueError:
            record("Gia tri khong hop le -> raise ValueError dung", True)

    # ── 3) Permission Admin-only cho endpoint POST /update-quote-business-role ──
    from fastapi import HTTPException
    from app.modules.all_platform.routers.users import users_update_quote_business_role

    admin_user = {"id": "u-admin", "role": "admin"}
    leader_user = {"id": "u-leader", "role": "leader"}
    member_user = {"id": "u-member", "role": "member"}

    with patch.object(svc, "get_supabase_client", return_value=FakeSupabase(list(users))), \
         patch.object(svc, "_clear_people_caches", return_value=None), \
         patch.object(svc, "_clear_auth_cache", return_value=None):
        try:
            users_update_quote_business_role({"email": "none@test.com", "quote_business_role": "sale"}, leader_user)
            record("Leader goi update-quote-business-role -> PHAI bi tu choi (403)", False)
        except HTTPException as exc:
            record("Leader goi update-quote-business-role -> HTTPException 403 dung", exc.status_code == 403)

        try:
            users_update_quote_business_role({"email": "none@test.com", "quote_business_role": "sale"}, member_user)
            record("Member goi update-quote-business-role -> PHAI bi tu choi (403)", False)
        except HTTPException as exc:
            record("Member goi update-quote-business-role -> HTTPException 403 dung", exc.status_code == 403)

        result_admin = users_update_quote_business_role({"email": "none@test.com", "quote_business_role": "sale"}, admin_user)
        record("Admin goi update-quote-business-role -> thanh cong (khong raise)", result_admin.success is True)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
