"""Unit test THUAN (khong DB that) cho supabase_project_service.py +
permission RIENG cho Project (can_view_project/can_manage_project) - KHONG
dung has_full_crm_access() vi ham do gom ca "sale-team" (team_type='sale'),
qua rong cho quan tri Project theo yeu cau da chot.
Chay: python scratch/test_project_service.py
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
        self._filters = {}
        self._insert_payload = None
        self._update_payload = None
        self._maybe_single = False

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def order(self, *_a, **_k):
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
        rows = self.store.setdefault("projects", [])
        if self._insert_payload is not None:
            row = dict(self._insert_payload)
            existing_codes = {r["project_code"] for r in rows}
            if row["project_code"] in existing_codes:
                raise Exception('duplicate key value violates unique constraint "projects_project_code_unique"')
            row["id"] = f"project-{len(rows) + 1}"
            rows.append(row)
            return FakeQueryResult(data=[row])
        if self._update_payload is not None:
            matches = [r for r in rows if r["id"] == self._filters.get("id")]
            for r in matches:
                r.update(self._update_payload)
            return FakeQueryResult(data=matches)
        matches = rows
        if "customer_id" in self._filters:
            matches = [r for r in matches if r.get("customer_id") == self._filters["customer_id"]]
        if "id" in self._filters:
            matches = [r for r in matches if r["id"] == self._filters["id"]]
        if self._maybe_single:
            # Mo phong DUNG hanh vi that cua postgrest-py: .maybe_single()
            # tra ve None THANG (khong phai response object) khi khong co
            # dong nao khop.
            if not matches:
                return None
            return FakeQueryResult(data=matches[0])
        return FakeQueryResult(data=matches)


class FakeSupabase:
    def __init__(self):
        self.store = {}

    def table(self, name):
        assert name == "projects"
        return FakeTable(self.store)


def run():
    from app.modules.all_platform.services import supabase_project_service as svc

    fake = FakeSupabase()
    with patch.object(svc, "get_supabase_client", return_value=fake):
        # ── 1) Tao du an hop le ──────────────────────────────────────────────
        created = svc.create_project(
            {"project_code": "PRJ-001", "name": "Hạ tầng Cloud 2026", "customer_id": "cust-1"}, "u-admin"
        )
        record("Tao du an: co id, dung customerId", created["id"] and created["customerId"] == "cust-1")
        record("Tao du an: status mac dinh 'active'", created["status"] == "active")

        # ── 2) Thieu project_code/name/customer_id -> ValueError ────────────
        for missing_field, payload in [
            ("project_code", {"name": "X", "customer_id": "c1"}),
            ("name", {"project_code": "PRJ-002", "customer_id": "c1"}),
            ("customer_id", {"project_code": "PRJ-003", "name": "X"}),
        ]:
            try:
                svc.create_project(payload, "u-admin")
                record(f"Thieu {missing_field} -> phai raise ValueError", False)
            except ValueError:
                record(f"Thieu {missing_field} -> raise ValueError dung", True)

        # ── 3) Trung project_code -> ValueError ro rang (khong phai loi DB tho) ──
        try:
            svc.create_project({"project_code": "PRJ-001", "name": "Trùng mã", "customer_id": "cust-2"}, "u-admin")
            record("project_code trung -> phai raise ValueError", False)
        except ValueError as e:
            record("project_code trung -> raise ValueError ro rang", "đã tồn tại" in str(e))

        # ── 4) status khong hop le -> ValueError ────────────────────────────
        try:
            svc.create_project({"project_code": "PRJ-004", "name": "X", "customer_id": "c1", "status": "invalid"}, "u-admin")
            record("status khong hop le -> phai raise ValueError", False)
        except ValueError:
            record("status khong hop le -> raise ValueError dung", True)

        # ── 5) list_projects loc theo customer_id ───────────────────────────
        svc.create_project({"project_code": "PRJ-005", "name": "Du an khac KH", "customer_id": "cust-2"}, "u-admin")
        cust1_projects = svc.list_projects("cust-1")
        record("list_projects(customer_id) chi tra ve du an cua DUNG khach hang do", all(p["customerId"] == "cust-1" for p in cust1_projects) and len(cust1_projects) == 1)

        # ── 6) get_project khong ton tai -> ValueError (khong crash None.get) ──
        try:
            svc.get_project("khong-ton-tai")
            record("get_project id sai -> phai raise ValueError", False)
        except ValueError:
            record("get_project id sai -> raise ValueError dung (khong crash)", True)

        # ── 7) update_project: khong cho sua customer_id/project_code ───────
        updated = svc.update_project(created["id"], {"name": "Đổi tên dự án", "customer_id": "cust-999"}, "u-admin")
        record("update_project: doi ten thanh cong", updated["name"] == "Đổi tên dự án")
        record("update_project: customer_id KHONG bi doi du gui len (khong ho tro sua)", updated["customerId"] == "cust-1")

    # ── 8) Permission Project RIENG (can_view_project/can_manage_project) -
    # KHONG dung has_full_crm_access() (ham do gom ca sale-team, qua rong
    # cho quan tri Project - da sua theo yeu cau audit) ────────────────────
    from app.modules.all_platform.services.crm_permission_service import can_view_project, can_manage_project

    admin = {"id": "u-admin", "role": "admin"}
    leader = {"id": "u-leader", "role": "leader"}
    member = {"id": "u-member", "role": "member"}
    sale_team_member = {"id": "u-saleteam", "role": "member"}  # gia dinh la thanh vien team_type='sale'

    record("can_view_project: bat ky ai dang nhap -> True", can_view_project(admin) is True and can_view_project(member) is True)
    record("can_view_project: anonymous -> False", can_view_project(None) is False)

    record("can_manage_project: Admin tao MOI (project=None) -> True", can_manage_project(admin, None) is True)
    record("can_manage_project: Leader tao MOI (project=None) -> True", can_manage_project(leader, None) is True)
    record("can_manage_project: Member thuong tao MOI -> False", can_manage_project(member, None) is False)
    record(
        "can_manage_project: Member CO the la sale-team van KHONG tu dong tao duoc Project (khac has_full_crm_access co y)",
        can_manage_project(sale_team_member, None) is False,
    )

    existing_project = {"id": "p1", "createdById": "u-member", "managerId": None}
    record("can_manage_project: chinh nguoi TAO project do -> True", can_manage_project(member, existing_project) is True)
    other_member = {"id": "u-other", "role": "member"}
    record("can_manage_project: nguoi KHONG lien quan project do -> False", can_manage_project(other_member, existing_project) is False)

    managed_project = {"id": "p2", "createdById": "u-admin", "managerId": "u-member"}
    record("can_manage_project: nguoi duoc gan LAM MANAGER project do -> True", can_manage_project(member, managed_project) is True)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
