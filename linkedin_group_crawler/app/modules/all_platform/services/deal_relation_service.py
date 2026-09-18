"""Validate effective Deal links, including unchanged links on partial updates."""
from typing import Any


def validate_deal_relations(
    data: dict[str, Any], actor: dict[str, Any] | None,
    existing: dict[str, Any] | None = None,
) -> None:
    from app.modules.all_platform.services.crm_customer_service import get_customer
    from app.modules.all_platform.services.customer_lead_service import (
        validate_contact_belongs_to_customer, validate_project_belongs_to_customer,
    )

    current = existing or {}
    customer_id = data.get('customer_id', current.get('customer_id'))
    contact_id = data.get('primary_contact_id', current.get('primary_contact_id'))
    project_id = data.get('project_id', current.get('project_id'))
    if (contact_id or project_id) and not customer_id:
        raise ValueError('Phải chọn khách hàng trước khi liên kết người liên hệ/dự án.')
    if customer_id:
        if not actor:
            raise PermissionError('Cần người dùng xác thực để liên kết khách hàng.')
        # get_customer scopes instance AND checks read permission.
        get_customer(str(customer_id), actor)
    # Validators scope their lookups to the runtime instance, then compare parent.
    validate_contact_belongs_to_customer(contact_id, customer_id)
    validate_project_belongs_to_customer(project_id, customer_id)
