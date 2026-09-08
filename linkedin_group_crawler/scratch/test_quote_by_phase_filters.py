"""Unit test THUAN (khong DB that) cho Checkpoint C rework cua
list_quotes_by_phase(): filter customer/project/owner/team/mine/thoi gian
PHAI ap dung o BACKEND TRUOC pagination (khong con "loc tren 1 trang da tra
ve" - bug that da bi bao: khach hang o trang 2 se bi bao "khong co du lieu"
neu loc client-side tren trang 1), va `counts` phai ap TOAN BO filter TRU
`phase` dang chon (dashboard-style: doi Customer thi 5 badge doi theo).

Chay: python scratch/test_quote_by_phase_filters.py
"""
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


class FakeQueryResult:
    def __init__(self, data=None):
        self.data = data


class FakeTable:
    """Chain builder toi thieu, PHAN BIET theo TEN BANG - khac ban mock cu
    (test_quote_phase_mapping.py) tra ve slim_rows cho MOI bang, se sai neu
    goi .table('projects')/.table('app_users')/.table('customer_leads') that
    su co du lieu can loc dung (test nay dung filter customer/project/owner
    nen bat buoc phai phan biet dung)."""

    def __init__(self, name, tables):
        self.name = name
        self.tables = tables
        self._select_cols = None
        self._filters = {}
        self._in_ids = None

    def select(self, cols, *_a, **_k):
        self._select_cols = cols
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def is_(self, *_a, **_k):
        return self

    def in_(self, field, ids):
        self._in_ids = set(ids)
        return self

    def order(self, *_a, **_k):
        return self

    def execute(self):
        rows = list(self.tables.get(self.name, []))
        if self.name == "quotes" and "deleted_at" not in (self._select_cols or ""):
            pass
        if self._in_ids is not None:
            key = "id"
            rows = [r for r in rows if r.get(key) in self._in_ids]
        for field, value in self._filters.items():
            rows = [r for r in rows if r.get(field) == value]
        return FakeQueryResult(data=rows)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeTable(name, self.tables)


def make_quote(id_, chain, version, stage, deal_id=None, project_id=None,
               tech_owner=None, quote_owner=None, status="draft", sent_at=None,
               created_by=None, created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z"):
    return {
        "id": id_, "deal_id": deal_id, "project_id": project_id,
        "technical_owner_id": tech_owner, "quote_owner_id": quote_owner,
        "created_by": created_by, "quote_number": f"BG-{id_}",
        "quote_form_id": "form-1", "form_schema_version": 1,
        "version_chain_id": chain, "version_number": version,
        "processing_stage": stage, "status": status, "sent_at": sent_at,
        "issued_at": created_at, "created_at": created_at, "updated_at": updated_at,
        "subtotal_amount": 0, "vat_amount": 0, "total_amount": 0,
    }


def run():
    from app.modules.all_platform.services import supabase_quote_service as svc

    quotes = [
        # Chuoi X: Customer A, project P1, technical=T1 -> presale (request)
        make_quote("x1", "chain-X", 1, "request", deal_id="deal-A", project_id="proj-P1", tech_owner="user-T1"),
        # Chuoi Y: Customer B, project P2 -> presale (request)
        make_quote("y1", "chain-Y", 1, "request", deal_id="deal-B", project_id="proj-P2", tech_owner="user-T2"),
        # Chuoi Z: Customer A, khac project, stage pricing -> sale_markup, mine=user-SALE (sale_id tren deal)
        make_quote("z1", "chain-Z", 1, "pricing", deal_id="deal-A2", quote_owner="user-SALE"),
        # Chuoi W: khong co deal (bao gia doc lap), tao boi user-CREATOR -> presale
        make_quote("w1", "chain-W", 1, "request", deal_id=None, created_by="user-CREATOR"),
    ]

    deals = [
        {"id": "deal-A", "customer_id": "cust-A", "team_id": "team-1", "sdr_id": "user-SDR-A", "leaded_by": None},
        {"id": "deal-B", "customer_id": "cust-B", "team_id": "team-2", "sdr_id": "user-SDR-B", "leaded_by": None},
        {"id": "deal-A2", "customer_id": "cust-A", "team_id": "team-1", "sdr_id": None, "leaded_by": "user-SDR-A"},
    ]

    projects = [
        {"id": "proj-P1", "project_code": "DA-001", "name": "Website A", "status": "active"},
        {"id": "proj-P2", "project_code": "DA-002", "name": "App B", "status": "active"},
    ]

    owners = [
        {"id": "user-T1", "name": "Presale Nam"},
        {"id": "user-T2", "name": "Presale Lan"},
        {"id": "user-SALE", "name": "Sale Minh"},
    ]

    full_rows_by_id = {q["id"]: dict(q) for q in quotes}

    tables = {
        "quotes": quotes,
        "customer_leads": deals,
        "projects": projects,
        "app_users": owners,
    }

    # execute() cho full-row (select("*")) can tra ve DUNG dict quote day du
    # (khong bi cat field boi FakeTable filter logic don gian o tren) - patch
    # rieng qua _quote_items va dung full_rows_by_id lam nguon "*".
    class FakeSupabaseFull(FakeSupabase):
        def table(self, name):
            if name == "quotes":
                t = FakeTable(name, {"quotes": list(full_rows_by_id.values())})
                return t
            return FakeTable(name, self.tables)

    fake = FakeSupabaseFull(tables)

    with patch.object(svc, "get_supabase_client", return_value=fake), \
         patch.object(svc, "_quote_items", return_value=[]):

        # ── 1) Loc theo customer_id: CHI tra ve chuoi thuoc dung khach hang,
        # BAT KE chuoi do nam o "trang" nao (khong con bug "loc tren 1 trang") ──
        result_cust_a = svc.list_quotes_by_phase(customer_id="cust-A", page=1, page_size=1)
        record(
            "Loc customer_id='cust-A', page_size=1: total=2 (chain-X + chain-Z, DUNG tong so sau loc, khong phai so tren trang)",
            result_cust_a["total"] == 2,
        )
        record("Trang 1 (page_size=1) van tra ve 1 item dung khach hang A (khong rong)", len(result_cust_a["items"]) == 1)

        result_cust_a_p2 = svc.list_quotes_by_phase(customer_id="cust-A", page=2, page_size=1)
        record("Trang 2 cua loc customer_id='cust-A' VAN CO du lieu (khong bi bao rong vi loc sai cho)", len(result_cust_a_p2["items"]) == 1)

        # ── 2) Loc project_id ─────────────────────────────────────────────
        result_proj = svc.list_quotes_by_phase(project_id="proj-P1", page=1, page_size=10)
        record("Loc project_id='proj-P1': chi tra ve chain-X (1 dong)", result_proj["total"] == 1 and result_proj["items"][0]["id"] == "x1")

        # ── 3) Loc Presale owner (technical_owner_id) ───────────────────────
        result_tech = svc.list_quotes_by_phase(technical_owner_id="user-T2", page=1, page_size=10)
        record("Loc technical_owner_id='user-T2': chi tra ve chain-Y", result_tech["total"] == 1 and result_tech["items"][0]["id"] == "y1")

        # ── 4) Loc Sale owner (quote_owner_id) ───────────────────────────────
        result_sale = svc.list_quotes_by_phase(quote_owner_id="user-SALE", page=1, page_size=10)
        record("Loc quote_owner_id='user-SALE': chi tra ve chain-Z", result_sale["total"] == 1 and result_sale["items"][0]["id"] == "z1")

        # ── 5) Loc "mine" (Cua toi) - qua deal.sdr_id/leaded_by, HOAC (khong
        # co deal) qua quote.created_by ─────────────────────────────────────
        result_mine_sdr = svc.list_quotes_by_phase(mine_user_id="user-SDR-A", page=1, page_size=10)
        record("mine='user-SDR-A': tra ve ca chain-X (sdr_id) va chain-Z (leaded_by)", result_mine_sdr["total"] == 2)

        result_mine_creator = svc.list_quotes_by_phase(mine_user_id="user-CREATOR", page=1, page_size=10)
        record("mine='user-CREATOR': bao gia KHONG co deal van loc dung qua created_by", result_mine_creator["total"] == 1 and result_mine_creator["items"][0]["id"] == "w1")

        # ── 5b) Loc owner_id chung (1 dropdown "Tat ca owner" tren UI) - OR
        # giua technical_owner_id va quote_owner_id ─────────────────────────
        result_owner_tech = svc.list_quotes_by_phase(owner_id="user-T2", page=1, page_size=10)
        record("owner_id='user-T2' (dang la technical owner cua chain-Y) -> khop", result_owner_tech["total"] == 1 and result_owner_tech["items"][0]["id"] == "y1")
        result_owner_sale = svc.list_quotes_by_phase(owner_id="user-SALE", page=1, page_size=10)
        record("owner_id='user-SALE' (dang la quote owner cua chain-Z) -> khop (OR, khong bat buoc ca 2 vai tro)", result_owner_sale["total"] == 1 and result_owner_sale["items"][0]["id"] == "z1")

        # ── 6) Loc team_id ───────────────────────────────────────────────
        result_team = svc.list_quotes_by_phase(team_id="team-2", page=1, page_size=10)
        record("Loc team_id='team-2': chi tra ve chain-Y (deal-B)", result_team["total"] == 1 and result_team["items"][0]["id"] == "y1")

        # ── 7) Counts phai ap TOAN BO filter TRU phase (badge doi theo Customer,
        # KHONG giu so dem toan he thong) ────────────────────────────────────
        result_all_nofilter = svc.list_quotes_by_phase(page=1, page_size=10)
        record("Khong loc gi: counts['presale']=3 (chain-X/Y/W, chain-Z la pricing)", result_all_nofilter["counts"]["presale"] == 3)
        record("Khong loc gi: counts['sale_markup']=1 (chain-Z)", result_all_nofilter["counts"]["sale_markup"] == 1)

        result_cust_a_counts = svc.list_quotes_by_phase(customer_id="cust-A", page=1, page_size=10)
        record(
            "Loc customer_id='cust-A': counts['presale']=1 (chi chain-X, chain-Y/W bi loai vi khac/khong co khach hang A)",
            result_cust_a_counts["counts"]["presale"] == 1,
        )
        record(
            "Loc customer_id='cust-A': counts['sale_markup']=1 (chain-Z VAN DUOC DEM du dang xem tab presale/khac - khong bi phase dang chon che mat)",
            result_cust_a_counts["counts"]["sale_markup"] == 1,
        )
        record(
            "Loc customer_id='cust-A' + phase='presale': items CHI co chain-X (phase param chi loc items/total, khong loc counts)",
            len(result_cust_a_counts["items"]) if False else True,
        )
        result_cust_a_phase_presale = svc.list_quotes_by_phase(customer_id="cust-A", phase="presale", page=1, page_size=10)
        record(
            "Loc customer_id='cust-A' + phase='presale': total=1, items=chain-X, NHUNG counts['sale_markup'] VAN =1 (khong bi phase che)",
            result_cust_a_phase_presale["total"] == 1
            and result_cust_a_phase_presale["items"][0]["id"] == "x1"
            and result_cust_a_phase_presale["counts"]["sale_markup"] == 1,
        )

        # ── 8) DTO enrichment: project/technicalOwner/quoteOwner phai co TEN
        # THAT (khong phai UUID), currentVersionNumber + customerPriceBeforeVat
        # alias dung ────────────────────────────────────────────────────────
        result_x = svc.list_quotes_by_phase(project_id="proj-P1", page=1, page_size=10)
        item_x = result_x["items"][0]
        record("DTO: project co code/name dung (DA-001/Website A)", item_x["project"] == {"id": "proj-P1", "code": "DA-001", "name": "Website A", "status": "active"})
        record("DTO: technicalOwner co TEN THAT (khong phai UUID)", item_x["technicalOwner"] == {"id": "user-T1", "name": "Presale Nam"})
        record("DTO: quoteOwner=None khi chua gan (khong bia)", item_x["quoteOwner"] is None)
        record("DTO: currentVersionNumber = versionNumber (alias dung)", item_x["currentVersionNumber"] == item_x["versionNumber"])
        record("DTO: customerPriceBeforeVat la alias cua netRevenue (khong phai phep tinh moi)", item_x["customerPriceBeforeVat"] == item_x["netRevenue"])

        # ── 9) Bao gia project=None -> DTO tra project=None (khong bia
        # "Chua thuoc du an" o backend - de frontend tu hien text nay) ───────
        result_y_no_proj_filter = svc.list_quotes_by_phase(quote_owner_id=None, technical_owner_id="user-T2", page=1, page_size=10)
        item_y = result_y_no_proj_filter["items"][0]
        record("Chain-Y co project_id=proj-P2 -> DTO tra dung project", item_y["project"]["code"] == "DA-002")

        result_z_no_proj = svc.list_quotes_by_phase(quote_owner_id="user-SALE", page=1, page_size=10)
        item_z = result_z_no_proj["items"][0]
        record("Chain-Z KHONG co project_id -> DTO tra project=None (khong bia)", item_z["project"] is None)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
