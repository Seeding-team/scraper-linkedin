from fastapi import APIRouter, HTTPException, Depends, Query, Request, Header, UploadFile, File, Form
from typing import List, Any, Optional
import logging
from app.modules.all_platform.schemas.common import BaseResponse
from app.modules.all_platform.schemas.customer_lead import (
    CustomerLeadCreate,
    CustomerLeadUpdate,
    CustomerLeadResponse,
    StageTransitionRequest,
    ActivityLogResponse,
    DEAL_STAGES,
)
from app.modules.all_platform.services import customer_lead_service, decode_token, get_user_by_id, can_write_deal
from app.modules.all_platform.services.customer_lead_service import TransitionError
from app.core.supabase_client import friendly_supabase_error_message
from app.modules.all_platform.services.crm_attachment_service import (
    upload_attachment,
    allowed_mime,
    MAX_FILE_SIZE_BYTES,
)
from app.modules.all_platform.services.deal_ai_parse_service import (
    is_ai_configured,
    parse_deal_text,
)
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def get_current_user(request: Request, authorization: str | None = Header(None)) -> dict[str, Any]:
    if not authorization:
        cookie_token = request.cookies.get("crawlpro_access_token")
        if cookie_token:
            authorization = f"Bearer {cookie_token}"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    payload = decode_token(authorization[7:])
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        user = get_user_by_id(str(payload["sub"]))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


router = APIRouter(prefix="/customer-leads", tags=["Customer Leads"])


# ---------------------------------------------------------------------------
# List + utility
# ---------------------------------------------------------------------------
@router.get("", response_model=BaseResponse)
def get_customer_leads(
    search: str | None = Query(None),
    status: str | None = Query(None),
    deal_stage: str | None = Query(None),
    city: str | None = Query(None),
    industry: str | None = Query(None),
    source_platform: str | None = Query(None),
    exclude_terminal: bool = Query(False, description="Loại bỏ won/lost ra khỏi kết quả (UI tab chính)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    current_user: Any = Depends(get_current_user),
):
    try:
        result = customer_lead_service.get_all_customer_leads(
            current_user=current_user,
            search=search,
            status=status,
            deal_stage=deal_stage,
            city=city,
            industry=industry,
            source_platform=source_platform,
            exclude_terminal=exclude_terminal,
            page=page,
            page_size=page_size,
        )
        return BaseResponse(success=True, data=result, message="Success")
    except Exception as e:
        return BaseResponse(success=False, message=friendly_supabase_error_message(e))


@router.get("/stage-counts", response_model=BaseResponse)
def get_stage_counts(current_user: Any = Depends(get_current_user)):
    """Số deal ở mỗi stage — cho header KPI / Kanban column counts."""
    try:
        counts = customer_lead_service.get_stage_counts(current_user=current_user)
        return BaseResponse(success=True, data=counts, message="Success")
    except Exception as e:
        return BaseResponse(success=False, message=friendly_supabase_error_message(e))


@router.get("/sdrs", response_model=BaseResponse)
def get_sdrs(_: Any = Depends(get_current_user)):
    try:
        data = customer_lead_service.get_all_sdrs()
        return BaseResponse(success=True, data=data, message="Success")
    except Exception as e:
        return BaseResponse(success=False, message=friendly_supabase_error_message(e))


@router.get("/by-conv/{conv_id}", response_model=BaseResponse)
def get_by_conv_id(conv_id: str, _: Any = Depends(get_current_user)):
    try:
        lead = customer_lead_service.get_customer_lead_by_conv_id(conv_id)
        if lead:
            return BaseResponse(success=True, data=lead, message="Found")
        return BaseResponse(success=True, data=None, message="Not found")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ---------------------------------------------------------------------------
# Stage transition (state machine + audit log)
# ---------------------------------------------------------------------------
@router.post("/{lead_id}/transition", response_model=BaseResponse)
def transition_stage(
    lead_id: str,
    payload: StageTransitionRequest,
    current_user: Any = Depends(get_current_user),
):
    """
    Body chứa: to_stage (+ note, attachment_url, reject_reason_type, ...).
    Required fields cho stage đích được enforce server-side ở STAGE_REQUIRED_FIELDS.
    Mỗi call hợp lệ sẽ ghi 1 dòng `stage_change` vào customer_lead_activity_log.
    """
    try:
        # Validate to_stage
        if payload.to_stage not in DEAL_STAGES:
            return BaseResponse(
                success=False,
                message=f"Giá trị 'to_stage' không hợp lệ: {payload.to_stage}",
            )
        existing = customer_lead_service.get_customer_lead_by_id(lead_id)
        if not can_write_deal(current_user, existing):
            return BaseResponse(success=False, message="Bạn không có quyền chuyển giai đoạn deal này")
        data = payload.model_dump(exclude_unset=True)
        updated = customer_lead_service.transition_stage(
            lead_id=lead_id,
            payload=data,
            actor=current_user,
        )
        return BaseResponse(success=True, data=updated, message="Success")
    except TransitionError as te:
        # 422 vì thiếu required fields — UI highlight ô thiếu
        return BaseResponse(
            success=False,
            message=te.message,
            data={"missing_fields": te.missing_fields},
        )
    except Exception as e:
        logger_msg = f"transition_stage failed for {lead_id}: {e}"
        return BaseResponse(success=False, message=logger_msg)


@router.get("/{lead_id}/activity-log", response_model=BaseResponse)
def get_activity_log(
    lead_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: Any = Depends(get_current_user),
):
    """Audit trail cho 1 deal — DESC theo created_at."""
    try:
        data = customer_lead_service.get_activity_log(lead_id, limit=limit, offset=offset)
        return BaseResponse(success=True, data=data, message="Success")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ---------------------------------------------------------------------------
# Attachment upload (lên Supabase Storage bucket `crm-attachments`)
# ---------------------------------------------------------------------------
_ALLOWED_UPLOAD_PREFIXES = {"brief", "proposal", "contract", "logo"}


@router.post("/upload", response_model=BaseResponse)
async def upload_crm_attachment(
    file: UploadFile = File(...),
    prefix: str = Form(..., description="brief | proposal | contract"),
    customer_id: Optional[str] = Form(None),
    _: Any = Depends(get_current_user),
):
    """
    Upload 1 file đính kèm lên Supabase Storage bucket ``crm-attachments``.

    - ``file``: multipart/form-data file
    - ``prefix``: phân loại (``brief`` / ``proposal`` / ``contract``)
    - ``customer_id`` (optional): UUID của deal — nếu chưa có cứ để trống

    Trả về ``{ url, name }`` để frontend dán vào ``attachment_url`` khi gọi
    transition. KHÔNG ghi vào DB ở step này — file chỉ được link với deal khi
    transition hợp lệ xảy ra (đỡ phải dọn file orphaned).
    """
    try:
        if prefix not in _ALLOWED_UPLOAD_PREFIXES:
            return BaseResponse(
                success=False,
                message=(
                    f"prefix không hợp lệ: '{prefix}'. "
                    f"Cho phép: {sorted(_ALLOWED_UPLOAD_PREFIXES)}"
                ),
            )

        content_type = (file.content_type or "").lower()
        if not allowed_mime(content_type):
            return BaseResponse(
                success=False,
                message=(
                    f"Định dạng file không được phép: '{content_type}'. "
                    "Chỉ nhận ảnh, PDF, Word/Excel/PowerPoint, video, audio, "
                    "txt/csv, nén (zip/7z/rar)."
                ),
            )

        # Logo cong ty phat hanh: rieng PNG/JPG/WebP, toi da 2MB - chat hon gioi
        # han chung (25MB, moi loai file) o duoi.
        LOGO_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
        LOGO_MAX_BYTES = 2 * 1024 * 1024
        if prefix == "logo" and content_type not in LOGO_MIME_TYPES:
            return BaseResponse(
                success=False,
                message=f"Logo chỉ nhận PNG/JPG/WebP, không nhận '{content_type}'.",
            )

        # Đọc tối đa MAX_FILE_SIZE_BYTES — tránh RAM spike với file khổng lồ.
        # FastAPI không tự giới hạn kích thước UploadFile.
        raw = await file.read()
        max_bytes = LOGO_MAX_BYTES if prefix == "logo" else MAX_FILE_SIZE_BYTES
        if len(raw) > max_bytes:
            mb = max_bytes // (1024 * 1024)
            return BaseResponse(
                success=False,
                message=f"File quá lớn (> {mb} MB). Vui lòng nén lại.",
            )

        # Lưu tên gốc (decode từ filename header — có thể latin1/utf-8)
        filename = file.filename or "file"
        try:
            filename.encode("latin1").decode("utf-8")
        except UnicodeError:
            # File client gửi bytes không phải latin1 — fallback dùng tên mặc định
            ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"
            filename = f"file.{ext}"

        url, err = upload_attachment(
            prefix=prefix,
            customer_id=customer_id or None,
            filename=filename,
            content=raw,
            content_type=content_type,
        )
        if err:
            return BaseResponse(success=False, message=err)
        return BaseResponse(
            success=True,
            data={"url": url, "name": filename, "size": len(raw), "content_type": content_type},
            message="Uploaded",
        )
    except Exception as e:
        logger.exception("upload_crm_attachment failed")
        return BaseResponse(success=False, message=f"Upload thất bại: {e}")


# ---------------------------------------------------------------------------
# AI điền nhanh (popup "Thêm deal") — tiện ích phụ, không phải phụ thuộc cứng.
# ---------------------------------------------------------------------------
class DealAiParseRequest(BaseModel):
    text: str


@router.get("/ai-parse-deal/status", response_model=BaseResponse)
def get_ai_parse_deal_status(current_user: Any = Depends(get_current_user)):
    return BaseResponse(success=True, data={"configured": is_ai_configured()})


@router.post("/ai-parse-deal", response_model=BaseResponse)
async def post_ai_parse_deal(
    payload: DealAiParseRequest,
    current_user: Any = Depends(get_current_user),
):
    text = (payload.text or "").strip()
    if not text:
        return BaseResponse(success=False, message="Vui lòng dán nội dung trước khi bấm AI điền nhanh.")
    try:
        result = await parse_deal_text(text)
        return BaseResponse(success=True, data=result)
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception:
        logger.exception("ai_parse_deal failed")
        return BaseResponse(success=False, message="AI điền nhanh thất bại, vui lòng thử lại hoặc nhập tay.")


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.post("", response_model=BaseResponse)
def create_customer_lead(
    payload: CustomerLeadCreate,
    current_user: Any = Depends(get_current_user),
):
    try:
        data_dict = payload.model_dump(exclude_unset=True)
        if not data_dict.get("leaded_by") and isinstance(current_user, dict) and current_user.get("id"):
            data_dict["leaded_by"] = current_user.get("id")
            # NOTE: không ghi `leaded_by_name` vào customer_leads — bảng không có cột này
            # (tên leader được JOIN qua `leader:leaded_by(name)` ở SELECT và cache qua
            # `customer_lead_activity_log.actor_name` cho audit). Trước đây dòng này
            # gây PGRST204 khi ghi.
        new_lead = customer_lead_service.create_customer_lead(data_dict)
        return BaseResponse(success=True, data=new_lead, message="Success")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/{lead_id}", response_model=BaseResponse)
def update_customer_lead(
    lead_id: str,
    payload: CustomerLeadUpdate,
    current_user: Any = Depends(get_current_user),
):
    try:
        existing = customer_lead_service.get_customer_lead_by_id(lead_id)
        if not can_write_deal(current_user, existing):
            return BaseResponse(success=False, message="Bạn không có quyền sửa deal này — chỉ deal do mình tạo hoặc được giao mới sửa được")
        updated = customer_lead_service.update_customer_lead(
            lead_id,
            payload.model_dump(exclude_unset=True),
        )
        if not updated:
            return BaseResponse(success=False, message="Not found or update failed")
        return BaseResponse(success=True, data=updated, message="Success")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/{lead_id}", response_model=BaseResponse)
def delete_customer_lead(lead_id: str, current_user: Any = Depends(get_current_user)):
    try:
        existing = customer_lead_service.get_customer_lead_by_id(lead_id)
        if not can_write_deal(current_user, existing):
            return BaseResponse(success=False, message="Bạn không có quyền xóa deal này — chỉ deal do mình tạo hoặc được giao mới xóa được")
        customer_lead_service.delete_customer_lead(lead_id)
        return BaseResponse(success=True, message="Deleted successfully")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
