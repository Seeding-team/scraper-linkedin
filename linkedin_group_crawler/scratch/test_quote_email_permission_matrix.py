"""Unit test THUAN (khong DB, khong FastAPI TestClient - chi goi truc tiep
ham permission + logic router qua require_quote_email_manager) cho ma tran
quyen "Email gui bao gia": Admin/Leader quan ly cau hinh, Member/Anonymous
bi chan, quote owner gui duoc bao gia CUA MINH.

Chay: python scratch/test_quote_email_permission_matrix.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RESULTS = []


def record(label, ok, detail=""):
    RESULTS.append((label, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {label} {detail}")


def run():
    from app.modules.all_platform.services.crm_permission_service import (
        can_manage_quote_email_settings,
        can_send_quote_email,
        can_approve_quote,
    )

    admin = {"id": "u-admin", "role": "admin"}
    leader = {"id": "u-leader", "role": "leader"}
    member = {"id": "u-member", "role": "member"}
    member_with_approve_flag = {"id": "u-member-approve", "role": "member", "can_approve_quotes": True}

    # ── 1. Quan ly cau hinh (can_manage_quote_email_settings) ──────────────
    record("Admin manage config -> allowed", can_manage_quote_email_settings(admin) is True)
    record("Leader manage config -> allowed", can_manage_quote_email_settings(leader) is True)
    record("Member manage config -> denied", can_manage_quote_email_settings(member) is False)
    record("Anonymous (None) manage config -> denied", can_manage_quote_email_settings(None) is False)
    record(
        "Member co can_approve_quotes=True VAN KHONG duoc quan ly config (2 quyen khac nhau hoan toan)",
        can_manage_quote_email_settings(member_with_approve_flag) is False,
    )

    # ── 2. Router-level 403 (require_quote_email_manager) - goi ham that ──
    from fastapi import HTTPException
    from app.modules.all_platform.routers.quote import require_quote_email_manager

    try:
        require_quote_email_manager(member)
        record("require_quote_email_manager(member) -> phai raise 403", False)
    except HTTPException as exc:
        record("require_quote_email_manager(member) -> HTTPException 403 dung", exc.status_code == 403)

    try:
        result = require_quote_email_manager(admin)
        record("require_quote_email_manager(admin) -> tra ve user, khong raise", result == admin)
    except HTTPException:
        record("require_quote_email_manager(admin) -> tra ve user, khong raise", False)

    try:
        result = require_quote_email_manager(leader)
        record("require_quote_email_manager(leader) -> tra ve user, khong raise", result == leader)
    except HTTPException:
        record("require_quote_email_manager(leader) -> tra ve user, khong raise", False)

    # ── 3. Gui 1 bao gia cu the (can_send_quote_email) - TACH BIET quyen quan ly ──
    quote_owned_by_member = {"id": "q1", "quoteOwnerId": "u-member", "technicalOwnerId": None, "created_by": None}
    quote_not_related_to_member = {"id": "q2", "quoteOwnerId": "someone-else", "technicalOwnerId": "someone-else-2", "created_by": "someone-else-3"}
    # Member la NGUOI TAO (created_by) NHUNG khong phai quote_owner - phai bi tu choi.
    quote_created_by_member_not_owner = {"id": "q3", "quoteOwnerId": "someone-else", "technicalOwnerId": None, "created_by": "u-member"}
    # Member la TECHNICAL OWNER (khong phai quote_owner) - phai bi tu choi (thu hep moi).
    quote_technical_owned_by_member = {"id": "q4", "quoteOwnerId": "someone-else", "technicalOwnerId": "u-member", "created_by": None}
    # Member VUA la nguoi tao VUA la quote_owner - duoc phep (dung ngoai le "dong thoi la quote owner").
    quote_created_and_owned_by_member = {"id": "q5", "quoteOwnerId": "u-member", "technicalOwnerId": None, "created_by": "u-member"}

    record("Admin gui bat ky quote nao -> allowed", can_send_quote_email(admin, quote_not_related_to_member) is True)
    record("Leader gui bat ky quote nao -> allowed (trong pham vi quan ly)", can_send_quote_email(leader, quote_not_related_to_member) is True)
    record("Quote owner (member) gui quote CUA MINH -> allowed", can_send_quote_email(member, quote_owned_by_member) is True)
    record("Member KHONG lien quan gui quote nguoi khac -> denied", can_send_quote_email(member, quote_not_related_to_member) is False)
    record("Anonymous gui quote bat ky -> denied", can_send_quote_email(None, quote_owned_by_member) is False)
    record(
        "Technical owner (member, KHONG phai quote owner) -> denied (thu hep moi, truoc day tung allowed)",
        can_send_quote_email(member, quote_technical_owned_by_member) is False,
    )
    record(
        "Creator/requester (member, KHONG phai quote owner) -> denied (thu hep moi, truoc day tung allowed)",
        can_send_quote_email(member, quote_created_by_member_not_owner) is False,
    )
    record(
        "Creator DONG THOI la quote owner -> allowed (ngoai le dung yeu cau)",
        can_send_quote_email(member, quote_created_and_owned_by_member) is True,
    )

    # ── 4. Khong dong nhat quyen gui mail voi quyen quan ly config ─────────
    record(
        "Quote owner (member) duoc GUI quote nhung KHONG duoc quan ly config (2 ham doc lap)",
        can_send_quote_email(member, quote_owned_by_member) is True and can_manage_quote_email_settings(member) is False,
    )

    # ── 5. KHONG doi permission duyet bao gia hien co (yeu cau rieng, kiem tra khong bi anh huong) ──
    record("Admin van duyet duoc (can_approve_quote khong doi)", can_approve_quote(admin) is True)
    record("Leader KHONG tu duyet duoc chi vi la Leader (dung yeu cau: khong co co thi khong duyet)", can_approve_quote(leader) is False)
    record("Member co can_approve_quotes=True van duyet duoc (khong doi)", can_approve_quote(member_with_approve_flag) is True)
    record("Member thuong (khong co co) khong duyet duoc (khong doi)", can_approve_quote(member) is False)

    print()
    print("=== SUMMARY ===")
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f"{len(RESULTS) - n_fail}/{len(RESULTS)} PASS")
    if n_fail:
        sys.exit(1)


if __name__ == "__main__":
    run()
