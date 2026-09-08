"""CRM/Pipeline permission helpers.

Nguyen tac phan quyen (thay cho phan quyen thuan role admin/leader/member
truoc day):

  - admin, leader: toan quyen (khong doi).
  - "Sale": nguoi thuoc 1 team co teams.team_type = 'sale' (migration 049) -
    duoc nang len ngang leader CHO RIENG Pipeline + Phan tich CRM, KHONG
    dua theo TEN team (ten team la text tu do, khong dang tin cay).
  - member thuong: doc (xem) toan bo Pipeline nhu moi nguoi, nhung chi
    sua/xoa deal do chinh minh tao (leaded_by) hoac duoc giao (sdr_id).
"""

from __future__ import annotations

import time
from typing import Any

from app.core.supabase_client import execute_supabase_query, get_supabase_client

_SALE_TEAM_TYPE = "sale"

_TEAM_TYPES_CACHE_TTL_SECONDS = 60.0
_TEAM_TYPES_CACHE: dict[str, tuple[float, set[str]]] = {}


def get_user_team_types(user_id: str | None) -> set[str]:
    """Tra ve tap hop team_type cua moi team ma user_id (app_users.id) dang
    la thanh vien (qua member_of_teams.id_member - luon la app_users.id,
    khong phai members.id - xem add_team_member/create_team)."""
    if not user_id:
        return set()

    now = time.monotonic()
    cached = _TEAM_TYPES_CACHE.get(user_id)
    if cached and cached[0] > now:
        return cached[1]

    try:
        supabase = get_supabase_client()
        mot_result = execute_supabase_query(
            lambda: supabase.table("member_of_teams").select("id_teams").eq("id_member", user_id).execute()
        )
        team_ids = list({r["id_teams"] for r in (mot_result.data or []) if r.get("id_teams")})
        if not team_ids:
            team_types: set[str] = set()
        else:
            teams_result = execute_supabase_query(
                lambda: supabase.table("teams").select("team_type").in_("id", team_ids).execute()
            )
            team_types = {r.get("team_type") for r in (teams_result.data or []) if r.get("team_type")}
    except Exception:
        # Loi tam thoi (mat ket noi...) -> coi nhu khong co team nao, an toan
        # hon la crash toan bo request Pipeline.
        team_types = set()

    _TEAM_TYPES_CACHE[user_id] = (now + _TEAM_TYPES_CACHE_TTL_SECONDS, team_types)
    if len(_TEAM_TYPES_CACHE) > 1000:
        for key in list(_TEAM_TYPES_CACHE.keys())[:-1000]:
            _TEAM_TYPES_CACHE.pop(key, None)
    return team_types


def clear_team_types_cache(user_id: str | None = None) -> None:
    if user_id:
        _TEAM_TYPES_CACHE.pop(user_id, None)
    else:
        _TEAM_TYPES_CACHE.clear()


def is_sale_member(user_id: str | None) -> bool:
    return _SALE_TEAM_TYPE in get_user_team_types(user_id)


def has_full_crm_access(user: dict[str, Any] | None) -> bool:
    """True neu user duoc xem/sua toan bo Pipeline + Phan tich CRM: admin,
    leader, hoac thanh vien 1 team team_type='sale'."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role in ("admin", "leader"):
        return True
    return is_sale_member(user.get("id"))


def can_write_deal(user: dict[str, Any] | None, lead: dict[str, Any] | None) -> bool:
    """True neu user duoc sua/xoa deal `lead` nay: co full CRM access, hoac
    la nguoi tao (leaded_by) / duoc giao (sdr_id) deal do."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    if not lead:
        return False
    uid = str(user.get("id") or "")
    if not uid:
        return False
    return str(lead.get("leaded_by") or "") == uid or str(lead.get("sdr_id") or "") == uid


def can_approve_quote(user: dict[str, Any] | None) -> bool:
    """SUA LAI (Phase 3 review/approve, ghi de quyet dinh cu o "Phase 1 Nang
    cap Trung tam bao gia" tung xac nhan la `bool(user)` - xem git blame/
    comment cu neu can doi lai): duyet bao gia CHI danh cho admin hoac user
    co co `can_approve_quotes=True` (cot that tren app_users, da co san tu
    truoc, chua tung duoc doc o day). Member thuong (khong co co nay) se
    KHONG con duyet duoc nua - day la thay doi hanh vi that, khong phai chi
    sua bug hien thi. CHI ap dung cho quyen BAO GIA - KHONG dung ham nay cho
    quyen Deal/Pipeline (`has_full_crm_access`/`can_write_deal` khong lien
    quan, giu nguyen)."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    return bool(user.get("can_approve_quotes"))


def can_edit_technical_quote(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """True neu user duoc sua phan KY THUAT (scope/cost/checklist) cua 1
    quote: chinh nguoi duoc gan `technical_owner_id`, hoac admin/leader/
    sale-team (full CRM access). Nguoi chi la quote_owner (phu trach gia ban)
    khong tu dong co quyen nay neu khong dong thoi la technical_owner."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    uid = str(user.get("id") or "")
    if not uid or not quote:
        return False
    return str(quote.get("technicalOwnerId") or quote.get("technical_owner_id") or "") == uid


# ── Quyen doc/sua GIA VON / GIA BAN / LOI NHUAN - 3 NHOM RIENG (sua lai sau
# khi bi bac bo lan 1 vi dung 1 ham strip_cost_fields_for_user() gop chung ca
# 3 nhom, khien Sale (quote_owner) mat luon quyen XEM gia von da chot cua
# Presale - Sale KHONG THE hoan thanh markup neu khong thay duoc gia von lam
# co so). Nguyen tac: KHONG dung 1 boolean chung cho nhieu nhom field - moi
# nhom co ham VIEW rieng (va EDIT rieng neu can), khong ham nao duoc suy ra tu
# ham khac. Leader/sale-team KHONG con tu dong duoc xem gia von/loi nhuan chi
# vi system role (has_full_crm_access) nua - phai la chinh technical_owner
# (cost)/quote_owner (pricing/profit) hoac admin. Day la thay doi CO CHU DICH
# so voi can_edit_technical_quote/can_edit_quote_pricing ben duoi (van giu
# nguyen has_full_crm_access cho SUA - da la hanh vi da chot tu truoc, khong
# dong trong pham vi sua lan nay) - CHI cac ham *_view_* moi that nghiem ngat
# hon nhu vay, theo dung yeu cau "Leader khong tu dong thay cost/profit".


def can_view_quote_cost(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """Nhom A - TECHNICAL/COST fields (costPrice/costTotal/costNotApplicable):
    CHI admin, hoac chinh technical_owner (Presale duoc gan quote nay), HOAC
    chinh quote_owner (Sale duoc gan quote nay - Sale PHAI xem duoc gia von
    Presale da chot, o che do READ-ONLY, de hoan thanh markup - xem
    can_edit_quote_cost() rieng cho quyen SUA, khac hoan toan quyen XEM nay)."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    uid = str(user.get("id") or "")
    if not uid or not quote:
        return False
    technical_owner_id = str(quote.get("technicalOwnerId") or quote.get("technical_owner_id") or "")
    quote_owner_id = str(quote.get("quoteOwnerId") or quote.get("quote_owner_id") or "")
    return uid == technical_owner_id or uid == quote_owner_id


def can_edit_quote_cost(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """Quyen SUA gia von - CHI technical_owner (Presale duoc gan) hoac admin/
    leader/sale-team (giu nguyen has_full_crm_access, KHONG doi hanh vi SUA da
    chot tu truoc). Sale (quote_owner) KHONG duoc sua cost du duoc XEM read-
    only qua can_view_quote_cost() - day la lan ranh READ vs WRITE THAT SU,
    chan o tang API (_check_item_field_level_permission), khong chi FE disable
    input. Alias ten ro nghia cua can_edit_technical_quote() (giu nguyen ham
    do cho cac noi goi cu, khong doi hanh vi)."""
    return can_edit_technical_quote(user, quote)


def can_view_quote_pricing(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """SUA LAI (bi bac bo lan 2 vi mo qua rong - da tung cho ca technical_owner
    xem, sai voi yeu cau "Technical owner Presale/Both KHONG xem Pricing noi
    bo neu khong dong thoi la Quote owner"). Nhom B THAT SU CHI la PRICING
    NOI BO (hien tai la field `markupPercent` - chien luoc markup cua Sale,
    KHONG phai so hien thi cho khach) - CHI admin hoac chinh quote_owner
    (Sale duoc gan quote nay). Presale (chi la technical_owner, khong dong
    thoi la quote_owner) KHONG duoc xem markupPercent.

    PHAN BIET RO voi nhom C "Customer commercial" (unitPrice/discountPercent/
    discountAmount/amountAfterDiscount/vatRate/totalAmount/netRevenue/
    customerPriceBeforeVat/payment terms trong quote.data) - nhom C KHONG gac
    o day, hien thi BINH THUONG cho bat ky ai xem duoc quote (kha nang xem
    tong the da chan boi can_edit_quote/endpoint rieng), vi day la so THAT SU
    xuat hien tren ban bao gia gui khach, khong phai chien luoc noi bo."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    uid = str(user.get("id") or "")
    if not uid or not quote:
        return False
    return uid == str(quote.get("quoteOwnerId") or quote.get("quote_owner_id") or "")


def can_view_quote_profitability(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """Nhom C - PROFITABILITY fields (grossProfit/grossMarginPercent): CHI
    admin hoac quote_owner (Sale - nguoi can margin de hoan thien gia, dung
    yeu cau "Gia von da chot -> Markup -> Gia khach -> Gross profit -> Margin"
    tren CUNG 1 workspace). Presale (chi la technical_owner, KHONG dong thoi
    la quote_owner) KHONG nam trong yeu cau xem loi nhuan - neu sau nay can
    mo rong thi sua CHINH o day, khong suy tu can_view_quote_cost()."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    uid = str(user.get("id") or "")
    if not uid or not quote:
        return False
    return uid == str(quote.get("quoteOwnerId") or quote.get("quote_owner_id") or "")


def can_edit_quote_pricing(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """True neu user duoc sua phan GIA BAN (markup/chiet khau/thanh toan) cua
    1 quote: chinh nguoi duoc gan `quote_owner_id`, hoac admin/leader/
    sale-team (full CRM access) - giu nguyen hanh vi SUA da chot tu truoc,
    KHONG doi trong lan sua permission-view nay."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    uid = str(user.get("id") or "")
    if not uid or not quote:
        return False
    return str(quote.get("quoteOwnerId") or quote.get("quote_owner_id") or "") == uid


def can_transition_quote_stage(user: dict[str, Any] | None, quote: dict[str, Any] | None, target_stage: str) -> bool:
    """Quyen chuyen processing_stage - phan theo dung nguoi phu trach dung
    buoc: chuyen SANG 'technical' hoac dang o buoc 'technical' (request-
    >technical do nguoi tao/quan ly deal thuc hien, tuong duong can_edit_quote
    cu) can quyen ky thuat; chuyen SANG 'pricing' (technical->pricing, tuc
    BAN GIAO) can quyen ky thuat (nguoi ky thuat la nguoi bam ban giao); chuyen
    SANG 'review' (pricing->review, HOAN TAT gia ban) can quyen gia ban."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    if target_stage in ("technical", "pricing"):
        return can_edit_technical_quote(user, quote)
    if target_stage == "review":
        return can_edit_quote_pricing(user, quote)
    return False


def can_edit_quote(user: dict[str, Any] | None, quote: dict[str, Any] | None, lead: dict[str, Any] | None) -> bool:
    """True neu user duoc xem/sua 1 bao gia CHUA duyet: nguoi tao bao gia,
    nguoi quan ly/phu trach deal gan voi bao gia (leaded_by/sdr_id), nguoi co
    full CRM access (admin/leader/sale-team), hoac nguoi co quyen duyet bao gia
    (can duoc xem/sua truoc khi quyet dinh duyet). KHONG tu dong cho phep chi
    vi la nguoi tao deal khac - phai gan dung deal cua bao gia nay."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    if can_approve_quote(user):
        return True
    uid = str(user.get("id") or "")
    if not uid:
        return False
    if quote and str(quote.get("created_by") or quote.get("createdById") or "") == uid:
        return True
    if lead and (str(lead.get("leaded_by") or "") == uid or str(lead.get("sdr_id") or "") == uid):
        return True
    return False


def can_manage_quote_email_settings(user: dict[str, Any] | None) -> bool:
    """True CHI khi role == admin hoac role == leader - dung tap trung o day
    (khong inline rai rac trong router) cho toan bo API cau hinh kenh gui
    email bao gia (GET/PUT/xoa credential/test IMAP/test SMTP/bat-tat kenh).
    Member (du la quote_owner/technical_owner cua bat ky bao gia nao) KHONG
    duoc quan ly cau hinh nay - day la quyen QUAN TRI kenh gui, TACH BIET
    hoan toan voi quyen GUI 1 bao gia cu the (`can_send_quote_email`)."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    return role in ("admin", "leader")


def can_send_quote_email(user: dict[str, Any] | None, quote: dict[str, Any] | None) -> bool:
    """True neu user duoc GUI 1 bao gia cu the qua email cho khach. THU HEP
    lai (khac ban dau) theo dung yeu cau nghiep vu:
      - admin: luon duoc.
      - leader: duoc, trong pham vi quan ly (dung role=='leader' truc tiep,
        KHONG dung has_full_crm_access() vi ham do gop ca thanh vien
        team_type='sale' - 1 sale member THUONG khong tu dong co quyen gui
        bao gia neu khong phai quote owner).
      - quote_owner_id: duoc (nguoi phu trach GIA BAN - nguoi thuc su chot
        so voi khach truoc khi gui).
      - technical_owner_id: KHONG tu co quyen (chi phu trach scope/cost noi
        bo, khong phai nguoi chot gia gui khach).
      - created_by/nguoi tao yeu cau: KHONG tu co quyen, TRU KHI dong thoi
        la quote_owner_id (tranh 1 nguoi tao bao gia ho nguoi khac roi tu y
        gui thang cho khach).
    Field mo rong rieng (permission gui bao gia dang tren app_users, vd
    `can_send_quotes`) CHUA co that trong schema - KHONG bia ra, chi kiem tra
    khi cot do THAT SU ton tai tren user dict (opt-in, an toan neu chua co)."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    if role == "leader":
        return True
    if user.get("can_send_quotes") is True:
        return True
    uid = str(user.get("id") or "")
    if not uid or not quote:
        return False
    return str(quote.get("quoteOwnerId") or quote.get("quote_owner_id") or "") == uid


def can_view_project(user: dict[str, Any] | None) -> bool:
    """Bat ky ai dang nhap deu XEM duoc Du an (can cho dropdown chon Du an
    khi tao bao gia) - DTO tra ve van phai dung allowlist (khong lo
    manager_id/team_id neu khong can), rieng biet voi quyen quan tri."""
    return bool(user)


def can_manage_project(user: dict[str, Any] | None, project: dict[str, Any] | None = None) -> bool:
    """QUAN TRONG: KHONG dung has_full_crm_access() o day - ham do gom ca
    "thanh vien 1 team team_type='sale'" (mot co che TEAM assignment THAT,
    KHONG PHAI system role thu 4 - xem get_user_team_types()/teams.team_type,
    migration 049; app_users.role van CHI co admin/leader/member, khong doi).
    Nhung rieng cho QUAN TRI Du an, yeu cau moi noi ro: sale-team KHONG tu
    dong duoc quan tri Project - chi Admin/Leader, HOAC (voi 1 Du an DA TON
    TAI) chinh nguoi tao (`created_by`) hoac nguoi duoc gan quan ly
    (`manager_id`) cua DUNG Du an do. Tao Du an MOI: CHI Admin/Leader (chua
    co project de tu nhan la "nguoi tao/manager")."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    if role in ("admin", "leader"):
        return True
    if not project:
        return False
    uid = str(user.get("id") or "")
    if not uid:
        return False
    return str(project.get("createdById") or project.get("created_by") or "") == uid or \
        str(project.get("managerId") or project.get("manager_id") or "") == uid


def can_manage_quote_approval_rules(user: dict[str, Any] | None) -> bool:
    """True CHI khi role == admin hoac role == leader - dung tap trung cho
    toan bo API cau hinh Rule engine duyet bao gia (GET active khong can ham
    nay - Member van xem duoc ket qua; CHI PUT/sua rule moi can). Tach biet
    hoan toan voi `can_manage_quote_email_settings` (2 khu vuc cau hinh khac
    nhau, du cung chi Admin/Leader quan ly)."""
    if not user:
        return False
    role = str(user.get("role") or "").strip().lower()
    return role in ("admin", "leader")


def can_pin_quote(user: dict[str, Any] | None) -> bool:
    """"Ghim báo giá lên đầu" (Quote Center) - CHI Admin (khong phai Leader,
    khac voi da so quyen quan tri khac o file nay) theo dung yeu cau nguoi
    dung: "Chỉ Admin được ghim/bỏ ghim". Khong dung has_full_crm_access
    (se cho ca Leader/sale-team) - day la 1 trong so it quyen CHI rieng
    admin, giu tach biet ro rang khoi cac ham *_admin_leader khac."""
    if not user:
        return False
    return str(user.get("role") or "").strip().lower() == "admin"


def can_edit_contract(user: dict[str, Any] | None, contract: dict[str, Any] | None, lead: dict[str, Any] | None) -> bool:
    """True neu user duoc xem/sua 1 hop dong: nguoi tao hop dong, nguoi quan
    ly/phu trach deal gan voi hop dong nay (leaded_by/sdr_id), hoac nguoi co
    full CRM access (admin/leader/sale-team). Cung logic can_edit_quote."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    uid = str(user.get("id") or "")
    if not uid:
        return False
    if contract and str(contract.get("createdById") or "") == uid:
        return True
    if lead and (str(lead.get("leaded_by") or "") == uid or str(lead.get("sdr_id") or "") == uid):
        return True
    return False


def can_write_lead(user: dict[str, Any] | None, lead: dict[str, Any] | None) -> bool:
    """True neu user duoc sua/xoa 1 Lead (`crm_leads`): co full CRM access
    (admin/leader/sale-team), hoac la SDR duoc giao lead do (sdr_id). Cung
    style/quyet dinh voi can_write_deal - chi khac field so sanh (sdr_id thay
    vi leaded_by/sdr_id, vi Lead luon co dung 1 nguoi phu trach la SDR)."""
    if not user:
        return False
    if has_full_crm_access(user):
        return True
    if not lead:
        return False
    uid = str(user.get("id") or "")
    if not uid:
        return False
    return str(lead.get("sdr_id") or "") == uid


def can_view_lead(user: dict[str, Any] | None, lead: dict[str, Any] | None) -> bool:
    """True neu user duoc xem 1 Lead: co the sua (xem tu nhien duoc), hoac la
    AE duoc gan o buoc qualify (qualification_ae_id), hoac la nguoi phu
    trach/tao deal ma lead nay da duoc convert sang (converted_deal_id ->
    customer_leads.leaded_by/sdr_id) - Sale/AE nhan deal tu 1 lead van can
    xem lai lead goc de biet lich su qualify truoc do."""
    if not user:
        return False
    if can_write_lead(user, lead):
        return True
    if not lead:
        return False
    uid = str(user.get("id") or "")
    if not uid:
        return False
    if str(lead.get("qualification_ae_id") or "") == uid:
        return True
    converted_deal = lead.get("_converted_deal")
    if converted_deal and (str(converted_deal.get("leaded_by") or "") == uid or str(converted_deal.get("sdr_id") or "") == uid):
        return True
    return False


# Luu y: quyen ho so `crm_customers` (sua/xem) KHONG dat o day - da co san,
# dung, va dang duoc dung that trong crm_customer_service.py
# (can_edit_customer/can_view_customer/_customer_ids_visible_to), cung logic
# chot voi sep (admin/leader toan quyen; owner_id duoc sua; Sale chi co deal
# lien quan duoc XEM khong duoc SUA; created_by chi audit) nhung can 1 truy
# van DB rieng (_customer_ids_visible_to) de loc danh sach hang loat cho
# list_customers - khong hop voi chu ky ham (user, customer, linked_deals)
# dung chung cho deal/quote/contract o file nay. Khong nhan doi 1 ban thu 2
# khong dung o day de tranh 2 nguon quyen lech nhau theo thoi gian.
