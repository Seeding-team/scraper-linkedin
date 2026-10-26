"""Loại hợp đồng: AI/luật TỰ ĐỀ XUẤT + người dùng nhập TỰ DO (không giới hạn danh sách cố định).

* Lưu trong cột `contracts.template_type` (TEXT, không có CHECK): giá trị có thể là khoá cũ ('service'/'principle'/'marketing') hoặc NHÃN tự do
  ('Hợp đồng cung cấp thiết bị'). `legacy_key()` map nhãn về khoá nghiệp vụ cũ khi cần (không làm hỏng phân loại ghi nhận / mua vào / bán ra,
  vốn nằm ở `deal_phase`, không phải ở đây).
* Đề xuất = (1) luật từ khoá trên tên/mô tả hạng mục báo giá, yêu cầu của Sale, tên mẫu; (2) AI xác nhận/bổ sung (nếu AI lỗi vẫn trả kết quả luật,
  ghi rõ nguồn). Độ tin cậy thấp => needsConfirmation=true: UI bắt người dùng chọn/nhập, không đoán chắc.
* Loại người dùng đã xác nhận KHÔNG bao giờ bị hệ thống tự đổi (caller chỉ ghi khi người dùng xác nhận).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

KNOWN_TYPES: list[dict[str, Any]] = [
    {"label": "Hợp đồng cung cấp dịch vụ CNTT", "legacy": "service", "keywords": ["dich vu cntt", "he thong", "van hanh", "hosting", "cloud", "server", "ha tang", "ung dung", "website", "vps", "bao mat", "an ninh mang"]},
    {"label": "Hợp đồng triển khai phần mềm", "legacy": "service", "keywords": ["trien khai phan mem", "cai dat phan mem", "tich hop", "trien khai he thong", "go-live", "cai dat", "dao tao su dung"]},
    {"label": "Hợp đồng phát triển phần mềm", "legacy": "service", "keywords": ["phat trien phan mem", "lap trinh", "thiet ke phan mem", "app mobile", "phat trien ung dung", "outsourcing", "viet phan mem", "api", "module"]},
    {"label": "Hợp đồng bảo trì hệ thống", "legacy": "service", "keywords": ["bao tri", "ho tro ky thuat", "maintenance", "sla", "van hanh va bao tri", "bao duong"]},
    {"label": "Hợp đồng cung cấp thiết bị", "legacy": "service", "keywords": ["thiet bi", "kiosk", "may in", "man hinh", "may chu", "linh kien", "phan cung", "bo thiet bi", "camera", "router", "may tinh", "mua ban"]},
    {"label": "Hợp đồng tư vấn", "legacy": "service", "keywords": ["tu van", "khao sat", "danh gia", "lap ke hoach", "chien luoc", "consulting"]},
    {"label": "Hợp đồng dịch vụ Marketing", "legacy": "marketing", "keywords": ["marketing", "quang cao", "fanpage", "seo", "thuong hieu", "truyen thong", "noi dung", "chien dich", "tiep thi", "branding", "booking kol", "content"]},
    {"label": "Hợp đồng nguyên tắc", "legacy": "principle", "keywords": ["nguyen tac", "khung", "framework", "hop dong khung"]},
    {"label": "Hợp đồng hợp tác kinh doanh", "legacy": "principle", "keywords": ["hop tac kinh doanh", "dai ly", "phan phoi", "chia se doanh thu", "lien doanh", "hop tac"]},
]
LEGACY_LABELS = {"service": "Hợp đồng cung cấp dịch vụ CNTT", "principle": "Hợp đồng nguyên tắc", "marketing": "Hợp đồng dịch vụ Marketing"}


def _fold(text: str) -> str:
    t = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    return re.sub(r"[̀-ͯ]", "", t)


def display_label(value: str | None) -> str:
    """Khoá cũ -> nhãn tiếng Việt; nhãn tự do giữ nguyên."""
    v = (value or "").strip()
    return LEGACY_LABELS.get(v, v) or LEGACY_LABELS["service"]


def legacy_key(value: str | None) -> str:
    """Nhãn tự do -> khoá nghiệp vụ cũ (service/principle/marketing) để các luồng cũ vẫn hiểu; không khớp => 'service'."""
    v = (value or "").strip()
    if v in LEGACY_LABELS:
        return v
    folded = _fold(v)
    for t in KNOWN_TYPES:
        if _fold(t["label"]) == folded:
            return t["legacy"]
    for t in KNOWN_TYPES:
        if any(k in folded for k in t["keywords"]):
            return t["legacy"]
    return "service"


def normalize_label(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())[:120]


def score_types(text_parts: list[str]) -> list[dict[str, Any]]:
    """Điểm khớp từ khoá cho từng loại. Trọng số: hạng mục/báo giá 1, yêu cầu Sale 2 (người dùng nói rõ nhất), tên mẫu 2."""
    scored = []
    folded_parts = [_fold(p) for p in text_parts]
    weights = [1.0, 2.0, 2.0][: len(folded_parts)] + [1.0] * max(0, len(folded_parts) - 3)
    for t in KNOWN_TYPES:
        s = 0.0
        hits: list[str] = []
        for fp, w in zip(folded_parts, weights):
            for kw in t["keywords"]:
                if kw in fp:
                    s += w
                    if kw not in hits:
                        hits.append(kw)
        scored.append({"label": t["label"], "legacy": t["legacy"], "score": s, "hits": hits})
    return sorted(scored, key=lambda x: -x["score"])


def rule_suggestion(quote: dict | None, extra_prompt: str | None, template_name: str | None) -> dict[str, Any]:
    items = (quote or {}).get("items") or []
    item_text = " ".join(f"{i.get('description') or ''} {i.get('serviceDescription') or ''}" for i in items if i.get("rowType") != "section")
    ranked = score_types([item_text, extra_prompt or "", template_name or ""])
    top = ranked[0] if ranked else None
    if not top or top["score"] <= 0:
        return {"label": None, "confidence": 0.0, "reason": "Không đủ dữ liệu (hạng mục/yêu cầu/mẫu) để đề xuất loại hợp đồng.", "alternatives": [], "source": "rules"}
    second = ranked[1]["score"] if len(ranked) > 1 else 0.0
    margin = (top["score"] - second) / top["score"]
    confidence = round(min(0.95, 0.35 + 0.1 * min(top["score"], 5) + 0.3 * margin), 2)
    return {"label": top["label"], "confidence": confidence, "reason": "Khớp từ khoá: " + ", ".join(top["hits"][:6]),
            "alternatives": [r["label"] for r in ranked[1:4] if r["score"] > 0], "source": "rules"}


CONFIDENCE_THRESHOLD = 0.6


def finalize(suggestion: dict[str, Any]) -> dict[str, Any]:
    out = dict(suggestion)
    out["needsConfirmation"] = (not out.get("label")) or float(out.get("confidence") or 0) < CONFIDENCE_THRESHOLD
    out["legacyKey"] = legacy_key(out.get("label")) if out.get("label") else None
    return out


_AI_SYSTEM = (
    "Bạn phân loại loại hợp đồng tại Việt Nam dựa trên hạng mục báo giá, yêu cầu của Sale và tên mẫu. Chỉ chọn loại khi dữ liệu thực sự cho thấy rõ; "
    "nếu không chắc phải trả confidence thấp (< 0.5) và label rỗng. KHÔNG bịa. Trả DUY NHẤT 1 JSON dạng "
    '{"label": "Hợp đồng ...", "confidence": 0.0-1.0, "reason": "lý do ngắn"}. Nhãn viết tiếng Việt, dạng "Hợp đồng <loại>", có thể là loại mới ngoài gợi ý.'
)


async def suggest_type(quote: dict | None, extra_prompt: str | None, template_name: str | None, deal: dict | None = None, ai_call=None) -> dict[str, Any]:
    """Đề xuất loại hợp đồng. ai_call(system, user)->dict được tiêm để test; mặc định dùng AI engine của team. AI lỗi -> trả kết quả luật + ghi chú."""
    base = rule_suggestion(quote, extra_prompt, template_name)
    if ai_call is None:
        from app.modules.all_platform.services import contract_ai_service as ai

        ai_call = ai._call_chat_json
    items = (quote or {}).get("items") or []
    listing = "\n".join(f"- {i.get('description')} | {i.get('serviceDescription') or ''}" for i in items[:40] if i.get("rowType") != "section")
    user = (f"=== HẠNG MỤC BÁO GIÁ ===\n{listing or '(không có)'}\n\n=== YÊU CẦU CỦA SALE ===\n{extra_prompt or '(không có)'}\n\n"
            f"=== TÊN MẪU ===\n{template_name or '(không dùng mẫu)'}\n\n=== GỢI Ý TỪ KHOÁ ===\n{base.get('label') or '(không có)'}")
    try:
        data = await ai_call(_AI_SYSTEM, user)
        label = normalize_label(data.get("label"))
        conf = float(data.get("confidence") or 0)
        if label and conf > 0:
            # AI và luật đồng ý => tin hơn; khác nhau => lấy AI nhưng hạ độ tin cậy, kèm phương án của luật
            agree = bool(base.get("label")) and _fold(base["label"]) == _fold(label)
            conf = min(0.97, conf + 0.05) if agree else min(conf, 0.75)
            alts = [a for a in ([base.get("label")] + base.get("alternatives", [])) if a and _fold(a) != _fold(label)]
            return finalize({"label": label, "confidence": round(conf, 2), "reason": str(data.get("reason") or base["reason"]), "alternatives": alts[:3], "source": "ai"})
        return finalize({**base, "aiNote": "AI không đủ chắc chắn để đề xuất loại hợp đồng."})
    except Exception as exc:  # noqa: BLE001
        return finalize({**base, "aiError": str(exc)[:200], "source": "rules"})
