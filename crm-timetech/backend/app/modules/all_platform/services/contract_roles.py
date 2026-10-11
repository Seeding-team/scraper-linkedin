"""Vai trò pháp lý Bên A / Bên B theo LOẠI hợp đồng và HƯỚNG giao dịch (không mặc định Bên A luôn là khách hàng).

direction:
  'sell' (mặc định, hợp đồng bán ra/ghi nhận): công ty phát hành báo giá là bên cung cấp (Bên B), khách hàng là bên mua/sử dụng (Bên A).
  'buy'  (hợp đồng mua vào, deal_phase='purchase'): công ty phát hành là bên mua/sử dụng (Bên A), khách hàng/nhà cung cấp là bên cung cấp (Bên B).
Thông tin từng bên lấy từ hồ sơ tương ứng (khách hàng ↔ Customer 360/Deal, công ty ↔ đơn vị phát hành báo giá); không bịa.
"""
from __future__ import annotations

from app.modules.all_platform.services.contract_type_service import _fold

RULES = [
    (("cho thue", "thue "), ("Bên thuê", "Bên cho thuê")),
    (("mua ban", "thiet bi", "cung cap hang", "phan cung"), ("Bên mua", "Bên bán")),
    (("hop tac kinh doanh", "lien doanh", "dai ly", "phan phoi"), ("Bên hợp tác thứ nhất", "Bên hợp tác thứ hai")),
    (("tu van",), ("Bên sử dụng dịch vụ tư vấn", "Bên tư vấn")),
    (("phat trien phan mem", "trien khai phan mem", "lap trinh"), ("Bên đặt hàng / sử dụng", "Bên thực hiện")),
]
DEFAULT = ("Bên sử dụng dịch vụ", "Bên cung cấp dịch vụ")


def role_labels(type_label: str | None) -> tuple[str, str]:
    t = _fold(type_label or "")
    for keys, roles in RULES:
        if any(k in t for k in keys):
            return roles
    return DEFAULT


def arrange_parties(parties: dict, direction: str | None) -> dict:
    """parties = {'a': khách hàng, 'b': công ty phát hành} (build_parties). direction='buy' -> đổi chỗ để công ty phát hành là Bên A."""
    if (direction or "sell").lower() == "buy":
        return {"a": parties["b"], "b": parties["a"], "swapped": True}
    return {"a": parties["a"], "b": parties["b"], "swapped": False}
