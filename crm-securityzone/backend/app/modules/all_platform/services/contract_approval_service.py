"""Điều kiện GỬI DUYỆT / KÝ của hợp đồng tạo bằng AI Copilot (backend là nơi quyết định; FE chỉ hiển thị).

Chỉ dùng trạng thái mà backend thực sự hỗ trợ (draft -> pending_legal -> pending_signature -> signed -> active -> completed; expiring/expired/terminated).
Trạng thái "Đã duyệt" KHÔNG tồn tại trong schema: việc pháp chế duyệt = chuyển pending_legal -> pending_signature và được ghi vào lịch sử
(người duyệt, thời điểm, PHIÊN BẢN tài liệu được duyệt). Không giả lập ký số.

Điều kiện cho hợp đồng có tài liệu (đã lưu phiên bản) khi chuyển sang pending_legal / pending_signature:
  1. có tài liệu (phiên bản mới nhất)            4. thông tin pháp lý bắt buộc đủ (MST/địa chỉ/đại diện, tên Bên B…)
  2. báo giá liên kết còn hợp lệ (đã duyệt…)     5. đã chạy AI kiểm tra rủi ro CHO ĐÚNG phiên bản mới nhất
  3. giá trị hợp đồng khớp báo giá (VND)
Hợp đồng ghi nhận thủ công / legacy (không có phiên bản tài liệu) không bị các điều kiện này chặn (giữ nguyên luồng cũ).
"""
from __future__ import annotations

from typing import Any

from app.modules.all_platform.services import contract_document_store as store
from app.modules.all_platform.services import contract_source_service as source

GATED_STATUSES = {"pending_legal", "pending_signature"}


def compute_readiness(contract: dict[str, Any], lead: dict[str, Any] | None, issuer: dict | None = None) -> dict[str, Any]:
    versions = store.list_versions(contract["id"])
    latest = versions[-1] if versions else None
    checks: list[dict[str, Any]] = []

    def add(key: str, label: str, ok: bool, detail: str = "", blocking: bool = True, action: dict | None = None) -> None:
        checks.append({"key": key, "label": label, "ok": bool(ok), "blocking": blocking, "detail": detail, **({"action": action} if action else {})})

    has_doc = bool(latest)
    legacy = bool(contract.get("clauses"))
    add("document", "Có tài liệu hợp đồng (DOCX/PDF)", has_doc, f"Phiên bản mới nhất: v{latest['version']}" if latest else ("Chỉ có nội dung điều khoản cũ (legacy) - chưa có tài liệu" if legacy else "Chưa có tài liệu"),
        action={"kind": "open_documents"} if not has_doc else None)

    quote = None
    if contract.get("quoteId"):
        try:
            from app.modules.all_platform.services import get_quote

            quote = get_quote(contract["quoteId"])
            source.check_quote_for_deal(quote, contract.get("dealId") or "")
            add("quote", "Báo giá liên kết hợp lệ (đã duyệt, đúng Deal, không OUT/xoá)", True, f"Báo giá {quote.get('quoteNumber')}")
        except Exception as exc:  # noqa: BLE001
            add("quote", "Báo giá liên kết hợp lệ (đã duyệt, đúng Deal, không OUT/xoá)", False, str(exc))
        if quote and (quote.get("currency") or "VND").upper() == "VND":
            same = abs(float(contract.get("contractValue") or 0) - float(quote.get("totalAmount") or 0)) < 0.5
            add("value", "Giá trị hợp đồng khớp tổng báo giá", same,
                "" if same else f"Hợp đồng {contract.get('contractValue'):,.0f} ≠ báo giá {float(quote.get('totalAmount') or 0):,.0f}", action={"kind": "edit_value"} if not same else None)
    else:
        add("quote", "Báo giá liên kết", True, "Hợp đồng không gắn báo giá", blocking=False)

    if contract.get("dealId") and lead:
        enriched = source.enrich_deal(lead, contact_id=contract.get("contactId"))
        gaps = source.legal_gaps(enriched, quote, issuer)
        miss = gaps["blockers"] + gaps["required"]
        add("legal", "Thông tin pháp lý hai bên đầy đủ", not miss, "; ".join(g["label"] for g in miss),
            action={"kind": "fix_legal", "customerId": lead.get("customer_id"), "gaps": [{"side": g["side"], "field": g["field"], "label": g["label"]} for g in miss]} if miss else None)
        # Người liên hệ của Deal KHÔNG mặc nhiên có quyền đại diện ký - ưu tiên lựa chọn đã lưu trên hợp đồng
        # (representative_confirmed, ghi lúc tạo/sửa hợp đồng), chỉ dùng gợi ý tạm từ gaps khi hợp đồng chưa có lựa chọn nào.
        rep_confirmed = bool(contract.get("representativeConfirmed"))
        rep = gaps.get("representative") or {}
        add("signer", "Đã xác nhận người đại diện ký hợp đồng", rep_confirmed,
            # Lo ten + chuc vu NGAY o dong nay (khong chi noi "co goi y") - Sale xac nhan nhanh ngay tai day (nut
            # "confirm_representative" o FE) ma khong phai mo form "Bo sung thong tin" long nhau de xem la AI/goi y ai.
            "" if rep_confirmed else ("Chưa chọn người đại diện ký" if not rep.get("name") else
                                       f"Gợi ý từ người liên hệ: {rep.get('name')}" + (f" ({rep['position']})" if rep.get("position") else "") + " - cần Sale xác nhận"),
            action={"kind": "confirm_representative", "customerId": lead.get("customer_id")} if not rep_confirmed else None)
    else:
        add("legal", "Thông tin pháp lý hai bên đầy đủ", True, "Hợp đồng không gắn Deal", blocking=False)

    risk = (latest or {}).get("risk")
    risk_ok = bool(latest and risk and risk.get("versionSha") == latest.get("sha256"))
    add("risk", "AI kiểm tra rủi ro cho đúng phiên bản mới nhất", risk_ok,
        "" if risk_ok else ("Phiên bản mới nhất chưa được phân tích (kết quả cũ thuộc phiên bản khác không được dùng)" if latest else "Chưa có phiên bản"),
        action={"kind": "run_risk", "version": latest["version"]} if latest and not risk_ok else None)

    gated = has_doc  # chỉ chặn hợp đồng đã có tài liệu (Copilot); legacy/thủ công giữ luồng cũ
    blocking_fail = [c for c in checks if c["blocking"] and not c["ok"]]
    return {"contractId": contract["id"], "hasDocument": has_doc, "latestVersion": latest["version"] if latest else None, "latestSha": (latest or {}).get("sha256"),
            "checks": checks, "ready": (not gated) or not blocking_fail, "gated": gated}


def enforce_status_change(contract: dict[str, Any], lead: dict[str, Any] | None, new_status: str, issuer: dict | None = None) -> dict[str, Any]:
    """Ném ValueError nếu chuyển sang trạng thái cần điều kiện mà chưa đủ. Trả kết quả readiness (để ghi vào lịch sử cùng phiên bản)."""
    r = compute_readiness(contract, lead, issuer)
    if new_status in GATED_STATUSES and r["gated"] and not r["ready"]:
        failed = "; ".join(c["label"] + (f" ({c['detail']})" if c["detail"] else "") for c in r["checks"] if c["blocking"] and not c["ok"])
        raise ValueError("Chưa đủ điều kiện gửi duyệt/ký: " + failed)
    return r
