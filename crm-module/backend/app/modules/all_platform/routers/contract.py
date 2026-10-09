"""Contracts endpoints — hợp đồng gắn với customer_leads (CRM deal) + quotes đã chốt,
kèm AI Contract Copilot (soạn thảo + chấm điểm rủi ro).

CRUD nội bộ dùng auth hiện có (get_current_user), theo đúng pattern quote.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile

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
        from app.modules.all_platform.services.contract_ai_service import _STANDARD_TERMS, _format_deal_context, _format_quote_context, numeric_tokens

        allowed = " ".join([_format_deal_context(deal), _format_quote_context(quote), payload.extra_prompt or "", _STANDARD_TERMS, source.money_tokens_text(quote, deal if crm_mode else None, _issuer_of_quote(quote))])
        unknown = sorted(numeric_tokens(" ".join(c.get("body", "") for c in clauses)) - numeric_tokens(allowed))
        warnings = override_warnings + ([f"Bản nháp chứa số liệu không có trong CRM/báo giá/yêu cầu: {', '.join(unknown[:12])} - hãy kiểm tra trước khi lưu."] if unknown else [])
        warnings += source.payment_plan_mismatch_warning(quote, clauses)
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
    """Đọc file hợp đồng vừa upload (PDF/ảnh), trích xuất best-effort số hợp
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
