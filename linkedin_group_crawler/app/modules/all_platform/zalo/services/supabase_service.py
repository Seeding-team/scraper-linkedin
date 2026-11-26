from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple
import asyncio
import html as html_lib
import ipaddress
import json
import mimetypes
import posixpath
import re
import time
import uuid
import base64
import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse

import httpx
from loguru import logger

from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.schemas.job import JobData
from app.modules.all_platform.zalo.schemas.message import Message


# ----------------------------------------------------------------------------
# Zalo Message Normalization Catalog (Zalo PC v26.11.12 — G2/G3/G4/G5/G6)
# ----------------------------------------------------------------------------

SIDEBAR_BRACKET_LABELS: Dict[str, str] = {
    "STR_ALBUM_MSG": "[Album]",
    "STR_ARTICLE_MSG": "[Bài viết]",
    "STR_CARD_MSG": "[Thiệp]",
    "STR_CONTACT_MSG": "[Danh thiếp]",
    "STR_DEL_MSG": "[Tin nhắn đã xóa]",
    "STR_DOODLE_MSG": "[Vẽ hình]",
    "STR_FILE_MSG": "[File]",
    "STR_FOLDER_MSG": "[Thư mục]",
    "STR_GIF": "[GIF]",
    "STR_IMPORTANT_PREFIX": "[Quan trọng]",
    "STR_INCALL_MSG": "[Cuộc gọi đến]",
    "STR_LINK_MSG": "[Link]",
    "STR_LOC_MSG": "[Vị trí]",
    "STR_MISS_CALL_MSG": "[Cuộc gọi nhỡ]",
    "STR_MSG_MEDIA": "[Tin nhắn Media]",
    "STR_MSG_NOT_SUPPORTED": "[Tin nhắn chưa hỗ trợ ở phiên bản hiện tại]",
    "STR_NO_RECENT_MESSAGES": "[Không có tin nhắn gần đây]",
    "STR_OUTCALL_MSG": "[Cuộc gọi đi]",
    "STR_PHOTO_MSG": "[Hình ảnh]",
    "STR_POLL_MSG": "[Bình chọn]",
    "STR_PREVIEW_SYNCING_OUT_OF_RANGE_W_BRACKET": "[Không có tin nhắn gần đây]",
    "STR_PREVIEW_SYNCING_W_BRACKET": "[Tin nhắn đang đồng bộ]",
    "STR_PREVIEW_SYNC_FAILED_W_BRACKET": "[Tin nhắn chưa đồng bộ]",
    "STR_RECALL_MSG_2": "[Tin nhắn đã thu hồi]",
    "STR_REPLY_MSG_BRACKET": "[Trả lời]",
    "STR_STICKER": "[Sticker]",
    "STR_STICKERSET_MSG": "[Bộ sticker]",
    "STR_URGENT_PREFIX": "[Khẩn cấp]",
    "STR_VANISH_MSG": "[Tin nhắn đã tự xóa]",
    "STR_VIDEO_MSG": "[Video]",
    "STR_VOICE_MSG": "[Tin nhắn thoại]",
    # Normalization extension for zinstant.bankcard / templateId=11845
    "BANKCARD": "[Thẻ ngân hàng]",
}

# All 57 Vietnamese Bank BIN codes extracted from Zalo PC v26.11.12 BinBankCard
VIETNAM_BANK_BINS: Dict[str, Dict[str, str]] = {
    "970425": {"code": "ABBank", "short_name": "ABBank", "name": "Ngân hàng TMCP An Bình (ABBank)"},
    "970416": {"code": "ACB", "short_name": "ACB", "name": "Ngân hàng TMCP Á Châu (ACB)"},
    "970405": {"code": "Agribank", "short_name": "Agribank", "name": "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam (Agribank)"},
    "970418": {"code": "BIDV", "short_name": "BIDV", "name": "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)"},
    "970454": {"code": "BVBank", "short_name": "BVBank", "name": "Ngân hàng TMCP Bản Việt (BVBank)"},
    "970409": {"code": "BacA_Bank", "short_name": "BacA Bank", "name": "Ngân hàng TMCP Bắc Á (BacA Bank)"},
    "970438": {"code": "BaoViet_Bank", "short_name": "BaoViet Bank", "name": "Ngân hàng TMCP Bảo Việt (BaoViet Bank)"},
    "546034": {"code": "CAKE", "short_name": "CAKE", "name": "Ngân hàng số CAKE by VPBank"},
    "970444": {"code": "CB_Bank", "short_name": "CB Bank", "name": "Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam (CB Bank)"},
    "422589": {"code": "CIMB_Bank", "short_name": "CIMB Bank", "name": "Ngân hàng TNHH MTV CIMB Việt Nam"},
    "970446": {"code": "Coop_Bank", "short_name": "Co-opBank", "name": "Ngân hàng Hợp tác xã Việt Nam (Co-opBank)"},
    "796500": {"code": "DBS_Bank", "short_name": "DBS Bank", "name": "Ngân hàng DBS Bank Ltd - CN TP.HCM"},
    "970406": {"code": "DongA_Bank", "short_name": "DongA Bank", "name": "Ngân hàng TMCP Đông Á (DongA Bank)"},
    "970431": {"code": "Eximbank", "short_name": "Eximbank", "name": "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam (Eximbank)"},
    "970408": {"code": "GPBank", "short_name": "GPBank", "name": "Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu (GPBank)"},
    "970437": {"code": "HDBank", "short_name": "HDBank", "name": "Ngân hàng TMCP Phát triển TP.HCM (HDBank)"},
    "458761": {"code": "HSBC", "short_name": "HSBC", "name": "Ngân hàng TNHH MTV HSBC Việt Nam"},
    "970442": {"code": "HongLeong_Bank", "short_name": "HongLeong Bank", "name": "Ngân hàng TNHH MTV Hong Leong Việt Nam"},
    "970456": {"code": "IBK_HCM", "short_name": "IBK HCM", "name": "Ngân hàng Công nghiệp Hàn Quốc - CN TP.HCM"},
    "970455": {"code": "IBK_HN", "short_name": "IBK HN", "name": "Ngân hàng Công nghiệp Hàn Quốc - CN Hà Nội"},
    "970434": {"code": "Indovina_Bank", "short_name": "Indovina Bank", "name": "Ngân hàng TNHH Indovina (IVB)"},
    "668888": {"code": "KBank", "short_name": "KBank", "name": "Ngân hàng Đại chúng TNHH Kasikornbank (KBank)"},
    "970452": {"code": "KienlongBank", "short_name": "KienlongBank", "name": "Ngân hàng TMCP Kiên Long (KienlongBank)"},
    "970463": {"code": "Kookmin_Bank_HCM", "short_name": "Kookmin HCM", "name": "Ngân hàng Kookmin - CN TP.HCM"},
    "970462": {"code": "Kookmin_Bank_HN", "short_name": "Kookmin HN", "name": "Ngân hàng Kookmin - CN Hà Nội"},
    "970449": {"code": "LPBank", "short_name": "LPBank", "name": "Ngân hàng TMCP Lộc Phát Việt Nam (LPBank)"},
    "970422": {"code": "MB_Bank", "short_name": "MB Bank", "name": "Ngân hàng TMCP Quân đội (MB Bank)"},
    "970426": {"code": "MSB", "short_name": "MSB", "name": "Ngân hàng TMCP Hàng Hải Việt Nam (MSB)"},
    "970419": {"code": "NCB", "short_name": "NCB", "name": "Ngân hàng TMCP Quốc Dân (NCB)"},
    "970428": {"code": "Nam_A_Bank", "short_name": "Nam A Bank", "name": "Ngân hàng TMCP Nam Á (Nam A Bank)"},
    "801011": {"code": "NongHyup_Bank", "short_name": "NongHyup Bank", "name": "Ngân hàng NongHyup - CN Hà Nội"},
    "970448": {"code": "OCB", "short_name": "OCB", "name": "Ngân hàng TMCP Phương Đông (OCB)"},
    "970414": {"code": "Ocean_Bank", "short_name": "Ocean Bank", "name": "Ngân hàng Thương mại TNHH MTV Đại Dương (Ocean Bank)"},
    "970430": {"code": "PGBank", "short_name": "PGBank", "name": "Ngân hàng TMCP Thịnh vượng và Phát triển (PGBank)"},
    "970412": {"code": "PVcomBank", "short_name": "PVcomBank", "name": "Ngân hàng TMCP Đại Chúng Việt Nam (PVcomBank)"},
    "970439": {"code": "Public_Bank_Vietnam", "short_name": "Public Bank", "name": "Ngân hàng TNHH MTV Public Việt Nam"},
    "970429": {"code": "SCB", "short_name": "SCB", "name": "Ngân hàng TMCP Sài Gòn (SCB)"},
    "970443": {"code": "SHB", "short_name": "SHB", "name": "Ngân hàng TMCP Sài Gòn - Hà Nội (SHB)"},
    "970403": {"code": "Sacombank", "short_name": "Sacombank", "name": "Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)"},
    "970400": {"code": "Saigon_Bank", "short_name": "SaigonBank", "name": "Ngân hàng TMCP Sài Gòn Công Thương (SaigonBank)"},
    "970440": {"code": "SeABank", "short_name": "SeABank", "name": "Ngân hàng TMCP Đông Nam Á (SeABank)"},
    "970424": {"code": "Shinhan_Bank", "short_name": "Shinhan Bank", "name": "Ngân hàng TNHH MTV Shinhan Việt Nam"},
    "970410": {"code": "Standard_Chartered_Vietnam", "short_name": "Standard Chartered", "name": "Ngân hàng TNHH MTV Standard Chartered Việt Nam"},
    "9704261": {"code": "TNEX", "short_name": "TNEX", "name": "Ngân hàng số TNEX by MSB"},
    "970423": {"code": "TPBank", "short_name": "TPBank", "name": "Ngân hàng TMCP Tiên Phong (TPBank)"},
    "970407": {"code": "Techcombank", "short_name": "Techcombank", "name": "Ngân hàng TMCP Kỹ thương Việt Nam (Techcombank)"},
    "963388": {"code": "Timo", "short_name": "Timo", "name": "Ngân hàng số Timo by BVBank"},
    "546035": {"code": "UBank", "short_name": "UBank", "name": "Ngân hàng số Ubank by VPBank"},
    "970458": {"code": "United_Overseas_Bank_Vietnam", "short_name": "UOB", "name": "Ngân hàng TNHH MTV United Overseas Bank Việt Nam (UOB)"},
    "970441": {"code": "VIB", "short_name": "VIB", "name": "Ngân hàng TMCP Quốc tế Việt Nam (VIB)"},
    "970432": {"code": "VPBank", "short_name": "VPBank", "name": "Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)"},
    "970421": {"code": "VRB", "short_name": "VRB", "name": "Ngân hàng Liên doanh Việt - Nga (VRB)"},
    "970427": {"code": "VietABank", "short_name": "VietABank", "name": "Ngân hàng TMCP Việt Á (VietABank)"},
    "970433": {"code": "VietBank", "short_name": "VietBank", "name": "Ngân hàng TMCP Việt Nam Thương Tín (VietBank)"},
    "970436": {"code": "Vietcombank", "short_name": "Vietcombank", "name": "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)"},
    "970415": {"code": "VietinBank", "short_name": "VietinBank", "name": "Ngân hàng TMCP Công thương Việt Nam (VietinBank)"},
    "970457": {"code": "Woori_Bank", "short_name": "Woori Bank", "name": "Ngân hàng TNHH MTV Woori Việt Nam"},
}

_BANK_ALIAS_TO_BIN: Dict[str, str] = {}
for _b_bin, _b_meta in VIETNAM_BANK_BINS.items():
    for _alias in (
        _b_meta["code"],
        _b_meta["code"].replace("_", " "),
        _b_meta["code"].replace("_", ""),
        _b_meta["short_name"],
        _b_meta["short_name"].replace(" ", ""),
    ):
        _BANK_ALIAS_TO_BIN[_alias.lower()] = _b_bin
_BANK_ALIAS_TO_BIN.update({
    "vcb": "970436",
    "vietcombank": "970436",
    "tcb": "970407",
    "techcombank": "970407",
    "mb": "970422",
    "mbbank": "970422",
    "mb bank": "970422",
    "vpb": "970432",
    "vpbank": "970432",
    "ctg": "970415",
    "vietinbank": "970415",
    "icb": "970415",
    "bidv": "970418",
    "tpb": "970423",
    "tpbank": "970423",
    "stb": "970403",
    "sacombank": "970403",
    "acb": "970416",
    "agribank": "970405",
    "hdbank": "970437",
    "vib": "970441",
    "ocb": "970448",
    "msb": "970426",
    "shb": "970443",
    "seabank": "970440",
    "eximbank": "970431",
    "lpbank": "970449",
    "lienvietpostbank": "970449",
    "pvcombank": "970412",
    "scb": "970429",
    "uob": "970458",
    "cake": "546034",
    "timo": "963388",
    "tnex": "9704261",
})

_CALL_ACTIONS = frozenset({
    "recommened.misscall", "recommened.calltime", "recommened.calling", "recommened.receivecall",
    "recommended.misscall", "recommended.calltime", "recommended.calling", "recommended.receivecall",
})
_CONTACT_ACTIONS = frozenset({
    "recommened.user", "recommened.vip", "show.profile",
    "recommended.user", "recommended.vip",
})
_LINK_ACTIONS = frozenset({
    "recommened.link", "recommened.minisite", "recommened.miniapp",
    "recommened.oa", "recommened.zvideo", "recommened.article", "recommened.post",
    "recommended.link", "recommended.minisite", "recommended.miniapp",
    "recommended.oa", "recommended.zvideo", "recommended.article", "recommended.post",
})
_SYSTEM_NOTICE_MSG_TYPES = frozenset({
    "group.event", "group.leave", "friend.event", "chat.ecard",
    "group.poll", "chat.poll", "chat.reminder", "chat.todo",
    "chat.list.action", "chat.e2ee.replace", "chat.delete",
    "chat.delete.everyone", "chat.vanish", "chat.reaction", "chat._jumpToMessage",
})
_SYSTEM_NOTICE_ACTIONS = frozenset({
    "msginfo.actionlist", "recommened.friend", "recommended.friend",
    "todo.remind", "todo.remind2",
})
_CANONICAL_MSG_KINDS = frozenset({
    "text", "image", "gif", "video", "voice", "file", "sticker", "doodle",
    "location", "link", "contact", "bankcard", "call", "system_notice", "undo",
})
_NON_BANKCARD_ZINSTANT_TEMPLATE_IDS = frozenset({14875, 17123})
_UGLY_SUFFIX_RE = re.compile(r"\s*[—–-]+\s*mở\s+zalo\s+để\s+xem\.?\s*$", re.IGNORECASE)
_BANKCARD_HOST_RE = re.compile(r"^[a-z0-9-]+(?:\.[a-z0-9-]+)+$")
_BANKCARD_PREVIEW_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_BANKCARD_PREVIEW_CACHE_TTL_S = 600.0


def _safe_parse_json_dict(value: Any) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s or not s.startswith("{"):
            return None
        try:
            parsed = json.loads(s)
            if isinstance(parsed, str) and parsed.strip().startswith("{"):
                parsed = json.loads(parsed.strip())
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _normalize_raw_content(value: Any) -> Optional[Dict[str, Any]]:
    """Safely normalize raw_content (dict or JSON string, including legacy type=='group' strings)."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        parsed = _safe_parse_json_dict(s)
        if parsed is not None:
            return parsed
        try:
            any_parsed = json.loads(s)
            if isinstance(any_parsed, dict):
                return any_parsed
            return {"raw_value": any_parsed}
        except Exception:
            return {"raw_text": s}
    return {"raw_value": value}


def _extract_raw_parts(raw_content: Any, msg_type: Optional[str] = None) -> Tuple[str, str, Optional[int], Dict[str, Any], Dict[str, Any]]:
    """Return (wire_msg_type, action_lower, template_id, content_dict, params_dict)."""
    raw_dict = _normalize_raw_content(raw_content) or {}
    data_obj = raw_dict.get("data") if isinstance(raw_dict.get("data"), dict) else raw_dict

    wire_type = str(
        data_obj.get("msgType")
        or raw_dict.get("msgType")
        or msg_type
        or data_obj.get("type")
        or raw_dict.get("type")
        or ""
    ).strip()

    raw_inner = data_obj.get("content")
    if raw_inner is None:
        raw_inner = raw_dict.get("content")
    content_dict = _safe_parse_json_dict(raw_inner) or {}
    # If raw_dict itself is already an unwrapped content payload (legacy group rows)
    if not content_dict and any(k in raw_dict for k in ("action", "zinstantdata_id", "data_url", "template_id", "templateId")):
        content_dict = raw_dict

    params_dict = (
        _safe_parse_json_dict(content_dict.get("params"))
        or _safe_parse_json_dict(data_obj.get("params"))
        or _safe_parse_json_dict(raw_dict.get("params"))
        or {}
    )
    action = str(
        content_dict.get("action")
        or data_obj.get("action")
        or raw_dict.get("action")
        or ""
    ).strip().lower()

    template_id: Optional[int] = None
    for cand in (
        raw_dict.get("_template_id"),
        content_dict.get("template_id"),
        content_dict.get("templateId"),
        params_dict.get("template_id"),
        params_dict.get("templateId"),
        (params_dict.get("item") or {}).get("templateId") if isinstance(params_dict.get("item"), dict) else None,
        (params_dict.get("pcItem") or {}).get("templateId") if isinstance(params_dict.get("pcItem"), dict) else None,
        data_obj.get("template_id"),
        data_obj.get("templateId"),
    ):
        if cand is not None and str(cand).strip().isdigit():
            template_id = int(str(cand).strip())
            break
    if template_id is None:
        for zid in (
            content_dict.get("zinstantdata_id"),
            params_dict.get("zinstantdata_id"),
            data_obj.get("zinstantdata_id"),
        ):
            if isinstance(zid, str):
                m = re.search(r"templateId\s*=\s*(\d+)", zid, re.IGNORECASE)
                if m:
                    template_id = int(m.group(1))
                    break

    return wire_type, action, template_id, content_dict, params_dict


def classify_message_kind(
    msg_type: Optional[str],
    content: Optional[str] = None,
    raw_content: Any = None,
    *,
    existing_kind: Optional[str] = None,
) -> str:
    """Classify canonical msg_kind for all 28 wire msgTypes & 22 actions."""
    wire_type, action, template_id, content_dict, _params_dict = _extract_raw_parts(raw_content, msg_type)
    mt = (wire_type or str(msg_type or "text")).strip()
    act = action

    # Inspect structured wire signals first (fixes legacy rows misclassified as "image" or raw msgType)
    if mt in ("chat.undo", "recalled"):
        return "undo"
    if act == "zinstant.bankcard" or template_id == 11845:
        return "bankcard"
    if mt in ("chat.webcontent", "chat.webcontent.v2"):
        if template_id in _NON_BANKCARD_ZINSTANT_TEMPLATE_IDS:
            return "system_notice"
        return "bankcard"
    if act in _CALL_ACTIONS:
        return "call"
    if mt == "chat.ecard":
        return "system_notice"
    if mt in _SYSTEM_NOTICE_MSG_TYPES or act in _SYSTEM_NOTICE_ACTIONS:
        return "system_notice"
    if mt == "chat.contact" or act in _CONTACT_ACTIONS:
        return "contact"
    if mt == "chat.location.new" or act in ("recommened.location", "recommended.location"):
        return "location"
    if mt == "chat.gif" or act in ("recommend.gif", "recommened.gif"):
        return "gif"
    if mt == "chat.sticker" or act in ("recommened.stickerset", "recommended.stickerset"):
        return "sticker"
    if mt in ("share.file", "file"):
        return "file"
    if mt in ("chat.video.msg", "video"):
        return "video"
    if mt in ("chat.voice", "voice"):
        return "voice"
    if mt in ("chat.doodle", "doodle"):
        return "doodle"
    if mt in ("chat.photo", "image"):
        return "image"
    if mt in ("chat.link", "chat.zalo.me") or act in _LINK_ACTIONS:
        return "link"
    if mt == "group":
        return "system_notice"
    if mt == "chat.recommended":
        href = content_dict.get("href")
        if isinstance(href, str) and href.startswith(("http://", "https://")):
            return "link"
        if existing_kind and existing_kind.strip().lower() in _CANONICAL_MSG_KINDS:
            return existing_kind.strip().lower()
        return "text"
    if act == "rtf" or mt in ("webchat", "text"):
        if existing_kind and existing_kind.strip().lower() in _CANONICAL_MSG_KINDS:
            return existing_kind.strip().lower()
        return "text"

    if existing_kind and existing_kind.strip().lower() in _CANONICAL_MSG_KINDS:
        return existing_kind.strip().lower()
    return "text"


def _sanitize_preview_text(text: Optional[str]) -> str:
    if not text or not isinstance(text, str):
        return ""
    s = text.strip()
    if not s:
        return ""
    if s.lower() == "sendbubblemessage":
        return ""
    s = _UGLY_SUFFIX_RE.sub("", s).strip()
    if s.startswith(("{", "[")):
        try:
            json.loads(s)
            return ""
        except Exception:
            pass
    return s


def _format_call_sidebar_preview(action: str, params_dict: Dict[str, Any], is_sent: bool) -> str:
    act = (action or "").lower()
    raw_is_caller = params_dict.get("isCaller")
    if isinstance(raw_is_caller, bool):
        is_caller = raw_is_caller
    elif raw_is_caller is not None:
        is_caller = bool(int(raw_is_caller)) if str(raw_is_caller).isdigit() else bool(raw_is_caller)
    elif "calling" in act:
        is_caller = True
    elif "receivecall" in act:
        is_caller = False
    else:
        is_caller = bool(is_sent)

    raw_calltype = params_dict.get("calltype", params_dict.get("callType", params_dict.get("type", 0)))
    try:
        calltype_num = int(raw_calltype)
    except Exception:
        calltype_num = 0
    is_video = calltype_num in (1, 3) or bool(params_dict.get("isVideo"))

    try:
        reason = int(params_dict.get("reason", 0) or 0)
    except Exception:
        reason = 0
    is_missed = "misscall" in act

    if is_caller:
        return "[Cuộc gọi video đi]" if is_video else "[Cuộc gọi thoại đi]"
    if is_missed and reason != 3:
        return "[Cuộc gọi video nhỡ]" if is_video else "[Cuộc gọi thoại nhỡ]"
    return "[Cuộc gọi video đến]" if is_video else "[Cuộc gọi thoại đến]"


def _format_msginfo_actionlist_preview(content_dict: Dict[str, Any], params_dict: Dict[str, Any]) -> str:
    msg_obj = params_dict.get("msg")
    template = ""
    if isinstance(msg_obj, dict):
        template = str(msg_obj.get("vi") or msg_obj.get("en") or "").strip()
    elif isinstance(msg_obj, str):
        template = msg_obj.strip()
    if template:
        highlights = params_dict.get("highLightsV2") or params_dict.get("highLights") or []
        resolved = template
        if isinstance(highlights, list):
            for idx, item in enumerate(highlights):
                if isinstance(item, dict):
                    val = str(item.get("content") or item.get("title") or item.get("text") or item.get("name") or "").strip()
                else:
                    val = str(item or "").strip()
                if val:
                    resolved = resolved.replace(f"%{idx + 1}$s", val).replace(f"${idx}$", val)
        resolved = re.sub(r"%\d+\$s|\$\d+\$", "", resolved)
        resolved = re.sub(r"\s{2,}", " ", resolved).strip()
        if resolved:
            return resolved
    return _sanitize_preview_text(content_dict.get("title")) or "Thông báo hệ thống"


def format_sidebar_last_message_preview(
    content: Optional[str],
    *,
    msg_type: Optional[str] = None,
    msg_kind: Optional[str] = None,
    raw_content: Any = None,
    is_sent: bool = False,
) -> Optional[str]:
    """Build clean Vietnamese sidebar last-message preview covering all 31 native [...] labels
    + [Thẻ ngân hàng] + clean call/friend/group notices. Never returns 'sendBubbleMessage',
    raw JSON, or '— mở Zalo để xem'."""
    wire_type, action, template_id, content_dict, params_dict = _extract_raw_parts(raw_content, msg_type)
    kind = classify_message_kind(msg_type, content, raw_content, existing_kind=msg_kind)
    clean_content = _sanitize_preview_text(content)
    mt = (wire_type or str(msg_type or "")).strip()

    if kind == "call":
        return _format_call_sidebar_preview(action, params_dict, is_sent)
    if kind == "bankcard":
        return SIDEBAR_BRACKET_LABELS["BANKCARD"]
    if kind == "contact":
        title = _sanitize_preview_text(content_dict.get("title"))
        if title and not title.startswith("[Danh thiếp]"):
            return f"{SIDEBAR_BRACKET_LABELS['STR_CONTACT_MSG']} {title}"
        if clean_content.startswith("[Danh thiếp]"):
            return clean_content
        return SIDEBAR_BRACKET_LABELS["STR_CONTACT_MSG"]
    if kind == "file":
        fdata = _safe_parse_json_dict(params_dict.get("fdata")) or (params_dict.get("fdata") if isinstance(params_dict.get("fdata"), dict) else {})
        is_folder = str(fdata.get("fType") if isinstance(fdata, dict) else params_dict.get("fType") or "") == "2"
        raw_meta = (_normalize_raw_content(raw_content) or {}).get("_file_meta")
        if isinstance(raw_meta, dict) and raw_meta.get("isFolder"):
            is_folder = True
        prefix = SIDEBAR_BRACKET_LABELS["STR_FOLDER_MSG"] if is_folder else SIDEBAR_BRACKET_LABELS["STR_FILE_MSG"]
        fname = clean_content or _sanitize_preview_text(content_dict.get("title"))
        if fname and not fname.startswith(("http://", "https://")) and not fname.startswith("["):
            return f"{prefix} {fname}"
        return prefix
    if kind == "image":
        if params_dict.get("is_group_layout") and int(params_dict.get("total_item_in_group") or 0) > 1:
            return SIDEBAR_BRACKET_LABELS["STR_ALBUM_MSG"]
        if clean_content and not clean_content.startswith(("http://", "https://", "data:image/")):
            return clean_content
        return SIDEBAR_BRACKET_LABELS["STR_PHOTO_MSG"]
    if kind == "gif":
        return SIDEBAR_BRACKET_LABELS["STR_GIF"]
    if kind == "video":
        return SIDEBAR_BRACKET_LABELS["STR_VIDEO_MSG"]
    if kind == "voice":
        return SIDEBAR_BRACKET_LABELS["STR_VOICE_MSG"]
    if kind == "sticker":
        if action in ("recommened.stickerset", "recommended.stickerset"):
            return SIDEBAR_BRACKET_LABELS["STR_STICKERSET_MSG"]
        return SIDEBAR_BRACKET_LABELS["STR_STICKER"]
    if kind == "doodle":
        return SIDEBAR_BRACKET_LABELS["STR_DOODLE_MSG"]
    if kind == "location":
        if clean_content and not clean_content.startswith("["):
            return f"{SIDEBAR_BRACKET_LABELS['STR_LOC_MSG']} {clean_content}"
        return SIDEBAR_BRACKET_LABELS["STR_LOC_MSG"]
    if kind == "link":
        if action in ("recommened.article", "recommended.article"):
            prefix = SIDEBAR_BRACKET_LABELS["STR_ARTICLE_MSG"]
        elif action in ("recommened.miniapp", "recommended.miniapp"):
            prefix = "[Mini App]"
        else:
            prefix = SIDEBAR_BRACKET_LABELS["STR_LINK_MSG"]
        title = _sanitize_preview_text(content_dict.get("title")) or clean_content
        if title and not title.startswith(("http://", "https://")) and not title.startswith("["):
            return f"{prefix} {title}"
        return prefix
    if kind == "undo":
        return SIDEBAR_BRACKET_LABELS["STR_RECALL_MSG_2"]
    if kind == "system_notice":
        if mt in ("chat.delete", "chat.delete.everyone"):
            return SIDEBAR_BRACKET_LABELS["STR_DEL_MSG"]
        if mt == "chat.vanish":
            return SIDEBAR_BRACKET_LABELS["STR_VANISH_MSG"]
        if mt in ("group.poll", "chat.poll"):
            q = _sanitize_preview_text(params_dict.get("question") or content_dict.get("title"))
            return f"{SIDEBAR_BRACKET_LABELS['STR_POLL_MSG']} {q}" if q else SIDEBAR_BRACKET_LABELS["STR_POLL_MSG"]
        if mt == "chat.ecard":
            ecard_txt = _sanitize_preview_text(params_dict.get("previewTxt") or content_dict.get("description") or clean_content)
            return ecard_txt or SIDEBAR_BRACKET_LABELS["STR_CARD_MSG"]
        if action == "msginfo.actionlist":
            return clean_content or _format_msginfo_actionlist_preview(content_dict, params_dict)
        if mt == "chat.e2ee.replace":
            return "Đang chờ tin nhắn này"
        if mt == "chat.list.action":
            return clean_content or SIDEBAR_BRACKET_LABELS["STR_MSG_NOT_SUPPORTED"]
        return clean_content or "Thông báo hệ thống"

    # Default text
    if clean_content:
        return clean_content
    if mt in ("chat.photo", "image"):
        return SIDEBAR_BRACKET_LABELS["STR_PHOTO_MSG"]
    if mt == "chat.recommended":
        return SIDEBAR_BRACKET_LABELS["STR_LINK_MSG"]
    return None


def build_zalo_sticker_cdn_url(sticker_id: Any, size: int = 130) -> Optional[str]:
    """Dựng URL ảnh nhãn dán Zalo công khai (`/sticker/webpc?eid=<id>&size=130`)."""
    try:
        sid = int(sticker_id)
    except (TypeError, ValueError):
        return None
    if sid <= 0:
        return None
    safe_size = int(size) if isinstance(size, int) and size > 0 else 130
    return f"https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid={sid}&size={safe_size}"


def extract_sticker_id_from_raw(raw_content: Any) -> Optional[int]:
    """Trích xuất sticker ID dương từ raw_content (kể cả envelope `data.content` hoặc JSON string)."""
    norm = _normalize_raw_content(raw_content)
    if not isinstance(norm, dict):
        return None
    candidates: List[Dict[str, Any]] = [norm]
    data_obj = norm.get("data")
    if isinstance(data_obj, dict):
        candidates.append(data_obj)
        inner = data_obj.get("content")
        if isinstance(inner, str) and inner.strip().startswith("{"):
            try:
                inner = json.loads(inner)
            except Exception:
                inner = None
        if isinstance(inner, dict):
            candidates.append(inner)
            params = inner.get("params")
            if isinstance(params, str) and params.strip().startswith("{"):
                try:
                    params = json.loads(params)
                except Exception:
                    params = None
            if isinstance(params, dict):
                candidates.append(params)
    top_content = norm.get("content")
    if isinstance(top_content, str) and top_content.strip().startswith("{"):
        try:
            top_content = json.loads(top_content)
        except Exception:
            top_content = None
    if isinstance(top_content, dict):
        candidates.append(top_content)

    for obj in candidates:
        for key in ("id", "stickerId", "sticker_id"):
            val = obj.get(key)
            if val is None or val == "" or isinstance(val, bool):
                continue
            try:
                sid = int(val)
            except (TypeError, ValueError):
                continue
            if sid > 0:
                return sid
    return None


def _normalize_message_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure every message row dict returned to API consumers has dict raw_content and canonical msg_kind."""
    out = dict(row)
    norm_raw = _normalize_raw_content(out.get("raw_content"))
    out["raw_content"] = norm_raw
    resolved_kind = classify_message_kind(
        out.get("type"),
        out.get("content"),
        norm_raw,
        existing_kind=out.get("msg_kind"),
    )
    out["msg_kind"] = resolved_kind
    if resolved_kind == "sticker":
        existing_urls = out.get("image_urls")
        if not existing_urls:
            sid = extract_sticker_id_from_raw(norm_raw)
            cdn_url = build_zalo_sticker_cdn_url(sid)
            if cdn_url:
                out["image_urls"] = [cdn_url]
    return out


# ----------------------------------------------------------------------------
# G4: SSRF-safe Bankcard CDN Decoder (HTTPS *.zadn.vn ONLY + 57 Bank BINs)
# ----------------------------------------------------------------------------

def validate_bankcard_cdn_url(url: str) -> str:
    """Strictly validate that `url` is an HTTPS URL hosted on `*.zadn.vn` (SSRF guard)."""
    raw = (url or "").strip()
    if not raw or len(raw) > 2048:
        raise ValueError("Invalid bankcard CDN URL")
    if any(ch in raw for ch in ("\r", "\n", "\x00", "\\")):
        raise ValueError("Invalid characters in bankcard CDN URL")
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise ValueError("Only HTTPS bankcard CDN URLs are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Credentials in URL are not allowed")
    if parsed.port not in (None, 443):
        raise ValueError("Non-standard HTTPS port is not allowed")
    host = (parsed.hostname or "").strip().lower()
    if not host or not _BANKCARD_HOST_RE.match(host):
        raise ValueError("Invalid bankcard CDN hostname")
    try:
        ipaddress.ip_address(host)
        raise ValueError("IP literal hostnames are not allowed")
    except ValueError as exc:
        if "IP literal" in str(exc):
            raise
    if not host.endswith(".zadn.vn") or len(host) <= len(".zadn.vn"):
        raise ValueError("Host is not in allowed *.zadn.vn CDN allowlist")
    return raw


def _lookup_bank_by_bin(bin_code: Optional[str]) -> Optional[Dict[str, str]]:
    if not bin_code:
        return None
    cleaned = re.sub(r"\D", "", str(bin_code))
    if cleaned in VIETNAM_BANK_BINS:
        return VIETNAM_BANK_BINS[cleaned]
    if len(cleaned) > 6 and cleaned[:6] in VIETNAM_BANK_BINS:
        return VIETNAM_BANK_BINS[cleaned[:6]]
    return None


def _infer_bin_from_bank_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    low = text.strip().lower()
    if not low:
        return None
    if low in _BANK_ALIAS_TO_BIN:
        return _BANK_ALIAS_TO_BIN[low]
    for alias, b_code in sorted(_BANK_ALIAS_TO_BIN.items(), key=lambda kv: len(kv[0]), reverse=True):
        if len(alias) >= 3 and re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", low):
            return b_code
    return None


def _extract_from_json_tree(obj: Any, out: Dict[str, Optional[str]]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = str(k).lower()
            if isinstance(v, (str, int)) and str(v).strip():
                sv = str(v).strip()
                if not out["bin"] and kl in ("bin", "binbank", "bankbin", "bank_bin", "acqid", "acq_id"):
                    digits = re.sub(r"\D", "", sv)
                    if digits in VIETNAM_BANK_BINS:
                        out["bin"] = digits
                elif not out["account_no"] and kl in ("accountno", "account_no", "numaccbank", "bankaccount", "accno", "accountnumber", "bank_account", "stk"):
                    if re.match(r"^[A-Za-z0-9]{4,24}$", sv):
                        out["account_no"] = sv
                elif not out["account_name"] and kl in ("accountname", "account_name", "nameaccbank", "holdername", "holder_name", "ownername", "accname"):
                    if len(sv) >= 2:
                        out["account_name"] = sv
                elif not out["bank_name"] and kl in ("bankname", "bank_name"):
                    out["bank_name"] = sv
                elif not out["bank_short_name"] and kl in ("bankshortname", "bank_short_name", "shortname", "short_name"):
                    out["bank_short_name"] = sv
                elif not out["logo_url"] and kl in ("logo", "logourl", "logo_url", "banklogo", "bank_logo", "iconurl", "icon_url"):
                    if sv.startswith("https://"):
                        out["logo_url"] = sv
                elif not out["qr_url"] and kl in ("qrurl", "qr_url", "vietqrurl", "vietqr_url", "qrcodeurl", "qr_image"):
                    if sv.startswith("https://"):
                        out["qr_url"] = sv
            elif isinstance(v, (dict, list)):
                _extract_from_json_tree(v, out)
    elif isinstance(obj, list):
        for item in obj:
            _extract_from_json_tree(item, out)


def parse_bankcard_cdn_payload(body_text: str) -> Dict[str, Any]:
    """Decode Zalo zinstant.bankcard HTML or JSON payload into normalized bankcard metadata."""
    text = body_text or ""
    extracted: Dict[str, Optional[str]] = {
        "bin": None,
        "bank_name": None,
        "bank_short_name": None,
        "account_no": None,
        "account_name": None,
        "logo_url": None,
        "qr_url": None,
    }

    # 1. Direct JSON payload
    stripped = text.strip()
    if stripped.startswith(("{", "[")):
        try:
            _extract_from_json_tree(json.loads(stripped), extracted)
        except Exception:
            pass

    # 2. VietQR image URL inside HTML/JSON (e.g. https://img.vietqr.io/image/970436-1234567890-compact2.png)
    vietqr_match = re.search(
        r"https://img\.vietqr\.io/image/(\d{6,7})-([A-Za-z0-9]{4,24})-[A-Za-z0-9_.-]+",
        text,
        re.IGNORECASE,
    )
    if vietqr_match:
        if not extracted["bin"] and vietqr_match.group(1) in VIETNAM_BANK_BINS:
            extracted["bin"] = vietqr_match.group(1)
        if not extracted["account_no"]:
            extracted["account_no"] = vietqr_match.group(2)
        if not extracted["qr_url"]:
            extracted["qr_url"] = vietqr_match.group(0)

    # 3. Embedded JSON-like key/value pairs inside HTML/script tags
    key_patterns = {
        "bin": r"""["'](?:bin|binBank|bankBin|bank_bin|acqId)["']\s*[:=]\s*["']?(\d{6,7})["']?""",
        "account_no": r"""["'](?:accountNo|account_no|numAccBank|bankAccount|accNo|accountNumber)["']\s*[:=]\s*["']([A-Za-z0-9]{4,24})["']""",
        "account_name": r"""["'](?:accountName|account_name|nameAccBank|holderName|ownerName|accName)["']\s*[:=]\s*["']([^"'<>{}]{2,80})["']""",
        "bank_name": r"""["'](?:bankName|bank_name)["']\s*[:=]\s*["']([^"'<>{}]{2,120})["']""",
        "bank_short_name": r"""["'](?:bankShortName|bank_short_name|shortName)["']\s*[:=]\s*["']([^"'<>{}]{2,60})["']""",
        "logo_url": r"""["'](?:logo|logoUrl|logo_url|bankLogo|bank_logo)["']\s*[:=]\s*["'](https://[^"'\s<>]+)["']""",
    }
    for field_name, pattern in key_patterns.items():
        if not extracted[field_name]:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                val = html_lib.unescape(m.group(1)).strip()
                if field_name == "bin":
                    if val in VIETNAM_BANK_BINS:
                        extracted["bin"] = val
                elif val:
                    extracted[field_name] = val

    # 4. HTML visible text fallback (e.g. Zalo ZInstant PC HTML card markup)
    if not extracted["logo_url"]:
        img_m = re.search(r"""<img[^>]+src=["'](https://[^"']+(?:bank|logo|zadn\.vn|vietqr\.io)[^"']*)["']""", text, re.IGNORECASE)
        if img_m:
            extracted["logo_url"] = html_lib.unescape(img_m.group(1)).strip()

    plain = html_lib.unescape(re.sub(r"<[^>]+>", " ", text))
    plain = re.sub(r"\s+", " ", plain).strip()

    if not extracted["bin"]:
        for m in re.finditer(r"\b(\d{6,7})\b", text):
            cand = m.group(1)
            if cand in VIETNAM_BANK_BINS:
                extracted["bin"] = cand
                break

    if not extracted["account_no"]:
        m_stk = re.search(
            r"(?:Số\s*tài\s*khoản|STK|Account\s*(?:No|Number))[:\s#-]*([A-Za-z0-9]{6,19})",
            plain,
            re.IGNORECASE,
        )
        if m_stk:
            extracted["account_no"] = m_stk.group(1).strip()

    if not extracted["account_name"]:
        m_holder = re.search(
            r"(?:Chủ\s*tài\s*khoản|Account\s*Name)[:\s-]*([A-Z0-9][A-Z0-9\s]{3,50})",
            plain,
        )
        if m_holder:
            extracted["account_name"] = m_holder.group(1).strip()

    # Infer BIN from bank_name / bank_short_name / plain text if still missing
    if not extracted["bin"]:
        for candidate_text in (extracted["bank_short_name"], extracted["bank_name"], plain[:500]):
            inferred = _infer_bin_from_bank_text(candidate_text)
            if inferred:
                extracted["bin"] = inferred
                break

    bank_meta = _lookup_bank_by_bin(extracted["bin"])
    if bank_meta:
        extracted["bank_short_name"] = extracted["bank_short_name"] or bank_meta["short_name"]
        extracted["bank_name"] = bank_meta["name"]

    if not extracted["qr_url"] and extracted["bin"] and extracted["account_no"]:
        extracted["qr_url"] = f"https://img.vietqr.io/image/{extracted['bin']}-{extracted['account_no']}-compact2.png"

    ok = bool(extracted["bin"] or extracted["account_no"] or extracted["bank_name"])
    return {
        "ok": ok,
        "bin": extracted["bin"],
        "bank_name": extracted["bank_name"],
        "bank_short_name": extracted["bank_short_name"],
        "account_no": extracted["account_no"],
        "account_name": extracted["account_name"],
        "logo_url": extracted["logo_url"],
        "qr_url": extracted["qr_url"],
    }


async def fetch_bankcard_preview(url: str, *, timeout: float = 5.0) -> Dict[str, Any]:
    """Safely fetch and decode a Zalo *.zadn.vn bankcard CDN payload (timeout=5s, no redirects)."""
    validated_url = validate_bankcard_cdn_url(url)
    now = time.monotonic()
    cached = _BANKCARD_PREVIEW_CACHE.get(validated_url)
    if cached and (now - cached[0] < _BANKCARD_PREVIEW_CACHE_TTL_S):
        return dict(cached[1])

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response = await client.get(
            validated_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            },
        )
    if response.status_code >= 400 or response.status_code in (301, 302, 303, 307, 308):
        return {
            "ok": False,
            "bin": None,
            "bank_name": None,
            "bank_short_name": None,
            "account_no": None,
            "account_name": None,
            "logo_url": None,
            "qr_url": None,
        }

    result = parse_bankcard_cdn_payload(response.text[:250_000])
    if len(_BANKCARD_PREVIEW_CACHE) >= 256:
        oldest_key = min(_BANKCARD_PREVIEW_CACHE, key=lambda k: _BANKCARD_PREVIEW_CACHE[k][0])
        _BANKCARD_PREVIEW_CACHE.pop(oldest_key, None)
    _BANKCARD_PREVIEW_CACHE[validated_url] = (now, dict(result))
    return result


class SupabaseNotConfigured(RuntimeError):
    pass


def is_supabase_configured() -> bool:
    return bool(settings.supabase_url.strip() and settings.supabase_service_role_key.strip())


def _require_configured() -> None:
    if not is_supabase_configured():
        raise SupabaseNotConfigured("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")


def _base_url() -> str:
    return settings.supabase_url.rstrip("/")


_POOLED_CLIENTS: Dict[Tuple[int, bool], "httpx.AsyncClient"] = {}
_POOL_LIMITS = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=30,
    keepalive_expiry=45.0,
)


def _get_pooled_http_client(*, follow_redirects: bool = False) -> "httpx.AsyncClient":
    """Trả về httpx.AsyncClient tái sử dụng kết nối TCP/TLS theo từng event loop.

    Loại bỏ chi phí tạo mới socket + TLS handshake (150-400ms) trên mỗi câu REST
    Supabase, đồng thời tự tạo lại an toàn nếu event loop đổi (vd trong pytest).
    """
    try:
        loop_id = id(asyncio.get_running_loop())
    except RuntimeError:
        loop_id = 0
    key = (loop_id, bool(follow_redirects))
    client = _POOLED_CLIENTS.get(key)
    if client is None or client.is_closed:
        if len(_POOLED_CLIENTS) > 12:
            stale_keys = [k for k, c in list(_POOLED_CLIENTS.items()) if c.is_closed]
            for sk in stale_keys:
                _POOLED_CLIENTS.pop(sk, None)
        client = httpx.AsyncClient(
            timeout=60.0,
            follow_redirects=follow_redirects,
            verify=settings.supabase_ssl_verify,
            limits=_POOL_LIMITS,
        )
        _POOLED_CLIENTS[key] = client
    return client


def _http_client(*, timeout: int = 60, follow_redirects: bool = False) -> "httpx.AsyncClient":
    """HTTP client độc lập giữ tương thích ngược cho script bên ngoài (nếu có)."""
    return httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=follow_redirects,
        verify=settings.supabase_ssl_verify,
    )


def _headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    key = settings.supabase_service_role_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


async def _rest(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json: Optional[Any] = None,
    prefer: Optional[str] = None,
) -> Any:
    _require_configured()
    headers = _headers({"Prefer": prefer} if prefer else None)
    url = f"{_base_url()}/rest/v1/{path.lstrip('/')}"
    client = _get_pooled_http_client(follow_redirects=False)
    response = await client.request(method, url, headers=headers, params=params, json=json, timeout=60.0)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase {method} {path} failed: {response.status_code} {response.text}")
    if not response.content:
        return None
    return response.json()


async def resolve_thread_type(account_id: str, conversation_id: str) -> int:
    """Tra cứu zalo_groups để xác định thread_type.

    - Nếu group có is_friend=true hoặc thread_type in ('direct', 'user') → type 0 (cá nhân/người lạ).
    - Nếu thread_type == 'group' → type 1 (nhóm).
    - Mặc định type 1 (nhóm) nếu không xác định được.
    """
    try:
        rows = await _rest(
            "GET",
            "zalo_groups",
            params={
                "select": "is_friend,thread_type",
                "user_id": f"eq.{account_id}",
                "group_id": f"eq.{conversation_id}",
                "limit": "1",
            },
        ) or []
        if rows:
            r = rows[0]
            tt = str(r.get("thread_type") or "").strip().lower()
            if tt in ("direct", "user") or r.get("is_friend"):
                return 0  # Cá nhân (friend hoặc người lạ/stranger chat)
            if tt == "group":
                return 1  # Nhóm chat
    except Exception:
        pass
    return 1  # Nhóm chat



async def _rest_with_count(
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    _require_configured()
    headers = _headers({"Prefer": "count=exact"})
    url = f"{_base_url()}/rest/v1/{path.lstrip('/')}"
    client = _get_pooled_http_client(follow_redirects=False)
    response = await client.get(url, headers=headers, params=params, timeout=60.0)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase GET {path} failed: {response.status_code} {response.text}")
    content_range = response.headers.get("content-range", "")
    total = 0
    if "/" in content_range:
        raw_total = content_range.rsplit("/", 1)[-1]
        if raw_total.isdigit():
            total = int(raw_total)
    return (response.json() if response.content else []), total


async def upload_asset_bytes(path: str, content: bytes, content_type: str) -> str:
    _require_configured()
    bucket = quote(settings.supabase_storage_bucket.strip() or "zalo-assets", safe="")
    object_path = quote(path.lstrip("/"), safe="/")
    url = f"{_base_url()}/storage/v1/object/{bucket}/{object_path}"
    headers = _headers(
        {
            "Content-Type": content_type,
            "x-upsert": "true",
        }
    )
    client = _get_pooled_http_client(follow_redirects=False)
    response = await client.put(url, headers=headers, content=content, timeout=90.0)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase storage upload failed: {response.status_code} {response.text}")
    return f"{_base_url()}/storage/v1/object/public/{bucket}/{object_path}"


async def download_asset_bytes(path: str) -> Tuple[bytes, str, str]:
    _require_configured()
    bucket = quote(settings.supabase_storage_bucket.strip() or "zalo-assets", safe="")
    object_path = quote(path.lstrip("/"), safe="/")
    url = f"{_base_url()}/storage/v1/object/{bucket}/{object_path}"
    client = _get_pooled_http_client(follow_redirects=True)
    response = await client.get(url, headers=_headers(), timeout=90.0)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase storage download failed: {response.status_code} {response.text}")
    content_type = response.headers.get("content-type", "").split(";")[0].strip() or "application/octet-stream"
    ext = mimetypes.guess_extension(content_type) or ".jpg"
    return response.content, content_type, ext


async def delete_storage_objects(paths: List[str]) -> None:
    if not paths:
        return
    _require_configured()
    bucket = quote(settings.supabase_storage_bucket.strip() or "zalo-assets", safe="")
    url = f"{_base_url()}/storage/v1/object/{bucket}"
    headers = _headers()
    client = _get_pooled_http_client(follow_redirects=False)
    response = await client.request(
        "DELETE",
        url,
        headers=headers,
        json={"prefixes": paths},
        timeout=90.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase storage delete failed: {response.status_code} {response.text}")


def _guess_extension(content_type: str, filename_hint: Optional[str] = None, *, default: str = ".bin") -> str:
    """Đoán extension từ content-type, ưu tiên extension THẬT của filename_hint
    (tên file Zalo trả về cho share.file/video/voice) nếu content-type generic
    (application/octet-stream — HTTP server nhiều khi không set đúng loại).
    Trước đây fallback cứng ".jpg" cho MỌI loại không đoán được — sai hoàn
    toàn với file/video/voice (huỷ luôn phần mở rộng thật, user tải về không
    mở được), giờ chỉ fallback ".jpg" khi content-type xác nhận là ảnh."""
    ext = mimetypes.guess_extension(content_type)
    if ext:
        return ext
    if filename_hint:
        hint_ext = posixpath.splitext(filename_hint)[1]
        if hint_ext and len(hint_ext) <= 10:
            return hint_ext
    if content_type.startswith("image/"):
        return ".jpg"
    return default


async def _download_image(source_url: str, filename_hint: Optional[str] = None) -> Tuple[bytes, str, str]:
    if source_url.startswith("data:image/"):
        header, _, payload = source_url.partition(",")
        if not payload or ";base64" not in header:
            raise RuntimeError("Unsupported data URL image format")
        content_type = header.removeprefix("data:").split(";")[0] or "image/jpeg"
        ext = _guess_extension(content_type, filename_hint)
        return base64.b64decode(payload), content_type, ext

    client = _get_pooled_http_client(follow_redirects=True)
    response = await client.get(source_url, timeout=60.0)
    if response.status_code >= 400:
        raise RuntimeError(f"Image download failed: HTTP {response.status_code}")
    content_type = response.headers.get("content-type", "").split(";")[0].strip() or "application/octet-stream"
    ext = _guess_extension(content_type, filename_hint)
    return response.content, content_type, ext


def _message_payload(user_id: str, job: JobData, group_id: str, group_name: str, msg: Message) -> Dict[str, Any]:
    norm_raw = _normalize_raw_content(msg.raw_content)
    resolved_kind = classify_message_kind(
        msg.type,
        msg.content,
        norm_raw,
        existing_kind=msg.msg_kind,
    )
    return {
        "user_id": user_id,
        "job_id": job.job_id,
        "group_id": group_id,
        "group_name": group_name,
        "source_message_id": msg.message_id,
        "sender_id": msg.sender_id,
        "sender_name": msg.sender_name,
        "timestamp_text": msg.timestamp,
        "time_text": msg.time_text,
        "type": msg.type,
        "content": msg.content,
        "is_sent": msg.is_sent,
        "is_deleted": msg.is_deleted,
        "updated_at": datetime.utcnow().isoformat(),
        # G3: Persist full normalization metadata on crawl/sync path as well
        "ts": msg.ts,
        "raw_content": norm_raw,
        "mentions": [m.model_dump() for m in msg.mentions] if msg.mentions else None,
        "cli_msg_id": msg.cli_msg_id,
        "msg_kind": resolved_kind,
        "reply_to_id": msg.reply_to_id,
    }


def _listener_message_payload(user_id: str, group_id: str, group_name: str, msg: Message) -> Dict[str, Any]:
    norm_raw = _normalize_raw_content(msg.raw_content)
    resolved_kind = classify_message_kind(
        msg.type,
        msg.content,
        norm_raw,
        existing_kind=msg.msg_kind,
    )
    return {
        "user_id": user_id,
        "job_id": None,
        "group_id": group_id,
        "group_name": group_name,
        "source_message_id": msg.message_id,
        "sender_id": msg.sender_id,
        "sender_name": msg.sender_name,
        "timestamp_text": msg.timestamp,
        "time_text": msg.time_text,
        "type": msg.type,
        "content": msg.content,
        "is_sent": msg.is_sent,
        "is_deleted": msg.is_deleted,
        "updated_at": datetime.utcnow().isoformat(),
        # Zalo tập trung (Mục 7.1 guide) — ghi qua RPC fn_bulk_save_zalo_messages
        # (migration 128) hoặc REST fallback trực tiếp (cột đã có từ migration 127).
        "ts": msg.ts,
        "raw_content": norm_raw,
        "mentions": [m.model_dump() for m in msg.mentions] if msg.mentions else None,
        "cli_msg_id": msg.cli_msg_id,
        "msg_kind": resolved_kind,
        "reply_to_id": msg.reply_to_id,
    }


def _message_from_row(row: Dict[str, Any]) -> Message:
    image_urls: List[str] = []
    for asset in row.get("assets") or []:
        if asset.get("storage_url"):
            image_urls.append(str(asset["storage_url"]))
        elif asset.get("source_url"):
            image_urls.append(str(asset["source_url"]))
    norm_raw = _normalize_raw_content(row.get("raw_content"))
    msg_type = str(row.get("type") or ("image" if image_urls else "text"))
    resolved_kind = classify_message_kind(
        msg_type,
        row.get("content"),
        norm_raw,
        existing_kind=row.get("msg_kind"),
    )
    if resolved_kind == "sticker" and not image_urls:
        sid = extract_sticker_id_from_raw(norm_raw)
        cdn_url = build_zalo_sticker_cdn_url(sid)
        if cdn_url:
            image_urls.append(cdn_url)
    return Message(
        message_id=str(row.get("source_message_id") or row.get("id") or ""),
        sender_id=row.get("sender_id") or None,
        sender_name=row.get("sender_name") or None,
        timestamp=row.get("timestamp_text") or None,
        time_text=row.get("time_text") or None,
        type=msg_type,
        content=row.get("content") or None,
        image_urls=list(dict.fromkeys(image_urls)),
        is_deleted=bool(row.get("is_deleted")),
        is_sent=bool(row.get("is_sent")),
        ts=row.get("ts"),
        cli_msg_id=row.get("cli_msg_id") or None,
        mentions=row.get("mentions") or [],
        msg_kind=resolved_kind,
        raw_content=norm_raw,
        reply_to_id=row.get("reply_to_id") or None,
    )


async def upsert_zalo_user(
    user_id: str,
    *,
    status: str,
    assigned_worker_id: Optional[str] = None,
    display_name: Optional[str] = None,
    cookie: Optional[str] = None,
    id_member: Optional[str] = None,
) -> None:
    if not is_supabase_configured():
        return

    now = datetime.utcnow().isoformat()
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "zalo_status": status,
        "last_seen_at": now,
        "updated_at": now,
    }
    if id_member:
        payload["id_member"] = id_member
    if status == "confirmed":
        payload["last_login_at"] = now
    if assigned_worker_id:
        payload["assigned_worker_id"] = assigned_worker_id
    if display_name:
        payload["display_name"] = display_name
    if cookie is not None:
        payload["cookie"] = cookie

    await _rest(
        "POST",
        "zalo_users",
        json=[payload],
        params={"on_conflict": "user_id"},
        prefer="resolution=merge-duplicates",
    )


async def upsert_crawl_job(user_id: str, job: JobData) -> None:
    await _rest(
        "POST",
        "zalo_crawl_jobs",
        json=[
            {
                "job_id": job.job_id,
                "user_id": user_id,
                "group_id": job.group_id,
                "group_name": job.group_name,
                "status": job.status,
                "messages_collected": job.progress.messages_collected,
                "images_found": job.progress.images_found,
                "oldest_message_date": job.progress.oldest_message_date,
                "started_at": job.started_at.isoformat(),
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                "error": job.error,
                "updated_at": datetime.utcnow().isoformat(),
            }
        ],
    )


async def upsert_group(
    user_id: str,
    group_id: str,
    group_name: str,
    avatar_url: Optional[str] = None,
    unread_count: Optional[int] = None,
    last_message_at: Optional[str] = None,
    last_message_content: Optional[str] = None,
    last_sender_id: Optional[str] = None,
    last_sender_name: Optional[str] = None,
    last_message_type: Optional[str] = None,
    is_friend: Optional[bool] = None,
    thread_type: Optional[str] = None,
) -> None:
    resolved_name = group_name
    if group_name and (group_name.startswith("Conversation ") or group_name.isdigit() or group_name == group_id):
        try:
            existing = await _rest(
                "GET",
                "zalo_groups",
                params={
                    "select": "group_name",
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{group_id}",
                    "limit": "1",
                }
            )
            if existing and existing[0].get("group_name"):
                old_name = str(existing[0]["group_name"]).strip()
                # Chỉ dùng tên cũ nếu nó là tên thật (không phải số, không phải mã nhóm, không phải placeholder).
                if old_name and not (old_name.startswith("Conversation ") or old_name.isdigit() or old_name == group_id):
                    resolved_name = old_name
        except Exception:
            pass

    payload = {
        "user_id": user_id,
        "group_id": group_id,
        "group_name": resolved_name,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if avatar_url:
        payload["avatar_url"] = avatar_url
    if unread_count is not None:
        payload["unread_count"] = unread_count
    if last_message_at is not None:
        payload["last_message_at"] = last_message_at
    if last_message_content is not None or last_message_type is not None:
        clean_preview = format_sidebar_last_message_preview(
            last_message_content,
            msg_type=last_message_type,
        )
        if clean_preview is not None:
            payload["last_message_content"] = clean_preview
    if last_sender_id is not None:
        payload["last_sender_id"] = last_sender_id
    if last_sender_name is not None:
        payload["last_sender_name"] = last_sender_name
    if last_message_type is not None:
        payload["last_message_type"] = last_message_type
    if is_friend is not None:
        payload["is_friend"] = is_friend
    if thread_type is not None:
        payload["thread_type"] = thread_type

    await _rest(
        "POST",
        "zalo_groups",
        json=[payload],
        params={"on_conflict": "user_id,group_id"},
        prefer="resolution=merge-duplicates",
    )


async def upsert_groups(user_id: str, groups: Iterable[Dict[str, Any]]) -> int:
    now = datetime.utcnow().isoformat()

    # Collect candidates first
    candidates: List[tuple] = []
    for group in groups:
        group_id = str(group.get("group_id") or group.get("id") or group.get("name") or "").strip()
        group_name = str(group.get("name") or group.get("group_name") or group_id).strip()
        if not group_id or not group_name:
            continue
        candidates.append((group_id, group_name, group))
    if not candidates:
        return 0

    # Prefetch existing group metadata so null values don't overwrite existing data
    # (e.g. avatar_url, last_message_at set by the listener).
    existing_map: Dict[str, Dict[str, Any]] = {}
    try:
        existing_rows = await _rest(
            "GET",
            "zalo_groups",
            params={
                "select": "group_id,group_name,avatar_url,unread_count,last_message_at,last_message_content,last_sender_id,last_sender_name,last_message_type,is_friend",
                "user_id": f"eq.{user_id}",
                "limit": "5000",
            },
        ) or []
        existing_map = {str(r.get("group_id")): r for r in existing_rows}
    except Exception as exc:
        logger.warning(f"Could not prefetch existing zalo_groups for merge: {exc}")

    rows: List[Dict[str, Any]] = []
    for group_id, group_name, group in candidates:
        existing = existing_map.get(group_id, {})
        
        # Preserve existing group_name if new one is just an ID or generic
        old_name = str(existing.get("group_name") or "").strip()
        if old_name and (group_name.startswith("Conversation ") or group_name.isdigit() or group_name == group_id):
            if not (old_name.startswith("Conversation ") or old_name.isdigit() or old_name == group_id):
                group_name = old_name

        last_msg_at_raw = group.get("last_message_at")
        new_last_msg_at = _normalize_iso_timestamp(last_msg_at_raw) if last_msg_at_raw is not None else None
        raw_preview_cand = group.get("last_message_content") or group.get("last_message") or existing.get("last_message_content")
        resolved_msg_type = group.get("last_message_type") or existing.get("last_message_type")
        clean_group_preview = (
            format_sidebar_last_message_preview(raw_preview_cand, msg_type=resolved_msg_type)
            if (raw_preview_cand is not None or resolved_msg_type is not None)
            else None
        )
        row = {
            "user_id": user_id,
            "group_id": group_id,
            "group_name": group_name,
            "avatar_url": group.get("avatar_url") or existing.get("avatar_url"),
            "unread_count": int(existing.get("unread_count") or 0),
            "last_message_at": new_last_msg_at or existing.get("last_message_at"),
            "last_message_content": clean_group_preview,
            "last_sender_id": group.get("last_sender_id") or existing.get("last_sender_id"),
            "last_sender_name": group.get("last_sender_name") or existing.get("last_sender_name"),
            "last_message_type": resolved_msg_type,
            "is_pinned": bool(group.get("is_pinned")),
            "is_friend": bool(group.get("is_friend") or existing.get("is_friend") or False),
            "updated_at": now,
        }
        rows.append(row)

    await _rest(
        "POST",
        "zalo_groups",
        json=rows,
        params={"on_conflict": "user_id,group_id"},
        prefer="resolution=merge-duplicates",
    )
    return len(rows)


async def save_crawl_messages(user_id: str, job: JobData, group_id: str, messages: Iterable[Message]) -> int:
    group_name = job.group_name
    await upsert_crawl_job(user_id, job)
    await upsert_group(user_id, group_id, group_name)

    saved_count = 0
    uploaded_images = 0
    failed_images = 0

    messages_list = list(messages)
    payloads = []
    msg_by_source_id = {}
    for msg in messages_list:
        if not msg.message_id:
            continue
        payloads.append(_message_payload(user_id, job, group_id, group_name, msg))
        msg_by_source_id[str(msg.message_id).strip()] = msg

    if payloads:
        try:
            rows = await _rest(
                "POST",
                "zalo_messages",
                json=payloads,
                params={"on_conflict": "user_id,group_id,source_message_id"},
                prefer="resolution=merge-duplicates,return=representation",
            ) or []

            for row in rows:
                saved_count += 1
                message_uuid = row["id"]
                source_msg_id = str(row.get("source_message_id") or "").strip()
                original_msg = msg_by_source_id.get(source_msg_id)
                if original_msg and original_msg.image_urls:
                    asset_stats = await save_message_assets(message_uuid, user_id, job.job_id, original_msg.image_urls, filename_hint=original_msg.content)
                    uploaded_images += asset_stats["uploaded"]
                    failed_images += asset_stats["failed"]
        except Exception as exc:
            logger.warning(f"Could not bulk save crawl messages for job={job.job_id}: {exc}")

    logger.info(
        "Saved Zalo crawl payload: job={} group={!r} messages={} images_uploaded={} images_failed={}",
        job.job_id,
        group_name,
        saved_count,
        uploaded_images,
        failed_images,
    )
    return saved_count


async def upsert_zalo_account(
    account_id: str,
    *,
    owner_id: str = "default",
    label: Optional[str] = None,
    phone: Optional[str] = None,
    status: str = "unknown",
    zalo_id: Optional[str] = None,
    avatar_url: Optional[str] = None,
    is_active: bool = True,
    id_member: Optional[str] = None,
    is_shared_with_all: Optional[bool] = None,
    owner_name: Optional[str] = None,
    sim_location: Optional[str] = None,
    sim_location_detail: Optional[str] = None,
    assigned_domains: Optional[List[str]] = None,
    assigned_groups: Optional[List[str]] = None,
) -> None:
    if not is_supabase_configured():
        return

    now = datetime.utcnow().isoformat()
    payload: Dict[str, Any] = {
        "account_id": account_id,
        "owner_id": owner_id or "default",
        "label": label or account_id,
        "phone": phone,
        "zalo_id": zalo_id,
        "avatar_url": avatar_url,
        "status": status,
        "is_active": is_active,
        "last_seen_at": now,
        "updated_at": now,
    }
    if id_member:
        payload["id_member"] = id_member
    if is_shared_with_all is not None:
        payload["is_shared_with_all"] = is_shared_with_all
    if owner_name is not None:
        payload["owner_name"] = owner_name
    if sim_location is not None:
        payload["sim_location"] = sim_location
    if sim_location_detail is not None:
        payload["sim_location_detail"] = sim_location_detail
    if assigned_domains is not None:
        payload["assigned_domains"] = assigned_domains
    if assigned_groups is not None:
        payload["assigned_groups"] = assigned_groups
    if status == "confirmed":
        payload["last_login_at"] = now

    try:
        await _rest(
            "POST",
            "zalo_accounts",
            json=[payload],
            params={"on_conflict": "account_id"},
            prefer="resolution=merge-duplicates",
        )
    except RuntimeError as exc:
        if "zalo_accounts" in str(exc):
            logger.warning(f"zalo_accounts table is not ready; skipping account upsert: {exc}")
            return
        raise


async def get_zalo_account_by_id(account_id: str) -> Optional[Dict[str, Any]]:
    if not is_supabase_configured():
        return None
    try:
        rows = await _rest("GET", "zalo_accounts", params={"account_id": f"eq.{account_id}", "limit": "1"})
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning(f"Could not get zalo_account {account_id}: {exc}")
        return None


async def list_zalo_accounts(
    owner_id: Optional[str] = None,
    id_member: Optional[str | List[str]] = None,
) -> List[Dict[str, Any]]:
    if not is_supabase_configured():
        return []

    params: Dict[str, Any] = {"select": "*", "is_active": "eq.true", "order": "updated_at.desc"}

    # id_member có thể là string (1 user) hoặc list[str] (leader + team members).
    # owner_id là fallback cho các account cũ chưa có id_member.
    # Luôn OR thêm is_shared_with_all=true: tài khoản Zalo dùng chung toàn công ty
    # phải hiện ra cho MỌI người gọi, không phụ thuộc owner/id_member/role.
    if id_member is not None:
        if isinstance(id_member, list):
            if id_member:
                params["or"] = f"(id_member.in.({','.join(id_member)}),is_shared_with_all.eq.true)"
        else:
            params["or"] = f"(id_member.eq.{id_member},is_shared_with_all.eq.true)"
    elif owner_id:
        params["or"] = f"(owner_id.eq.{owner_id},is_shared_with_all.eq.true)"

    try:
        return await _rest("GET", "zalo_accounts", params=params) or []
    except RuntimeError as exc:
        if "zalo_accounts" in str(exc):
            logger.warning(f"zalo_accounts table is not ready; returning empty account list: {exc}")
            return []
        raise


async def delete_zalo_account(account_id: str) -> None:
    if not is_supabase_configured():
        return
    try:
        await _rest("PATCH", "zalo_accounts", params={"account_id": f"eq.{account_id}"}, json={"is_active": False, "updated_at": datetime.utcnow().isoformat()})
    except RuntimeError as exc:
        if "zalo_accounts" in str(exc):
            return
        raise


async def hard_delete_zalo_account_data(account_id: str) -> Dict[str, int]:
    """Xoá thật sự (hard delete) toàn bộ dữ liệu của 1 account Zalo trong Supabase.

    Gọi PostgreSQL RPC fn_hard_delete_zalo_account để xóa toàn bộ các bảng trong 1 transaction.
    """
    if not is_supabase_configured():
        return {}

    try:
        resp = await _rest(
            "POST",
            "rpc/fn_hard_delete_zalo_account",
            json={"p_account_id": account_id},
        )
        if isinstance(resp, dict):
            return resp
        return {}
    except Exception as exc:
        logger.info(f"fn_hard_delete_zalo_account RPC failed: {exc}. Falling back to sequential deletes...")
        return await _hard_delete_zalo_account_data_fallback(account_id)


async def _hard_delete_zalo_account_data_fallback(account_id: str) -> Dict[str, int]:
    result: Dict[str, int] = {}

    def _count(resp: Any) -> int:
        if isinstance(resp, list):
            return len(resp)
        if isinstance(resp, dict):
            d = resp.get("data")
            if isinstance(d, list):
                return len(d)
        return 0

    targets = [
        ("zalo_sessions", {"user_id": f"eq.{account_id}"}),
        ("zalo_users", {"user_id": f"eq.{account_id}"}),
        ("zalo_accounts", {"account_id": f"eq.{account_id}"}),
        ("zalo_groups", {"user_id": f"eq.{account_id}"}),
        ("zalo_messages", {"user_id": f"eq.{account_id}"}),
    ]
    for table, params in targets:
        try:
            resp = await _rest("DELETE", table, params=params, prefer="return=representation")
            result[table] = _count(resp)
        except RuntimeError as exc:
            msg = str(exc)
            if "Could not find" in msg or "does not exist" in msg or "404" in msg or "PGRST" in msg:
                result[table] = 0
            else:
                result.setdefault("_errors", 0)
                result["_errors"] += 1
                logger.warning(f"hard_delete_zalo_account_data fallback: failed to delete {table}: {msg}")
        except Exception as exc:
            logger.warning(f"hard_delete_zalo_account_data fallback: unexpected error on {table}: {exc}")
            result[table] = 0

    return result


# ----------------------------------------------------------------------------
# Realtime: phân quyền user/role + share conversation
# ----------------------------------------------------------------------------

_USER_BY_EMAIL_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_USER_BY_EMAIL_CACHE_TTL = 60.0  # 60 giây


async def get_app_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Tra cứu ``public.app_users`` theo email (case-insensitive).

    Trả về dict các cột ``id``, ``email``, ``role``, ``name`` ... hoặc ``None``
    nếu không tìm thấy / chưa cấu hình Supabase.

    Lưu ý: bảng ``app_users`` nằm ngoài schema zalo, có thể chưa được tạo trên
    một số môi trường. Hàm fail-soft trả về ``None`` thay vì raise.
    """
    import time
    import copy
    if not is_supabase_configured():
        return None
    email_norm = (email or "").strip().lower()
    if not email_norm:
        return None
    cached = _USER_BY_EMAIL_CACHE.get(email_norm)
    if cached:
        c_time, c_user = cached
        if (time.time() - c_time) < _USER_BY_EMAIL_CACHE_TTL:
            return copy.deepcopy(c_user)
    try:
        rows = await _rest(
            "GET",
            "app_users",
            params={
                "select": "id,email,role,name",
                "email": f"ilike.{email_norm}",
                "limit": "1",
            },
        )
    except RuntimeError as exc:
        # Bảng chưa tồn tại — coi như user không tồn tại.
        if "app_users" in str(exc) or "does not exist" in str(exc):
            return None
        raise
    if not rows:
        return None
    row = rows[0]
    if not isinstance(row, dict):
        return None
    _USER_BY_EMAIL_CACHE[email_norm] = (time.time(), copy.deepcopy(row))
    return row


async def get_user_role(email: str) -> str:
    """Trả về role từ bảng ``app_users``. Mặc định ``"member"`` nếu không tìm thấy."""
    user = await get_app_user_by_email(email)
    if not user:
        return "member"
    return str(user.get("role") or "member").strip().lower() or "member"


async def get_app_user_id_by_email(email: str) -> Optional[str]:
    user = await get_app_user_by_email(email)
    if not user:
        return None
    return str(user.get("id") or "").strip() or None


async def get_team_member_ids(leader_user_id: str) -> List[str]:
    """Lấy danh sách app_user.id của các member thuộc team leader.

    Leader → team: ``teams.id_leader`` (không có cột này trên ``member_of_teams``).
    Team → members: ``member_of_teams.id_teams``. Trả về list rỗng nếu leader
    không quản lý team nào hoặc thiếu cấu hình.
    """
    if not is_supabase_configured() or not leader_user_id:
        return []
    try:
        team_rows = await _rest(
            "GET",
            "teams",
            params={
                "select": "id",
                "id_leader": f"eq.{leader_user_id}",
            },
        ) or []
        team_ids = [str(r.get("id")) for r in team_rows if isinstance(r, dict) and r.get("id")]
        if not team_ids:
            return []
        rows = await _rest(
            "GET",
            "member_of_teams",
            params={
                "select": "id_member",
                "id_teams": f"in.({','.join(team_ids)})",
            },
        ) or []
    except RuntimeError as exc:
        if "does not exist" in str(exc):
            return []
        raise
    ids: List[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = str(row.get("id_member") or "").strip()
        if value and value not in ids:
            ids.append(value)
    return ids


async def set_conversation_share(
    account_id: str,
    conversation_id: str,
    *,
    shared: bool,
    shared_role: str = "admin",
) -> None:
    """Bật/tắt share conversation với role (admin/leader).

    - ``shared=True``  → upsert dòng với ``is_active=True``.
    - ``shared=False`` → update ``is_active=False`` (giữ dòng để audit, không xoá).

    Hàm này fail-soft nếu bảng chưa migrate.
    """
    if not is_supabase_configured():
        return
    account_id = (account_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    if not account_id or not conversation_id:
        return
    role = (shared_role or "admin").strip().lower() or "admin"

    now = datetime.utcnow().isoformat()
    payload = {
        "account_id": account_id,
        "conversation_id": conversation_id,
        "shared_role": role,
        "is_active": bool(shared),
        "updated_at": now,
    }
    if shared:
        payload["created_at"] = now

    try:
        if shared:
            await _rest(
                "POST",
                "zalo_conversation_permissions",
                json=[payload],
                params={"on_conflict": "account_id,conversation_id,shared_role"},
                prefer="resolution=merge-duplicates",
            )
        else:
            # Tắt share: PATCH theo composite key (account_id, conversation_id, shared_role).
            await _rest(
                "PATCH",
                "zalo_conversation_permissions",
                params={
                    "account_id": f"eq.{account_id}",
                    "conversation_id": f"eq.{conversation_id}",
                    "shared_role": f"eq.{role}",
                },
                json={"is_active": False, "updated_at": now},
            )
    except RuntimeError as exc:
        if "zalo_conversation_permissions" in str(exc) or "does not exist" in str(exc):
            logger.warning(
                f"zalo_conversation_permissions table not ready; cannot set share: {exc}"
            )
            return
        raise


async def list_shared_conversation_ids(
    account_id: str,
    shared_role: Optional[str] = None,
) -> set[str]:
    """Trả về set ``conversation_id`` đang được share (is_active=true) cho account.

    Nếu ``shared_role=None`` trả về tất cả role. Hàm fail-soft trả về set rỗng
    nếu bảng chưa tồn tại.
    """
    empty: set[str] = set()
    if not is_supabase_configured():
        return empty
    account_id = (account_id or "").strip()
    if not account_id:
        return empty

    params: Dict[str, Any] = {
        "select": "conversation_id,shared_role",
        "account_id": f"eq.{account_id}",
        "is_active": "eq.true",
    }
    if shared_role:
        params["shared_role"] = f"eq.{shared_role.strip().lower()}"

    try:
        rows = await _rest("GET", "zalo_conversation_permissions", params=params) or []
    except RuntimeError as exc:
        if "zalo_conversation_permissions" in str(exc) or "does not exist" in str(exc):
            return empty
        raise

    result: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("conversation_id") or "").strip()
        if cid:
            result.add(cid)
    return result


async def get_conversation_share_status(
    account_id: str,
    conversation_id: str,
) -> Dict[str, bool]:
    """Trả về dict ``{role: is_shared}`` cho 1 conversation cụ thể.

    Dùng cho UI hiển thị trạng thái share hiện tại (đang bật cho ai).
    """
    result: Dict[str, bool] = {"admin": False, "leader": False}
    if not is_supabase_configured():
        return result
    account_id = (account_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    if not account_id or not conversation_id:
        return result
    try:
        rows = await _rest(
            "GET",
            "zalo_conversation_permissions",
            params={
                "select": "shared_role,is_active",
                "account_id": f"eq.{account_id}",
                "conversation_id": f"eq.{conversation_id}",
            },
        ) or []
    except RuntimeError as exc:
        if "zalo_conversation_permissions" in str(exc) or "does not exist" in str(exc):
            return result
        raise
    for row in rows:
        if not isinstance(row, dict):
            continue
        role = str(row.get("shared_role") or "").strip().lower()
        if role in result and bool(row.get("is_active")):
            result[role] = True
    return result


async def get_zalo_inbox_report(
    account_ids: Optional[List[str]] = None,
    *,
    owner_id: Optional[str] = None,
    limit: int = 1000,
) -> Dict[str, Any]:
    _require_configured()
    accounts = await list_zalo_accounts(owner_id)
    account_by_id = {str(row.get("account_id")): row for row in accounts}

    selected_ids = [item for item in (account_ids or []) if item]
    if not selected_ids:
        selected_ids = list(account_by_id.keys())
    if not selected_ids:
        return {"accounts": [], "customers": [], "total_messages": 0, "total_customers": 0}

    params = {
        "select": "id,user_id,group_id,group_name,source_message_id,sender_id,sender_name,timestamp_text,time_text,type,content,msg_kind,raw_content,cli_msg_id,is_sent,created_at",
        "user_id": f"in.({','.join(selected_ids)})",
        "is_deleted": "eq.false",
        "order": "created_at.desc",
        "limit": str(max(1, min(limit, 5000))),
    }
    rows = await _rest("GET", "zalo_messages", params=params) or []

    account_stats: Dict[str, Dict[str, Any]] = {}
    customer_stats: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for row in rows:
        account_id = str(row.get("user_id") or "default")
        account = account_by_id.get(account_id) or {"account_id": account_id, "label": account_id}
        acc = account_stats.setdefault(
            account_id,
            {
                "account_id": account_id,
                "label": account.get("label") or account_id,
                "owner_id": account.get("owner_id") or owner_id or "default",
                "message_count": 0,
                "customer_count": 0,
                "latest_message_at": None,
            },
        )
        acc["message_count"] += 1
        if not acc["latest_message_at"]:
            acc["latest_message_at"] = row.get("created_at")

        customer_id = str(row.get("group_id") or row.get("sender_id") or row.get("group_name") or "unknown")
        key = (account_id, customer_id)
        customer = customer_stats.setdefault(
            key,
            {
                "account_id": account_id,
                "account_label": account.get("label") or account_id,
                "customer_id": customer_id,
                "customer_name": row.get("group_name") or row.get("sender_name") or customer_id,
                "conversation_id": row.get("group_id"),
                "conversation_name": row.get("group_name"),
                "message_count": 0,
                "sent_count": 0,
                "received_count": 0,
                "latest_message_at": None,
                "latest_content": None,
            },
        )
        customer["message_count"] += 1
        if row.get("is_sent"):
            customer["sent_count"] += 1
        else:
            customer["received_count"] += 1
        if not customer["latest_message_at"]:
            customer["latest_message_at"] = row.get("created_at")
            norm_raw = _normalize_raw_content(row.get("raw_content"))
            customer["latest_msg_kind"] = classify_message_kind(
                row.get("type"),
                row.get("content"),
                norm_raw,
                existing_kind=row.get("msg_kind"),
            )
            customer["latest_content"] = format_sidebar_last_message_preview(
                row.get("content"),
                msg_type=row.get("type"),
                msg_kind=customer["latest_msg_kind"],
                raw_content=norm_raw,
                is_sent=bool(row.get("is_sent")),
            )

    for account_id in account_stats:
        account_stats[account_id]["customer_count"] = sum(1 for key in customer_stats if key[0] == account_id)

    customers = sorted(customer_stats.values(), key=lambda item: item.get("latest_message_at") or "", reverse=True)
    accounts_out = sorted(account_stats.values(), key=lambda item: item.get("latest_message_at") or "", reverse=True)
    return {
        "accounts": accounts_out,
        "customers": customers,
        "total_messages": sum(item["message_count"] for item in accounts_out),
        "total_customers": len(customers),
    }


async def save_listener_messages(
    user_id: str,
    group_id: str,
    group_name: str,
    messages: Iterable[Message],
    *,
    increment_unread: bool = True,
) -> int:
    if not is_supabase_configured():
        return 0

    safe_group_name = group_name or group_id
    messages_list = list(messages)

    unread_inc = 0
    if increment_unread:
        for msg in messages_list:
            if not msg.is_sent:
                unread_inc += 1

    current_unread = 0
    if unread_inc > 0:
        try:
            group_rows = await _rest(
                "GET",
                "zalo_groups",
                params={
                    "select": "unread_count",
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{group_id}",
                    "limit": "1",
                },
            ) or []
            if group_rows:
                current_unread = int(group_rows[0].get("unread_count") or 0)
        except Exception as exc:
            logger.warning(f"Could not fetch current unread count for group={group_id}: {exc}")

    # Tìm tin nhắn mới nhất theo timestamp để update group metadata.
    last_message = None
    if messages_list:
        last_message = max(
            messages_list,
            key=lambda msg: _parse_to_millis(msg.timestamp) or _parse_to_millis(msg.time_text),
        )

    last_message_at_value = None
    if last_message:
        ts_ms = _parse_to_millis(last_message.timestamp) or _parse_to_millis(last_message.time_text)
        if ts_ms > 0:
            last_message_at_value = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")

    # Chuẩn bị payload cho group (G5: luôn dùng nhãn tiếng Việt sạch, không bao giờ lưu sendBubbleMessage/raw JSON)
    last_message_preview = (
        format_sidebar_last_message_preview(
            last_message.content,
            msg_type=last_message.type,
            msg_kind=last_message.msg_kind,
            raw_content=last_message.raw_content,
            is_sent=bool(last_message.is_sent),
        )
        if last_message
        else None
    )
    group_payload = {
        "group_id": group_id,
        "group_name": safe_group_name,
        "unread_count": (current_unread + unread_inc) if unread_inc > 0 else None,
        "last_message_at": last_message_at_value,
        "last_message_content": last_message_preview,
        "last_sender_id": last_message.sender_id if last_message else None,
        "last_sender_name": last_message.sender_name if last_message else None,
        "last_message_type": last_message.type if last_message else None,
    }

    # Chuẩn bị payload cho messages
    payloads = []
    msg_by_source_id = {}
    for msg in messages_list:
        if not msg.message_id:
            continue
        p = _listener_message_payload(user_id, group_id, safe_group_name, msg)
        p["message_id"] = msg.message_id
        payloads.append(p)
        msg_by_source_id[str(msg.message_id).strip()] = msg

    saved_count = 0
    uploaded_images = 0
    failed_images = 0
    use_fallback = True

    # 1. Gọi RPC fn_bulk_save_zalo_messages để gộp Group + Messages thành 1 truy vấn duy nhất
    if payloads:
        try:
            await _rest(
                "POST",
                "rpc/fn_bulk_save_zalo_messages",
                json={
                    "p_user_id": user_id,
                    "p_groups": [group_payload],
                    "p_messages": payloads,
                }
            )
            
            # Lấy UUIDs của tin nhắn vừa upsert để lưu assets
            source_ids = list(msg_by_source_id.keys())
            rows = await _rest(
                "GET",
                "zalo_messages",
                params={
                    "select": "id,source_message_id",
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{group_id}",
                    "source_message_id": f"in.({','.join(source_ids)})",
                }
            ) or []

            for row in rows:
                saved_count += 1
                message_uuid = row["id"]
                source_msg_id = str(row.get("source_message_id") or "").strip()
                original_msg = msg_by_source_id.get(source_msg_id)
                if original_msg and original_msg.image_urls:
                    asset_stats = await save_message_assets(message_uuid, user_id, None, original_msg.image_urls, filename_hint=original_msg.content)
                    uploaded_images += asset_stats["uploaded"]
                    failed_images += asset_stats["failed"]
            
            use_fallback = False
        except Exception as rpc_exc:
            logger.warning(
                "fn_bulk_save_zalo_messages RPC failed, fallback to REST: {}",
                rpc_exc,
            )
            use_fallback = True

    # 2. Luồng Fallback REST truyền thống
    if use_fallback:
        try:
            await upsert_group(
                user_id=user_id,
                group_id=group_id,
                group_name=safe_group_name,
                unread_count=(current_unread + unread_inc) if unread_inc > 0 else None,
                last_message_at=last_message_at_value,
                last_message_content=last_message_preview,
                last_sender_id=last_message.sender_id if last_message else None,
                last_sender_name=last_message.sender_name if last_message else None,
                last_message_type=last_message.type if last_message else None,
            )
            
            if payloads:
                # Remove temporary "message_id" key used only by the RPC to avoid database insert error
                rest_payloads = []
                for p in payloads:
                    p_copy = p.copy()
                    p_copy.pop("message_id", None)
                    rest_payloads.append(p_copy)

                rows = await _rest(
                    "POST",
                    "zalo_messages",
                    json=rest_payloads,
                    params={"on_conflict": "user_id,group_id,source_message_id"},
                    prefer="resolution=merge-duplicates,return=representation",
                ) or []

                for row in rows:
                    saved_count += 1
                    message_uuid = row["id"]
                    source_msg_id = str(row.get("source_message_id") or "").strip()
                    original_msg = msg_by_source_id.get(source_msg_id)
                    if original_msg and original_msg.image_urls:
                        asset_stats = await save_message_assets(message_uuid, user_id, None, original_msg.image_urls, filename_hint=original_msg.content)
                        uploaded_images += asset_stats["uploaded"]
                        failed_images += asset_stats["failed"]
        except Exception as exc:
            logger.warning(f"Could not bulk save listener messages (REST) for user={user_id}: {exc}")

    if saved_count:
        logger.info(
            "Saved Zalo listener messages: user={} group={!r} messages={} images_uploaded={} images_failed={}",
            user_id,
            safe_group_name,
            saved_count,
            uploaded_images,
            failed_images,
        )
    return saved_count


async def save_global_listener_messages(
    user_id: str,
    messages: Iterable[Message],
) -> int:
    if not is_supabase_configured():
        return 0

    from collections import defaultdict
    grouped = defaultdict(list)
    for msg in messages:
        g_id = getattr(msg, "group_id", None) or ""
        if g_id:
            grouped[g_id].append(msg)

    total_saved = 0
    for g_id, g_messages in grouped.items():
        group_rows = await _rest(
            "GET",
            "zalo_groups",
            params={
                "select": "group_name",
                "user_id": f"eq.{user_id}",
                "group_id": f"eq.{g_id}",
                "limit": "1",
            },
        ) or []
        g_name = group_rows[0].get("group_name") if group_rows else g_id
        
        saved = await save_listener_messages(user_id, g_id, g_name, g_messages)
        total_saved += saved

    return total_saved



async def list_recent_messages_for_group(
    user_id: str,
    group_id: str,
    limit: int = 500,
) -> List[Message]:
    if not is_supabase_configured():
        return []
    safe_limit = max(1, min(int(limit or 500), 1000))
    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "*,assets:zalo_message_assets(*)",
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{group_id}",
            "is_deleted": "eq.false",
            "order": "created_at.desc",
            "limit": str(safe_limit),
        },
    ) or []
    messages = [_message_from_row(row) for row in rows]
    return [message for message in messages if message.message_id]


async def save_message_assets(
    message_uuid: str,
    user_id: str,
    job_id: Optional[str],
    source_urls: Iterable[str],
    *,
    filename_hint: Optional[str] = None,
) -> Dict[str, int]:
    stats = {"uploaded": 0, "failed": 0}
    existing_assets = {}
    try:
        rows = await _rest(
            "GET",
            "zalo_message_assets",
            params={
                "select": "source_url,status",
                "message_id": f"eq.{message_uuid}",
            }
        ) or []
        existing_assets = {r["source_url"]: r["status"] for r in rows}
    except Exception as exc:
        logger.warning(f"Could not pre-fetch existing zalo_message_assets for message {message_uuid}: {exc}")

    payloads = []
    for source_url in source_urls:
        status = "pending"
        storage_path = None
        storage_url = None
        error = None
        source_url_ref = source_url

        if source_url.startswith("data:image/"):
            # Normalize data URL structure to match source_url_ref hash check
            try:
                content, content_type, ext = await _download_image(source_url, filename_hint)
                source_url_ref = f"data:{content_type};sha256={hashlib.sha256(content).hexdigest()}"
            except Exception:
                pass

        if existing_assets.get(source_url_ref) == "uploaded":
            continue

        if source_url.startswith("blob:"):
            status = "failed"
            error = "Blob URL is browser-local and cannot be persisted after crawl"
        else:
            try:
                content, content_type, ext = await _download_image(source_url, filename_hint)
                if source_url.startswith("data:image/"):
                    source_url_ref = f"data:{content_type};sha256={hashlib.sha256(content).hexdigest()}"
                storage_path = posixpath.join(
                    user_id,
                    job_id or "manual",
                    f"{message_uuid}-{uuid.uuid4().hex}{ext}",
                )
                storage_url = await upload_asset_bytes(storage_path, content, content_type)
                status = "uploaded"
                stats["uploaded"] += 1
            except Exception as exc:
                logger.warning(f"Could not persist Zalo image {source_url}: {exc}")
                status = "failed"
                error = str(exc)
                stats["failed"] += 1
        if status == "failed" and source_url.startswith("blob:"):
            stats["failed"] += 1

        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payloads.append({
            "message_id": message_uuid,
            "source_url": source_url_ref,
            "storage_path": storage_path,
            "storage_url": storage_url,
            "status": status,
            "error": error,
            "updated_at": now_iso,
        })

    if payloads:
        try:
            await _rest(
                "POST",
                "zalo_message_assets",
                json=payloads,
                params={"on_conflict": "message_id,source_url"},
                prefer="resolution=merge-duplicates",
            )
        except Exception as exc:
            logger.warning(f"Could not bulk save message assets for message {message_uuid}: {exc}")

    return stats


async def list_library_messages(
    user_id: str,
    group_name: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    content_kind: str = "all",
) -> Tuple[List[Dict[str, Any]], int]:
    safe_limit = max(1, min(limit, 1000))
    safe_offset = max(0, offset)
    select_clause = "*,assets:zalo_message_assets(*)"
    if content_kind == "image":
        select_clause = "*,assets:zalo_message_assets!inner(*)"
    params: Dict[str, Any] = {
        "select": select_clause,
        "user_id": f"eq.{user_id}",
        "is_deleted": "eq.false",
        "order": "created_at.desc",
        "limit": str(safe_limit),
        "offset": str(safe_offset),
    }
    if group_name:
        params["group_name"] = f"ilike.*{group_name}*"
    if content_kind == "text":
        params["content"] = "not.is.null"
    if content_kind == "image":
        params["assets.status"] = "eq.uploaded"
    rows, total = await _rest_with_count("zalo_messages", params=params)
    if group_name and not rows:
        job_rows = await _rest(
            "GET",
            "zalo_crawl_jobs",
            params={
                "select": "job_id",
                "user_id": f"eq.{user_id}",
                "group_name": f"ilike.*{group_name}*",
                "limit": "200",
            },
        ) or []
        job_ids = [
            str(job.get("job_id") or "").strip()
            for job in job_rows
            if str(job.get("job_id") or "").strip()
        ]
        if job_ids:
            fallback_params = dict(params)
            fallback_params.pop("group_name", None)
            fallback_params["job_id"] = "in.(" + ",".join(f'"{job_id}"' for job_id in job_ids) + ")"
            rows, total = await _rest_with_count("zalo_messages", params=fallback_params)
    hydrated_rows = await hydrate_message_groups_from_jobs(user_id, rows or [])
    return [_normalize_message_row(row) for row in hydrated_rows], total


def _normalize_iso_timestamp(val: Any) -> Optional[str]:
    """Chuẩn hóa giá trị thời gian (epoch ms/s hoặc ISO) về ISO-8601 UTC cho cột timestamptz."""
    if val is None or val == "":
        return None
    if isinstance(val, str) and not val.strip().isdigit():
        # Đã là ISO hoặc text -> giữ nguyên, để Postgres tự parse.
        return val
    ms = _parse_to_millis(val)
    if ms <= 0:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_to_millis(val: Any) -> int:
    if not val:
        return 0
    val_str = str(val).strip()
    if val_str.isdigit():
        return int(val_str)
    try:
        normalized = val_str
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        dt = datetime.fromisoformat(normalized)
        return int(dt.timestamp() * 1000)
    except Exception:
        pass
    return 0


async def list_conversations(user_id: str, limit: int = 500) -> List[Dict[str, Any]]:
    # 1. Fetch group mappings from zalo_groups
    group_rows = await _rest(
        "GET",
        "zalo_groups",
        params={
            "select": (
                "group_id,group_name,avatar_url,unread_count,updated_at,"
                "last_message_at,last_message_content,last_sender_id,"
                "last_sender_name,last_message_type,is_pinned,tag"
            ),
            "user_id": f"eq.{user_id}",
            "order": "is_pinned.desc,last_message_at.desc,updated_at.desc",
            "limit": "5000",
        },
    ) or []

    group_info = {}
    group_name_to_id = {}
    for g in group_rows:
        g_id = str(g.get("group_id") or "").strip()
        g_name = str(g.get("group_name") or "").strip()
        if g_id:
            group_info[g_id] = {
                "avatar_url": g.get("avatar_url"),
                "unread_count": int(g.get("unread_count") or 0),
                "updated_at": g.get("updated_at"),
                "last_message_at": g.get("last_message_at"),
                "last_message_content": g.get("last_message_content"),
                "last_sender_name": g.get("last_sender_name"),
                "last_message_type": g.get("last_message_type"),
                "is_pinned": bool(g.get("is_pinned")),
                "tag": g.get("tag"),
            }
            if g_name:
                group_name_to_id[g_name.lower()] = g_id

    # 2. Fetch up to 1000 recent messages for aggregation (G6: include msg_kind, raw_content, cli_msg_id)
    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "id,user_id,group_id,group_name,sender_name,created_at,timestamp_text,time_text,type,content,msg_kind,raw_content,cli_msg_id,is_sent",
            "user_id": f"eq.{user_id}",
            "is_deleted": "eq.false",
            "order": "created_at.desc",
            "limit": "1000",
        },
    ) or []
    rows = await hydrate_message_groups_from_jobs(user_id, rows)

    # Supplement name-to-id mapping dynamically from recent message rows that have both fields
    for row in rows:
        g_id = str(row.get("group_id") or "").strip()
        g_name = str(row.get("group_name") or "").strip()
        if g_id and g_name:
            group_name_to_id[g_name.lower()] = g_id

    conversations: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        g_id = str(row.get("group_id") or "").strip()
        g_name = str(row.get("group_name") or "").strip()
        
        # Unify by mapping empty group_id using known group name
        if not g_id and g_name:
            g_id = group_name_to_id.get(g_name.lower(), "")
            
        conversation_id = g_id or g_name
        if not conversation_id:
            continue
            
        raw_group_name = g_name
        sender_name = str(row.get("sender_name") or "").strip()
        is_fallback_name = (
            not raw_group_name
            or raw_group_name == conversation_id
            or raw_group_name == f"Conversation {conversation_id}"
            or raw_group_name.lower() in {"markee", "zalo", "user", "dm", "me", "__me__"}
        )
        usable_sender_name = (
            bool(sender_name)
            and not row.get("is_sent")
            and sender_name.lower() not in {"__me__", "me", "ban", "bạn", "markee"}
        )
        conversation_name = (
            sender_name
            if is_fallback_name and usable_sender_name
            else raw_group_name or f"Conversation {conversation_id}"
        )
        current = conversations.setdefault(
            conversation_id,
            {
                "conversation_id": conversation_id,
                "conversation_name": conversation_name,
                "account_id": user_id,
                "message_count": 0,
                "image_count": 0,
                "sent_count": 0,
                "received_count": 0,
                "latest_message_at": None,
                "latest_content": None,
                "latest_sender_name": None,
                "has_messages": True,
                "sync_status": "has_messages",
                "avatar_url": group_info.get(conversation_id, {}).get("avatar_url"),
                "unread_count": group_info.get(conversation_id, {}).get("unread_count", 0),
                "updated_at": group_info.get(conversation_id, {}).get("updated_at"),
                "is_pinned": group_info.get(conversation_id, {}).get("is_pinned", False),
                "tag": group_info.get(conversation_id, {}).get("tag"),
            },
        )
        if is_fallback_name and usable_sender_name:
            current["conversation_name"] = sender_name
        current["message_count"] += 1
        current["image_count"] += sum(
            1 for asset in row.get("assets") or [] if asset.get("status") == "uploaded"
        )
        if row.get("is_sent"):
            current["sent_count"] += 1
        else:
            current["received_count"] += 1
        if not current["latest_message_at"]:
            norm_raw = _normalize_raw_content(row.get("raw_content"))
            resolved_kind = classify_message_kind(
                row.get("type"),
                row.get("content"),
                norm_raw,
                existing_kind=row.get("msg_kind"),
            )
            current["latest_message_at"] = row.get("created_at") or row.get("timestamp_text") or row.get("time_text")
            current["latest_msg_kind"] = resolved_kind
            current["last_message_type"] = row.get("type")
            current["latest_content"] = format_sidebar_last_message_preview(
                row.get("content"),
                msg_type=row.get("type"),
                msg_kind=resolved_kind,
                raw_content=norm_raw,
                is_sent=bool(row.get("is_sent")),
            )
            current["latest_sender_name"] = row.get("sender_name")

    # 3. Add any groups that exist in zalo_groups but have no recent messages in our 3000-message window
    for group in group_rows:
        conversation_id = str(group.get("group_id") or group.get("group_name") or "").strip()
        if not conversation_id or conversation_id in conversations:
            continue
        conversation_name = str(group.get("group_name") or "").strip() or f"Conversation {conversation_id}"
        conversations[conversation_id] = {
            "conversation_id": conversation_id,
            "conversation_name": conversation_name,
            "account_id": user_id,
            "message_count": 0,
            "image_count": 0,
            "sent_count": 0,
            "received_count": 0,
            "latest_message_at": None,
            "latest_content": None,
            "latest_sender_name": None,
            "has_messages": False,
            "sync_status": "known_empty",
            "avatar_url": group.get("avatar_url"),
            "unread_count": int(group.get("unread_count") or 0),
            "updated_at": group.get("updated_at"),
            "is_pinned": bool(group.get("is_pinned")),
            "tag": group.get("tag"),
        }

    # 4. Overlay metadata chính xác từ zalo_groups (last_message_at thật của tin nhắn).
    #    Cột này được listener cập nhật realtime nên là nguồn tin cậy nhất cho preview + sort.
    for conversation_id, info in group_info.items():
        conv = conversations.get(conversation_id)
        if not conv:
            continue
        group_last_at = info.get("last_message_at")
        if group_last_at and _parse_to_millis(group_last_at) >= _parse_to_millis(conv.get("latest_message_at")):
            conv["latest_message_at"] = group_last_at
            overlay_preview = format_sidebar_last_message_preview(
                info.get("last_message_content"),
                msg_type=info.get("last_message_type"),
                msg_kind=conv.get("latest_msg_kind"),
            )
            if overlay_preview:
                conv["latest_content"] = overlay_preview
            if info.get("last_sender_name"):
                conv["latest_sender_name"] = info.get("last_sender_name")
            if info.get("last_message_type"):
                conv["last_message_type"] = info.get("last_message_type")
        conv["is_pinned"] = info.get("is_pinned", conv.get("is_pinned", False))
        if info.get("tag"):
            conv["tag"] = info.get("tag")

    def _sort_key(item: Dict[str, Any]):
        real_ms = _parse_to_millis(item.get("latest_message_at"))
        return (
            1 if item.get("is_pinned") else 0,
            # Group có tin nhắn thật luôn xếp trên group rỗng (chỉ có updated_at).
            1 if real_ms > 0 else 0,
            real_ms or _parse_to_millis(item.get("updated_at")),
            str(item.get("conversation_name") or "").lower(),
        )

    return sorted(conversations.values(), key=_sort_key, reverse=True)


def _message_sort_millis(row: Dict[str, Any]) -> int:
    return (
        _parse_to_millis(row.get("timestamp_text"))
        or _parse_to_millis(row.get("time_text"))
        or _parse_to_millis(row.get("created_at"))
    )


def _sort_messages_oldest_first(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            _message_sort_millis(row),
            str(row.get("source_message_id") or row.get("id") or ""),
        ),
    )


async def list_conversation_messages(
    user_id: str,
    conversation_id: str,
    limit: int = 100,
    offset: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    if not is_supabase_configured():
        return [], 0

    safe_limit = max(1, min(limit, 500))
    safe_offset = max(0, offset)

    try:
        rpc_result = await _rest(
            "POST",
            "rpc/fn_get_zalo_conversation_messages",
            json={
                "p_user_id": user_id,
                "p_conversation_id": conversation_id,
                "p_limit": safe_limit,
                "p_offset": safe_offset,
            }
        )
        if not rpc_result or not isinstance(rpc_result, list) or len(rpc_result) == 0:
            return [], 0
            
        data = rpc_result[0]
        messages_list = data.get("messages_json") or []
        total_count = int(data.get("total_count") or 0)
        
        hydrated_rows = await hydrate_message_groups_from_jobs(user_id, messages_list)
        normalized_rows = [_normalize_message_row(row) for row in hydrated_rows]
        return _sort_messages_oldest_first(normalized_rows), total_count
    except Exception as exc:
        logger.info(f"fn_get_zalo_conversation_messages RPC failed: {exc}. Falling back to manual queries...")
        return await _list_conversation_messages_fallback(user_id, conversation_id, limit, offset)


async def _list_conversation_messages_fallback(
    user_id: str,
    conversation_id: str,
    limit: int = 100,
    offset: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    safe_limit = max(1, min(limit, 500))
    safe_offset = max(0, offset)

    # Resolve group_id and group_name mappings from zalo_groups
    resolved_group_id = None
    resolved_group_name = None

    is_numeric_id = conversation_id.isdigit() or (conversation_id.startswith("-") and conversation_id[1:].isdigit())

    # Conversation ID có thể ở 3 dạng:
    #   1) group_id Zalo (vd "g123456789" hoặc số user id)
    #   2) group_name thuần (vd "Hội nhóm bán hàng")
    #   3) UUID / chuỗi bất kỳ (crawl job, friend thread)
    # Ta cần thử cả 3 cách resolve để tìm được messages đã lưu.
    mapping_rows: List[Dict[str, Any]] = []
    if is_numeric_id:
        try:
            mapping_rows = await _rest(
                "GET",
                "zalo_groups",
                params={
                    "select": "group_id,group_name",
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{conversation_id}",
                }
            ) or []
        except Exception as exc:
            logger.warning(f"Failed to fetch zalo_groups mapping by id in messages view: {exc}")
    else:
        # Có thể conversation_id chính là group_id kiểu "gXXXX" — tra theo group_id trước
        # vì zalo_groups.group_id là khóa chính tra cứu nhanh nhất.
        try:
            mapping_rows = await _rest(
                "GET",
                "zalo_groups",
                params={
                    "select": "group_id,group_name",
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{conversation_id}",
                }
            ) or []
        except Exception as exc:
            logger.warning(f"Failed to fetch zalo_groups mapping by id (non-numeric) in messages view: {exc}")

        # Nếu chưa thấy, thử match theo group_name
        if not mapping_rows:
            try:
                mapping_rows = await _rest(
                    "GET",
                    "zalo_groups",
                    params={
                        "select": "group_id,group_name",
                        "user_id": f"eq.{user_id}",
                        "group_name": f"eq.{conversation_id}",
                    }
                ) or []
            except Exception as exc:
                logger.warning(f"Failed to fetch zalo_groups mapping by name in messages view: {exc}")

    if mapping_rows:
        resolved_group_id = mapping_rows[0].get("group_id")
        resolved_group_name = mapping_rows[0].get("group_name")

    # Fallback scan messages if not found in mapping
    if not resolved_group_id or not resolved_group_name:
        try:
            if is_numeric_id:
                msg_rows = await _rest(
                    "GET",
                    "zalo_messages",
                    params={
                        "select": "group_name",
                        "user_id": f"eq.{user_id}",
                        "group_id": f"eq.{conversation_id}",
                        "limit": "1",
                    }
                ) or []
                if msg_rows and msg_rows[0].get("group_name"):
                    resolved_group_id = conversation_id
                    resolved_group_name = msg_rows[0].get("group_name")
            else:
                # Ưu tiên tra messages theo group_id trước (covers "gXXXX" Zalo group ids)
                msg_rows = await _rest(
                    "GET",
                    "zalo_messages",
                    params={
                        "select": "group_name",
                        "user_id": f"eq.{user_id}",
                        "group_id": f"eq.{conversation_id}",
                        "limit": "1",
                    }
                ) or []
                if msg_rows and msg_rows[0].get("group_name"):
                    resolved_group_id = conversation_id
                    resolved_group_name = msg_rows[0].get("group_name")
                else:
                    # Cuối cùng mới thử match theo group_name
                    msg_rows = await _rest(
                        "GET",
                        "zalo_messages",
                        params={
                            "select": "group_id",
                            "user_id": f"eq.{user_id}",
                            "group_name": f"eq.{conversation_id}",
                            "group_id": "not.is.null",
                            "limit": "1",
                        }
                    ) or []
                    if msg_rows and msg_rows[0].get("group_id"):
                        resolved_group_id = msg_rows[0].get("group_id")
                        resolved_group_name = conversation_id
        except Exception as exc:
            logger.warning(f"Failed to scan zalo_messages mapping in messages view: {exc}")

    if not resolved_group_id and is_numeric_id:
        resolved_group_id = conversation_id
    if not resolved_group_name and not is_numeric_id:
        resolved_group_name = conversation_id

    # Final defensive fallback: nếu vẫn không resolve được gì cả, thử dùng cả group_id và group_name
    # khi query messages. Điều này tránh trả về rỗng khi mapping bị thiếu nhưng messages đã được lưu.
    if not resolved_group_id and not resolved_group_name:
        # Trường hợp hiếm: dùng conversation_id nguyên bản cho cả 2 phía
        resolved_group_id = conversation_id
        resolved_group_name = conversation_id

    # Query messages using or-filter to aggregate both group_id and group_name
    query_params = {
        "select": "*,assets:zalo_message_assets(*)",
        "user_id": f"eq.{user_id}",
        "is_deleted": "eq.false",
        "order": "timestamp_text.desc",
        "limit": str(safe_limit),
        "offset": str(safe_offset),
    }

    if resolved_group_id:
        query_params["group_id"] = f"eq.{resolved_group_id}"
    elif resolved_group_name:
        query_params["group_name"] = f"eq.{resolved_group_name}"
    else:
        # Fallback to conversation_id if somehow both are empty
        query_params["group_id"] = f"eq.{conversation_id}"

    rows, total = await _rest_with_count("zalo_messages", params=query_params)
    hydrated_rows = await hydrate_message_groups_from_jobs(user_id, rows or [])
    normalized_rows = [_normalize_message_row(row) for row in hydrated_rows]
    return _sort_messages_oldest_first(normalized_rows), total


async def search_conversation_messages(
    user_id: str,
    conversation_id: str,
    keyword: str,
    *,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Tìm tin nhắn cũ chứa `keyword` (không phân hoa/thường) TRONG 1 hội
    thoại cụ thể (1 người hoặc 1 nhóm) — vd tìm "Leo" trong nhóm KẾ TOÁN -
    VẬN HÀNH DENFOOD. ILIKE trên `content`, luôn kèm user_id+group_id nên
    chỉ scan trong đúng hội thoại đó (đã có index idx_zalo_messages_lookup
    trên (user_id, group_id, source_message_id) làm hẹp phạm vi trước khi
    ILIKE, không cần thêm index full-text riêng).
    """
    if not is_supabase_configured():
        return []
    safe_limit = max(1, min(limit, 200))
    # Escape ký tự đặc biệt của ILIKE ("%", "_") để tìm ĐÚNG chuỗi người dùng
    # nhập, không bị hiểu nhầm thành wildcard (vd tìm "50%" không match mọi
    # nội dung dài >= 1 ký tự vì "%" là wildcard trần trong ILIKE).
    escaped = keyword.strip().replace("%", "\\%").replace("_", "\\_")
    if not escaped:
        return []
    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "id,source_message_id,sender_id,sender_name,content,timestamp_text,time_text,type,msg_kind,raw_content,cli_msg_id,is_sent,created_at,reply_to_id",
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{conversation_id}",
            "is_deleted": "eq.false",
            "content": f"ilike.*{escaped}*",
            "order": "timestamp_text.desc,created_at.desc",
            "limit": str(safe_limit),
        },
    ) or []
    return [_normalize_message_row(row) for row in rows]


def group_summaries_from_message_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups_by_name: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        group_name = str(row.get("group_name") or "").strip()
        if not group_name:
            continue
        key = group_name.lower()
        item = groups_by_name.setdefault(
            key,
            {
                "group_name": group_name,
                "sheet_tab": group_name,
                "message_count": 0,
                "image_count": 0,
                "latest_message_at": row.get("created_at"),
            },
        )
        item["message_count"] += 1
        item["image_count"] += sum(
            1 for asset in row.get("assets") or [] if asset.get("status") == "uploaded"
        )
        if not item.get("latest_message_at"):
            item["latest_message_at"] = row.get("created_at")
    return list(groups_by_name.values())


def _group_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _merge_group_summary(
    groups_by_name: Dict[str, Dict[str, Any]],
    *,
    group_name: str,
    message_count: int = 0,
    image_count: int = 0,
    latest_message_at: Any = None,
    prefer_counts: bool = False,
) -> None:
    clean_name = str(group_name or "").strip()
    if not clean_name:
        return
    key = _group_key(clean_name)
    current = groups_by_name.setdefault(
        key,
        {
            "group_name": clean_name,
            "sheet_tab": clean_name,
            "message_count": 0,
            "image_count": 0,
            "latest_message_at": latest_message_at,
        },
    )
    if prefer_counts:
        current["message_count"] = max(int(current.get("message_count") or 0), int(message_count or 0))
        current["image_count"] = max(int(current.get("image_count") or 0), int(image_count or 0))
    else:
        current["message_count"] = int(current.get("message_count") or 0) + int(message_count or 0)
        current["image_count"] = int(current.get("image_count") or 0) + int(image_count or 0)
    if latest_message_at and not current.get("latest_message_at"):
        current["latest_message_at"] = latest_message_at


async def hydrate_message_groups_from_jobs(
    user_id: str,
    rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    missing_job_ids = sorted(
        {
            str(row.get("job_id") or "").strip()
            for row in rows
            if not str(row.get("group_name") or "").strip() and str(row.get("job_id") or "").strip()
        }
    )
    if not missing_job_ids:
        return rows

    quoted_job_ids = ",".join(f'"{job_id}"' for job_id in missing_job_ids)
    job_rows = await _rest(
        "GET",
        "zalo_crawl_jobs",
        params={
            "select": "job_id,group_id,group_name",
            "user_id": f"eq.{user_id}",
            "job_id": f"in.({quoted_job_ids})",
        },
    ) or []
    jobs_by_id = {
        str(job.get("job_id") or ""): job
        for job in job_rows
        if str(job.get("job_id") or "")
    }
    if not jobs_by_id:
        return rows

    hydrated: List[Dict[str, Any]] = []
    for row in rows:
        next_row = dict(row)
        if not str(next_row.get("group_name") or "").strip():
            job = jobs_by_id.get(str(next_row.get("job_id") or ""))
            if job:
                next_row["group_name"] = job.get("group_name") or next_row.get("group_name")
                next_row["group_id"] = next_row.get("group_id") or job.get("group_id")
        hydrated.append(next_row)
    return hydrated


async def list_library_group_summaries(user_id: str = "default") -> List[Dict[str, Any]]:
    groups_by_name: Dict[str, Dict[str, Any]] = {}

    job_rows = await _rest(
        "GET",
        "zalo_crawl_jobs",
        params={
            "select": "group_name,messages_collected,images_found,completed_at,updated_at,started_at",
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "limit": "10000",
        },
    ) or []
    for job in job_rows:
        latest_at = job.get("completed_at") or job.get("updated_at") or job.get("started_at")
        _merge_group_summary(
            groups_by_name,
            group_name=str(job.get("group_name") or ""),
            message_count=int(job.get("messages_collected") or 0),
            image_count=int(job.get("images_found") or 0),
            latest_message_at=latest_at,
            prefer_counts=False,
        )

    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "job_id,group_id,group_name,created_at,assets:zalo_message_assets(status)",
            "user_id": f"eq.{user_id}",
            "is_deleted": "eq.false",
            "order": "created_at.desc",
            "limit": "10000",
        },
    ) or []
    rows = await hydrate_message_groups_from_jobs(user_id, rows)
    message_groups = group_summaries_from_message_rows(rows)
    for group in message_groups:
        _merge_group_summary(
            groups_by_name,
            group_name=str(group.get("group_name") or ""),
            message_count=int(group.get("message_count") or 0),
            image_count=int(group.get("image_count") or 0),
            latest_message_at=group.get("latest_message_at"),
            prefer_counts=True,
        )
    return sorted(
        groups_by_name.values(),
        key=lambda item: str(item.get("latest_message_at") or ""),
        reverse=True,
    )


async def _message_group_counts(user_id: str = "default") -> Dict[str, Dict[str, Any]]:
    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "job_id,group_id,group_name,created_at,assets:zalo_message_assets(status)",
            "user_id": f"eq.{user_id}",
            "is_deleted": "eq.false",
            "order": "created_at.desc",
            "limit": "10000",
        },
    ) or []
    rows = await hydrate_message_groups_from_jobs(user_id, rows)
    return {
        _group_key(group.get("group_name")): group
        for group in group_summaries_from_message_rows(rows)
        if _group_key(group.get("group_name"))
    }


async def list_saved_groups(user_id: str = "default") -> List[Dict[str, Any]]:
    groups_by_name: Dict[str, Dict[str, Any]] = {}
    job_rows = await _rest(
        "GET",
        "zalo_crawl_jobs",
        params={
            "select": "group_name,messages_collected,images_found,completed_at,updated_at,started_at",
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "limit": "10000",
        },
    ) or []
    for job in job_rows:
        latest_at = job.get("completed_at") or job.get("updated_at") or job.get("started_at")
        _merge_group_summary(
            groups_by_name,
            group_name=str(job.get("group_name") or ""),
            message_count=int(job.get("messages_collected") or 0),
            image_count=int(job.get("images_found") or 0),
            latest_message_at=latest_at,
        )

    for group in (await _message_group_counts(user_id)).values():
        _merge_group_summary(
            groups_by_name,
            group_name=str(group.get("group_name") or ""),
            message_count=int(group.get("message_count") or 0),
            image_count=int(group.get("image_count") or 0),
            latest_message_at=group.get("latest_message_at"),
            prefer_counts=True,
        )

    return sorted(
        groups_by_name.values(),
        key=lambda item: str(item.get("latest_message_at") or ""),
        reverse=True,
    )


async def cleanup_expired_assets(retention_days: int, limit: int) -> Dict[str, Any]:
    cutoff = datetime.utcnow() - timedelta(days=max(1, retention_days))
    batch_limit = max(1, min(limit, 1000))
    rows = await _rest(
        "GET",
        "zalo_message_assets",
        params={
            "select": "id,storage_path,storage_url,status,created_at",
            "status": "eq.uploaded",
            "storage_path": "not.is.null",
            "created_at": f"lt.{cutoff.isoformat()}",
            "order": "created_at.asc",
            "limit": str(batch_limit),
        },
    ) or []

    deleted = 0
    expired = 0
    failed: List[Dict[str, Any]] = []

    for row in rows:
        asset_id = row.get("id")
        storage_path = row.get("storage_path")
        if not asset_id:
            continue
        try:
            if storage_path:
                await delete_storage_objects([storage_path])
                deleted += 1
            await _rest(
                "PATCH",
                "zalo_message_assets",
                params={"id": f"eq.{asset_id}"},
                json={
                    "status": "expired",
                    "storage_path": None,
                    "storage_url": None,
                    "error": None,
                    "updated_at": datetime.utcnow().isoformat(),
                },
            )
            expired += 1
        except Exception as exc:
            logger.warning(f"Could not cleanup Zalo asset {asset_id}: {exc}")
            failed.append({"id": asset_id, "storage_path": storage_path, "error": str(exc)})

    return {
        "cutoff": cutoff.isoformat(),
        "scanned": len(rows),
        "deleted_storage_objects": deleted,
        "expired_assets": expired,
        "failed": failed,
    }


async def fetch_messages_by_ids(
    user_id: str,
    message_ids: List[str],
    *,
    include_deleted: bool = False,
) -> List[Dict[str, Any]]:
    if not message_ids:
        return []
    
    import re
    # UUID pattern: 8-4-4-4-12 hex chars
    uuid_pattern = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.I)
    uuid_ids = [mid for mid in message_ids if uuid_pattern.match(mid)]
    source_ids = [mid for mid in message_ids if not uuid_pattern.match(mid)]
    
    or_filters = []
    if uuid_ids:
        or_filters.append(f"id.in.({','.join(uuid_ids)})")
    if source_ids:
        or_filters.append(f"source_message_id.in.({','.join(source_ids)})")
        
    if not or_filters:
        return []

    params = {
        "select": "*,assets:zalo_message_assets(*)",
        "user_id": f"eq.{user_id}",
        "or": f"({','.join(or_filters)})",
    }
    if not include_deleted:
        params["is_deleted"] = "eq.false"
    return await _rest(
        "GET",
        "zalo_messages",
        params=params,
    ) or []


async def create_library_message(user_id: str, payload: Dict[str, Any], asset_urls: List[str]) -> Dict[str, Any]:
    rows = await _rest(
        "POST",
        "zalo_messages",
        json=[
            {
                "user_id": user_id,
                "group_name": payload.get("group_name"),
                "sender_name": payload.get("sender_name"),
                "time_text": payload.get("time_text"),
                "type": payload.get("type") or "text",
                "content": payload.get("content"),
                "source_message_id": f"manual-{uuid.uuid4()}",
            }
        ],
        prefer="return=representation",
    )
    row = rows[0]
    await save_message_assets(row["id"], user_id, None, asset_urls)
    return (await fetch_messages_by_ids(user_id, [row["id"]]))[0]


async def update_library_message(user_id: str, message_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = {key: value for key, value in payload.items() if value is not None}
    payload["updated_at"] = datetime.utcnow().isoformat()
    include_deleted = payload.get("is_deleted") is True
    
    import re
    uuid_pattern = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.I)
    id_field = "id" if uuid_pattern.match(message_id) else "source_message_id"
    
    rows = await _rest(
        "PATCH",
        "zalo_messages",
        params={id_field: f"eq.{message_id}", "user_id": f"eq.{user_id}"},
        json=payload,
        prefer="return=representation",
    )
    if not rows:
        raise KeyError(message_id)
    fetched = await fetch_messages_by_ids(user_id, [message_id], include_deleted=include_deleted)
    return fetched[0] if fetched else rows[0]


async def bulk_delete_library_messages(
    user_id: str,
    *,
    message_ids: Optional[List[str]] = None,
    group_name: Optional[str] = None,
    delete_all_matching: bool = False,
) -> int:
    payload = {"is_deleted": True, "updated_at": datetime.utcnow().isoformat()}
    params: Dict[str, Any] = {"user_id": f"eq.{user_id}", "is_deleted": "eq.false"}
    ids = [message_id for message_id in (message_ids or []) if message_id]
    if delete_all_matching:
        if group_name:
            params["group_name"] = f"ilike.*{group_name}*"
    else:
        if not ids:
            return 0
        params["id"] = f"in.({','.join(ids)})"

    rows = await _rest(
        "PATCH",
        "zalo_messages",
        params=params,
        json=payload,
        prefer="return=representation",
    )
    return len(rows or [])


async def create_broadcast_campaign(
    user_id: str,
    content_mode: str,
    message_ids: List[str],
    targets: List[Dict[str, Any]],
) -> str:
    campaign_id = str(uuid.uuid4())
    await _rest(
        "POST",
        "zalo_broadcast_campaigns",
        json=[
            {
                "id": campaign_id,
                "user_id": user_id,
                "status": "queued",
                "content_mode": content_mode,
                "message_count": len(message_ids),
                "target_count": len(targets),
            }
        ],
    )
    if targets:
        await _rest(
            "POST",
            "zalo_broadcast_targets",
            json=[
                {
                    "campaign_id": campaign_id,
                    "group_id": target.get("group_id"),
                    "group_name": target["group_name"],
                    "status": "queued",
                }
                for target in targets
            ],
        )
    if message_ids:
        await _rest(
            "POST",
            "zalo_broadcast_items",
            json=[
                {
                    "campaign_id": campaign_id,
                    "message_id": message_id,
                    "position": index,
                    "status": "queued",
                }
                for index, message_id in enumerate(message_ids)
            ],
        )
    return campaign_id


async def update_campaign_status(campaign_id: str, status: str, error: Optional[str] = None) -> None:
    payload: Dict[str, Any] = {"status": status, "updated_at": datetime.utcnow().isoformat()}
    if status in {"completed", "failed"}:
        payload["completed_at"] = datetime.utcnow().isoformat()
    if error:
        payload["error"] = error
    await _rest("PATCH", "zalo_broadcast_campaigns", params={"id": f"eq.{campaign_id}"}, json=payload)


async def add_broadcast_log(
    campaign_id: str,
    group_name: str,
    status: str,
    detail: Optional[str] = None,
    message_id: Optional[str] = None,
) -> None:
    await _rest(
        "POST",
        "zalo_broadcast_logs",
        json=[
            {
                "campaign_id": campaign_id,
                "group_name": group_name,
                "message_id": message_id,
                "status": status,
                "detail": detail,
            }
        ],
    )


async def get_broadcast_status(campaign_id: str) -> Dict[str, Any]:
    campaigns = await _rest("GET", "zalo_broadcast_campaigns", params={"id": f"eq.{campaign_id}"}) or []
    if not campaigns:
        raise KeyError(campaign_id)
    targets = await _rest("GET", "zalo_broadcast_targets", params={"campaign_id": f"eq.{campaign_id}", "order": "created_at.asc"}) or []
    items = await _rest("GET", "zalo_broadcast_items", params={"campaign_id": f"eq.{campaign_id}", "order": "position.asc"}) or []
    logs = await _rest("GET", "zalo_broadcast_logs", params={"campaign_id": f"eq.{campaign_id}", "order": "created_at.asc"}) or []
    return {"campaign": campaigns[0], "targets": targets, "items": items, "logs": logs}


async def mark_conversation_as_read(user_id: str, group_id: str) -> None:
    if not is_supabase_configured():
        return
    await _rest(
        "PATCH",
        "zalo_groups",
        params={
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{group_id}",
        },
        json={
            "unread_count": 0,
            "updated_at": datetime.utcnow().isoformat(),
        },
    )


async def set_zalo_message_reaction(
    user_id: str,
    group_id: str,
    source_message_id: str,
    reactor_uid: str,
    icon: Optional[str],
) -> Dict[str, str]:
    """Thả/đổi/bỏ cảm xúc cho 1 tin — mỗi người chỉ có 1 icon/tin (giống Zalo
    thật, đổi thì thay icon cũ). `icon=None` để bỏ reaction.

    Cột `reactions` (migration 138) chưa có RPC merge riêng — tự GET rồi PATCH
    lại nguyên cột (không atomic, nhưng đây không phải dữ liệu cần ACID chặt:
    2 reaction cùng lúc trên cùng 1 tin, tệ nhất 1 cái bị đè, tự "sửa" ở lần
    react tiếp theo). Nếu cột `reactions` chưa tồn tại (chưa áp migration 138),
    _rest sẽ raise — caller (route) tự bắt và coi là "chưa hỗ trợ lưu", không
    chặn việc GỬI reaction thật lên Zalo.

    Trả về map reactions MỚI (sau khi merge) để caller trả thẳng cho FE, khỏi
    phải GET lại.
    """
    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "id,reactions",
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{group_id}",
            "source_message_id": f"eq.{source_message_id}",
            "limit": "1",
        },
    ) or []
    if not rows:
        raise RuntimeError(f"Message not found: {source_message_id}")

    current = dict(rows[0].get("reactions") or {})
    if icon:
        current[reactor_uid] = icon
    else:
        current.pop(reactor_uid, None)

    await _rest(
        "PATCH",
        "zalo_messages",
        params={
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{group_id}",
            "source_message_id": f"eq.{source_message_id}",
        },
        json={"reactions": current, "updated_at": datetime.utcnow().isoformat()},
    )
    return current


# ── Zalo tập trung: RBAC theo tài khoản (zalo_account_assignments) ──────────
# Thay cho "staff_zalo_assignments" của ZALO_CENTRALIZED_MODULE_GUIDE.md —
# khoá theo app_users.id vì dùng chung SSO app chính, không có bảng staff riêng.

async def list_account_assignments(account_id: str) -> List[Dict[str, Any]]:
    if not is_supabase_configured():
        return []
    return await _rest(
        "GET",
        "zalo_account_assignments",
        params={"account_id": f"eq.{account_id}", "select": "*", "order": "created_at.asc"},
    ) or []


async def upsert_account_assignment(
    account_id: str,
    app_user_id: str,
    *,
    can_view: bool = True,
    can_send: bool = False,
    can_broadcast: bool = False,
) -> Dict[str, Any]:
    if not is_supabase_configured():
        raise SupabaseNotConfigured("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    now = datetime.utcnow().isoformat()
    result = await _rest(
        "POST",
        "zalo_account_assignments",
        params={"on_conflict": "app_user_id,account_id"},
        json={
            "account_id": account_id,
            "app_user_id": app_user_id,
            "can_view": can_view,
            "can_send": can_send,
            "can_broadcast": can_broadcast,
            "updated_at": now,
        },
        prefer="resolution=merge-duplicates,return=representation",
    )
    return (result or [{}])[0] if isinstance(result, list) else (result or {})


async def delete_account_assignment(account_id: str, app_user_id: str) -> None:
    if not is_supabase_configured():
        return
    await _rest(
        "DELETE",
        "zalo_account_assignments",
        params={"account_id": f"eq.{account_id}", "app_user_id": f"eq.{app_user_id}"},
    )


# ----------------------------------------------------------------------------
# G1 & G7: System event (friend_event / group_event) & message recall (undo)
# ----------------------------------------------------------------------------

async def persist_zalo_system_event(
    user_id: str,
    group_id: str,
    group_name: str,
    event_msg: Message,
) -> int:
    """Persist a normalized friend.event or group.event system notice into zalo_messages."""
    if not is_supabase_configured():
        return 0
    if not group_id or not event_msg.message_id:
        return 0

    norm_raw = _normalize_raw_content(event_msg.raw_content) or {}
    normalized_msg = event_msg.model_copy(
        update={
            "msg_kind": "system_notice",
            "raw_content": norm_raw,
            "is_deleted": False,
        }
    )

    saved = await save_listener_messages(
        user_id,
        group_id,
        group_name or group_id,
        [normalized_msg],
        increment_unread=False,
    )

    # Best-effort side-effect metadata sync on zalo_groups (never fail event persistence)
    try:
        act = str(norm_raw.get("act") or "").strip().lower()
        if event_msg.type == "friend.event" and act == "add":
            await upsert_group(
                user_id=user_id,
                group_id=group_id,
                group_name=group_name or group_id,
                is_friend=True,
                thread_type="direct",
            )
        elif event_msg.type == "group.event" and act == "update":
            ev_data = norm_raw.get("data") if isinstance(norm_raw.get("data"), dict) else {}
            new_group_name = str(ev_data.get("groupName") or "").strip()
            if new_group_name:
                await upsert_group(
                    user_id=user_id,
                    group_id=group_id,
                    group_name=new_group_name,
                    thread_type="group",
                )
    except Exception as exc:
        logger.debug(f"Could not sync group metadata for system event ({event_msg.type}): {exc}")

    return saved


async def mark_zalo_message_recalled(
    user_id: str,
    group_id: Optional[str],
    *,
    source_message_id: Optional[str] = None,
    cli_msg_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Mark matching message(s) in zalo_messages as recalled (`is_deleted=True`, `msg_kind='undo'`)."""
    if not is_supabase_configured():
        return None
    src_id = (str(source_message_id).strip() if source_message_id is not None else "") or None
    cli_id = (str(cli_msg_id).strip() if cli_msg_id is not None else "") or None
    gid = (str(group_id).strip() if group_id is not None else "") or None
    if not src_id and not cli_id:
        return None

    patch_body = {
        "is_deleted": True,
        "msg_kind": "undo",
        "updated_at": datetime.utcnow().isoformat(),
    }

    attempts: List[Dict[str, str]] = []
    if src_id and gid:
        attempts.append({"user_id": f"eq.{user_id}", "group_id": f"eq.{gid}", "source_message_id": f"eq.{src_id}"})
    if cli_id and gid:
        attempts.append({"user_id": f"eq.{user_id}", "group_id": f"eq.{gid}", "cli_msg_id": f"eq.{cli_id}"})
    if src_id:
        attempts.append({"user_id": f"eq.{user_id}", "source_message_id": f"eq.{src_id}"})
    if cli_id:
        attempts.append({"user_id": f"eq.{user_id}", "cli_msg_id": f"eq.{cli_id}"})

    for params in attempts:
        try:
            rows = await _rest(
                "PATCH",
                "zalo_messages",
                params=params,
                json=patch_body,
                prefer="return=representation",
            ) or []
            if rows and isinstance(rows, list):
                row = rows[0]
                return {
                    "id": row.get("id"),
                    "group_id": row.get("group_id") or gid,
                    "source_message_id": row.get("source_message_id") or src_id,
                    "cli_msg_id": row.get("cli_msg_id") or cli_id,
                    "updated_count": len(rows),
                }
        except Exception as exc:
            logger.debug(f"mark_zalo_message_recalled attempt failed ({params}): {exc}")
    return None


