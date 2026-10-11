"""Hàng đợi job cào bài cho các VPS worker (mô hình PULL qua Supabase)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

# Worker không gửi heartbeat trong khoảng thời gian này bị coi là mất kết nối
# -> job đang xử lý dở của nó được thả về "pending" cho worker khác nhận.
WORKER_STALE_SECONDS = 90

# Số lần tối đa 1 job được tự động thả về "pending" để thử lại (do fail hoặc do
# worker mất heartbeat) trước khi bị coi là "failed" vĩnh viễn -- tránh job của
# 1 group luôn lỗi (VD link sai/bị block) lặp vô hạn giữa các worker.
MAX_JOB_RETRIES = 2

# NOTE: mọi lambda truyền vào execute_supabase_query() đều tự gọi get_supabase_client()
# BÊN TRONG lambda (không capture biến `supabase` từ ngoài) -- để khi retry xảy ra sau
# 1 lỗi transient (execute_supabase_query có thể gọi reset_supabase_client() giữa các lần
# thử), lần gọi lại sẽ lấy đúng client MỚI thay vì tái sử dụng client cũ đã bị đóng session.


def upsert_worker_heartbeat(worker_id: str, name: Optional[str], status: str) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_workers")
        .upsert(
            {
                "worker_id": worker_id,
                "name": name,
                "status": status,
                "last_heartbeat": now_iso,
                "updated_at": now_iso,
            },
            on_conflict="worker_id",
        )
        .execute()
    )


def enqueue_crawl_job(
    group_url: str,
    group_name: Optional[str] = None,
    group_id: Optional[str] = None,
    id_member: Optional[str] = None,
    keywords: Optional[List[str]] = None,
    post_limit: Optional[int] = None,
    platform: str = "facebook",
) -> Dict[str, Any]:
    row = {
        "platform": platform,
        "group_url": group_url,
        "group_name": group_name,
        "group_id": group_id,
        "id_member": id_member,
        "keywords": keywords or None,
        "post_limit": post_limit,
        "status": "pending",
    }
    res = execute_supabase_query(lambda: get_supabase_client().table("crawl_jobs").insert(row).execute())
    return (res.data or [None])[0]


def claim_next_job(
    worker_id: str,
    worker_name: Optional[str] = None,
    current_id_member: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Worker gọi định kỳ để xin job. Đồng thời cập nhật heartbeat/trạng thái busy/idle.

    `current_id_member`: chủ acc FB mà worker đang cầm sẵn (nếu có) -- chỉ dùng để ƯU TIÊN
    (không bắt buộc) job cùng chủ, tránh đổi acc liên tục khi hàng đợi xen kẽ nhiều nhân
    viên. Việc đảm bảo đúng acc cho đúng job nằm ở bước claim_next_fb_account riêng.
    """
    res = execute_supabase_query(
        lambda: get_supabase_client()
        .rpc("claim_next_crawl_job", {"p_worker_id": worker_id, "p_current_id_member": current_id_member})
        .execute()
    )
    job = (res.data or [None])[0]

    upsert_worker_heartbeat(
        worker_id,
        worker_name,
        status="busy" if job else "idle",
    )
    if job:
        execute_supabase_query(
            lambda: get_supabase_client()
            .table("crawl_workers")
            .update({"current_job_id": job["id"]})
            .eq("worker_id", worker_id)
            .execute()
        )
        # Job vừa claim chuyển ngay sang processing (extension bắt đầu cào thật).
        execute_supabase_query(
            lambda: get_supabase_client()
            .table("crawl_jobs")
            .update({"status": "processing"})
            .eq("id", job["id"])
            .execute()
        )
        job["status"] = "processing"
    return job


def complete_job(
    job_id: str,
    success: bool,
    worker_id: Optional[str] = None,
    result_count: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    """Đóng job khi worker báo kết quả (thành công qua /save-posts, thất bại qua /job-result).

    `worker_id` nên luôn được truyền vào (2 call site hiện tại đều có sẵn field này trong
    payload) để tránh trường hợp: job đã bị `requeue_stale_jobs` thả về 'pending' và worker
    khác nhận, mà worker cũ vẫn "hồi" báo kết quả trễ -> nếu không check worker_id sẽ ghi đè
    nhầm state của worker MỚI (đang thực sự bận với job đó) thành idle.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    if success:
        job_update: Dict[str, Any] = {
            "status": "done",
            "result_count": result_count,
            "error_message": error_message,
            "completed_at": now_iso,
        }
    else:
        # Không try/except quanh SELECT này: nếu đọc retry_count lỗi mà cứ âm thầm coi
        # như 0 thì sẽ vô tình xoá luôn tác dụng của MAX_JOB_RETRIES (job lỗi liên tục
        # nhưng lần nào cũng "may" đọc lỗi retry_count sẽ được coi là mới, retry vô hạn).
        # Cứ để lỗi bay lên -- cả 2 nơi gọi complete_job() đều đã tự xử lý exception rồi
        # (crawl_queue.py trả lỗi 500 cho request /job-result, extension_crawl.py log
        # warning) -- job giữ nguyên trạng thái cũ, chờ requeue_stale_jobs xử lý tiếp.
        row_res = execute_supabase_query(
            lambda: get_supabase_client()
            .table("crawl_jobs")
            .select("retry_count")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        current_retry = (row_res.data[0].get("retry_count") or 0) if row_res.data else 0

        if current_retry < MAX_JOB_RETRIES:
            job_update = {
                "status": "pending",
                "retry_count": current_retry + 1,
                "assigned_worker_id": None,
                "assigned_at": None,
                "error_message": error_message,
            }
        else:
            job_update = {
                "status": "failed",
                "result_count": result_count,
                "error_message": error_message,
                "completed_at": now_iso,
            }

    def _update_job():
        q = get_supabase_client().table("crawl_jobs").update(job_update).eq("id", job_id)
        if worker_id:
            q = q.eq("assigned_worker_id", worker_id)
        return q.execute()

    job_res = execute_supabase_query(_update_job)

    if worker_id and not (job_res.data or []):
        logger.warning(
            f"[CRAWL-QUEUE] Bỏ qua complete_job: job {job_id} không còn gán cho worker {worker_id} "
            "(đã bị requeue và worker khác xử lý hoặc đã đóng trước đó)."
        )
        return

    if not success and job_update["status"] == "pending":
        logger.info(
            f"[CRAWL-QUEUE] Job {job_id} lỗi, đã thả về 'pending' để thử lại "
            f"(lần {job_update['retry_count']}/{MAX_JOB_RETRIES})."
        )

    def _update_worker():
        q = (
            get_supabase_client()
            .table("crawl_workers")
            .update({"current_job_id": None, "status": "idle"})
            .eq("current_job_id", job_id)
        )
        if worker_id:
            q = q.eq("worker_id", worker_id)
        return q.execute()

    execute_supabase_query(_update_worker)


def requeue_stale_jobs() -> int:
    """Job đang 'assigned'/'processing' mà worker phụ trách đã mất heartbeat quá lâu
    -> thả về 'pending' để worker khác nhận. Tránh job treo vĩnh viễn khi worker crash.

    Job nào đã bị thả kiểu này quá `MAX_JOB_RETRIES` lần thì chuyển thẳng 'failed' luôn,
    tránh trường hợp 1 group luôn khiến worker crash (link sai, bị chặn...) cứ lặp vô hạn
    giữa các VPS mà không bao giờ dừng lại ở trạng thái failed.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=WORKER_STALE_SECONDS)).isoformat()

    stale_workers_res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_workers")
        .select("worker_id")
        .lt("last_heartbeat", cutoff)
        .neq("status", "offline")
        .execute()
    )
    stale_worker_ids = [w["worker_id"] for w in (stale_workers_res.data or [])]
    if not stale_worker_ids:
        return 0

    execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_workers")
        .update({"status": "offline", "current_job_id": None})
        .in_("worker_id", stale_worker_ids)
        .execute()
    )

    stale_jobs_res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_jobs")
        .select("id, retry_count")
        .in_("assigned_worker_id", stale_worker_ids)
        .in_("status", ["assigned", "processing"])
        .execute()
    )
    stale_jobs = stale_jobs_res.data or []
    if not stale_jobs:
        return 0

    requeued_count = 0
    failed_count = 0
    for j in stale_jobs:
        job_id = j["id"]
        current_retry = j.get("retry_count") or 0
        if current_retry < MAX_JOB_RETRIES:
            update_payload: Dict[str, Any] = {
                "status": "pending",
                "retry_count": current_retry + 1,
                "assigned_worker_id": None,
                "assigned_at": None,
            }
        else:
            update_payload = {
                "status": "failed",
                "error_message": "Worker mat heartbeat qua so lan retry cho phep.",
                "completed_at": now_iso,
            }

        # Guard `.in_("status", [...])` NGAY LÚC UPDATE (không chỉ lúc SELECT ở trên) --
        # nếu đúng lúc này worker "hồi sinh" và complete_job() đã kịp đóng job (status
        # chuyển 'done'/'failed') giữa lúc SELECT và UPDATE này, thì update sẽ không match
        # dòng nào nữa (an toàn), tránh đè mất kết quả job vừa hoàn thành lên trạng thái cũ.
        res = execute_supabase_query(
            lambda job_id=job_id, update_payload=update_payload: get_supabase_client()
            .table("crawl_jobs")
            .update(update_payload)
            .eq("id", job_id)
            .in_("status", ["assigned", "processing"])
            .execute()
        )
        if not (res.data or []):
            logger.info(
                f"[CRAWL-QUEUE] Job {job_id} đã được đóng (worker báo kết quả) trước khi "
                "requeue-stale kịp cập nhật -- bỏ qua, không đè trạng thái."
            )
            continue

        if update_payload["status"] == "pending":
            requeued_count += 1
        else:
            failed_count += 1

    if requeued_count:
        logger.warning(
            f"[CRAWL-QUEUE] Đã thả {requeued_count} job về 'pending' do worker mất heartbeat: {stale_worker_ids}"
        )
    if failed_count:
        logger.warning(
            f"[CRAWL-QUEUE] Đã đánh 'failed' {failed_count} job vượt quá {MAX_JOB_RETRIES} lần retry do worker mất heartbeat."
        )
    return requeued_count


# ── Dashboard / giám sát (chỉ đọc, không đụng tới claim/complete/requeue) ─────

def get_job_status_counts() -> Dict[str, int]:
    """Đếm số job trong crawl_jobs theo từng status -- dùng cho trang giám sát hàng đợi."""
    res = execute_supabase_query(
        lambda: get_supabase_client().table("crawl_jobs").select("status").execute()
    )
    counts: Dict[str, int] = {"pending": 0, "assigned": 0, "processing": 0, "done": 0, "failed": 0}
    for row in res.data or []:
        status = row.get("status")
        counts[status] = counts.get(status, 0) + 1
    return counts


def get_recent_jobs(limit: int = 20) -> List[Dict[str, Any]]:
    """N job gần nhất (mọi trạng thái) -- dùng cho trang giám sát hàng đợi soi nhanh job
    nào đang lỗi/đang chạy."""
    res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_jobs")
        .select("id, group_name, group_url, status, assigned_worker_id, retry_count, error_message, created_at, completed_at")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def list_workers() -> List[Dict[str, Any]]:
    """Danh sách toàn bộ VPS worker đã từng heartbeat -- dùng cho trang giám sát hàng đợi
    xem VPS nào đang online/offline."""
    res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_workers")
        .select("worker_id, name, status, last_heartbeat, current_job_id")
        .order("last_heartbeat", desc=True)
        .execute()
    )
    return res.data or []
