from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.crm_contact import CrmContactCreate, CrmContactUpdate
from app.modules.all_platform.services.crm_contact_service import (
    ContactNotFoundError,
    create_contact,
    delete_contact,
    get_contact,
    get_contact_activity,
    get_contact_related,
    list_contacts,
    update_contact,
)
from app.modules.all_platform.services.crm_customer_service import CustomerNotFoundError

# Mounted at prefix "/crm/customers/{customer_id}/contacts" in router.py -
# judgment call: kept as its OWN router file (not piggybacked onto
# crm_customer.py) because contacts are a distinct sub-resource with their
# own CRUD schema set; the path-param-in-prefix style itself follows the
# same convention already used for crm_customer_router's simple prefix.
router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    if isinstance(exc, PermissionError):
        return BaseResponse(success=False, message=str(exc))
    return BaseResponse(success=False, message=str(exc))


@router.get("")
def contacts_list(customer_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_contacts(customer_id, user))
    except Exception as exc:
        return _error(exc)


@router.post("")
def contacts_create(customer_id: str, payload: CrmContactCreate, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, message="Da them lien he", data=create_contact(customer_id, payload.model_dump(), user))
    except Exception as exc:
        return _error(exc)


@router.put("/{contact_id}")
def contacts_update(
    customer_id: str,
    contact_id: str,
    payload: CrmContactUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            message="Da cap nhat lien he",
            data=update_contact(customer_id, contact_id, payload.model_dump(exclude_unset=True), user),
        )
    except Exception as exc:
        return _error(exc)


@router.delete("/{contact_id}")
def contacts_delete(customer_id: str, contact_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        delete_contact(customer_id, contact_id, user)
        return BaseResponse(success=True, message="Da xoa lien he")
    except Exception as exc:
        return _error(exc)


# Contact 360 - dia chi truc tiep boi contact_id (khong long trong customer_id
# nhu router tren, vi Contact 360 duoc mo/deep-link truc tiep tu 1 contact
# row - xem ContactDetailDrawer). Mounted rieng o prefix "/crm/contacts"
# trong router.py (khong dung chung prefix "/crm/customers/{customer_id}/
# contacts" o tren).
detail_router = APIRouter()


def _detail_error(exc: Exception):
    if isinstance(exc, (ContactNotFoundError, CustomerNotFoundError)):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return BaseResponse(success=False, message=str(exc))


@detail_router.get("/{contact_id}")
def contact_detail(contact_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_contact(contact_id, user))
    except Exception as exc:
        return _detail_error(exc)


@detail_router.get("/{contact_id}/related")
def contact_related(contact_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_contact_related(contact_id, user))
    except Exception as exc:
        return _detail_error(exc)


@detail_router.get("/{contact_id}/activity")
def contact_activity(contact_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_contact_activity(contact_id, user))
    except Exception as exc:
        return _detail_error(exc)
