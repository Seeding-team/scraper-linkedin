"""Script migrate dữ liệu đánh giá và kết quả liên hệ từ file JSON (evaluations.json)
sang database Supabase (bảng post_quick_review và post_call_results).

Hỗ trợ flag --dry-run (mặc định) để kiểm tra trước hoặc --execute để ghi thật vào DB.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Mapping mã đánh giá cũ sang mã chuẩn trong categories (category_type = 'post_evaluation')
# 3 mã chuẩn: 'chua-danh-gia', 'can-lien-he', 'khong-phu-hop'
EVALUATION_CODE_MAP = {
    "chua_danh_gia": "chua-danh-gia",
    "chua-danh-gia": "chua-danh-gia",
    "can_lien_he": "can-lien-he",
    "can-lien-he": "can-lien-he",
    "khong_phu_hop": "khong-phu-hop",
    "khong-phu-hop": "khong-phu-hop",
    # Các mã cũ legacy hợp nhất về 'can-lien-he'
    "phu_hop": "can-lien-he",
    "phu-hop": "can-lien-he",
    "can_xem_xet": "can-lien-he",
    "can-nhac": "can-lien-he",
}

# 8 mã chuẩn trong categories (category_type = 'call_result')
VALID_CALL_RESULT_CODES = {
    "noanswer", "callback", "consulting", "waiting",
    "interested", "refused", "nointerest", "invalid"
}


def parse_iso_datetime(dt_str: Optional[str]) -> Optional[str]:
    """Parse chuỗi ngày giờ sang ISO-8601 UTC chuẩn."""
    if not dt_str or not dt_str.strip():
        return None
    s = dt_str.strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            continue
    return None


def run_migration(
    json_path: str,
    dry_run: bool = True,
    email_user_map: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    if email_user_map is None:
        email_user_map = {}

    if not os.path.exists(json_path):
        raise FileNotFoundError(f"Không tìm thấy file: {json_path}")

    with open(json_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    print(f"==================================================")
    print(f"MIGRATE POST EVALUATIONS JSON -> SUPABASE")
    print(f"File nguồn: {json_path}")
    print(f"Chế độ: {'DRY-RUN (CHỈ ĐỌC, KHÔNG GHI)' if dry_run else 'THỰC THI THẬT'}")
    print(f"Tổng số entries trong file: {len(raw_data)}")
    print(f"==================================================\n")

    posts_by_id: Dict[str, Dict[str, Any]] = {}
    skipped_entries: List[Tuple[str, str]] = []

    for key, val in raw_data.items():
        if isinstance(val, str):
            status = val
            call_result = ""
            call_attempts = 0
            last_call = ""
            evaluated_by = "unknown"
            updated_at = ""
        elif isinstance(val, dict):
            status = val.get("status") or ""
            call_result = val.get("call_result") or ""
            call_attempts = int(val.get("call_attempts") or 0)
            last_call = val.get("last_call") or ""
            evaluated_by = (val.get("evaluated_by") or "unknown").strip()
            updated_at = val.get("updated_at") or ""
        else:
            skipped_entries.append((key, f"Giá trị không hợp lệ: {type(val)}"))
            continue

        is_url = key.startswith("http://") or key.startswith("https://")
        post_key = key.strip()

        if post_key not in posts_by_id:
            posts_by_id[post_key] = {
                "post_id": post_key,
                "is_url": is_url,
                "status": status,
                "call_result": call_result,
                "call_attempts": call_attempts,
                "last_call": last_call,
                "evaluated_by": evaluated_by,
                "updated_at": updated_at,
            }
        else:
            curr = posts_by_id[post_key]
            if not curr["status"] and status:
                curr["status"] = status
            if not curr["call_result"] and call_result:
                curr["call_result"] = call_result
                curr["call_attempts"] = max(curr["call_attempts"], call_attempts)
                curr["last_call"] = last_call or curr["last_call"]
            if curr["evaluated_by"] == "unknown" and evaluated_by != "unknown":
                curr["evaluated_by"] = evaluated_by

    deduped_posts: Dict[str, Dict[str, Any]] = {}

    for k, p in posts_by_id.items():
        if not p["is_url"]:
            deduped_posts[k] = p

    for k, p in posts_by_id.items():
        if p["is_url"]:
            matched_uuid = None
            for uk, up in deduped_posts.items():
                if up["status"] == p["status"] and up["updated_at"] == p["updated_at"]:
                    matched_uuid = uk
                    break
            if matched_uuid:
                skipped_entries.append((k, f"Trùng với bài UUID {matched_uuid} (cùng status & updated_at)"))
            else:
                deduped_posts[k] = p

    print(f"Tổng số bài viết duy nhất sau khi deduplicate: {len(deduped_posts)}")
    print(f"Số entries bị skip (trùng URL hoặc rác): {len(skipped_entries)}")

    review_records = []
    call_records = []
    resolved_users = 0
    null_users = 0

    for pid, p in deduped_posts.items():
        raw_status = p["status"]
        mapped_code = EVALUATION_CODE_MAP.get(raw_status) or "chua-danh-gia"

        user_email = p["evaluated_by"]
        user_id = None
        if user_email and user_email.lower() not in ["", "unknown", "none", "null"]:
            user_id = email_user_map.get(user_email.lower())
            if user_id:
                resolved_users += 1
            else:
                null_users += 1
        else:
            null_users += 1

        eval_at = parse_iso_datetime(p["updated_at"]) or datetime.now(timezone.utc).isoformat()

        rev_row = {
            "post_id": pid,
            "platform": "facebook",
            "evaluation_code": mapped_code,
            "evaluated_by": user_id,
            "evaluated_at": eval_at,
            "exclude_keyword_exempt": False,
        }
        review_records.append(rev_row)

        call_res = p["call_result"].strip()
        call_att = p["call_attempts"]
        last_c = parse_iso_datetime(p["last_call"])

        if call_res or call_att > 0:
            norm_call_code = call_res if call_res in VALID_CALL_RESULT_CODES else "noanswer"
            call_row = {
                "post_id": pid,
                "platform": "facebook",
                "result_code": norm_call_code,
                "attempts": call_att,
                "last_call_at": last_c,
                "updated_by": user_id,
            }
            call_records.append(call_row)

    print(f"\n--- KẾT QUẢ PHÂN TÍCH ---")
    print(f"1. post_quick_review:")
    print(f"   - Số records: {len(review_records)}")
    status_summary = {}
    for r in review_records:
        c = r["evaluation_code"]
        status_summary[c] = status_summary.get(c, 0) + 1
    for c, cnt in status_summary.items():
        print(f"     + {c}: {cnt} bài")

    print(f"\n2. post_call_results:")
    print(f"   - Số records: {len(call_records)}")
    if call_records:
        call_summary = {}
        for r in call_records:
            c = r["result_code"]
            call_summary[c] = call_summary.get(c, 0) + 1
        for c, cnt in call_summary.items():
            print(f"     + {c}: {cnt} bài")
    else:
        print(f"     + (Không có record nào có call_result hoặc attempts > 0 -> 0 record cần insert)")

    print(f"\n3. User ID resolution (app_users):")
    print(f"   - User ID resolve thành công: {resolved_users}")
    print(f"   - User ID để NULL (do 'unknown' hoặc không khớp): {null_users}")

    print(f"\n4. Danh sách các entries bị skip ({len(skipped_entries)} entries):")
    for k, reason in skipped_entries:
        print(f"   - Key: {k[:60]}... -> Lý do: {reason}")

    if not dry_run:
        print(f"\n==================================================")
        print(f"--- ĐANG THỰC HIỆN GHI VÀO SUPABASE DATABASE ---")
        print(f"==================================================")
        parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)
        try:
            from app.core.supabase_client import get_supabase_client
            supabase = get_supabase_client()
        except Exception as e:
            print(f"Lỗi khởi tạo Supabase client: {e}")
            raise

        inserted_reviews = 0
        batch_size = 50
        for i in range(0, len(review_records), batch_size):
            batch = review_records[i : i + batch_size]
            res = (
                supabase.table("post_quick_review")
                .upsert(batch, on_conflict="post_id,platform")
                .execute()
            )
            inserted_reviews += len(batch)
            print(f"-> Đã upsert {len(batch)} records vào post_quick_review (tổng: {inserted_reviews})")

        inserted_calls = 0
        if call_records:
            for i in range(0, len(call_records), batch_size):
                batch = call_records[i : i + batch_size]
                res = (
                    supabase.table("post_call_results")
                    .upsert(batch, on_conflict="post_id,platform")
                    .execute()
                )
                inserted_calls += len(batch)
                print(f"-> Đã upsert {len(batch)} records vào post_call_results (tổng: {inserted_calls})")

        print(f"\n✓ Hoàn tất migration vào Supabase: {inserted_reviews} post_quick_review, {inserted_calls} post_call_results.")

    return {
        "total_raw": len(raw_data),
        "total_unique": len(deduped_posts),
        "review_records_count": len(review_records),
        "call_records_count": len(call_records),
        "skipped_count": len(skipped_entries),
        "resolved_users": resolved_users,
        "null_users": null_users,
        "review_records": review_records,
        "call_records": call_records,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate post evaluations JSON to Supabase")
    parser.add_argument("--file", default="latest_evaluations_prod.json", help="Path to evaluations.json")
    parser.add_argument("--execute", action="store_true", help="Thực thi ghi thật vào DB (mặc định là dry-run)")
    args = parser.parse_args()

    run_migration(args.file, dry_run=not args.execute)
