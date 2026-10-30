"""Annotation TƯỜNG MINH cho highlight AI/Sale (2026-10-27, Word Editor - xem
C:\\Users\\Asus\\.claude\\plans\\proud-stargazing-pixel.md, mục 3). Mỗi highlight (AI tạo lúc
chạy AI Review, hoặc Sale tô tay trong OnlyOffice) là 1 row trong `contract_highlight_annotations`
với ID/nguồn/vị trí RIÊNG - KHÔNG suy luận lại nguồn bằng so text mỗi lần đọc.

3 hành động TÁCH RIÊNG trên annotation AI (nguyên tắc #2 của plan, không gộp làm một):
  - dismiss_warning  -> chỉ đổi status='dismissed' trong DB, KHÔNG đụng file.
  - remove_highlight -> THỰC SỰ bỏ màu trong DOCX (nháp hoặc version), rồi status='removed'.
  - clear_note       -> chỉ xoá field `note`, không đụng status/highlight.

Vòng đời phát hiện annotation mới chạy SAU MỖI autosave (không chỉ lúc lưu version) - khớp theo
`paragraph_anchor` trước, dùng `excerpt` chỉ để re-align khi đoạn dịch nhẹ (KHÔNG phải tiêu chí
so khớp duy nhất).
"""
from __future__ import annotations

import re
from typing import Any

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

_TABLE = "contract_highlight_annotations"


def _sb():
    return get_supabase_client()


def list_annotations(contract_id: str, *, statuses: list[str] | None = None) -> list[dict[str, Any]]:
    q = _sb().table(_TABLE).select("*").eq("contract_id", contract_id)
    if statuses:
        q = q.in_("status", statuses)
    rows = q.order("created_at").execute().data or []
    # Uu tien hien thi highlight cua AI truoc, Sale to thu cong sau (giu nguyen thu tu created_at trong moi nhom)
    return sorted(rows, key=lambda r: (0 if r.get("source") == "ai" else 1))


def get_annotation(annotation_id: str, contract_id: str) -> dict[str, Any] | None:
    rows = _sb().table(_TABLE).select("*").eq("id", annotation_id).eq("contract_id", contract_id).limit(1).execute().data
    return rows[0] if rows else None


def _para_index(anchor: str | None) -> int | None:
    if not anchor:
        return None
    m = re.fullmatch(r"p(\d+)", anchor)
    return int(m.group(1)) if m else None


def _span_belongs_to_ai_excerpt(
    span_text: str,
    ai_excerpt: str,
    *,
    span_anchor: str | None = None,
    ai_anchor: str | None = None,
) -> bool:
    st = (span_text or "").strip()
    ex = (ai_excerpt or "").strip()
    if not st or not ex:
        return False
    # Neu ca 2 deu co paragraph_anchor ro rang: chi coi la o phu cua CUNG 1 hang bang AI
    # khi nam ngay canh nhau (0 <= span_idx - ai_idx <= 4) va excerpt AI la dang nhieu dong ("\n").
    # Nho vay neu Sale to thu cong 1 cum tu trung ten o doan khac (vd "Mã số thuế" cua Ben B o p22),
    # he thong VAN nhan dien dung la "Sale tô vàng thủ công".
    s_idx = _para_index(span_anchor)
    a_idx = _para_index(ai_anchor)
    if s_idx is not None and a_idx is not None:
        if s_idx != a_idx:
            if "\n" not in ex or not (0 < s_idx - a_idx <= 4):
                return False
    if st == ex:
        return True
    for line in ex.splitlines():
        ln = line.strip()
        if ln and st == ln:
            return True
    return False


def _ranges_overlap_or_match(a: dict[str, Any], span: dict[str, Any]) -> bool:
    a_start, a_end = a.get("char_start"), a.get("char_end")
    s_start, s_end = span.get("charStart"), span.get("charEnd")
    if a_start is not None and a_end is not None and s_start is not None and s_end is not None:
        if max(a_start, s_start) < min(a_end, s_end):
            return True
    a_ex = (a.get("excerpt") or "").strip()
    s_tx = (span.get("text") or "").strip()
    return bool(a_ex and s_tx and (a_ex == s_tx or s_tx in a_ex or a_ex in s_tx))


def seed_ai_annotations(
    contract_id: str,
    version_id: str,
    findings: list[dict[str, Any]],
    anchors: dict[str, dict[str, Any]],
    pages: dict[str, int],
    is_pdf: bool,
) -> None:
    """Tạo annotation `source='ai'` NGAY khi sinh Highlight (gọi từ contract_ai_review_service,
    KHÔNG đợi Sale mở editor). Idempotent theo (contract_id, source='ai') - xoá sạch bộ AI cũ
    rồi tạo lại, đồng thời dọn các dòng `source='sale'` giả (do bug cũ khi 1 highlight AI trải
    qua nhiều ô bảng khiến các ô phụ bị nhận nhầm là Sale tô tay)."""
    sb = _sb()
    try:
        sb.table(_TABLE).delete().eq("contract_id", contract_id).eq("source", "ai").execute()
    except Exception as exc:  # noqa: BLE001 - bang chua ton tai (migration 198 chua chay) khong duoc chan AI Review
        logger.warning("Không dọn được annotation AI cũ cho %s/%s: %s", contract_id, version_id, exc)
        return

    rows = []
    for f in findings:
        field = f.get("field")
        excerpt = (f.get("sourceExcerpt") or "").strip()
        if not field or not excerpt or not f.get("located"):
            continue
        # (2026-10-28, fix bug that "click-to-jump tren tab PDF tinh khong hoat dong cho
        # annotation nguon DOCX") - `pages` da duoc contract_ai_review_service TINH SAN cho CA
        # DOCX lan PDF (cung 1 pipeline highlight_docx/highlight_pdf_*), luu rieng vao
        # `highlight_page` du nguon la gi - KHONG con phu thuoc dinh dang paragraph_anchor
        # ("pN" cho nhay bookmark trong OnlyOffice dang song, "page:N" chi con dung cho rieng
        # annotation khong co ban DOCX nao (PDF-only)).
        highlight_page = pages.get(field)
        if is_pdf:
            anchor = f"page:{highlight_page}" if highlight_page else None
            char_start = char_end = None
        else:
            a = anchors.get(field) or {}
            anchor = a.get("paragraphAnchor")
            char_start, char_end = a.get("charStart"), a.get("charEnd")
        rows.append({
            "contract_id": contract_id, "version_id": version_id, "source": "ai",
            "category": field, "paragraph_anchor": anchor,
            "char_start": char_start, "char_end": char_end,
            "highlight_page": highlight_page,
            "excerpt": excerpt[:500], "status": "active",
        })

    # Don cac annotation `source='sale'` bi tao nham tu cac o phu cua highlight AI da co
    if rows:
        try:
            sale_rows = sb.table(_TABLE).select("id, excerpt, paragraph_anchor").eq("contract_id", contract_id).eq("source", "sale").execute().data or []
            bogus_sale_ids = [
                sr["id"] for sr in sale_rows
                if any(
                    _span_belongs_to_ai_excerpt(
                        sr.get("excerpt") or "", r["excerpt"],
                        span_anchor=sr.get("paragraph_anchor"), ai_anchor=r.get("paragraph_anchor"),
                    )
                    for r in rows
                )
            ]
            if bogus_sale_ids:
                sb.table(_TABLE).delete().in_("id", bogus_sale_ids).execute()
        except Exception:  # noqa: BLE001
            pass

    if rows:
        try:
            sb.table(_TABLE).insert(rows).execute()
        except Exception as exc:  # noqa: BLE001
            # (2026-10-28) Fallback khi migration 200 (cột highlight_page) CHƯA được áp lên DB:
            # không được để annotation AI seeding thất bại HOÀN TOÀN chỉ vì thiếu 1 cột mới - đó
            # là regression so với trước (trước đây vẫn tạo được annotation, chỉ là không nhảy
            # trang được cho nguồn DOCX). Rút field highlight_page ra rồi thử lại 1 lần.
            if "highlight_page" in str(exc) or "PGRST204" in str(exc):
                try:
                    fallback_rows = [{k: v for k, v in r.items() if k != "highlight_page"} for r in rows]
                    sb.table(_TABLE).insert(fallback_rows).execute()
                    logger.warning(
                        "Migration 200 (cột highlight_page) chưa áp cho %s/%s — đã seed annotation KHÔNG kèm số trang "
                        "(click-to-jump trên tab PDF tĩnh sẽ không hoạt động cho tới khi áp migration).",
                        contract_id, version_id,
                    )
                    return
                except Exception as exc2:  # noqa: BLE001
                    logger.warning("Không tạo được annotation AI (cả fallback) cho %s/%s: %s", contract_id, version_id, exc2)
                    return
            logger.warning("Không tạo được annotation AI cho %s/%s: %s", contract_id, version_id, exc)


def _iter_highlighted_runs(doc) -> list[dict[str, Any]]:
    """Quét TOÀN BỘ run có `w:highlight` (Sale tô bằng nút chuẩn OnlyOffice) hoặc `w:shd` (AI tô
    #FFF176) trong thân tài liệu - gộp các run liền kề cùng được tô thành 1 "vùng" (span), trả về
    {paragraphAnchor, charStart, charEnd, text} theo global_paragraph_index. Dùng chung cho sync
    pass (phát hiện Sale tô mới) - KHÔNG phân biệt loại thuộc tính tô (highlight/shd) ở bước quét,
    việc gán nguồn AI/Sale làm ở sync_annotations_after_draft_save() bằng cách so annotation đã
    biết."""
    from docx.oxml.ns import qn

    from app.modules.all_platform.services.contract_docx_engine import (
        _all_paragraph_elements,
        _run_text,
        _text_runs,
        global_paragraph_index,
    )

    spans: list[dict[str, Any]] = []
    for p_el in _all_paragraph_elements(doc):
        runs = _text_runs(p_el)
        pos = 0
        cur_start: int | None = None
        cur_text = ""
        for r in runs:
            t = _run_text(r)
            rpr = r.find(qn("w:rPr"))
            is_hl = False
            if rpr is not None:
                is_hl = rpr.find(qn("w:highlight")) is not None or rpr.find(qn("w:shd")) is not None
            if is_hl:
                if cur_start is None:
                    cur_start = pos
                cur_text += t
            else:
                if cur_start is not None and cur_text.strip():
                    gidx = global_paragraph_index(doc, p_el)
                    spans.append({"paragraphAnchor": f"p{gidx}" if gidx is not None else None,
                                  "charStart": cur_start, "charEnd": pos, "text": cur_text})
                cur_start, cur_text = None, ""
            pos += len(t)
        if cur_start is not None and cur_text.strip():
            gidx = global_paragraph_index(doc, p_el)
            spans.append({"paragraphAnchor": f"p{gidx}" if gidx is not None else None,
                          "charStart": cur_start, "charEnd": pos, "text": cur_text})
    return spans


def sync_annotations_from_draft(contract_id: str, version_label: str, draft_bytes: bytes, actor_id: str | None) -> dict[str, Any]:
    """Chạy SAU MỖI autosave callback thành công (không chỉ lúc lưu version) - quét `_draft.docx`
    tìm vùng được tô màu, khớp với annotation `active` đã biết theo `paragraph_anchor` TRƯỚC (dùng
    `excerpt` chỉ để xác nhận/re-align khi đoạn dịch nhẹ), vùng không khớp ai = annotation
    `source='sale'` MỚI. KHÔNG tự đổi status của annotation active không còn thấy highlight tương
    ứng (nguyên tắc: hành động tường minh của Sale qua API riêng mới được đổi status - xem
    apply_annotation_action). Trả {created, matched, totalSpans}."""
    from app.modules.all_platform.services.contract_docx_engine import load_document

    sb = _sb()
    try:
        doc = load_document(draft_bytes)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Không đọc được _draft.docx để đồng bộ annotation (%s): %s", contract_id, exc)
        return {"created": 0, "matched": 0, "totalSpans": 0, "error": str(exc)}

    spans = _iter_highlighted_runs(doc)
    known = [a for a in list_annotations(contract_id, statuses=["active"])]
    ai_known = [a for a in known if a.get("source") == "ai"]
    matched_ids: set[str] = set()
    created = 0

    for span in spans:
        best = None
        for a in known:
            if a["id"] in matched_ids:
                continue
            if a.get("paragraph_anchor") and a["paragraph_anchor"] == span["paragraphAnchor"] and _ranges_overlap_or_match(a, span):
                best = a
                break
        if best:
            matched_ids.add(best["id"])
            # Neu la annotation AI trai nhieu o bang (excerpt co "\n"), giu nguyen excerpt day du
            # thay vi ghi de bang text cua 1 o don le.
            preserve_multi_excerpt = best.get("source") == "ai" and "\n" in (best.get("excerpt") or "")
            new_excerpt = best.get("excerpt") if preserve_multi_excerpt else span["text"][:500]
            if best.get("char_start") != span["charStart"] or best.get("char_end") != span["charEnd"] or best.get("excerpt") != new_excerpt:
                try:
                    sb.table(_TABLE).update({
                        "char_start": span["charStart"], "char_end": span["charEnd"],
                        "excerpt": new_excerpt, "updated_at": "now()",
                    }).eq("id", best["id"]).execute()
                except Exception:  # noqa: BLE001
                    pass
            continue
        # Neu span nay la 1 o phu thuoc cung 1 highlight AI trai nhieu o bang (vd o ": 0317945970"
        # o p10 ngay sau p9 cua "Mã số thuế\n: 0317945970" hoac "6.952.400" o p77 ngay sau p76),
        # hoac annotation AI backfill chua co paragraph_anchor -> gop vao AI, KHONG tao nham Sale.
        parent_ai = next(
            (
                a for a in ai_known
                if _span_belongs_to_ai_excerpt(
                    span["text"], a.get("excerpt") or "",
                    span_anchor=span.get("paragraphAnchor"), ai_anchor=a.get("paragraph_anchor"),
                )
            ),
            None,
        )
        if parent_ai is not None:
            matched_ids.add(parent_ai["id"])
            if not parent_ai.get("paragraph_anchor") and span.get("paragraphAnchor"):
                try:
                    sb.table(_TABLE).update({
                        "paragraph_anchor": span["paragraphAnchor"],
                        "char_start": span["charStart"], "char_end": span["charEnd"],
                        "updated_at": "now()",
                    }).eq("id", parent_ai["id"]).execute()
                    parent_ai["paragraph_anchor"] = span["paragraphAnchor"]
                except Exception:  # noqa: BLE001
                    pass
            continue
        # Khong khop annotation AI/Sale nao da biet -> Sale vua to moi.
        try:
            sb.table(_TABLE).insert({
                "contract_id": contract_id, "version_id": version_label, "source": "sale",
                "category": None, "paragraph_anchor": span["paragraphAnchor"],
                "char_start": span["charStart"], "char_end": span["charEnd"],
                "excerpt": span["text"][:500], "status": "active", "created_by": actor_id,
            }).execute()
            created += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Không tạo được annotation Sale mới cho %s: %s", contract_id, exc)

    return {"created": created, "matched": len(matched_ids), "totalSpans": len(spans)}


def apply_annotation_action(
    annotation: dict[str, Any],
    action: str,
    *,
    get_current_draft_bytes,
    save_draft_bytes,
    already_applied_live: bool = False,
) -> dict[str, Any]:
    """3 hành động TÁCH RIÊNG (xem docstring đầu file). `get_current_draft_bytes`/`save_draft_bytes`
    là callback do contract_edit_service truyền vào (đọc/ghi đúng `_draft.docx` hiện tại của hợp
    đồng) - module này KHÔNG tự biết vị trí lưu trữ, giữ tách bạch trách nhiệm.

    `already_applied_live`: BACKEND KHÔNG tự điều khiển được 1 trình duyệt cụ thể đang mở phiên
    OnlyOffice sống - nếu FE đang có editor mở, CHÍNH FE gọi plugin (postMessage) xoá highlight
    NGAY trong phiên trước, rồi gọi API này với cờ `already_applied_live=True` để backend CHỈ cập
    nhật DB (không patch lại file - forcesave kế tiếp sẽ tự phản ánh đúng thay đổi FE vừa làm).
    Nếu FE KHÔNG có editor đang mở (xem danh sách annotation ở trạng thái tĩnh), backend patch
    trực tiếp `_draft.docx` (hoặc file version nếu chưa có draft) qua `_remove_highlight_in_docx`."""
    sb = _sb()
    ann_id = annotation["id"]

    if action == "clear_note":
        sb.table(_TABLE).update({"note": None, "updated_at": "now()"}).eq("id", ann_id).execute()
        return {"status": "ok", "action": action}

    if action == "dismiss_warning":
        if annotation["source"] != "ai":
            raise ValueError("Chỉ bỏ qua cảnh báo được với annotation do AI tạo")
        sb.table(_TABLE).update({"status": "dismissed", "updated_at": "now()"}).eq("id", ann_id).execute()
        return {"status": "ok", "action": action}

    if action == "remove_highlight":
        anchor = annotation.get("paragraph_anchor") or ""
        m = re.fullmatch(r"p(\d+)", anchor or "")
        if anchor.startswith("page:"):
            raise ValueError("Annotation này thuộc bản PDF (không có vị trí DOCX) - không xoá được màu trực tiếp ở đây.")
        if not already_applied_live:
            docx = get_current_draft_bytes()
            if docx is None:
                raise ValueError("Không có file để xoá highlight (hợp đồng chưa có nháp/phiên bản DOCX)")
            if m:
                para_idx, char_start, char_end = int(m.group(1)), annotation.get("char_start") or 0, annotation.get("char_end")
            else:
                # Khong co paragraph_anchor hop le (annotation cu, tao truoc khi co anchor-tracking,
                # hoac bi mat do loi khac) - FALLBACK: quet lai toan bo vung highlight THAT SU dang
                # co trong draft (dung chung ham _iter_highlighted_runs voi sync pass) va khop theo
                # excerpt da luu, thay vi am tham tra ve thanh cong gia (status=200 nhung khong doi
                # gi) nhu bug cu. Khop CHINH XAC excerpt truoc, khong chinh xac thi khop theo
                # "excerpt da luu la substring cua span hien tai" (phong truong hop excerpt bi cat
                # ngan luc seed AI annotation).
                from app.modules.all_platform.services.contract_docx_engine import load_document
                doc_probe = load_document(docx)
                spans = _iter_highlighted_runs(doc_probe)
                excerpt = (annotation.get("excerpt") or "").strip()
                found = None
                if excerpt:
                    for span in spans:
                        if span["text"].strip() == excerpt:
                            found = span
                            break
                    if found is None:
                        for span in spans:
                            if excerpt in span["text"] or span["text"].strip() in excerpt:
                                found = span
                                break
                if found is None or found["paragraphAnchor"] is None:
                    raise ValueError(
                        "Không thể xác định vị trí để xoá - đoạn này không còn tô màu trong tài liệu hiện tại "
                        "hoặc đã bị thay đổi quá nhiều để khớp lại tự động."
                    )
                gm = re.fullmatch(r"p(\d+)", found["paragraphAnchor"])
                para_idx, char_start, char_end = int(gm.group(1)), found["charStart"], found["charEnd"]
                # Cap nhat lai anchor that cho annotation nay - lan sau khong can fallback nua.
                sb.table(_TABLE).update({
                    "paragraph_anchor": found["paragraphAnchor"], "char_start": char_start, "char_end": char_end,
                }).eq("id", ann_id).execute()
            new_docx = _remove_highlight_in_docx(docx, para_idx, char_start or 0, char_end)
            save_draft_bytes(new_docx)
        sb.table(_TABLE).update({"status": "removed", "updated_at": "now()"}).eq("id", ann_id).execute()
        return {"status": "ok", "action": action}

    raise ValueError(f"Hành động không hợp lệ: {action}")


def _remove_highlight_in_docx(docx_bytes: bytes, paragraph_index: int, char_start: int, char_end: int | None) -> bytes:
    """Xoá `<w:shd>`/`<w:highlight>` của đúng vùng [char_start, char_end) trong đoạn toàn cục thứ
    `paragraph_index` - dùng khi KHÔNG có phiên OnlyOffice nào đang mở sống (patch trực tiếp file
    ở trạng thái nghỉ, cùng kỹ thuật tách run với `_apply_shading_range`/`contract_docx_engine`)."""
    from io import BytesIO

    from docx import Document
    from docx.oxml.ns import qn

    from app.modules.all_platform.services.contract_docx_engine import _all_paragraph_elements, _run_text, _text_runs

    doc = Document(BytesIO(docx_bytes))
    els = _all_paragraph_elements(doc)
    if paragraph_index >= len(els):
        raise ValueError("Vị trí đoạn không còn hợp lệ trong tài liệu hiện tại")
    p_el = els[paragraph_index]
    runs = _text_runs(p_el)
    end = char_end if char_end is not None and char_end >= 0 else sum(len(_run_text(r)) for r in runs)
    pos = 0
    for r in runs:
        t = _run_text(r)
        r_start, r_end = pos, pos + len(t)
        pos += len(t)
        if r_end <= char_start or r_start >= end:
            continue
        rpr = r.find(qn("w:rPr"))
        if rpr is None:
            continue
        for tag in ("w:shd", "w:highlight"):
            el = rpr.find(qn(tag))
            if el is not None:
                rpr.remove(el)
    out = BytesIO()
    doc.save(out)
    return out.getvalue()
