from __future__ import annotations

from typing import Any, Dict, List, Optional
import asyncio
import json
import os
from pathlib import Path

from loguru import logger

from app.modules.all_platform.zalo.schemas.group import Group
from app.modules.all_platform.zalo.schemas.message import Message


class ZcaAuthExpiredError(RuntimeError):
    """Cookie/session ZCA đã hết hạn hoặc bị Zalo vô hiệu hóa — cần đăng nhập lại qua Chrome Extension."""


# Các chuỗi lỗi từ zca-js cho biết phiên đăng nhập đã hỏng.
_AUTH_EXPIRED_MARKERS = (
    "đăng nhập thất bại",
    "logincookie",
    "login failed",
    "not logged in",
    "session expired",
    "zpw_enk",
    "invalid cookie",
    "cookie expired",
    "401",
)

# Các lệnh phức tạp cần listener riêng — không dùng được qua persistent server
_SPAWN_ONLY_COMMANDS = {"sync-old-messages"}


def _looks_like_auth_expired(detail_text: str) -> bool:
    lowered = (detail_text or "").lower()
    return any(marker in lowered for marker in _AUTH_EXPIRED_MARKERS)


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[5]


def zca_api_script_path() -> Path:
    return _backend_root() / "scripts" / "zca_api_bridge.js"


# ── Persistent worker pool (ưu tiên) ─────────────────────────────────────────

async def _run_via_pool(
    command: str,
    auth: Dict[str, Any],
    *,
    args: Optional[Dict[str, Any]] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = 120,
) -> Dict[str, Any]:
    """Chạy command qua persistent Node.js worker pool.

    Raise RuntimeError nếu pool chưa khởi tạo được hoặc server crash.
    Caller sẽ fallback sang _run_via_spawn nếu cần.
    """
    from app.modules.all_platform.zalo.services.zca_worker_pool import get_pool
    pool = get_pool()
    return await pool.run_command(
        command,
        auth,
        args=args or {},
        payload=payload,
        timeout=float(timeout_seconds),
    )


# ── Spawn-per-call (fallback) ─────────────────────────────────────────────────

async def _run_via_spawn(
    command: str,
    auth: Dict[str, Any],
    *,
    args: Optional[List[str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = 120,
) -> Dict[str, Any]:
    """Mô hình cũ: spawn 1 tiến trình Node.js per lệnh."""
    script = zca_api_script_path()
    if not script.exists():
        raise RuntimeError(f"ZCA API helper not found: {script}")

    input_payload = {"auth": auth}
    if payload:
        input_payload.update(payload)

    input_data = json.dumps(input_payload).encode("utf-8")
    cmd = ["node", str(script), command, *(args or [])]

    import sys
    import subprocess

    if sys.platform == "win32":
        proc = subprocess.Popen(
            cmd,
            cwd=str(_backend_root()),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ},
        )
        def _communicate():
            return proc.communicate(input=input_data)

        try:
            stdout, stderr = await asyncio.wait_for(asyncio.to_thread(_communicate), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            raise
    else:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(_backend_root()),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ},
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input_data),
            timeout=timeout_seconds,
        )

    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    if stderr_text:
        logger.warning(f"ZCA API helper stderr: {stderr_text[:1000]}")

    lines = [
        line.strip()
        for line in stdout.decode("utf-8", errors="replace").splitlines()
        if line.strip()
    ]
    if not lines:
        raise RuntimeError(f"ZCA API helper returned no output for {command}")

    try:
        result = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ZCA API helper returned invalid JSON: {lines[-1][:500]}") from exc

    if proc.returncode != 0 or not result.get("ok"):
        detail = result.get("error_detail") or result.get("error") or stderr_text
        if isinstance(detail, (dict, list)):
            detail_text = json.dumps(detail, ensure_ascii=False)
        else:
            detail_text = str(detail or f"ZCA command failed: {command}")
        if _looks_like_auth_expired(detail_text):
            raise ZcaAuthExpiredError(detail_text)
        raise RuntimeError(detail_text)

    return result


# ── Dispatcher: pool → fallback spawn ────────────────────────────────────────

async def _run_zca_command(
    command: str,
    auth: Dict[str, Any],
    *,
    args: Optional[List[str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = 120,
) -> Dict[str, Any]:
    """Entry point cho tất cả ZCA API calls.

    Chiến lược:
        1. Nếu command trong _SPAWN_ONLY_COMMANDS → spawn-per-call ngay (listener/sync).
        2. Thử chạy qua persistent worker pool (0 spawn overhead).
        3. Nếu pool lỗi → fallback về spawn-per-call và log warning.

    Args dict (pool) vs list (spawn) được convert tự động.
    """
    # Convert args list → dict cho pool (vd: ["--group-id","123"] → {"group-id":"123"})
    pool_args: Dict[str, Any] = {}
    if args:
        it = iter(args)
        for token in it:
            if token.startswith("--"):
                key = token[2:]
                try:
                    val = next(it)
                    if val.startswith("--"):
                        pool_args[key] = True
                        pool_args[val[2:]] = True  # next flag
                    else:
                        pool_args[key] = val
                except StopIteration:
                    pool_args[key] = True
            else:
                pool_args[token] = True

    # Lệnh cần listener — luôn dùng spawn
    if command in _SPAWN_ONLY_COMMANDS:
        return await _run_via_spawn(
            command, auth, args=args, payload=payload, timeout_seconds=timeout_seconds
        )

    # Thử pool trước
    try:
        result = await _run_via_pool(
            command, auth,
            args=pool_args,
            payload=payload,
            timeout_seconds=timeout_seconds,
        )
        # Kiểm tra auth expired từ kết quả pool
        if not result.get("ok"):
            detail_text = str(result.get("error") or "")
            if _looks_like_auth_expired(detail_text):
                raise ZcaAuthExpiredError(detail_text)
            raise RuntimeError(detail_text)
        return result
    except ZcaAuthExpiredError:
        raise  # propagate auth expired không cần fallback
    except Exception as pool_exc:
        logger.warning(
            f"ZCA pool failed for command={command} ({pool_exc}), "
            f"falling back to spawn-per-call"
        )

    # Fallback: spawn-per-call
    return await _run_via_spawn(
        command, auth, args=args, payload=payload, timeout_seconds=timeout_seconds
    )


def _to_group(row: Dict[str, Any], *, is_friend: bool = False) -> Group:
    # Ưu tiên: name > group_name > display_name > số điện thoại > group_id.
    # Không bao giờ dùng group_id làm fallback name vì nó gây confusion trên UI.
    raw_name = row.get("name") or row.get("group_name") or row.get("display_name") or ""
    safe_name = str(raw_name).strip() if raw_name else ""
    group_id = str(row.get("group_id") or row.get("id") or "").strip()
    # Nếu name chỉ toàn số (số điện thoại) hoặc trùng với group_id, bỏ qua
    if safe_name.isdigit() or safe_name == group_id:
        safe_name = ""
    resolved_name = safe_name if safe_name else (f"Conversation {group_id}" if group_id else "Unknown")
    return Group(
        group_id=group_id,
        name=resolved_name,
        avatar_url=row.get("avatar_url"),
        last_message=row.get("last_message"),
        last_message_at=str(row["last_message_at"]) if row.get("last_message_at") else None,
        last_sender_id=str(row["last_sender_id"]) if row.get("last_sender_id") else None,
        last_sender_name=row.get("last_sender_name") or None,
        last_message_type=row.get("last_message_type") or None,
        unread_count=int(row.get("unread_count") or 0),
        is_pinned=bool(row.get("is_pinned") or row.get("pinned") or False),
        is_friend=bool(is_friend or row.get("is_friend") or False),
    )


def _to_message(row: Dict[str, Any]) -> Message:
    return Message(
        message_id=str(row.get("message_id") or ""),
        sender_id=row.get("sender_id") or None,
        sender_name=row.get("sender_name") or None,
        timestamp=row.get("timestamp") or None,
        time_text=row.get("time_text") or None,
        type=str(row.get("type") or "text"),
        content=row.get("content") or None,
        image_urls=[str(url) for url in (row.get("image_urls") or []) if url],
        reply_to_id=row.get("reply_to_id") or None,
        is_deleted=bool(row.get("is_deleted")),
        is_sent=bool(row.get("is_sent")),
        group_id=row.get("group_id") or None,
    )


async def list_zca_groups(auth: Dict[str, Any]) -> List[Group]:
    result = await _run_zca_command("list-groups", auth, timeout_seconds=120)
    groups = [_to_group(row, is_friend=False) for row in result.get("groups") or []]
    return [group for group in groups if group.group_id and group.name]


async def list_zca_friends(auth: Dict[str, Any]) -> List[Group]:
    result = await _run_zca_command("list-friends", auth, timeout_seconds=120)
    friends = [_to_group(row, is_friend=True) for row in result.get("friends") or []]
    return [friend for friend in friends if friend.group_id and friend.name]


async def get_zca_group_history(
    auth: Dict[str, Any],
    group_id: str,
    *,
    count: int = 500,
) -> List[Message]:
    result = await _run_zca_command(
        "group-history",
        auth,
        args=["--group-id", group_id, "--count", str(count)],
        timeout_seconds=180,
    )
    messages = [_to_message(row) for row in result.get("messages") or []]
    return [message for message in messages if message.message_id]


async def get_zca_user_history(
    auth: Dict[str, Any],
    user_id: str,
    *,
    count: int = 500,
) -> List[Message]:
    """Fetch message history with a specific Zalo user (friend thread)."""
    result = await _run_zca_command(
        "user-history",
        auth,
        args=["--user-id", user_id, "--count", str(count)],
        timeout_seconds=180,
    )
    messages = [_to_message(row) for row in result.get("messages") or []]
    return [message for message in messages if message.message_id]


async def get_zca_group_related_ids(
    auth: Dict[str, Any],
    group_id: str,
) -> List[str]:
    result = await _run_zca_command(
        "group-related-ids",
        auth,
        args=["--group-id", group_id],
        timeout_seconds=90,
    )
    ids: List[str] = []
    for value in result.get("ids") or []:
        text = str(value or "").strip()
        if text and text.isdigit() and len(text) >= 6 and text not in ids:
            ids.append(text)
    return ids


async def sync_zca_group_old_messages(
    auth: Dict[str, Any],
    group_id: Optional[str] = None,
    *,
    thread_type: int = 1,
    count: int = 500,
    timeout_ms: int = 35000,
) -> List[Message]:
    args = [
        "--type",
        str(thread_type),
        "--count",
        str(count),
        "--timeout",
        str(timeout_ms),
    ]
    if group_id:
        args.extend(["--thread-id", group_id])

    result = await _run_zca_command(
        "sync-old-messages",
        auth,
        args=args,
        timeout_seconds=max(30, int(timeout_ms / 1000) + 10),
    )
    messages = [_to_message(row) for row in result.get("messages") or []]
    if not messages and result.get("diagnostics"):
        logger.warning(
            "ZCA listener sync returned no messages for requested group/global; "
            f"diagnostics={json.dumps(result.get('diagnostics'), ensure_ascii=False)[:1000]}"
        )
    return [message for message in messages if message.message_id]


async def send_zca_message(
    auth: Dict[str, Any],
    thread_id: str,
    text: str,
    *,
    thread_type: int = 1,
    mentions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Gửi tin nhắn text. ``mentions`` = [{"pos":int,"uid":str,"len":int}] cho @tag/@All
    (xem Mục 3.3.5 + 4.6 mentionUtils của ZALO_CENTRALIZED_MODULE_GUIDE.md)."""
    payload = {"mentions": mentions} if mentions else None
    try:
        return await _run_zca_command(
            "send-message",
            auth,
            args=["--thread-id", thread_id, "--type", str(thread_type), "--text", text],
            payload=payload,
            timeout_seconds=90,
        )
    except RuntimeError as exc:
        msg = str(exc).lower()
        if thread_type == 1 and ("không tồn tại" in msg or "161" in msg or "not exist" in msg):
            logger.info(f"Fallback to thread_type=0 for send-message thread={thread_id}")
            return await _run_zca_command(
                "send-message",
                auth,
                args=["--thread-id", thread_id, "--type", "0", "--text", text],
                payload=payload,
                timeout_seconds=90,
            )
        raise


async def send_zca_images(
    auth: Dict[str, Any],
    thread_id: str,
    file_paths: List[str],
    *,
    text: str = "",
    thread_type: int = 1,
) -> Dict[str, Any]:
    try:
        return await _run_zca_command(
            "send-images",
            auth,
            args=["--thread-id", thread_id, "--type", str(thread_type)],
            payload={"file_paths": file_paths, "text": text},
            timeout_seconds=180,
        )
    except RuntimeError as exc:
        msg = str(exc).lower()
        if thread_type == 1 and ("không tồn tại" in msg or "161" in msg or "not exist" in msg):
            logger.info(f"Fallback to thread_type=0 for send-images thread={thread_id}")
            return await _run_zca_command(
                "send-images",
                auth,
                args=["--thread-id", thread_id, "--type", "0"],
                payload={"file_paths": file_paths, "text": text},
                timeout_seconds=180,
            )
        raise


async def remove_zca_unread_mark(
    auth: Dict[str, Any],
    thread_id: str,
    *,
    thread_type: int = 1,
) -> Dict[str, Any]:
    try:
        return await _run_zca_command(
            "remove-unread",
            auth,
            args=["--thread-id", thread_id, "--type", str(thread_type)],
            timeout_seconds=30,
        )
    except RuntimeError as exc:
        msg = str(exc).lower()
        if thread_type == 1 and ("không tồn tại" in msg or "161" in msg or "not exist" in msg):
            logger.info(f"Fallback to thread_type=0 for remove-unread thread={thread_id}")
            return await _run_zca_command(
                "remove-unread",
                auth,
                args=["--thread-id", thread_id, "--type", "0"],
                timeout_seconds=30,
            )
        raise


async def find_zca_user_by_phone(auth: Dict[str, Any], phone_e164: str) -> Dict[str, Any]:
    """Gọi zca-js findUser(phone). Trả về dict user hoặc raise RuntimeError.

    Số điện thoại phải ở dạng E.164 (vd: +84939108906). Dùng ``app.core.phone.vn_phone_to_e164``
    để chuẩn hoá trước khi gọi.

    Raises:
        RuntimeError: khi ZCA trả lỗi (user không tồn tại, không nhận tin từ người lạ, rate limit...)
        ZcaAuthExpiredError: khi session Zalo đã hết hạn.
    """
    result = await _run_zca_command(
        "find-user-by-phone",
        auth,
        args=["--phone", phone_e164],
        timeout_seconds=30,
    )
    return result.get("user") or {}


async def find_zca_user_by_username(auth: Dict[str, Any], username: str) -> Dict[str, Any]:
    """Gọi zca-js findUserByUsername(username)."""
    result = await _run_zca_command(
        "find-user-by-username",
        auth,
        args=["--username", username],
        timeout_seconds=30,
    )
    return result.get("user") or {}


async def first_time_sync(
    auth: Dict[str, Any],
    *,
    zalo_account_id: str,
    messages_per_chat: int = 50,
    group_limit: int = 25,
    include_friends: bool = True,
) -> Dict[str, Any]:
    """First-time sync: list top groups + fetch recent messages từ mỗi group + friends.

    Args:
        auth: ZCA auth dict (cookies/imei/userAgent).
        zalo_account_id: owner user_id (chỉ để log).
        messages_per_chat: số tin lấy từ mỗi conversation.
        group_limit: giới hạn số group sync.
        include_friends: có sync personal chat với bạn bè không.

    Returns:
        Dict với keys: ok, groups, friends, messages, total_groups, total_messages, errors.

    Raises:
        ZcaAuthExpiredError: khi session Zalo đã hết hạn.
        RuntimeError: các lỗi khác.
    """
    args = [
        "--messages-per-chat", str(messages_per_chat),
        "--group-limit", str(group_limit),
        "--include-friends", "true" if include_friends else "false",
    ]
    # Timeout dài vì first-time sync có thể mất vài phút với nhiều group + DM friends.
    timeout = 90 + (group_limit * 12)
    try:
        result = await _run_zca_command(
            "first-time-sync",
            auth,
            args=args,
            timeout_seconds=timeout,
        )
        logger.info(
            f"ZCA first-time sync done for user={zalo_account_id}: "
            f"groups={result.get('total_groups', 0)}, "
            f"messages={result.get('total_messages', 0)}, "
            f"errors={len(result.get('errors') or [])}"
        )
        return result
    except Exception as exc:
        logger.warning(
            f"ZCA first-time sync failed for user={zalo_account_id}: {exc}"
        )
        # Re-raise để caller quyết định — listener sẽ vẫn start dù sync fail.
        raise


# ── Zalo tập trung: recall / friend actions / group-scan / sticker ──────────
# Port từ ZALO_CENTRALIZED_MODULE_GUIDE.md (InvoiceFlowManager) — xem Mục 3.3.5,
# 3.5, 8(c)(e)(f) và cảnh báo Mục 11.1 (is_requested/is_requesting map ngược).

async def recall_zca_message(
    auth: Dict[str, Any],
    thread_id: str,
    *,
    msg_id: str,
    cli_msg_id: str,
    thread_type: int = 1,
) -> Dict[str, Any]:
    """Thu hồi tin nhắn thật (api.undo) — tin biến mất ở CẢ HAI phía, khác 'xoá ở phía tôi'.

    Cần cả msg_id (real Zalo message id) lẫn cli_msg_id (id phía client lúc gửi) —
    chỉ có ở tin do CHÍNH tài khoản này gửi.
    """
    return await _run_zca_command(
        "recall-message",
        auth,
        args=["--thread-id", thread_id, "--type", str(thread_type)],
        payload={"msg_id": msg_id, "cli_msg_id": cli_msg_id},
        timeout_seconds=30,
    )


async def add_zca_reaction(
    auth: Dict[str, Any],
    thread_id: str,
    *,
    msg_id: str,
    cli_msg_id: str,
    icon: str,
    thread_type: int = 1,
) -> Dict[str, Any]:
    """Thả cảm xúc (giống bấm giữ tin nhắn trên app Zalo rồi chọn icon).

    `icon` là tên enum Reactions của zca-js (HEART/LIKE/HAHA/WOW/CRY/ANGRY/...),
    map thật sang giá trị Zalo cần ở phía Node (xem cmdAddReaction). msg_id/
    cli_msg_id là của TIN ĐANG ĐƯỢC REACT (không phải tin mới), giống recall.
    """
    return await _run_zca_command(
        "add-reaction",
        auth,
        args=["--thread-id", thread_id, "--type", str(thread_type)],
        payload={"msg_id": msg_id, "cli_msg_id": cli_msg_id, "icon": icon},
        timeout_seconds=30,
    )


async def search_zca_stickers(auth: Dict[str, Any], keyword: str, limit: int = 24) -> List[Dict[str, Any]]:
    """Tìm sticker thật theo từ khoá (giống thanh tìm sticker trong app Zalo) —
    trả về sticker đã có đủ url ảnh (stickerUrl/stickerWebpUrl) để hiển thị
    trực tiếp lên UI, không cần FE gọi thêm round-trip lấy detail."""
    result = await _run_zca_command(
        "search-stickers",
        auth,
        args=["--keyword", keyword, "--limit", str(limit)],
        timeout_seconds=30,
    )
    return result.get("stickers") or []


async def get_zca_friend_status(auth: Dict[str, Any], uid: str) -> Dict[str, Any]:
    """Trả {is_friend, is_requested, is_requesting, ...}.

    CẢNH BÁO (Mục 11.1 guide): is_requested=True nghĩa là MÌNH đã gửi lời mời (chờ họ
    chấp nhận); is_requesting=True nghĩa là HỌ đang gửi lời mời cho MÌNH. Rất dễ map
    ngược — giữ nguyên tên field khi trả lên API/FE, không đảo nghĩa.
    """
    result = await _run_zca_command(
        "friend-status", auth, args=["--uid", uid], timeout_seconds=20,
    )
    return result.get("response") or {}


async def send_zca_friend_request(
    auth: Dict[str, Any], uid: str, *, message: str = "",
) -> Dict[str, Any]:
    return await _run_zca_command(
        "send-friend-request",
        auth,
        args=["--uid", uid],
        payload={"msg": message},
        timeout_seconds=30,
    )


async def accept_zca_friend_request(auth: Dict[str, Any], uid: str) -> Dict[str, Any]:
    return await _run_zca_command(
        "accept-friend-request", auth, args=["--uid", uid], timeout_seconds=30,
    )


async def get_zca_group_members_full(
    auth: Dict[str, Any], group_id: str,
) -> Dict[str, Any]:
    """Quét ĐẦY ĐỦ thành viên 1 nhóm (memberIds từ getGroupInfo không bị cap ở tầng
    API — cap ~155-200 chỉ xảy ra ở UI Zalo), resolve tên/avatar theo batch 50.

    Returns: {group_id, total_member, members: [{uid, display_name, avatar_url, role}]}.
    """
    result = await _run_zca_command(
        "group-members-full", auth, args=["--group-id", group_id], timeout_seconds=90,
    )
    return {
        "group_id": result.get("group_id") or group_id,
        "total_member": int(result.get("total_member") or 0),
        "members": result.get("members") or [],
    }


async def get_zca_stickers_detail(auth: Dict[str, Any], sticker_ids: List[int]) -> List[Dict[str, Any]]:
    ids_csv = ",".join(str(int(i)) for i in sticker_ids)
    result = await _run_zca_command(
        "stickers-detail", auth, args=["--ids", ids_csv], timeout_seconds=30,
    )
    return result.get("stickers") or []


async def invite_zca_user_to_group(auth: Dict[str, Any], uid: str, group_id: str) -> Dict[str, Any]:
    """Thêm/mời uid vào group_id. Tự thử add thẳng trước (đã bạn bè), rồi mời (quen biết)."""
    return await _run_zca_command(
        "invite-to-group", auth, args=["--uid", uid, "--group-id", group_id], timeout_seconds=30,
    )


async def send_zca_sticker(
    auth: Dict[str, Any],
    thread_id: str,
    *,
    sticker_id: int,
    cate_id: int,
    sticker_type: int = 1,
    thread_type: int = 1,
) -> Dict[str, Any]:
    return await _run_zca_command(
        "send-sticker",
        auth,
        args=["--thread-id", thread_id, "--type", str(thread_type)],
        payload={"id": sticker_id, "cateId": cate_id, "type": sticker_type},
        timeout_seconds=30,
    )

