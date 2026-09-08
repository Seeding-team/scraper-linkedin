"""Unit test THUAN (khong DB that) cho:
1) get_member_options() / get_user_by_id() (supabase_user_service.py) - allowlist
   DTO cho picker "Người phụ trách dự án": khong tra email, loc active-only
   mac dinh, include_id ep tra them nguoi da vo hieu hoa, kem team names dung.
2) _validate_manager_id() trong create_project()/update_project() - tu choi
   manager_id khong ton tai bang thong bao tieng Viet sach (khong FK error tho).

Chay: python scratch/test_member_options_owner_picker.py
"""
import io
import os
import sys
from unittest.mock import patch

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


class FakeQueryResult:
    def __init__(self, data=None):
        self.data = data


class FakeTable:
    def __init__(self, store, name):
        self.store = store
        self.name = name
        self._filters = {}
        self._in_field = None
        self._in_values = None
        self._limit = None
        self._maybe_single = False
        self._update_payload = None
        self._insert_payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def in_(self, field, values):
        self._in_field = field
        self._in_values = set(values)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def _matching_rows(self):
        rows = list(self.store.get(self.name, []))
        for field, value in self._filters.items():
            rows = [r for r in rows if r.get(field) == value]
        if self._in_field is not None:
            rows = [r for r in rows if r.get(self._in_field) in self._in_values]
        return rows

    def execute(self):
        query_calls.append(self.name)
        if self._insert_payload is not None:
            new_row = dict(self._insert_payload)
            new_row.setdefault("id", f"new-{len(self.store.setdefault(self.name, []))}")
            self.store.setdefault(self.name, []).append(new_row)
            return FakeQueryResult(data=[new_row])
        if self._update_payload is not None:
            rows = self._matching_rows()
            for r in rows:
                r.update(self._update_payload)
            return FakeQueryResult(data=rows)
        rows = self._matching_rows()
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._maybe_single:
            return FakeQueryResult(data=(rows[0] if rows else None))
        return FakeQueryResult(data=rows)


class FakeSupabase:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return FakeTable(self.store, name)


query_calls: list[str] = []

USERS = [
    {"id": "u-admin", "name": "Admin Root", "email": "admin@x.com", "role": "admin", "is_active": True, "quote_business_role": None},
    {"id": "u-leader", "name": "Lê Leader", "email": "leader@x.com", "role": "leader", "is_active": True, "quote_business_role": None},
    {"id": "u-member", "name": "Minh Member", "email": "minh@x.com", "role": "member", "is_active": True, "quote_business_role": "presale"},
    {"id": "u-inactive", "name": "Cũ Đã Nghỉ", "email": "cu@x.com", "role": "member", "is_active": False, "quote_business_role": "sale"},
    {"id": "u-inactive-2", "name": "Khác Đã Nghỉ", "email": "khac@x.com", "role": "member", "is_active": False, "quote_business_role": "sale"},
]
TEAMS = [{"id": "team-1", "name_team": "Team Sale", "created_at": "2026-01-01"}]
MOT = [{"id_member": "u-member", "id_teams": "team-1"}]


def run_member_options():
    from app.modules.all_platform.services import supabase_user_service as svc

    store = {"app_users": USERS, "teams": TEAMS, "member_of_teams": MOT}
    fake = FakeSupabase(store)

    with patch.object(svc, "get_supabase_client", return_value=fake), \
         patch.object(svc, "get_all_teams", return_value=TEAMS):
        active = svc.get_member_options(active_only=True)
        record("Active-only: tra dung 3 nguoi (admin/leader/member), KHONG co inactive",
               {o["id"] for o in active} == {"u-admin", "u-leader", "u-member"}, [o["id"] for o in active])
        record("Khong loc theo quote_business_role - Admin/Leader (quote_business_role=None) van xuat hien",
               any(o["id"] == "u-admin" for o in active) and any(o["id"] == "u-leader" for o in active))
        record("Khong tra field email trong DTO", all("email" not in o for o in active))
        member = next(o for o in active if o["id"] == "u-member")
        record("Team names dung (Team Sale)", member["teamNames"] == ["Team Sale"], member["teamNames"])
        record("systemRole/quoteBusinessRole dung", member["systemRole"] == "member" and member["quoteBusinessRole"] == "presale")

        with_include = svc.get_member_options(active_only=True, include_ids=["u-inactive"])
        record("include_ids ep tra them nguoi da vo hieu hoa (dung cho form Sua)",
               any(o["id"] == "u-inactive" for o in with_include))
        inactive_opt = next(o for o in with_include if o["id"] == "u-inactive")
        record("Nguoi bi ep tra van dung isActive=False (de FE hien badge 'Đã ngưng hoạt động')",
               inactive_opt["isActive"] is False)

        all_rows = svc.get_member_options(active_only=False)
        record("active=False tra tat ca nguoi (dung cho audit/all)", len(all_rows) == len(USERS))

        one = svc.get_member_option_by_id("u-inactive")
        record("get_user_by_id tra dung 1 nguoi, khong co email", one is not None and "email" not in one)
        none_ = svc.get_member_option_by_id("khong-ton-tai")
        record("get_user_by_id tra None cho id khong ton tai", none_ is None)


def run_manager_id_validation():
    from app.modules.all_platform.services import supabase_project_service as psvc
    from app.modules.all_platform.services import supabase_user_service as usvc

    store = {"app_users": USERS, "projects": []}
    fake = FakeSupabase(store)

    with patch.object(usvc, "get_supabase_client", return_value=fake), \
         patch.object(psvc, "get_supabase_client", return_value=fake):
        try:
            psvc._validate_manager_id("u-member")
            record("_validate_manager_id: chap nhan id ton tai", True)
        except ValueError:
            record("_validate_manager_id: chap nhan id ton tai", False)

        try:
            psvc._validate_manager_id("uuid-khong-ton-tai")
            record("_validate_manager_id: TU CHOI id khong ton tai", False)
        except ValueError as e:
            record("_validate_manager_id: TU CHOI id khong ton tai", "không hợp lệ" in str(e) or "không còn tồn tại" in str(e), str(e))

        try:
            psvc._validate_manager_id(None)
            record("_validate_manager_id: None (chua gan) duoc chap nhan", True)
        except ValueError:
            record("_validate_manager_id: None (chua gan) duoc chap nhan", False)

        # ── create_project: manager inactive -> tu choi; active -> OK ──────
        try:
            psvc.create_project({"project_code": "DA-X1", "name": "Test 1", "customer_id": "cust-1", "manager_id": "u-inactive"}, actor_id="u-admin")
            record("create_project: TU CHOI manager_id dang inactive", False)
        except ValueError as e:
            record("create_project: TU CHOI manager_id dang inactive", "ngừng hoạt động" in str(e), str(e))

        created = psvc.create_project({"project_code": "DA-X2", "name": "Test 2", "customer_id": "cust-1", "manager_id": "u-member"}, actor_id="u-admin")
        record("create_project: chap nhan manager_id dang active", created["managerId"] == "u-member")

        # ── update_project: chi doi status, KHONG dong den manager_id ──────
        # -> Project cu (dang co manager_id="u-inactive" tu truoc, gia su da
        # bi vo hieu hoa SAU khi gan) khong duoc bi "sua hong" chi vi Luu 1
        # thay doi khac khong lien quan.
        store["projects"].append({"id": "proj-old", "project_code": "DA-OLD", "name": "Cu", "customer_id": "cust-1", "status": "planning", "manager_id": "u-inactive", "team_id": None, "created_by": "u-admin", "created_at": "2026-01-01", "updated_at": "2026-01-01"})
        updated = psvc.update_project("proj-old", {"status": "active"}, actor_id="u-admin")
        record("update_project: sua field khac (status) KHONG lam mat/hong manager_id cu dang inactive", updated["managerId"] == "u-inactive")
        record("update_project: status duoc cap nhat dung", updated["status"] == "active")

        # ── update_project: resend DUNG manager_id cu (dang inactive) - cho
        # qua vi khong doi nguoi phu trach, khong duoc bat loi ──────────────
        try:
            resaved = psvc.update_project("proj-old", {"manager_id": "u-inactive"}, actor_id="u-admin")
            record("update_project: resend DUNG manager_id cu dang inactive (khong doi) - duoc chap nhan", resaved["managerId"] == "u-inactive")
        except ValueError as e:
            record("update_project: resend DUNG manager_id cu dang inactive (khong doi) - duoc chap nhan", False, str(e))

        # ── update_project: CHON MOI 1 manager_id khac ma nguoi do inactive
        # -> BAT BUOC tu choi (khac voi truong hop resend o tren) ──────────
        try:
            psvc.update_project("proj-old", {"manager_id": "u-inactive-2"}, actor_id="u-admin")
            record("update_project: TU CHOI khi CHON MOI 1 manager_id dang inactive", False)
        except ValueError as e:
            record("update_project: TU CHOI khi CHON MOI 1 manager_id dang inactive", "ngừng hoạt động" in str(e), str(e))

        # ── update_project: CHON MOI 1 manager_id khac dang active -> OK ───
        updated2 = psvc.update_project("proj-old", {"manager_id": "u-leader"}, actor_id="u-admin")
        record("update_project: CHON MOI 1 manager_id dang active - duoc chap nhan", updated2["managerId"] == "u-leader")


if __name__ == "__main__":
    run_member_options()
    run_manager_id_validation()
    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)
