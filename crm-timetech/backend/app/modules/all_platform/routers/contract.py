"""Contracts endpoints — hợp đồng gắn với customer_leads (CRM deal) + quotes đã chốt,
kèm AI Contract Copilot (soạn thảo + chấm điểm rủi ro).

CRUD nội bộ dùng auth hiện có (get_current_user), theo đúng pattern quote.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.config import settings
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    ContractCreateRequest,
    ContractUpdateRequest,
    ContractStatusUpdateRequest,
    ContractGenerateRequest,
    ContractReviewRequest,
    ContractRefineRequest,
    ContractPrecheckRequest,
    ContractSuggestTypeRequest,
    ContractNumberSettingsRequest,
)
from app.modules.all_platform.services import (
    create_contract,
    delete_contract,
    get_contract,
    get_contracts_dashboard_stats,
    list_contracts,
    update_contract,
    update_contract_status,
    generate_contract_draft,
    review_contract_risk,
    refine_contract_draft,
    get_contract_template,
    get_quote,
    list_issuer_companies,
    list_contract_activity_log,
)
from app.modules.all_platform.services import contract_source_service as source
from app.modules.all_platform.services import idempotency_service
from app.modules.all_platform.services import contract_approval_service as approval
from app.modules.all_platform.services import contract_number_service as numbering
from app.modules.all_platform.services import contract_type_service as type_service
from app.modules.all_platform.services.contract_ocr_service import compare_to_quote, extract_contract_summary
from app.modules.all_platform.services.quote_currency import quote_amount_to_vnd
from app.modules.all_platform.services.crm_permission_service import can_edit_contract, can_edit_quote, filter_rows_by_scope, get_scope_visible_user_ids
from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

contracts_router = APIRouter()


def _load_contract_and_lead(contract_id: str) -> tuple[dict, dict | None]:
    contract = get_contract(contract_id)
    lead = get_customer_lead_by_id(contract["dealId"]) if contract.get("dealId") else None
    return contract, lead


@contracts_router.get("")
def contracts_list(
    deal_id: str | None = Query(None),
    status: str | None = Query(None),
    quote_id: str | None = Query(None),
    _user: dict = Depends(get_current_user),
) -> BaseResponse:
    try:
        rows = filter_rows_by_scope(_user, list_contracts(deal_id, status, quote_id), ("createdById", "ownerId"))
        return BaseResponse(success=True, data=rows)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/dashboard-stats")
def contracts_dashboard_stats(_user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        allowed = None
        if get_scope_visible_user_ids(_user) is not None:  # KPI chi tinh tren hop dong user duoc thay
            allowed = {r["id"] for r in filter_rows_by_scope(_user, list_contracts(None, None, None), ("createdById", "ownerId"))}
        return BaseResponse(success=True, data=get_contracts_dashboard_stats(allowed))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/suggest-type")
async def contracts_suggest_type(payload: ContractSuggestTypeRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI/luật ĐỀ XUẤT loại hợp đồng từ hạng mục báo giá + yêu cầu Sale + tên mẫu. Không chắc => needsConfirmation (người dùng chọn/nhập). Không lưu gì."""
    try:
        deal, quote = (source.resolve_source(payload.deal_id, payload.quote_id, payload.customer_id) if (payload.deal_id or payload.quote_id) else (None, None))
        data = await type_service.suggest_type(quote, payload.extra_prompt, payload.template_name, deal)
        return BaseResponse(success=True, data=data)
    except source.SourceError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/types")
def contracts_types(_user: dict = Depends(get_current_user)) -> BaseResponse:
    """Gợi ý cho combobox loại hợp đồng: danh sách có sẵn + các loại tự do đã dùng trong workspace (không giới hạn)."""
    from app.core.config import settings
    from app.core.supabase_client import get_supabase_client

    try:
        used = [r["template_type"] for r in (get_supabase_client().table("contracts").select("template_type").eq("instance", settings.crm_instance).limit(2000).execute().data or []) if r.get("template_type")]
    except Exception:  # noqa: BLE001
        used = []
    labels: list[str] = [t["label"] for t in type_service.KNOWN_TYPES]
    for u in used:
        lab = type_service.display_label(u)
        if lab not in labels:
            labels.append(lab)
    return BaseResponse(success=True, data={"types": labels})


@contracts_router.get("/number-settings")
def contracts_number_settings(short: str | None = Query(None), _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Quy tắc mã hợp đồng của workspace + mã kế tiếp (xem trước, không tiêu thụ số)."""
    try:
        return BaseResponse(success=True, data=numbering.peek_next(short))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.put("/number-settings")
def contracts_number_settings_save(payload: ContractNumberSettingsRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Chỉ admin/leader. Không đổi mã hợp đồng đã có. Cần migration 184 (chưa áp => trả lỗi rõ ràng)."""
    from app.modules.all_platform.services.crm_permission_service import can_manage_quote_email_settings

    if not can_manage_quote_email_settings(user):
        return BaseResponse(success=False, message="Chỉ Admin hoặc Leader được đổi quy tắc mã hợp đồng.")
    try:
        return BaseResponse(success=True, data=numbering.save_settings(payload.number_format, payload.short_name, user.get("id")))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/{contract_id}")
def contracts_get(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền xem hợp đồng này")
        return BaseResponse(success=True, data=contract)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/{contract_id}/activity-log")
def contracts_activity_log(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền xem lịch sử hợp đồng này")
        return BaseResponse(success=True, data=list_contract_activity_log(contract_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("")
def contracts_create(
    payload: ContractCreateRequest,
    user: dict = Depends(get_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> BaseResponse:
    """Tạo hợp đồng. Từ Copilot (ai_generated) backend kiểm tra Deal/báo giá đúng workspace + đã duyệt + không OUT/xoá, và chống tạo trùng
    (Idempotency-Key: gửi lại cùng key => trả đúng hợp đồng đã tạo, không tạo thêm)."""
    try:
        data = payload.model_dump()
        if data.get("ai_generated") and (data.get("deal_id") or data.get("quote_id")):
            source.resolve_source(data.get("deal_id"), data.get("quote_id"), data.get("customer_id"))

        def _create():
            if data.get("ai_generated"):
                from app.core.config import settings
                from app.core.supabase_client import get_supabase_client

                dup = idempotency_service.find_recent_duplicate_contract(
                    get_supabase_client(), settings.crm_instance, user.get("id"), data.get("deal_id"), data.get("quote_id"), data.get("title") or "")
                if dup:
                    return get_contract(dup["id"])
            return create_contract(data, user.get("id"))

        result, replayed = idempotency_service.run_once(idempotency_key, str(user.get("id")), _create)
        return BaseResponse(success=True, message="Hợp đồng này đã được tạo trước đó" if replayed else "Đã tạo hợp đồng", data=result)
    except source.SourceError as e:
        return BaseResponse(success=False, message=str(e))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.put("/{contract_id}")
def contracts_update(contract_id: str, payload: ContractUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền chỉnh sửa hợp đồng này")
        data = update_contract(contract_id, payload.model_dump(exclude_none=True), user.get("id"))
        return BaseResponse(success=True, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/{contract_id}/status")
def contracts_update_status(contract_id: str, payload: ContractStatusUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền đổi trạng thái hợp đồng này")
        # Hợp đồng Copilot (có tài liệu): chặn gửi duyệt/ký khi chưa đủ điều kiện (backend quyết định, không chỉ FE)
        readiness = approval.enforce_status_change(contract, lead, payload.status, _issuer_of_contract(contract))
        if readiness.get("gated") and payload.version and payload.version != readiness.get("latestVersion") and payload.status in approval.GATED_STATUSES:
            raise ValueError("Phiên bản được gửi duyệt không phải phiên bản mới nhất của tài liệu.")   # kiểm tra TRƯỚC khi đổi trạng thái
        data = update_contract_status(contract_id, payload.status, payload.signed_at, user.get("id"))
        if readiness.get("gated"):
            from app.modules.all_platform.services.supabase_contract_service import _log_activity

            _log_activity(contract_id, user.get("id"), f"approval:{payload.status}", {"version": payload.version or readiness.get("latestVersion"), "sha256": readiness.get("latestSha")})
        return BaseResponse(success=True, message="Đã cập nhật trạng thái hợp đồng", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.delete("/{contract_id}")
def contracts_delete(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền xoá hợp đồng này")
        delete_contract(contract_id)
        return BaseResponse(success=True)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── AI Contract Copilot ──────────────────────────────────────────────────────

def _issuer_of_contract(contract: dict) -> dict | None:
    try:
        return _issuer_of_quote(get_quote(contract["quoteId"])) if contract.get("quoteId") else None
    except Exception:  # noqa: BLE001
        return None


def _issuer_of_quote(quote: dict | None) -> dict | None:
    """Đơn vị phát hành báo giá = Bên B của hợp đồng.
    - Quote ĐÃ chọn đơn vị tường minh (issuer_company_id): LUÔN dùng đúng đơn vị đó - tin vào lựa chọn đã lưu trên quote, không
      thay bằng đơn vị khác dù workspace hiện tại là gì (1 vài workspace phát hành báo giá dưới pháp nhân của workspace khác là
      tình huống nghiệp vụ hợp lệ đã có trong dữ liệu thật - không phải lỗi).
    - Quote CHƯA chọn đơn vị nào: chỉ tự chọn trong số đơn vị thuộc ĐÚNG workspace hiện tại (settings.crm_instance); workspace
      khác hoặc không đơn vị nào khớp -> để trống, KHÔNG tự lấy đơn vị của workspace khác (vd Cloudgate không tự lấy Markee)."""
    try:
        companies = list_issuer_companies(include_inactive=True)
    except Exception:
        return None
    issuer_id = (quote or {}).get("issuerCompanyId")
    if issuer_id:
        return next((c for c in companies if c.get("id") == issuer_id), None)
    same_workspace_active = [c for c in companies if (c.get("status") or "active") == "active" and c.get("instance") == settings.crm_instance]
    return same_workspace_active[0] if len(same_workspace_active) == 1 else None


def _apply_legal_overrides(deal: dict | None, overrides, contact_id: str | None, user: dict, save_to_crm: bool) -> tuple[dict | None, str | None, list[str]]:
    """'Bổ sung tại chỗ' trong Copilot: chỉ áp CHÍNH XÁC những trường Sale thật sự nhập (không ghi đè field khác). Nhóm company_*
    (Tên pháp nhân/MST/Địa chỉ) luôn ghi vào Customer; nhóm contact_* (Họ tên/Chức vụ/SĐT/Email) ghi vào Contact - không bao giờ trộn 2 nhóm.
    save_to_crm=False (mặc định - "Chỉ dùng cho hợp đồng này"): chỉ áp lên bản deal của PHIÊN này, không đụng hồ sơ CRM gốc.
    save_to_crm=True: ghi thật vào crm_customers/crm_contacts qua permission-checked update_customer/update_contact (đúng quyền, đúng instance -
    2 hàm này tự kiểm tra; không đủ quyền thì KHÔNG chặn luồng, chỉ báo warning và vẫn dùng overrides cho phiên hiện tại)."""
    if not overrides or not deal:
        return deal, contact_id, []
    o = overrides.model_dump(exclude_none=True) if hasattr(overrides, "model_dump") else dict(overrides)
    warnings: list[str] = []
    out = dict(deal)
    company_patch = {k: o[k] for k in ("company_name", "tax_code", "address") if str(o.get(k) or "").strip()}
    contact_patch = {
        **({"name": o["contact_name"]} if str(o.get("contact_name") or "").strip() else {}),
        **({"position": o["contact_position"]} if str(o.get("contact_position") or "").strip() else {}),
        **({"phone": o["contact_phone"]} if str(o.get("contact_phone") or "").strip() else {}),
        **({"email": o["contact_email"]} if str(o.get("contact_email") or "").strip() else {}),
    }
    out.update(company_patch)
    if "name" in contact_patch:
        out["contact_name"] = contact_patch["name"]
    for src_key, deal_key in (("position", "position"), ("phone", "phone"), ("email", "email")):
        if src_key in contact_patch:
            out[deal_key] = contact_patch[src_key]
    if save_to_crm:
        customer_id = deal.get("customer_id")
        if company_patch and customer_id:
            try:
                from app.modules.all_platform.services.crm_customer_service import update_customer
                update_customer(customer_id, company_patch, user)
            except PermissionError:
                warnings.append("Không đủ quyền lưu thông tin doanh nghiệp vào hồ sơ CRM - chỉ áp dụng cho hợp đồng này.")
            except Exception:
                warnings.append("Không lưu được thông tin doanh nghiệp vào hồ sơ CRM - chỉ áp dụng cho hợp đồng này.")
        if contact_patch and customer_id:
            try:
                from app.modules.all_platform.services.crm_contact_service import create_contact, find_duplicate_contacts, update_contact
                if contact_id:
                    update_contact(customer_id, contact_id, contact_patch, user)
                else:
                    # Tránh tạo trùng Contact khi Sale bấm Lưu nhiều lần / precheck tự chạy lại (focus tab) mà chưa kịp
                    # nhận contact_id vừa tạo - khớp theo SĐT/Email đã chuẩn hoá trong CHÍNH khách hàng này trước khi tạo mới.
                    dup = find_duplicate_contacts(customer_id, user, phone=contact_patch.get("phone"), email=contact_patch.get("email"))
                    same_customer_dup = next((d for d in dup if d.get("same_customer")), None)
                    if same_customer_dup:
                        contact_id = same_customer_dup.get("id")
                        update_contact(customer_id, contact_id, contact_patch, user)
                    else:
                        created = create_contact(customer_id, {**contact_patch, "is_primary": False}, user)
                        contact_id = created.get("id")
                    out["contact_id"] = contact_id
            except PermissionError:
                warnings.append("Không đủ quyền lưu người liên hệ vào hồ sơ CRM - chỉ áp dụng cho hợp đồng này.")
            except Exception:
                warnings.append("Không lưu được người liên hệ vào hồ sơ CRM - chỉ áp dụng cho hợp đồng này.")
    return out, contact_id, warnings


def _contacts_for_deal(deal: dict | None, user: dict) -> list[dict]:
    """Danh sách Contact của khách hàng - để FE cho Sale CHỌN đúng người khi khách có nhiều Contact (không tự đoán)."""
    customer_id = (deal or {}).get("customer_id")
    if not customer_id:
        return []
    try:
        from app.modules.all_platform.services.crm_contact_service import list_contacts

        return [{"id": c["id"], "name": c.get("name"), "position": c.get("position"), "phone": c.get("phone"),
                 "email": c.get("email"), "isPrimary": bool(c.get("is_primary"))} for c in list_contacts(customer_id, user)]
    except Exception:
        return []


@contracts_router.post("/precheck")
def contracts_precheck(payload: ContractPrecheckRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Kiểm tra nguồn TRƯỚC khi tạo bản nháp: Deal/báo giá hợp lệ + thông tin pháp lý hai bên còn thiếu (blockers / required / optional)."""
    try:
        deal, quote = source.resolve_source(payload.deal_id, payload.quote_id, payload.customer_id, require_deal=bool(payload.customer_id), contact_id=payload.contact_id)
    except source.SourceError as e:
        return BaseResponse(success=True, data={"ok": False, "blockers": [{"label": str(e), "side": "", "field": "source", "source": ""}], "required": [], "optional": []})
    contacts = _contacts_for_deal(deal, user)
    deal, contact_id, override_warnings = _apply_legal_overrides(deal, payload.legal_overrides, payload.contact_id, user, payload.save_overrides_to_crm)
    issuer = _issuer_of_quote(quote)
    from app.modules.all_platform.services.contract_ai_service import build_parties, resolve_representative

    representative = resolve_representative(deal, payload.representative.model_dump() if payload.representative else None)
    gaps = source.legal_gaps(deal, quote, issuer, representative)
    # "Bổ sung thông tin": mỗi trường thiếu kèm nơi sửa (Customer 360 cho Bên khách hàng, Cài đặt đơn vị phát hành cho công ty phát hành)
    for bucket in ("blockers", "required", "optional"):
        for g in gaps[bucket]:
            g["fix"] = ({"kind": "customer", "customerId": (deal or {}).get("customer_id")} if g.get("side") == "A"
                        else {"kind": "issuer", "issuerId": (issuer or {}).get("id")})

    # Đủ trường để FE hiển thị tóm tắt 2 bên NGAY (kể cả trường đã đủ, không chỉ liệt kê trường thiếu) - không suy đoán gì thêm
    # ngoài đúng dữ liệu build_parties() đã dùng để dựng hợp đồng thật (DOCX/PDF dùng chung hàm này -> luôn nhất quán).
    parties = build_parties(deal, quote, issuer, representative)
    issuer_out = ({
        "id": issuer.get("id"), "code": issuer.get("code"), "legalName": issuer.get("legalName"), "brandName": issuer.get("brandName"),
        "taxCode": issuer.get("taxCode"), "address": issuer.get("address"), "phone": issuer.get("phone"), "email": issuer.get("email"),
        "contactName": issuer.get("contactName"), "positionCategoryId": issuer.get("positionCategoryId"), "positionLabel": issuer.get("positionLabel"),
        "status": issuer.get("status"),
    } if issuer else None)
    return BaseResponse(success=True, data={"ok": not gaps["blockers"], **gaps, "issuer": issuer_out, "parties": parties,
                                             "contacts": contacts, "contactId": contact_id, "warnings": override_warnings})


@contracts_router.post("/generate-draft")
async def contracts_generate_draft(payload: ContractGenerateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI soạn thảo — KHÔNG tạo row DB, chỉ trả clauses tạm để FE review trước khi Lưu."""
    try:
        from app.modules.all_platform.services.contract_ai_service import build_parties, resolve_representative

        crm_mode = bool(payload.deal_id or payload.customer_id or payload.quote_id)
        representative = None
        override_warnings: list[str] = []
        if crm_mode:
            deal, quote = source.resolve_source(payload.deal_id, payload.quote_id, payload.customer_id, require_deal=bool(payload.customer_id), contact_id=payload.contact_id)
            deal, _contact_id, override_warnings = _apply_legal_overrides(deal, payload.legal_overrides, payload.contact_id, user, payload.save_overrides_to_crm)
            representative = resolve_representative(deal, payload.representative.model_dump() if payload.representative else None)
            source.enforce_gaps(source.legal_gaps(deal, quote, _issuer_of_quote(quote), representative), payload.acknowledge_missing)
        else:
            deal = {"customer_name": payload.manual_customer_name} if payload.manual_customer_name else None
            quote = None
        reference_text = (payload.reference_text or "")[:20000] or None
        if payload.reference_template_id:
            reference_text = get_contract_template(payload.reference_template_id, include_text=True).get("extractedText")
        extra = payload.extra_prompt or ""
        hints = [h for h in (f"Ngôn ngữ: {payload.language}" if payload.language else "", f"Phong cách: {payload.style}" if payload.style else "") if h]
        if hints:
            extra = (extra + "\n" if extra else "") + "[" + "; ".join(hints) + " - chỉ ảnh hưởng văn phong, KHÔNG được đổi số liệu/tỷ lệ/ngày]"
        clauses = await generate_contract_draft(
            deal, quote, payload.template_type, payload.detail_level, extra or None, reference_text,
            issuer=_issuer_of_quote(quote), representative=representative,
        )
        # Số liệu trong bản nháp không có trong CRM/báo giá/yêu cầu người dùng (vd lấy từ mẫu tham chiếu) => cảnh báo để người duyệt kiểm tra
        from app.modules.all_platform.services.contract_ai_service import (
            _STANDARD_TERMS,
            _format_deal_context,
            _format_quote_context,
            _has_api_key,
            numeric_tokens,
        )

        allowed = " ".join([_format_deal_context(deal), _format_quote_context(quote), payload.extra_prompt or "", _STANDARD_TERMS, source.money_tokens_text(quote, deal if crm_mode else None, _issuer_of_quote(quote))])
        unknown = sorted(numeric_tokens(" ".join(c.get("body", "") for c in clauses)) - numeric_tokens(allowed))
        warnings = override_warnings + ([f"Bản nháp chứa số liệu không có trong CRM/báo giá/yêu cầu: {', '.join(unknown[:12])} - hãy kiểm tra trước khi lưu."] if unknown else [])
        warnings += source.payment_plan_mismatch_warning(quote, clauses)
        if not _has_api_key():
            warnings.insert(0, "Chế độ Local Dev: Chưa cấu hình CONTRACT_AI_API_KEY — Hợp đồng được sinh bằng bộ máy Heuristic/Regex tự động từ dữ liệu CRM & Báo giá.")
        return BaseResponse(success=True, data={"clauses": clauses, "warnings": warnings,
                                                 "parties": build_parties(deal, quote, _issuer_of_quote(quote), representative) if crm_mode else None})
    except source.SourceError as e:
        return BaseResponse(success=False, message=str(e))
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/ai-review")
async def contracts_ai_review(payload: ContractReviewRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote = get_quote(payload.quote_id) if payload.quote_id else None
        clauses = [c.model_dump() for c in payload.clauses]
        result = await review_contract_risk(clauses, quote, payload.contract_value, payload.payment_terms)
        return BaseResponse(success=True, data=result)
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/refine-draft")
async def contracts_refine_draft(payload: ContractRefineRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """'✦ AI đề xuất chỉnh sửa' — soạn lại nội dung điều khoản để khắc phục các
    rủi ro vừa được /ai-review phát hiện. Không tạo/sửa DB, chỉ trả clauses mới
    để FE hiển thị + người dùng tự bấm Lưu."""
    try:
        clauses = [c.model_dump() for c in payload.clauses]
        refined = await refine_contract_draft(clauses, payload.findings)
        return BaseResponse(success=True, data={"clauses": refined})
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── OCR reconciliation ("Ghi nhận hợp đồng có sẵn" - đối chiếu file hợp đồng
#    đã upload với số liệu THẬT của báo giá đã chọn) ──────────────────────────

@contracts_router.post("/ocr-reconcile")
async def contracts_ocr_reconcile(
    file: UploadFile = File(...),
    quote_id: str = Form(...),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Đọc file hợp đồng vừa upload (PDF/ảnh/.docx), trích xuất best-effort số hợp
    đồng/ngày ký/3 mốc tiền (Trước VAT/VAT/Sau VAT), rồi so với số liệu THẬT
    của báo giá `quote_id` đã chọn trên form. Dùng lại đúng quyền đọc báo giá
    đã áp dụng ở GET /quotes/{quote_id} (quotes_get trong quote.py) - báo giá
    đã duyệt/xác nhận thì ai đăng nhập cũng xem được, chưa duyệt thì phải có
    quyền sửa báo giá đó (can_edit_quote) mới được đối chiếu.

    KHÔNG bịa dữ liệu: nếu không đọc được nội dung file, trả extractable=False
    và data.comparison rỗng - FE phải hiển thị honest message, không dựng bảng
    so sánh giả."""
    try:
        quote = get_quote(quote_id)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))

    lead = get_customer_lead_by_id(quote["dealId"]) if quote.get("dealId") else None
    if quote.get("status") not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
        return BaseResponse(success=False, message="Không có quyền xem báo giá này")

    try:
        file_bytes = await file.read()
        extracted = await extract_contract_summary(file_bytes, file.filename or "")
        # Hop dong dang VND: bao gia USD so sanh theo gia tri quy doi VND (ty gia DA CHOT cua bao gia).
        def _vnd(amount):
            if amount is None or str(quote.get("currency") or "VND").upper() == "VND":
                return amount
            return quote_amount_to_vnd(amount, quote.get("currency"), quote.get("exchangeRate"))

        comparison = compare_to_quote(
            extracted,
            _vnd(quote.get("subtotalAmount")),
            _vnd(quote.get("vatAmount")),
            _vnd(quote.get("totalAmount")),
        )
        return BaseResponse(
            success=True,
            data={
                "extracted": extracted,
                "comparison": comparison["rows"],
                "allMatched": comparison["allMatched"],
                "extractable": extracted.get("extractable", False),
            },
        )
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class ContractImportDriveRequest(BaseModel):
    url: str


@contracts_router.post("/{contract_id}/document/upload")
async def contracts_document_upload(
    contract_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    """(A4/Tai lieu) Sale tai 1 file tu may len thay cho file goc cua hop dong - luu vao bucket
    `crm-attachments` (dung chung ham upload_attachment() da co o luong "Ghi nhan hop dong co
    san", khong lam lai co che upload moi), ghi `contracts.file_url`, roi xep job dong bo Drive
    (KHONG goi Drive truc tiep trong request - dung chung pipeline worker A3)."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    from app.modules.all_platform.services.crm_attachment_service import (
        MAX_FILE_SIZE_BYTES, allowed_mime, upload_attachment,
    )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        return BaseResponse(success=False, message="File quá lớn (tối đa 25MB).")
    if not allowed_mime(file.content_type):
        return BaseResponse(success=False, message=f"Định dạng file không được hỗ trợ: {file.content_type or 'không rõ'}.")
    public_url, error = upload_attachment(
        prefix="contract", customer_id=contract.get("customerId") or contract.get("dealId"),
        filename=file.filename or "hop-dong", content=content, content_type=file.content_type,
    )
    if error:
        return BaseResponse(success=False, message=error)
    try:
        # update_contract() da tu dong xep job dong bo Drive (xem _queue_drive_sync wrapper trong
        # supabase_contract_service.py) - khong can goi them o day.
        updated = update_contract(contract_id, {"file_url": public_url, "source": contract.get("source") or "external"}, user.get("id"))
        return BaseResponse(success=True, message="Đã tải file lên và xếp lịch đồng bộ Drive.", data=updated)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/{contract_id}/document/import-drive")
def contracts_document_import_drive(
    contract_id: str, payload: ContractImportDriveRequest, user: dict = Depends(get_current_user),
) -> BaseResponse:
    """(A4/Tai lieu) Nhap 1 link Google Docs/Drive co san lam tai lieu goc cua hop dong - kiem tra
    THAT quyen doc truoc (nguyen tac #4 trong plan), KHONG mac dinh "co link la co quyen". Thieu
    quyen -> tra huong dan ro rang de Sale tu chia se cho service account hoac tai file thay the,
    KHONG coi la loi he thong chung chung."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    url = (payload.url or "").strip()
    if not url:
        return BaseResponse(success=False, message="Thiếu link Google Docs/Drive.")
    from app.modules.all_platform.services.contract_drive_service import check_file_readable, extract_file_id_from_url

    if "docs.google.com" not in url and "drive.google.com" not in url:
        return BaseResponse(success=False, message="Link phải là Google Docs/Drive (docs.google.com hoặc drive.google.com).")
    file_id = extract_file_id_from_url(url)
    if not file_id:
        return BaseResponse(success=False, message="Không đọc được ID file từ link này — kiểm tra lại đúng link chia sẻ của Google Docs/Drive.")
    if not check_file_readable(file_id):
        return BaseResponse(success=False, message=(
            f"Chưa có quyền đọc file này. Hãy mở link trên Google Drive → Chia sẻ → thêm "
            f"{settings.google_service_account_email} (quyền Xem) rồi thử lại, hoặc tải file lên trực tiếp thay thế."
        ))
    try:
        updated = update_contract(contract_id, {"file_url": url, "source": contract.get("source") or "external"}, user.get("id"))
        return BaseResponse(success=True, message="Đã nhập file từ Google Drive và xếp lịch đồng bộ.", data=updated)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/{contract_id}/document/import-via-oauth")
def contracts_document_import_via_oauth(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """(2026-10-27, "nhap hop dong Google Docs/Drive rieng tu") Thay vi bat Sale tai file tu
    may (vo ly khi file KHONG he nam tren may ho), dung CHINH OAuth token cua Sale (da ket noi
    qua /google-oauth/start) de doc/export file rieng tu, roi UPLOAD BAN SAO do vao Shared
    Drive bang service account co san (contract_drive_service) - file nguon tren Drive ca
    nhan cua Sale KHONG he bi dong/doi quyen chia se."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    file_url = (contract.get("fileUrl") or "").strip()
    if "docs.google.com" not in file_url and "drive.google.com" not in file_url:
        return BaseResponse(success=False, message="Hợp đồng chưa có link Google Docs/Drive để nhập.")

    from app.modules.all_platform.services import google_oauth_service as oauth
    from app.modules.all_platform.services.contract_drive_service import (
        _resolve_company_label, _sanitize_folder_name, ensure_contract_folder,
        extract_file_id_from_url, upload_new_file_with_hash,
    )

    try:
        user_id = user.get("id")
        status = oauth.get_status(user_id)
        if not status:
            return BaseResponse(success=False, message="Chưa kết nối Google — bấm \"Kết nối Google để nhập\" trước.", data={"needsConnect": True})

        file_id = extract_file_id_from_url(file_url)
        if not file_id:
            return BaseResponse(success=False, message="Không đọc được ID file từ link này.")
        if not oauth.check_user_can_read_file(user_id, file_id):
            return BaseResponse(success=False, message=(
                f"Tài khoản Google đã kết nối ({status.get('email') or 'không rõ email'}) không có quyền đọc file này — "
                "nhờ chủ sở hữu chia sẻ quyền Xem cho đúng tài khoản này, hoặc kết nối tài khoản khác đang có quyền."
            ))
        downloaded = oauth.download_file_via_user(user_id, file_id)
        if downloaded is None:
            return BaseResponse(success=False, message="Không tải được nội dung file (có quyền đọc nhưng tải lỗi — thử lại sau).")
        content, _name, mime_type = downloaded

        from app.core.supabase_client import get_supabase_client

        sb = get_supabase_client()
        contract_row = sb.table("contracts").select("*").eq("id", contract_id).limit(1).execute().data[0]
        company_label = _resolve_company_label(contract_row)
        filename = f"{_sanitize_folder_name(contract.get('contractNumber') or contract_id)}_Goc.pdf"
        folder_id = ensure_contract_folder(contract_row["instance"], company_label, contract.get("contractNumber") or contract_id)
        result = upload_new_file_with_hash(folder_id, filename, content, mime_type)
        if not result["reused"]:
            sb.table("contract_drive_files").insert({
                "contract_id": contract_id, "drive_file_id": result["drive_file_id"], "file_name": filename,
                "file_type": "original", "content_hash": result["content_hash"], "source_bucket": "google_oauth_import",
            }).execute()
        sb.table("contracts").update({"drive_folder_id": folder_id}).eq("id", contract_id).execute()

        return BaseResponse(success=True, message="Đã nhập file qua tài khoản Google đã kết nối và lưu vào Drive CRM.", data={
            "driveFileId": result["drive_file_id"], "folderId": folder_id,
        })
    except Exception as e:  # noqa: BLE001
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/{contract_id}/drive/sync")
def contracts_drive_sync_retry(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """(A3) Dong bo lai thu cong - CHI insert 1 job moi vao contract_drive_sync_jobs, dung CHUNG
    pipeline voi worker tu dong (khong goi Drive truc tiep trong request nay)."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    try:
        get_supabase_client_for_drive_queue().table("contract_drive_sync_jobs").insert({
            "contract_id": contract_id, "status": "queued",
        }).execute()
        return BaseResponse(success=True, message="Đã xếp lịch đồng bộ lại")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


def get_supabase_client_for_drive_queue():
    from app.core.supabase_client import get_supabase_client

    return get_supabase_client()


@contracts_router.post("/{contract_id}/ai-review-full")
async def contracts_ai_review_full(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """(B5) Chay B2+B3 (hoac tra ve cache B1 neu noi dung hop dong+bao gia khong doi) - CHUA luu
    gi len Drive, Sale xem truoc roi moi goi /ai-review/confirm."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    try:
        from app.modules.all_platform.services.contract_ai_review_service import run_ai_review_full

        result = await run_ai_review_full(contract_id)
        return BaseResponse(success=True, data=result)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/{contract_id}/ai-review/latest")
async def contracts_ai_review_latest(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """(2026-10-27, fix bug "mat trang thai khi dong/mo lai panel") Doc phien AI Review GAN
    NHAT da luu trong DB - KHONG goi AI, KHONG tao ban ghi moi. FE goi ham nay o LAN MO TAB/
    PANEL dau tien (khong phai nut "Chay AI Review") de khoi phuc day du ket qua + Highlight
    nhap + trang thai xac nhan, du da dong panel/doi tab/F5/dang nhap lai."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    try:
        from app.modules.all_platform.services.contract_ai_review_service import get_latest_review_status

        result = await get_latest_review_status(contract_id)
        return BaseResponse(success=True, data=result)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/{contract_id}/ai-review/{review_id}/highlight-preview-pdf")
def contracts_ai_review_highlight_preview(contract_id: str, review_id: str, user: dict = Depends(get_current_user)):
    """(B6) Xem truoc bang HIGHLIGHT THAT da tao san o run_ai_review_full() - DOCX duoc convert
    sang PDF de xem (cung engine LibreOffice da dung cho cac noi khac), PDF tra thang."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    from app.modules.all_platform.services.contract_ai_review_service import get_highlight_preview_bytes
    from app.modules.all_platform.services import contract_docx_engine as eng

    result = get_highlight_preview_bytes(review_id)
    if result is None:
        return BaseResponse(success=False, message="Chưa có bản Highlight xem trước cho hợp đồng này")
    content, mime_type = result
    if mime_type != "application/pdf":
        try:
            content = eng.convert_docx_to_pdf(content)
        except Exception as exc:  # noqa: BLE001
            return BaseResponse(success=False, message=f"Không xem trước được bản Highlight: {exc}")
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="ai-highlight.pdf"'})


@contracts_router.post("/{contract_id}/ai-review/confirm")
async def contracts_ai_review_confirm(
    contract_id: str, review_id: str = Form(...), user: dict = Depends(get_current_user)
) -> BaseResponse:
    """(B5, nguyen tac #6) Sale xac nhan sau khi xem truoc ket qua - LUC NAY moi tao file
    Highlight that + day len Drive."""
    contract, lead = _load_contract_and_lead(contract_id)
    if not can_edit_contract(user, contract, lead):
        return BaseResponse(success=False, message="Không có quyền với hợp đồng này")
    try:
        from app.modules.all_platform.services.contract_ai_review_service import confirm_ai_review

        result = await confirm_ai_review(contract_id, review_id, user.get("id"))
        return BaseResponse(success=True, data=result)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
