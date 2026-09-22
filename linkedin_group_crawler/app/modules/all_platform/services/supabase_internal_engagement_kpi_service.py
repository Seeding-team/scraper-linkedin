"""KPI tracking for Internal Engagement (Tương tác nội bộ) — comments and
reactions (like/love/care/haha/wow/sad/angry) and shares that employees
perform, via the comment-extension, on the company's own MarkeeAI-sourced
Facebook Page posts. Separate table from seeding_content_kpi (group seeding),
since posts here aren't crawled by us and reactions have no equivalent there.
"""

from __future__ import annotations

import html
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
import urllib.parse
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from bs4 import BeautifulSoup
import httpx
from fastapi import HTTPException
from supabase import Client

from app.core.logger import get_logger, logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_user_service import get_all_teams, get_user

logger = get_logger(__name__)

_VERIFIED_STATUSES = {"success"}

REACTION_LABELS = {
    "like": "Thích",
    "love": "Yêu thích",
    "care": "Thương thương",
    "haha": "Haha",
    "wow": "Wow",
    "sad": "Buồn",
    "angry": "Phẫn nộ",
}


def _get_member_id(email: str) -> Optional[str]:
    supabase: Client = get_supabase_client()
    res = supabase.table("members").select("id").eq("email", email).limit(1).execute()
    if res.data:
        return res.data[0].get("id")
    res_app = supabase.table("app_users").select("id").eq("email", email).limit(1).execute()
    return res_app.data[0].get("id") if res_app.data else None


def record_action(payload: dict) -> dict:
    """Record the final result of one comment/reaction/share attempt."""
    print(f"Nhận request KPI: {payload}")
    supabase: Client = get_supabase_client()

    email = payload.get("email_member") or payload.get("email") or ""
    id_member = _get_member_id(email) if email else None
    if not id_member:
        raise ValueError(f"Member email '{email}' not found in app_users")

    data = {
        "id_member": id_member,
        "fanpage_id": payload.get("fanpage_id") or "",
        "fanpage_name": payload.get("fanpage_name") or "",
        "facebook_post_id": payload.get("facebook_post_id") or "unknown",
        "link_post": payload.get("link_post") or payload.get("url") or "",
        "action_type": payload.get("action_type") or "comment",
        "content": payload.get("content") or payload.get("text") or "",
        "status": payload.get("status") or "success",
        "platform": payload.get("platform") or "facebook",
    }
    if payload.get("reaction_id"):
        data["reaction_id"] = payload.get("reaction_id")
    if payload.get("id_social_account"):
        data["id_social_account"] = payload.get("id_social_account")
    if payload.get("profile_id"):
        data["profile_id"] = payload.get("profile_id")
    if payload.get("error_message"):
        data["error_message"] = payload.get("error_message")

    result = supabase.table("internal_engagement_kpi").insert(data).execute()
    return result.data[0] if result.data else {}


def get_marks_by_links(email_member: str, link_posts: list[str]) -> dict[str, str]:
    if not link_posts:
        return {}

    supabase: Client = get_supabase_client()
    id_member = _get_member_id(email_member)
    if not id_member:
        return {link: "need" for link in link_posts}

    result = (
        supabase.table("internal_engagement_kpi")
        .select("link_post, status")
        .eq("id_member", id_member)
        .in_("link_post", link_posts)
        .execute()
    )

    best_status: dict[str, str] = {}
    for row in result.data or []:
        link = row["link_post"]
        status = row.get("status")
        if status in _VERIFIED_STATUSES:
            best_status[link] = "completed"
        elif link not in best_status:
            best_status[link] = "received"

    return {link: best_status.get(link, "need") for link in link_posts}


def get_action_summary(
    email_member: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    supabase: Client = get_supabase_client()
    id_member = _get_member_id(email_member)
    if not id_member:
        return {"total": 0, "by_action_type": {}}

    query = (
        supabase.table("internal_engagement_kpi")
        .select("action_type, created_at")
        .eq("id_member", id_member)
        .eq("status", "success")
    )
    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        query = query.lte("created_at", date_to)

    result = query.execute()
    rows = result.data or []

    by_action_type: dict[str, int] = {}
    for row in rows:
        action_type = row["action_type"]
        by_action_type[action_type] = by_action_type.get(action_type, 0) + 1

    return {"total": len(rows), "by_action_type": by_action_type}


def resolve_team_scope(email: str, team_id_filter: Optional[str] = None) -> tuple[list[dict], str]:
    user = get_user(email)
    role = user.get("role", "member")
    all_teams = get_all_teams()

    if role == "admin":
        teams = all_teams
        if team_id_filter:
            teams = [t for t in teams if t["id"] == team_id_filter]
        return teams, role

    if role == "leader":
        my_id = user.get("id")
        teams = [t for t in all_teams if t.get("id_leader") == my_id]
        return teams, role

    return [], role


def _member_team_map(teams: list[dict]) -> dict[str, dict]:
    """member_id -> {team_id, team_name} (Chỉ lấy thành viên được tick, KHÔNG ép Leader vào)."""
    out: dict[str, dict] = {}
    for t in teams:
        for m in t.get("members", []):
            out.setdefault(m["id"], {"team_id": t["id"], "team_name": t.get("name_team") or "Team"})
    return out


def _enrich_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    supabase: Client = get_supabase_client()

    member_ids = list({r["id_member"] for r in rows if r.get("id_member")})
    users = (
        supabase.table("app_users").select("id, email, name").in_("id", member_ids).execute().data or []
    ) if member_ids else []
    user_map = {u["id"]: u for u in users}

    account_ids = list({r["id_social_account"] for r in rows if r.get("id_social_account")})
    accounts = (
        supabase.table("social_accounts").select("id, account_name").in_("id", account_ids).execute().data or []
    ) if account_ids else []
    account_map = {a["id"]: a for a in accounts}

    enriched = []
    for r in rows:
        user = user_map.get(r.get("id_member"), {})
        account = account_map.get(r.get("id_social_account"), {})
        action_type = r.get("action_type")
        account_label = account.get("account_name") or r.get("profile_id") or "tài khoản đang đăng nhập"
        if action_type == "comment":
            summary = f"đã bình luận với tài khoản: {account_label} với nội dung: \"{r.get('content') or ''}\""
        elif action_type == "share":
            summary = f"đã chia sẻ bài viết với tài khoản: {account_label}"
        else:
            summary = f"đã tương tác {REACTION_LABELS.get(action_type, action_type)} với tài khoản: {account_label}"

        enriched.append({
            **r,
            "member_email": user.get("email"),
            "member_name": user.get("name") or (user.get("email") or "").split("@")[0] or "?",
            "account_name": account.get("account_name"),
            "summary": summary,
        })
    return enriched


def get_team_daily_trend(email: str, days: int = 14, team_id: Optional[str] = None) -> dict:
    """Độ ổn định: Chỉ lấy thành viên được tick rõ ràng trong UI."""
    teams, role = resolve_team_scope(email, team_id)
    if not teams:
        return {"role": role, "teams": []}

    today = datetime.now(timezone.utc).date()
    day_list = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    since = day_list[0]
    supabase: Client = get_supabase_client()

    result_teams = []
    for team in teams:
        member_ids = [m["id"] for m in team.get("members", [])]
        series_map: dict[str, int] = defaultdict(int)
        if member_ids:
            rows = (
                supabase.table("internal_engagement_kpi")
                .select("created_at")
                .in_("id_member", member_ids)
                .eq("status", "success")
                .gte("created_at", since)
                .execute()
            ).data or []
            for row in rows:
                series_map[str(row["created_at"])[:10]] += 1

        series = [{"date": day, "total": series_map.get(day, 0)} for day in day_list]

        result_teams.append({
            "team_id": team["id"],
            "team_name": team.get("name_team") or "Team",
            "series": series,
        })

    return {"role": role, "teams": result_teams}


def get_team_totals(
    email: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    team_id: Optional[str] = None,
) -> dict:
    """Per-team totals + stability score (Chỉ tính members được tick)."""
    teams, role = resolve_team_scope(email, team_id)
    if not teams:
        return {"role": role, "teams": []}

    supabase: Client = get_supabase_client()

    range_days = 30
    if date_from and date_to:
        try:
            d1 = datetime.fromisoformat(date_from).date()
            d2 = datetime.fromisoformat(date_to).date()
            range_days = max((d2 - d1).days + 1, 1)
        except ValueError:
            pass

    result_teams = []
    for team in teams:
        member_ids = [m["id"] for m in team.get("members", [])]
        total = 0
        active_days: set[str] = set()
        by_action_type: dict[str, int] = defaultdict(int)

        if member_ids:
            query = (
                supabase.table("internal_engagement_kpi")
                .select("action_type, created_at")
                .in_("id_member", member_ids)
                .eq("status", "success")
            )
            if date_from:
                query = query.gte("created_at", date_from)
            if date_to:
                query = query.lte("created_at", date_to)
            rows = query.execute().data or []

            total = len(rows)
            for row in rows:
                by_action_type[row["action_type"]] += 1
                active_days.add(str(row["created_at"])[:10])

        stability_score = round(len(active_days) / range_days, 3) if range_days else 0.0

        result_teams.append({
            "team_id": team["id"],
            "team_name": team.get("name_team") or "Team",
            "number_of_member": len(member_ids),
            "total": total,
            "active_days": len(active_days),
            "range_days": range_days,
            "stability_score": stability_score,
            "by_action_type": dict(by_action_type),
        })

    result_teams.sort(key=lambda t: (t["stability_score"], t["total"]), reverse=True)
    return {"role": role, "teams": result_teams}


def fetch_facebook_post_metadata(url: str, cookie: Optional[str] = None) -> dict[str, Optional[str]]:
    debug_res = debug_fetch_facebook_post_metadata(url, cookie=cookie)
    return debug_res.get("metadata", {})


def debug_fetch_facebook_post_metadata(url: str, cookie: Optional[str] = None) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }
    if cookie:
        headers["Cookie"] = cookie.strip()

    metadata: dict[str, Optional[str]] = {
        "title": None,
        "description": None,
        "image": None,
        "site_name": None,
    }
    debug_info = {
        "target_url": url,
        "has_cookie": bool(cookie),
        "http_status": None,
        "final_url": None,
        "is_redirected_to_login": False,
        "error": None,
        "page_title": None,
        "metadata": metadata,
    }

    urls_to_try = [url]
    if "facebook.com" in url:
        mbasic_url = url.replace("www.facebook.com", "mbasic.facebook.com").replace("web.facebook.com", "mbasic.facebook.com").replace("m.facebook.com", "mbasic.facebook.com")
        if mbasic_url != url:
            urls_to_try.append(mbasic_url)
        m_url = url.replace("www.facebook.com", "m.facebook.com").replace("web.facebook.com", "m.facebook.com")
        if m_url != url and m_url not in urls_to_try:
            urls_to_try.append(m_url)

    for target in urls_to_try:
        try:
            with httpx.Client(follow_redirects=True, timeout=8.0) as client:
                res = client.get(target, headers=headers)
                debug_info["http_status"] = res.status_code
                debug_info["is_redirected_to_login"] = "/login" in str(res.url).lower() or "login.php" in str(res.url).lower()

                res_text = res.text
                if not metadata.get("raw_html"):
                    metadata["raw_html"] = res_text

                if res.status_code != 200 and not debug_info["is_redirected_to_login"]:
                    continue

                m_html_title = re.search(r'<title[^>]*>(.*?)</title>', res_text, re.IGNORECASE | re.DOTALL)
                if m_html_title and not debug_info["page_title"]:
                    debug_info["page_title"] = html.unescape(m_html_title.group(1).strip())

                if not metadata["title"]:
                    m_title = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', res_text, re.IGNORECASE) or \
                              re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:title["\']', res_text, re.IGNORECASE)
                    if m_title:
                        metadata["title"] = html.unescape(m_title.group(1))

                if not metadata["description"]:
                    m_desc = re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', res_text, re.IGNORECASE) or \
                              re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:description["\']', res_text, re.IGNORECASE)
                    if m_desc:
                        metadata["description"] = html.unescape(m_desc.group(1))

                if not metadata["image"]:
                    m_img = re.search(r'<meta\s+property=["\']og:image["\']\s+content=["\']([^"\']+)["\']', res_text, re.IGNORECASE) or \
                            re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:image["\']', res_text, re.IGNORECASE)
                    if m_img:
                        metadata["image"] = html.unescape(m_img.group(1))

                if not metadata["site_name"]:
                    m_site = re.search(r'<meta\s+property=["\']og:site_name["\']\s+content=["\']([^"\']+)["\']', res_text, re.IGNORECASE) or \
                             re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:site_name["\']', res_text, re.IGNORECASE)
                    if m_site:
                        metadata["site_name"] = html.unescape(m_site.group(1))

                if metadata["title"] or metadata["description"]:
                    break

        except Exception as e:
            if not debug_info["error"]:
                debug_info["error"] = str(e)

    return debug_info


INVALID_FANPAGE_NAMES = {
    "photo", "photo.php", "photos", "reel", "reels", "post", "posts",
    "video", "videos", "watch", "permalink", "permalink.php", "story",
    "story.php", "profile", "profile.php", "groups", "group", "pfbid",
    "share", "p", "facebook", "log in", "đăng nhập", "chú ý", "null", "none"
}


def clean_fb_string(s: Optional[str]) -> str:
    if not s:
        return ""
    cleaned = html.unescape(str(s)).strip()
    suffixes = [
        "| Facebook", "- Facebook", "| Meta", "- Meta",
        "on Facebook", "trên Facebook", "| FB", "- FB"
    ]
    for suf in suffixes:
        if cleaned.lower().endswith(suf.lower()):
            cleaned = cleaned[:-len(suf)].strip()
    return cleaned


def extract_fanpage_name_from_meta_or_url(link_post: str, meta: dict) -> str:
    raw_title = meta.get("title") or meta.get("page_title") or meta.get("og:title") or ""
    raw_desc = meta.get("description") or meta.get("og:description") or ""

    clean_title = clean_fb_string(raw_title)
    clean_desc = clean_fb_string(raw_desc)

    # 1. Kỹ thuật "Chẻ chuỗi" (Split) từ Title kết hợp check URL mở rộng (/reel/, /share/...) và so sánh độ dài chuỗi
    if clean_title:
        is_video_link = any(k in link_post.lower() for k in ["/reel/", "/reels/", "/videos/", "/watch", "/share/"])

        # Xử lý dấu phân cách |
        if "|" in clean_title:
            parts = clean_title.split("|")
            # Nếu là link video/share HOẶC phần đầu dài hơn phần đuôi (Caption | Tên Page)
            if is_video_link or len(parts[0].strip()) > len(parts[-1].strip()):
                candidate = parts[-1].strip()
            else:
                candidate = parts[0].strip()

            candidate = clean_fb_string(candidate)
            if candidate and candidate.lower() not in INVALID_FANPAGE_NAMES and len(candidate) < 100:
                return candidate

        # Xử lý dấu phân cách -
        elif " - " in clean_title:
            parts = clean_title.split(" - ")
            if is_video_link or len(parts[0].strip()) > len(parts[-1].strip()):
                candidate = parts[-1].strip()
            else:
                candidate = parts[0].strip()

            candidate = clean_fb_string(candidate)
            if candidate and candidate.lower() not in INVALID_FANPAGE_NAMES and len(candidate) < 100:
                return candidate

        elif len(clean_title) >= 2 and clean_title.lower() not in INVALID_FANPAGE_NAMES and len(clean_title) < 100:
            return clean_title

    # 2. Thử bóc từ Meta (cho bài KHÔNG caption)
    raw_html = meta.get("raw_html") or ""
    desc_str = raw_desc
    if not desc_str and raw_html:
        desc_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE) or \
                     re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']', raw_html, re.IGNORECASE)
        if desc_match:
            desc_str = desc_match.group(1)

    if desc_str:
        unescaped_desc = html.unescape(desc_str).strip()
        keywords = ["lượt thích", "đang nói về", "lượt đăng ký", "người theo dõi", "followers", "likes"]
        if any(kw in unescaped_desc.lower() for kw in keywords):
            possible_name = re.split(r'\.\s+|\s+-\s+|\s+\|\s+', unescaped_desc)[0].strip()
            possible_name = clean_fb_string(possible_name)
            if possible_name and possible_name.lower() not in INVALID_FANPAGE_NAMES:
                return possible_name

    # 3. Cào sâu vào JSON Relay (Cho bài CÓ caption) - Khóa mục tiêu để tránh bắt nhầm user đang login
    if raw_html:
        patterns = [
            r'"actors"\s*:\s*\[\s*\{\s*"__typename"\s*:\s*"(?:Page|User)"[^}]*?"name"\s*:\s*"([^"]+)"',
            r'"author"\s*:\s*\{\s*"__typename"\s*:\s*"(?:Page|User)"[^}]*?"name"\s*:\s*"([^"]+)"',
            r'"owner"\s*:\s*\{\s*"__typename"\s*:\s*"(?:Page|User)"[^}]*?"name"\s*:\s*"([^"]+)"',
            r'"publisher"\s*:\s*\{\s*"__typename"\s*:\s*"(?:Page|User)"[^}]*?"name"\s*:\s*"([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, raw_html)
            if match:
                try:
                    name = match.group(1).encode().decode('unicode-escape', errors='ignore').strip()
                except Exception:
                    name = match.group(1).strip()
                name = clean_fb_string(name)
                if name and name.lower() not in INVALID_FANPAGE_NAMES and len(name) < 80:
                    if name != "Họ Nguyễn TênQ":
                        return name

    # 4. Quét site_name
    site_name = clean_fb_string(meta.get("site_name") or "")
    if site_name and site_name.lower() not in INVALID_FANPAGE_NAMES:
        return site_name

    # 5. Quét từ URL Path (lọc bỏ triệt để các từ khóa rác)
    if "facebook.com/groups/" in link_post:
        return "Nhóm Facebook"

    parts = link_post.replace("https://", "").replace("http://", "").replace("www.", "").replace("web.", "").replace("m.", "").split("/")
    if len(parts) > 1 and parts[0].startswith("facebook.com"):
        sub = parts[1].split("?")[0].strip()
        if sub and sub.lower() not in INVALID_FANPAGE_NAMES:
            return sub

    # 6. CHỈ Fallback khi TOÀN BỘ phương pháp bóc tách (Meta, JSON Regex, URL Path) đều rỗng
    if "/photo" in link_post.lower() or "fbid=" in link_post.lower() or "set=" in link_post.lower():
        return "Bài viết Ảnh Facebook"
    elif "/reel/" in link_post.lower() or "/reels/" in link_post.lower():
        return "Video Reel Facebook"

    return "Markee AI Marketing"


def clean_facebook_content(meta: dict, fanpage_name: str) -> Optional[str]:
    raw_html = meta.get("raw_html") or ""
    raw_desc = meta.get("description") or meta.get("og:description") or ""

    if not raw_desc and raw_html:
        desc_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE) or \
                     re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']', raw_html, re.IGNORECASE) or \
                     re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE)
        if desc_match:
            raw_desc = desc_match.group(1)

    if raw_desc:
        raw_desc = html.unescape(raw_desc).strip()

    stats_keywords = ["lượt thích", "người theo dõi", "đang nói về", "lượt đăng ký", "followers", "likes"]
    is_stats_desc = any(kw in raw_desc.lower() for kw in stats_keywords)

    clean_desc = clean_fb_string(raw_desc) if not is_stats_desc else ""

    raw_title = clean_fb_string(meta.get("title") or meta.get("page_title") or "")
    clean_title = raw_title
    if fanpage_name and clean_title.startswith(fanpage_name):
        clean_title = clean_title[len(fanpage_name):].strip()
        for prefix in ["-", "|", ":", "–"]:
            if clean_title.startswith(prefix):
                clean_title = clean_title[1:].strip()

    if not clean_title and raw_title:
        for delim in [" - ", " | ", " : ", " – "]:
            if delim in raw_title:
                parts = raw_title.split(delim, 1)
                if len(parts) > 1 and parts[1].strip():
                    clean_title = parts[1].strip()
                    break

    parts = []
    if clean_title and clean_title.lower() not in INVALID_FANPAGE_NAMES:
        parts.append(clean_title)

    if clean_desc and clean_desc.lower() not in INVALID_FANPAGE_NAMES:
        if not clean_title or (clean_title not in clean_desc and clean_desc not in clean_title):
            parts.append(clean_desc)
        elif len(clean_desc) > len(clean_title):
            parts = [clean_desc]

    return "\n\n".join(parts) if parts else None


_TRACKING_PARAMS = {
    "mibextid", "ref", "__cft__", "__tn__", "rdid", "wtsid", "sfnsn",
    "paipv", "notif_id", "notif_t", "checkpoint_data", "refsrc", "hrc", "_rdr",
    "st", "s"
}


def sanitize_linkedin_url(url: str) -> str:
    """Chuẩn hóa URL LinkedIn: Chuyển subdomain quốc gia (vn., en.,...) thành www. và xóa tracking parameters ?..."""
    if not url or "linkedin.com" not in url.lower():
        return url or ""
    clean_url_str = re.sub(r'https?://[a-zA-Z]{2,3}\.linkedin\.com', 'https://www.linkedin.com', url.strip(), flags=re.IGNORECASE)
    clean_url_str = clean_url_str.split('?')[0].strip()
    return clean_url_str


def clean_url(url: str) -> str:
    if not url:
        return ""

    cleaned = url.strip()

    if "linkedin.com" in cleaned.lower():
        cleaned = sanitize_linkedin_url(cleaned)

    if "share_url=" in cleaned:
        try:
            parsed = urlparse(cleaned)
            query_params = parse_qs(parsed.query)
            if "share_url" in query_params and query_params["share_url"]:
                decoded = urllib.parse.unquote(query_params["share_url"][0])
                if decoded and decoded.startswith("http"):
                    cleaned = decoded
        except Exception:
            pass

    try:
        parsed = urlparse(cleaned)
        netloc = parsed.netloc
        if netloc in ["m.facebook.com", "mobile.facebook.com", "web.facebook.com", "l.facebook.com", "fb.com"]:
            netloc = "www.facebook.com"

        query_params = parse_qs(parsed.query, keep_blank_values=True)
        # BẮT BUỘC GIỮ LẠI CÁC PARAMS ĐỊNH DANH (fbid, set, story_fbid, id, v, ...), CHỈ LỌC BỎ TRACKING PARAMS RÁC
        filtered_params = {
            k: v for k, v in query_params.items()
            if k.lower() not in _TRACKING_PARAMS
        }

        new_query = urllib.parse.urlencode(filtered_params, doseq=True)
        cleaned = urlunparse((
            parsed.scheme or "https",
            netloc,
            parsed.path,
            parsed.params,
            new_query,
            ""
        ))
    except Exception:
        pass

    return cleaned.rstrip("/#")


def strip_fb_tracking_params(url_str: str) -> str:
    return clean_url(url_str)


async def normalize_facebook_url_and_scrape(raw_url: str) -> tuple[str, str]:
    if not raw_url or not raw_url.strip():
        return "", "Bài viết Facebook - Cần tương tác"

    initial_clean_url = clean_url(raw_url)
    final_url = initial_clean_url
    extracted_content = "Bài viết Facebook - Cần tương tác"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0, headers=headers) as client:
            first_res = await client.get(initial_clean_url)
            resolved_url = str(first_res.url)
            
            soup1 = BeautifulSoup(first_res.text or "", "html.parser")
            og_url = soup1.find("meta", property="og:url") or soup1.find("meta", attrs={"name": "og:url"})
            if og_url and og_url.get("content"):
                extracted_og = html.unescape(og_url["content"]).replace("&amp;", "&")
                if "facebook.com" in extracted_og and "/login" not in extracted_og:
                    resolved_url = extracted_og

            if "/login" not in resolved_url.lower() and "checkpoint" not in resolved_url.lower():
                final_url = clean_url(resolved_url)

            is_reel = "/reel/" in final_url.lower() or "/reels/" in final_url.lower()

            urls_to_scrape = [final_url]
            if "facebook.com" in final_url and not is_reel:
                mbasic = final_url.replace("www.facebook.com", "mbasic.facebook.com").replace("web.facebook.com", "mbasic.facebook.com")
                if mbasic != final_url:
                    urls_to_scrape.append(mbasic)

            for target in urls_to_scrape:
                res = await client.get(target)
                if "/login" in str(res.url).lower() or "login.php" in str(res.url).lower():
                    continue
                    
                html_text = res.text or ""
                soup = BeautifulSoup(html_text, "html.parser")

                content_text = None

                # Bóc tách riêng dành cho Facebook Reel (/reel/ và /reels/)
                if is_reel:
                    # 1. Trích xuất caption từ description meta
                    og_desc = soup.find("meta", property="og:description") or soup.find("meta", attrs={"name": "og:description"}) or soup.find("meta", attrs={"name": "description"})
                    if og_desc and og_desc.get("content"):
                        content_text = og_desc["content"]

                    # 2. Quét regex từ JSON script thô của Reel
                    if not content_text:
                        reel_msg = re.search(r'"message":\s*\{\s*"text":\s*"([^"]+)"', html_text) or re.search(r'"caption":\s*\{\s*"text":\s*"([^"]+)"', html_text)
                        if reel_msg:
                            content_text = reel_msg.group(1).encode().decode('unicode-escape', errors='ignore')

                    # 3. Quét Tên Fanpage / Chủ Reel
                    owner_name = None
                    owner_match = re.search(r'"owner":\s*\{\s*"name":\s*"([^"]+)"', html_text) or re.search(r'"owner_name":\s*"([^"]+)"', html_text)
                    if owner_match:
                        owner_name = owner_match.group(1).encode().decode('unicode-escape', errors='ignore')

                    if content_text and owner_name and owner_name.lower() not in content_text.lower():
                        content_text = f"[{owner_name}] {content_text}"
                    elif owner_name and not content_text:
                        content_text = f"Video Reel từ {owner_name}"

                # Bóc tách cho bài viết thường / Photo / Video
                if not content_text:
                    og_title = soup.find("meta", property="og:title") or soup.find("meta", attrs={"name": "og:title"})
                    if og_title and og_title.get("content"): content_text = og_title["content"]
                if not content_text:
                    title_tag = soup.find("title")
                    if title_tag and title_tag.text: content_text = title_tag.text
                if not content_text:
                    og_desc = soup.find("meta", property="og:description") or soup.find("meta", attrs={"name": "og:description"})
                    if og_desc and og_desc.get("content"): content_text = og_desc["content"]

                if content_text:
                    raw_title = html.unescape(str(content_text)).strip()
                    for suffix in ["| Facebook", "- Facebook", "| Meta", "- Meta"]:
                        if raw_title.endswith(suffix): raw_title = raw_title[:-len(suffix)].strip()
                    if raw_title and raw_title.lower() not in ["facebook", "share", "log in", "đăng nhập", "chú ý"]:
                        extracted_content = raw_title
                        break 

    except Exception as scrape_err:
        logger.warning(f"Scraping error for {initial_clean_url}: {scrape_err}")

    if not extracted_content or not extracted_content.strip() or extracted_content.lower() in ["facebook", "share", "log in", "đăng nhập"]:
        extracted_content = "Bài viết Facebook - Cần tương tác"

    return final_url, extracted_content


async def normalize_facebook_url(raw_url: str) -> str:
    url, _ = await normalize_facebook_url_and_scrape(raw_url)
    return url


async def add_custom_post(
    email_member: str,
    link_post: str,
    content: Optional[str] = None,
    fanpage_name: Optional[str] = None,
    media_urls: Optional[list] = None,
    cookie: Optional[str] = None,
    campaign_id: Optional[str] = None,
    campaign_name: Optional[str] = None,
    deadline: Optional[str] = None,
    target_comments: int = 32,
    assigned_team_ids: Optional[list] = None,
    platform: Optional[str] = None,
    likes: Optional[int] = None,
    comments: Optional[int] = None,
    shares: Optional[int] = None,
) -> dict:
    supabase: Client = get_supabase_client()
    user_id = _get_member_id(email_member)

    if not user_id:
        raise Exception("Không tìm thấy thông tin user.")

def fetch_youtube_post_metadata(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            html_content = response.read().decode("utf-8", errors="ignore")

        # 1. Trích xuất Tên Kênh (Channel Name)
        channel_name = ""
        author_match = re.search(
            r'<span\s+itemprop=["\']author["\'][^>]*>[\s\S]*?<link\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']',
            html_content, re.IGNORECASE
        )
        if author_match and author_match.group(1):
            channel_name = author_match.group(1)

        if not channel_name:
            meta_author = re.search(r'<meta\s+itemprop=["\']author["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
            if meta_author and meta_author.group(1):
                channel_name = meta_author.group(1)

        if not channel_name:
            channel_json = re.search(r'"channel"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"\}', html_content, re.IGNORECASE)
            if channel_json and channel_json.group(1):
                channel_name = channel_json.group(1)

        if not channel_name:
            owner_json = re.search(r'"videoOwnerRenderer"\s*:\s*\{\s*"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"', html_content, re.IGNORECASE) or \
                         re.search(r'"ownerChannelName"\s*:\s*"([^"]+)"', html_content, re.IGNORECASE) or \
                         re.search(r'"author"\s*:\s*"([^"]+)"', html_content, re.IGNORECASE)
            if owner_json and owner_json.group(1):
                channel_name = owner_json.group(1)

        if not channel_name:
            link_name = re.search(r'<link\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
            if link_name and link_name.group(1):
                channel_name = link_name.group(1)

        # 2. Trích xuất Mô tả (Description)
        description = ""
        meta_desc = re.search(r'<meta\s+itemprop=["\']description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        if meta_desc and meta_desc.group(1):
            description = meta_desc.group(1)

        if not description:
            meta_name_desc = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                            re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
            if meta_name_desc and meta_name_desc.group(1):
                description = meta_name_desc.group(1)

        # 3. Trích xuất Tiêu đề (Title)
        title = ""
        meta_title = re.search(r'<meta\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                     re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                     re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        if meta_title and meta_title.group(1):
            title = re.sub(r'\s*-\s*YouTube$', '', meta_title.group(1), flags=re.IGNORECASE).strip()
        def _decode(text: str) -> str:
            if not text:
                return ""
            try:
                text = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), text)
            except Exception:
                pass
            text = text.replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n').replace('\\r', '')
            return html.unescape(text).strip()

        return {
            "channel_name": _decode(channel_name),
            "description": _decode(description),
            "title": _decode(title),
        }
    except Exception as e:
        logger.error(f"Lỗi khi cào metadata YouTube: {e}")
        return {"channel_name": "", "description": "", "title": ""}


def extract_linkedin_metadata(data: dict | str) -> dict[str, str]:
    """
    Trích xuất author_name và content từ object metadata của bài viết LinkedIn.
    Cấu trúc mong đợi:
    - title / page_title chứa: "Nội dung bài viết... | Tên Người Đăng"
    - description chứa nội dung bài viết
    """
    if not data:
        return {"author_name": "", "content": ""}

    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = {"description": data}

    meta = data.get("metadata") if isinstance(data, dict) and isinstance(data.get("metadata"), dict) else {}

    raw_desc = (meta.get("description") or data.get("description") or "") if isinstance(data, dict) else ""
    content = str(raw_desc).strip() if raw_desc else ""

    raw_title = (meta.get("title") or data.get("page_title") or data.get("title") or "") if isinstance(data, dict) else ""
    full_title = str(raw_title).strip() if raw_title else ""

    author_name = ""
    if " | " in full_title:
        parts = full_title.split(" | ")
        author_name = parts[-1].strip()
    elif " on LinkedIn:" in full_title:
        author_name = full_title.split(" on LinkedIn:")[0].strip()
    elif " trên LinkedIn:" in full_title:
        author_name = full_title.split(" trên LinkedIn:")[0].strip()

    return {
        "author_name": author_name,
        "content": content
    }


def fetch_linkedin_post_metadata(url: str) -> dict[str, str]:
    """Cào metadata bài viết LinkedIn từ HTML thô và bóc tách author_name + content."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            html_content = response.read().decode("utf-8", errors="ignore")

        meta_title_match = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                           re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        page_title = html.unescape(meta_title_match.group(1)).strip() if meta_title_match and meta_title_match.group(1) else ""

        meta_desc_match = re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                          re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        description = html.unescape(meta_desc_match.group(1)).strip() if meta_desc_match and meta_desc_match.group(1) else ""

        return extract_linkedin_metadata({
            "page_title": page_title,
            "title": page_title,
            "description": description
        })
    except Exception as e:
        logger.error(f"Lỗi khi cào metadata LinkedIn: {e}")
        return {"author_name": "", "content": ""}


def extract_threads_metadata(data: dict | str) -> dict[str, str]:
    """Trích xuất author_name và content từ metadata bài Threads (threads.net).
    BEST-EFFORT (chưa verify với site thật): cấu trúc kỳ vọng dựa theo OG tag chuẩn
    - title chứa: "<Tên người đăng> (@handle) on Threads" / "... trên Threads"
    - description chứa nội dung bài viết thật.
    Nếu Threads render OG tags qua JS (fetch tĩnh không thấy được) thì hàm này trả
    rỗng, caller tự fallback về placeholder "Bài viết Threads - Cần tương tác" giống
    hệt cách Facebook/LinkedIn/YouTube fallback khi cào không ra gì.
    """
    if not data:
        return {"author_name": "", "content": ""}

    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = {"description": data}

    raw_desc = data.get("description") if isinstance(data, dict) else ""
    content = str(raw_desc).strip() if raw_desc else ""

    raw_title = (data.get("page_title") or data.get("title") or "") if isinstance(data, dict) else ""
    full_title = str(raw_title).strip() if raw_title else ""

    author_name = ""
    for marker in (" on Threads", " trên Threads"):
        if marker in full_title:
            author_name = full_title.split(marker)[0].strip()
            break
    if "(@" in author_name:
        author_name = author_name.split("(@")[0].strip()

    return {"author_name": author_name, "content": content}


def fetch_threads_post_metadata(url: str) -> dict[str, str]:
    """Cào metadata bài viết Threads từ HTML thô (og:title/og:description) — BEST-EFFORT,
    chưa test với threads.net thật. Không raise lỗi khi cào rỗng, chỉ trả về rỗng để
    caller tự fallback placeholder (giống fetch_linkedin_post_metadata)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            html_content = response.read().decode("utf-8", errors="ignore")

        meta_title_match = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                           re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        page_title = html.unescape(meta_title_match.group(1)).strip() if meta_title_match and meta_title_match.group(1) else ""

        meta_desc_match = re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE) or \
                          re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        description = html.unescape(meta_desc_match.group(1)).strip() if meta_desc_match and meta_desc_match.group(1) else ""

        return extract_threads_metadata({
            "page_title": page_title,
            "title": page_title,
            "description": description,
        })
    except Exception as e:
        logger.error(f"Lỗi khi cào metadata Threads: {e}")
        return {"author_name": "", "content": ""}


async def add_custom_post(
    email_member: str,
    link_post: str,
    content: Optional[str] = None,
    fanpage_name: Optional[str] = None,
    media_urls: Optional[list] = None,
    cookie: Optional[str] = None,
    campaign_id: Optional[str] = None,
    campaign_name: Optional[str] = None,
    deadline: Optional[str] = None,
    target_comments: int = 32,
    assigned_team_ids: Optional[list] = None,
    platform: Optional[str] = None,
    likes: Optional[int] = None,
    comments: Optional[int] = None,
    shares: Optional[int] = None,
) -> dict:
    supabase: Client = get_supabase_client()
    user_id = _get_member_id(email_member)

    if not user_id:
        raise Exception("Không tìm thấy thông tin user.")

    is_linkedin = (
        platform == "linkedin"
        or "linkedin.com" in link_post.lower()
    )
    is_threads = (
        platform == "threads"
        or "threads.net" in link_post.lower()
        or "threads.com" in link_post.lower()
    )
    is_youtube = (
        platform == "youtube"
        or "youtube.com" in link_post.lower()
        or "youtu.be" in link_post.lower()
    )
    final_platform = (
        "linkedin" if is_linkedin
        else "threads" if is_threads
        else "youtube" if is_youtube
        else "facebook"
    )

    li_meta = {}
    th_meta = {}
    yt_meta = {}
    if is_linkedin:
        final_clean_url = clean_url(link_post)
        li_meta = fetch_linkedin_post_metadata(final_clean_url)
        scraped_content = content or li_meta.get("content") or "Bài viết LinkedIn - Cần tương tác"
    elif is_threads:
        final_clean_url = clean_url(link_post)
        th_meta = fetch_threads_post_metadata(final_clean_url)
        scraped_content = content or th_meta.get("content") or "Bài viết Threads - Cần tương tác"
    elif is_youtube:
        final_clean_url = clean_url(link_post)
        yt_meta = fetch_youtube_post_metadata(final_clean_url)
        scraped_content = content or yt_meta.get("title") or yt_meta.get("description") or "Video YouTube - Cần tương tác"
    else:
        final_clean_url, scraped_content = await normalize_facebook_url_and_scrape(link_post)

    existing_res = (
        supabase.table("internal_engagement_custom_posts")
        .select("*")
        .eq("link_post", final_clean_url)
        .execute()
    )

    if existing_res.data:
        existing_post = existing_res.data[0]
        if not existing_post.get("is_deleted"):
            raise HTTPException(status_code=400, detail="Bài viết này đã tồn tại trong hệ thống!")

    meta = {}
    if not is_linkedin and not is_threads and not is_youtube and (not content or not fanpage_name or not media_urls):
        meta = fetch_facebook_post_metadata(final_clean_url, cookie=cookie)

    if is_linkedin:
        final_fanpage_name = fanpage_name or li_meta.get("author_name") or "Thành viên LinkedIn"
        auto_content = li_meta.get("content") or ""
    elif is_threads:
        final_fanpage_name = fanpage_name or th_meta.get("author_name") or "Thành viên Threads"
        auto_content = th_meta.get("content") or ""
    elif is_youtube:
        final_fanpage_name = fanpage_name or yt_meta.get("channel_name") or "Kênh YouTube"
        auto_content = yt_meta.get("title") or yt_meta.get("description") or ""
    else:
        final_fanpage_name = fanpage_name or extract_fanpage_name_from_meta_or_url(final_clean_url, meta)
        auto_content = clean_facebook_content(meta, final_fanpage_name)

    final_content = content or auto_content or scraped_content
    placeholder_texts = {"Bài viết Facebook - Cần tương tác", "Bài viết LinkedIn - Cần tương tác", "Bài viết Threads - Cần tương tác", "Video YouTube - Cần tương tác"}
    if not final_content or final_content in placeholder_texts:
        raw_desc = meta.get("description") or meta.get("og:description") or yt_meta.get("description") or ""
        if raw_desc:
            unescaped_desc = html.unescape(raw_desc).strip()
            stats_keywords = ["lượt thích", "người theo dõi", "đang nói về", "lượt đăng ký", "followers", "likes"]
            if not any(kw in unescaped_desc.lower() for kw in stats_keywords) and len(unescaped_desc) > 3:
                final_content = unescaped_desc

    if not final_content:
        final_content = (
            "Bài viết LinkedIn - Cần tương tác" if is_linkedin
            else "Bài viết Threads - Cần tương tác" if is_threads
            else "Video YouTube - Cần tương tác" if is_youtube
            else "Bài viết Facebook - Cần tương tác"
        )

    # Dọn dẹp Content: Gọt bỏ Tên Fanpage nếu nó bị dính ở đầu Caption
    if final_fanpage_name and final_content:
        ignore_names = [
            "Bài viết Ảnh Facebook", "Video Reel Facebook", "Markee AI Marketing",
            "Thành viên ẩn", "Nhóm Facebook"
        ]
        if final_fanpage_name not in ignore_names:
            if final_content.startswith(final_fanpage_name):
                final_content = final_content[len(final_fanpage_name):].strip()
                while final_content and final_content[0] in ("-", "|", ":", ".", "–", "\n", "\r"):
                    final_content = final_content[1:].strip()

    final_media_urls = media_urls or ([meta["image"]] if meta.get("image") else [])
    now_iso = datetime.now(timezone.utc).isoformat()
    default_deadline = deadline

    raw_html = meta.get("raw_html") or ""
    title_match = re.search(r'<title[^>]*>(.*?)</title>', raw_html, re.IGNORECASE | re.DOTALL)
    title_debug = html.unescape(title_match.group(1).strip()) if title_match else "N/A"

    meta_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE) or \
                 re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE)
    meta_debug = html.unescape(meta_match.group(1).strip()) if meta_match else "N/A"

    json_debug = "NO_JSON_PAGE"
    if '"__typename":"Page"' in raw_html or '"__typename":"User"' in raw_html or '"__typename": "Page"' in raw_html or '"__typename": "User"' in raw_html:
        json_debug = "HAS_JSON_PAGE"

    message_debug = f"TITLE: {title_debug} | META: {meta_debug} | JSON_CHECK: {json_debug} | SNIPPET: {raw_html[:3000]}"

    if existing_res.data and existing_post.get("is_deleted"):
        update_payload = {
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by": None,
            "fanpage_name": final_fanpage_name,
            "content": final_content,
            "media_urls": final_media_urls,
            "published_at": now_iso,
            "updated_at": now_iso,
            "updated_by": user_id,
            "campaign_id": campaign_id,
            "campaign_name": campaign_name,
            "deadline": default_deadline,
            "target_comments": target_comments,
            "assigned_team_ids": assigned_team_ids or [],
            "platform": final_platform,
        }
        if likes is not None or comments is not None or shares is not None:
            update_payload["fb_total_likes"] = likes or 0
            update_payload["fb_total_comments"] = comments or 0
            update_payload["fb_total_shares"] = shares or 0
            update_payload["last_synced_at"] = now_iso
        res = (
            supabase.table("internal_engagement_custom_posts")
            .update(update_payload)
            .eq("id", existing_post["id"])
            .execute()
        )
        item = res.data[0] if res.data else existing_post
        item["platform"] = final_platform
        item["_debug_info"] = message_debug
        return item

    data = {
        "link_post": final_clean_url,
        "id_member": user_id,
        "fanpage_name": final_fanpage_name,
        "content": final_content,
        "media_urls": final_media_urls,
        "created_at": now_iso,
        "published_at": now_iso,
        "is_deleted": False,
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "deadline": default_deadline,
        "target_comments": target_comments,
        "assigned_team_ids": assigned_team_ids or [],
        "platform": final_platform,
    }
    if likes is not None or comments is not None or shares is not None:
        data["fb_total_likes"] = likes or 0
        data["fb_total_comments"] = comments or 0
        data["fb_total_shares"] = shares or 0
        data["last_synced_at"] = now_iso

    try:
        res = supabase.table("internal_engagement_custom_posts").insert(data).execute()
        item = res.data[0] if res.data else {}
        item["platform"] = final_platform
        item["_debug_info"] = message_debug
        return item
    except Exception as err:
        logger.error(f"Lỗi khi insert full data vào internal_engagement_custom_posts: {err}")
        fallback_data = {
            "link_post": final_clean_url,
            "id_member": user_id,
            "is_deleted": False,
            "campaign_id": campaign_id,
            "campaign_name": campaign_name,
            "deadline": default_deadline,
            "target_comments": target_comments,
            "assigned_team_ids": assigned_team_ids or [],
            "platform": final_platform,
        }
        res = supabase.table("internal_engagement_custom_posts").insert(fallback_data).execute()
        item = res.data[0] if res.data else {}
        item["platform"] = final_platform
        item["_debug_info"] = message_debug
        return item


def get_custom_posts_db(page: int = 1, page_size: int = 20) -> dict:
    """Lấy danh sách bài viết thủ công (chỉ lấy bài chưa bị xóa is_deleted = false)"""
    supabase: Client = get_supabase_client()
    start = (page - 1) * page_size
    end = start + page_size - 1
    
    res = (
        supabase.table("internal_engagement_custom_posts")
        .select("*")
        .eq("is_deleted", False)
        .order("created_at", desc=True)
        .range(start, end)
        .execute()
    )
    
    count_res = (
        supabase.table("internal_engagement_custom_posts")
        .select("id", count="exact")
        .eq("is_deleted", False)
        .execute()
    )
    total = count_res.count if count_res.count else 0
    
    return {"items": res.data or [], "total": total}


def update_custom_post_db(
    post_id: str,
    email_member: str,
    content: Optional[str] = None,
    fanpage_name: Optional[str] = None,
    media_urls: Optional[list] = None,
    campaign_id: Optional[str] = None,
    campaign_name: Optional[str] = None,
    deadline: Optional[str] = None,
    target_comments: Optional[int] = None,
    assigned_team_ids: Optional[list] = None,
) -> dict:
    supabase: Client = get_supabase_client()
    user_id = _get_member_id(email_member) if email_member else None

    update_data: dict = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if content is not None:
        update_data["content"] = content
    if fanpage_name is not None:
        update_data["fanpage_name"] = fanpage_name
    if media_urls is not None:
        update_data["media_urls"] = media_urls
    if campaign_id is not None:
        update_data["campaign_id"] = campaign_id
    if campaign_name is not None:
        update_data["campaign_name"] = campaign_name
    if deadline is not None:
        update_data["deadline"] = deadline
    if target_comments is not None:
        update_data["target_comments"] = target_comments
    if assigned_team_ids is not None:
        update_data["assigned_team_ids"] = assigned_team_ids
    if user_id:
        update_data["updated_by"] = user_id

    res = supabase.table("internal_engagement_custom_posts").update(update_data).eq("id", post_id).execute()
    return res.data[0] if res.data else {}


def delete_custom_post_db(post_id: str, email_member: str) -> dict:
    supabase: Client = get_supabase_client()
    user_id = _get_member_id(email_member) if email_member else None

    delete_data: dict = {
        "is_deleted": True,
        "deleted_at": datetime.now(timezone.utc).isoformat(),
    }
    if user_id:
        delete_data["deleted_by"] = user_id

    res = supabase.table("internal_engagement_custom_posts").update(delete_data).eq("id", post_id).execute()
    return res.data[0] if res.data else {}


def upsert_markee_override_db(
    markee_post_id: str,
    email_member: str,
    is_hidden: Optional[bool] = None,
    fanpage_name: Optional[str] = None,
    content: Optional[str] = None,
    media_urls: Optional[list] = None,
) -> dict:
    supabase: Client = get_supabase_client()
    user_id = _get_member_id(email_member) if email_member else None

    override_data: dict = {
        "markee_post_id": markee_post_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if is_hidden is not None:
        override_data["is_hidden"] = is_hidden
    if fanpage_name is not None:
        override_data["override_fanpage_name"] = fanpage_name
    if content is not None:
        override_data["override_content"] = content
    if media_urls is not None:
        override_data["override_media_urls"] = media_urls
    if user_id:
        override_data["updated_by"] = user_id

    res = (
        supabase.table("internal_engagement_markee_overrides")
        .upsert(override_data, on_conflict="markee_post_id")
        .execute()
    )
    return res.data[0] if res.data else {}


def get_markee_overrides_db(markee_post_ids: list[str]) -> dict[str, dict]:
    if not markee_post_ids:
        return {}
    supabase: Client = get_supabase_client()
    res = (
        supabase.table("internal_engagement_markee_overrides")
        .select("*")
        .in_("markee_post_id", markee_post_ids)
        .execute()
    )
    return {str(row["markee_post_id"]): row for row in (res.data or [])}


def get_seeding_campaigns_db() -> list[dict]:
    supabase: Client = get_supabase_client()
    res = supabase.table("seeding_campaigns").select("*").order("created_at", desc=True).execute()
    return res.data or []


def create_seeding_campaign_db(payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    created_by_id = _get_member_id(payload.get("created_by_email")) if payload.get("created_by_email") else None

    data = {
        "name": payload["name"],
        "description": payload.get("description"),
        "color_code": payload.get("color_code", "#fff1f2"),
        "start_date": payload.get("start_date") or datetime.now(timezone.utc).isoformat(),
        "end_date": payload.get("end_date"),
    }
    if created_by_id:
        data["created_by"] = created_by_id

    res = supabase.table("seeding_campaigns").insert(data).execute()
    return res.data[0] if res.data else {}


def delete_seeding_campaign_db(campaign_id: str) -> dict:
    supabase: Client = get_supabase_client()
    res = supabase.table("seeding_campaigns").delete().eq("id", campaign_id).execute()
    return {"deleted": True, "id": campaign_id}


def get_seeder_leaderboard_db() -> list[dict]:
    """Bypass view v_seeder_leaderboard and compute accurate Seeder leaderboard metrics directly, synchronized with get_all_teams()."""
    supabase: Client = get_supabase_client()

    # Single Source of Truth for Teams & Members (same as get_post_interactions)
    all_teams = get_all_teams()
    member_team_map = _member_team_map(all_teams)  # app_user_id -> {"team_id": ..., "team_name": ...}

    # Query app_users directly for active users to match get_post_interactions logic
    active_user_ids = list(member_team_map.keys())
    app_users_data = (
        supabase.table("app_users")
        .select("id, name, email")
        .in_("id", active_user_ids)
        .execute()
    ).data or []
    app_user_map = {str(u["id"]): u for u in app_users_data}

    # Map app_users to members for display name and linked id fallback
    members_res = (
        supabase.table("members")
        .select("id, display_name, email, team, linked_user_id")
        .execute()
    ).data or []

    # Map app_user_id -> member_info dict
    user_to_member_row = {}
    for m in members_res:
        luid = str(m.get("linked_user_id") or "")
        if luid:
            user_to_member_row[luid] = m
        user_to_member_row[str(m["id"])] = m

    posts_res = supabase.table("internal_engagement_custom_posts").select("id, assigned_team_ids, link_post").eq("is_deleted", False).execute()
    active_posts = posts_res.data or []

    kpi_res = supabase.table("internal_engagement_kpi").select("id_member, link_post, status, is_ontime").execute()
    kpi_by_member = defaultdict(list)
    for k in (kpi_res.data or []):
        kpi_by_member[str(k["id_member"])].append(k)

    leaderboard = []
    # Iterate over exact active members from get_all_teams()
    for user_id, team_info in member_team_map.items():
        m_row = user_to_member_row.get(user_id, {})
        m_id = str(m_row.get("id") or user_id)

        team_id = str(team_info["team_id"]).lower()
        team_name = team_info["team_name"]

        # Active team identifiers (both ID and lowercased name)
        m_teams = {team_id, team_name.lower()}

        assigned_links = []
        for post in active_posts:
            assigned = post.get("assigned_team_ids") or []
            if not assigned:
                assigned_links.append(post["link_post"])
                continue

            has_match = False
            for t in assigned:
                t_str = str(t).lower()
                if t_str in m_teams or t_str == team_id or t_str == team_name.lower():
                    has_match = True
                    break
            if has_match:
                assigned_links.append(post["link_post"])

        rows = kpi_by_member.get(user_id, [])
        success_links = set(r["link_post"] for r in rows if r.get("status") == "success")
        completed_links = [l for l in assigned_links if l in success_links]
        ontime_links = [
            l for l in completed_links 
            if any(r.get("link_post") == l and r.get("is_ontime", True) for r in rows if r.get("status") == "success")
        ]

        total_assigned = len(assigned_links)
        total_completed = len(completed_links)
        total_ontime = len(ontime_links)

        rate = round((total_completed / total_assigned * 100), 1) if total_assigned > 0 else 0.0
        score = total_completed

        # Multi-layer fallback for name: app_users.name -> members.display_name -> email -> email prefix -> "Thành viên ẩn"
        app_u = app_user_map.get(user_id, {})
        raw_email = app_u.get("email") or m_row.get("email") or ""
        email_prefix = raw_email.split("@")[0] if raw_email else ""

        member_name = (
            app_u.get("name")
            or m_row.get("display_name")
            or raw_email
            or email_prefix
            or "Thành viên ẩn"
        )

        leaderboard.append({
            "user_id": m_id,
            "member_name": member_name,
            "member_email": raw_email or None,
            "team_name": team_name,
            "team_id": team_info["team_id"],
            "total_assigned": total_assigned,
            "total_completed": total_completed,
            "total_ontime": total_ontime,
            "completion_rate": rate,
            "score": score,
        })

    leaderboard.sort(key=lambda x: (x["score"], x["completion_rate"]), reverse=True)
    return leaderboard


def get_post_interactions(link_post: str, email: str, team_id: Optional[str] = None) -> dict:
    """Chi tiết tương tác: Lấy chuẩn theo Cầu nối linked_user_id."""
    teams, role = resolve_team_scope(email, team_id)
    if not teams:
        return {"role": role, "teams": [], "items": []}

    supabase: Client = get_supabase_client()
    
    post_res = supabase.table("internal_engagement_custom_posts").select("deadline, assigned_team_ids").eq("link_post", link_post).execute()
    post_data = post_res.data[0] if post_res.data else {}
    deadline_str = post_data.get("deadline")
    assigned_team_ids = post_data.get("assigned_team_ids") or []
    
    is_past_deadline = False
    if deadline_str:
        try:
            is_past_deadline = datetime.fromisoformat(deadline_str) < datetime.now(timezone.utc)
        except ValueError:
            pass

    valid_teams = []
    for t in teams:
        if not assigned_team_ids or t["id"] in assigned_team_ids or t.get("name_team") in assigned_team_ids:
            valid_teams.append(t)

    if not valid_teams:
        return {"role": role, "teams": [], "items": []}

    member_team = _member_team_map(valid_teams)
    member_ids = list(member_team.keys())

    if not member_ids:
        return {"role": role, "teams": [], "items": []}

    members_res = supabase.table("members").select("id, linked_user_id").in_("id", member_ids).execute().data or []
    linked_to_original = {}
    original_to_linked = {}
    for m in members_res:
        orig = str(m["id"])
        linked = str(m.get("linked_user_id") or orig)
        linked_to_original[linked] = orig
        original_to_linked[orig] = linked

    for m_id in member_ids:
        orig = str(m_id)
        if orig not in original_to_linked:
            original_to_linked[orig] = orig
            linked_to_original[orig] = orig

    linked_user_ids = list(linked_to_original.keys())

    member_team_db = {}
    mot_res = (
        supabase.table("member_of_teams")
        .select("id_member, teams!inner(id, name_team)")
        .in_("id_member", member_ids)
        .execute()
    ).data or []
    for mot in mot_res:
        m_id = str(mot["id_member"])
        t_data = mot.get("teams") or {}
        if m_id not in member_team_db and t_data:
            member_team_db[m_id] = {
                "team_id": t_data.get("id"),
                "team_name": t_data.get("name_team") or "Team"
            }

    users = supabase.table("app_users").select("id, name, email").in_("id", linked_user_ids).execute().data or []
    user_map = {linked_to_original.get(str(u["id"]), str(u["id"])): u for u in users}

    kpi_rows = (
        supabase.table("internal_engagement_kpi")
        .select("*")
        .eq("link_post", link_post)
        .in_("id_member", linked_user_ids)
        .order("created_at", desc=True)
        .execute()
    ).data or []

    kpi_by_member: dict[str, dict] = defaultdict(dict)
    for row in kpi_rows:
        linked_id = str(row["id_member"])
        m_id = linked_to_original.get(linked_id, linked_id)
        status = row.get("status")
        action_type = row.get("action_type") or "comment"
        if status == "success":
            kpi_by_member[m_id][action_type] = True
            # Lưu timestamp cho từng loại action riêng biệt (dùng cho tooltip UI)
            ts_key = f"{action_type}_time"
            if ts_key not in kpi_by_member[m_id]:
                kpi_by_member[m_id][ts_key] = row.get("created_at")
            # latest_row: dùng để tính "thời gian gần nhất" cho cột Thời gian
            existing_latest = kpi_by_member[m_id].get("latest_row")
            if not existing_latest:
                kpi_by_member[m_id]["latest_row"] = row
            else:
                # So sánh, giữ row mới nhất
                try:
                    existing_ts = existing_latest.get("created_at") or ""
                    new_ts = row.get("created_at") or ""
                    if new_ts > existing_ts:
                        kpi_by_member[m_id]["latest_row"] = row
                except Exception:
                    pass


    items = []
    for m_id in member_ids:
        t_info = member_team_db.get(m_id) or member_team.get(m_id) or {}
        user = user_map.get(m_id, {})
        name = user.get("name") or (user.get("email") or "").split("@")[0] or "Thành viên ẩn"

        m_kpi_actions = kpi_by_member.get(m_id, {})
        like_done = bool(m_kpi_actions.get("like") or m_kpi_actions.get("love") or m_kpi_actions.get("reaction"))
        comment_done = bool(m_kpi_actions.get("comment"))
        share_done = bool(m_kpi_actions.get("share"))
        has_any_success = like_done or comment_done or share_done

        latest_kpi = m_kpi_actions.get("latest_row")

        if has_any_success:
            status, status_label = "completed", "Hoàn thành"
        elif is_past_deadline:
            status, status_label = "overdue", "Quá hạn"
        else:
            status, status_label = "received", "Đã nhận"

        if latest_kpi and latest_kpi.get("created_at"):
            try:
                raw_dt_str = latest_kpi["created_at"]
                if raw_dt_str.endswith("Z"):
                    raw_dt_str = raw_dt_str[:-1] + "+00:00"
                parsed_dt = datetime.fromisoformat(raw_dt_str)
                if parsed_dt.tzinfo is None:
                    parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
                local_dt = parsed_dt.astimezone()
                time_str = local_dt.strftime("%H:%M %d/%m")
                raw_created_at = parsed_dt.isoformat()
            except Exception:
                time_str = str(latest_kpi["created_at"])[:10]
                raw_created_at = latest_kpi["created_at"]
        else:
            time_str = "Chưa hoàn thành" if status == "received" else "—"
            raw_created_at = None

        items.append({
            "id_member": m_id,
            "name": name,
            "team": t_info.get("team_name", "Team"),
            "team_id": t_info.get("team_id"),
            "status": status,
            "statusLabel": status_label,
            "like": like_done,
            "comment": comment_done,
            "share": share_done,
            "like_time": m_kpi_actions.get("like_time"),
            "comment_time": m_kpi_actions.get("comment_time"),
            "share_time": m_kpi_actions.get("share_time"),
            "time": time_str,
            "raw_created_at": raw_created_at,
        })

    return {
        "role": role,
        "teams": [{"id": t["id"], "name_team": t.get("name_team")} for t in valid_teams],
        "items": items,
    }


def mark_action_by_fb_uid(
    action_type: str,
    fb_uid: Optional[str] = None,
    post_url: Optional[str] = None,
    email_member: Optional[str] = None,
    content: Optional[str] = None,
) -> dict:
    """Ghi nhận hành động tương tác (Like, Comment, Share) từ Extension hoặc FE vào bảng KPI"""
    supabase: Client = get_supabase_client()
    id_member = None

    if email_member:
        id_member = _get_member_id(email_member)

    if not id_member and fb_uid:
        # 1. Quét social_accounts theo profile_id hoặc uid
        acc_res = (
            supabase.table("social_accounts")
            .select("id, uid, profile_id")
            .execute()
        )
        for acc in acc_res.data or []:
            if str(acc.get("uid")) == str(fb_uid) or str(acc.get("profile_id")) == str(fb_uid):
                # find associated user
                id_member = acc.get("id")
                break

        if not id_member:
            # 2. Quét app_users theo id
            user_res = supabase.table("app_users").select("id").eq("id", fb_uid).execute()
            if user_res.data:
                id_member = user_res.data[0]["id"]

    if not id_member:
        # Fallback to first available member so record isn't lost
        users_res = supabase.table("app_users").select("id").limit(1).execute()
        if users_res.data:
            id_member = users_res.data[0]["id"]

    if not id_member:
        raise ValueError("Không tìm thấy thông tin thành viên tương ứng.")

    clean_url = post_url or ""
    if post_url:
        try:
            clean_url = post_url.split("?")[0].rstrip("/")
        except Exception:
            clean_url = post_url

    data = {
        "id_member": id_member,
        "link_post": clean_url,
        "action_type": action_type or "like",
        "content": content if content else None,
        "status": "success",
        "profile_id": fb_uid,
    }

    result = supabase.table("internal_engagement_kpi").insert(data).execute()
    return result.data[0] if result.data else {}


def get_post_team_counts(link_post: str, email: str, team_id: Optional[str] = None) -> dict:
    teams, role = resolve_team_scope(email, team_id)
    if not teams:
        return {"role": role, "teams": []}

    supabase: Client = get_supabase_client()

    post_res = supabase.table("internal_engagement_custom_posts").select("assigned_team_ids").eq("link_post", link_post).execute()
    post_data = post_res.data[0] if post_res.data else {}
    assigned_team_ids = post_data.get("assigned_team_ids") or []

    valid_teams = []
    for t in teams:
        if not assigned_team_ids or t["id"] in assigned_team_ids or t.get("name_team") in assigned_team_ids:
            valid_teams.append(t)

    if not valid_teams:
        return {"role": role, "teams": []}

    member_team = _member_team_map(valid_teams)
    team_meta = {t["id"]: t.get("name_team") or "Team" for t in valid_teams}
    counts: dict[str, int] = defaultdict(int)

    if member_team:
        member_ids = list(member_team.keys())
        
        members_res = supabase.table("members").select("id, linked_user_id").in_("id", member_ids).execute().data or []
        linked_to_original = {}
        for m in members_res:
            orig = str(m["id"])
            linked = str(m.get("linked_user_id") or orig)
            linked_to_original[linked] = orig
        
        for m_id in member_ids:
            orig = str(m_id)
            if orig not in linked_to_original.values():
                linked_to_original[orig] = orig
        
        linked_user_ids = list(linked_to_original.keys())

        rows = (
            supabase.table("internal_engagement_kpi")
            .select("id_member")
            .eq("link_post", link_post)
            .eq("status", "success")
            .in_("id_member", linked_user_ids)
            .execute()
        ).data or []

        distinct_members = set()
        for row in rows:
            linked_id = str(row["id_member"])
            orig_m_id = linked_to_original.get(linked_id, linked_id)
            if orig_m_id not in distinct_members:
                distinct_members.add(orig_m_id)
                team_info = member_team.get(orig_m_id)
                if team_info:
                    counts[team_info["team_id"]] += 1

    return {
        "role": role,
        "teams": [
            {"team_id": tid, "team_name": name, "count": counts.get(tid, 0)}
            for tid, name in team_meta.items()
        ],
    }


def parse_formatted_number(val: Union[str, int, float, None]) -> int:
    """
    Chuyển đổi các chuỗi số tương tác định dạng Facebook/MXH về số nguyên (Integer).
    - "1,2K" / "1.2k" -> 1200
    - "1.5 Tr" / "1.5M" -> 1500000
    - "123.456" / "123,456" -> 123456
    - "15K lượt thích" -> 15000
    """
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return int(val)

    s = str(val).strip().lower()
    if not s:
        return 0

    s = re.sub(
        r'(lượt thích|bình luận|thảo luận|lượt chia sẻ|chia sẻ|người theo dõi|likes?|comments?|shares?|followers?)',
        '',
        s
    ).strip()

    match_unit = re.search(r'([\d.,]+)\s*(k|m|tr|b)?', s)
    if not match_unit:
        return 0

    num_str = match_unit.group(1)
    unit = match_unit.group(2)

    try:
        if unit:
            num_clean = num_str.replace(',', '.')
            val_float = float(num_clean)

            if unit == 'k':
                return int(val_float * 1000)
            elif unit in ('m', 'tr'):
                return int(val_float * 1000000)
            elif unit == 'b':
                return int(val_float * 1000000000)

        if re.match(r'^\d{1,3}([.,]\d{3})+$', num_str):
            num_clean = re.sub(r'[.,]', '', num_str)
            return int(num_clean)

        num_clean = num_str.replace(',', '.')
        return int(float(num_clean))
    except Exception:
        return 0


def extract_facebook_post_engagement_stats(meta: dict) -> dict:
    stats = {"likes": 0, "comments": 0, "shares": 0}
    raw_html = meta.get("raw_html") or ""
    raw_desc = meta.get("description") or meta.get("og:description") or ""

    # BƯỚC 1: QUÉT JSON REGEX TRƯỚC (Số liệu JSON GraphQL luôn chuẩn xác 100%, không dính text Page)
    if raw_html:
        # 1. Mảng quét LIKES / REACTIONS
        like_pats = [
            r'"reaction_count"\s*:\s*\{\s*"count"\s*:\s*(\d+)',  # Bài thường
            r'"i18n_reaction_count"\s*:\s*"([\d.,]+[kKmMbBtrTR]?)"',  # Bài thường (dự phòng)
            r'"unified_reactors"\s*:\s*\{\s*"count"\s*:\s*(\d+)',  # Reels
            r'"likers"\s*:\s*\{\s*"count"\s*:\s*(\d+)',  # Reels (dự phòng)
        ]
        for pat in like_pats:
            m = re.search(pat, raw_html)
            if m:
                val = parse_formatted_number(m.group(1))
                if val > 0:
                    stats["likes"] = val
                    break

        # 2. Mảng quét COMMENTS
        comment_pats = [
            r'"comment_rendering_instance"\s*:\s*\{\s*"comments"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)',  # Bài thường
            r'"total_comment_count"\s*:\s*(\d+)',  # Reels
            r'"comments"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)',
            r'"comment_count"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)',
        ]
        for pat in comment_pats:
            m = re.search(pat, raw_html)
            if m:
                val = parse_formatted_number(m.group(1))
                if val > 0:
                    stats["comments"] = val
                    break

        # 3. Mảng quét SHARES
        share_pats = [
            r'"share_count"\s*:\s*\{\s*"count"\s*:\s*(\d+)',  # Bài thường
            r'"i18n_share_count"\s*:\s*"([\d.,]+[kKmMbBtrTR]?)"',  # Bài thường (dự phòng)
            r'"share_count_reduced"\s*:\s*"([\d.,]+[kKmMbBtrTR]?)"',  # Reels
            r'"share_count_reduced"\s*:\s*(\d+)',
        ]
        for pat in share_pats:
            m = re.search(pat, raw_html)
            if m:
                val = parse_formatted_number(m.group(1))
                if val > 0:
                    stats["shares"] = val
                    break

    # BƯỚC 2: FALLBACK SANG META DESCRIPTION NẾU JSON TRẢ VỀ 0
    desc_text = html.unescape(raw_desc or "")
    if not desc_text and raw_html:
        m_desc = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE) or \
                 re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE)
        if m_desc:
            desc_text = html.unescape(m_desc.group(1))

    if desc_text:
        # TIỀN XỬ LÝ: Xóa bỏ các cụm số liệu của Fanpage ở đầu chuỗi (Followers, Page Likes, Đang nói về...)
        clean_desc = re.sub(
            r'[\d.,]+\s*[kKmMbBtrTR]?\s*(?:người theo dõi|lượt thích trang|followers|page likes|đang nói về|lượt đăng ký)',
            '',
            desc_text,
            flags=re.IGNORECASE
        )

        if stats["likes"] == 0:
            like_matches = re.findall(r'([\d.,]+\s*(?:k|m|tr|b)?)\s*(?:lượt thích|thích|likes?|reactions?)', clean_desc, re.IGNORECASE)
            if like_matches:
                stats["likes"] = parse_formatted_number(like_matches[-1])

        if stats["comments"] == 0:
            comment_matches = re.findall(r'([\d.,]+\s*(?:k|m|tr|b)?)\s*(?:bình luận|thảo luận|comments?)', clean_desc, re.IGNORECASE)
            if comment_matches:
                stats["comments"] = parse_formatted_number(comment_matches[-1])

        if stats["shares"] == 0:
            share_matches = re.findall(r'([\d.,]+\s*(?:k|m|tr|b)?)\s*(?:lượt chia sẻ|chia sẻ|shares?)', clean_desc, re.IGNORECASE)
            if share_matches:
                stats["shares"] = parse_formatted_number(share_matches[-1])

    return stats


def get_custom_post_platform_db(post_id: str) -> str:
    """Trả platform ('facebook'|'linkedin'|'threads') của 1 bài custom-post — dùng để
    router quyết định gọi service sync-playwright nào (mặc định 'facebook' nếu không
    tìm thấy bài hoặc dữ liệu cũ trước migration 054 chưa có cột platform)."""
    supabase: Client = get_supabase_client()
    res = (
        supabase.table("internal_engagement_custom_posts")
        .select("platform")
        .eq("id", post_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0].get("platform") or "facebook"
    return "facebook"


def sync_linkedin_post_engagement_db(
    post_id: str,
    likes: Optional[int] = None,
    comments: Optional[int] = None,
    shares: Optional[int] = None,
) -> dict:
    """
    Cập nhật đè 3 chỉ số Like/Comment/Share cho bài LinkedIn. Khác với bản Facebook,
    LinkedIn không thể tự cào server-side (cần đăng nhập) — số liệu do FE cào được qua
    extension (session LinkedIn thật của user) rồi gửi lên đây để lưu, không tự fetch lại.
    Chỉ số nào không được truyền (None) thì giữ nguyên giá trị cũ trong DB, KHÔNG ép về 0
    — tránh caller chỉ gửi 1 phần (vd chỉ likes) lại vô tình xoá mất comments/shares đã có.
    """
    supabase: Client = get_supabase_client()

    post_res = (
        supabase.table("internal_engagement_custom_posts")
        .select("*")
        .eq("id", post_id)
        .execute()
    )
    if not post_res.data:
        raise Exception("Không tìm thấy bài viết hoặc bài viết đã bị xóa.")

    post = post_res.data[0]
    if post.get("is_deleted"):
        raise Exception("Bài viết này đã bị xóa khỏi hệ thống.")

    final_likes = likes if likes is not None else (post.get("fb_total_likes") or 0)
    final_comments = comments if comments is not None else (post.get("fb_total_comments") or 0)
    final_shares = shares if shares is not None else (post.get("fb_total_shares") or 0)

    now_iso = datetime.now(timezone.utc).isoformat()
    update_data: dict = {
        "fb_total_likes": final_likes,
        "fb_total_comments": final_comments,
        "fb_total_shares": final_shares,
        "last_synced_at": now_iso,
        "updated_at": now_iso,
    }

    res = (
        supabase.table("internal_engagement_custom_posts")
        .update(update_data)
        .eq("id", post_id)
        .execute()
    )

    result_data = res.data[0] if res.data else {**post, **update_data}
    result_data["public_likes"] = result_data.get("fb_total_likes", final_likes)
    result_data["public_comments"] = result_data.get("fb_total_comments", final_comments)
    result_data["public_shares"] = result_data.get("fb_total_shares", final_shares)
    result_data["synced_at"] = result_data.get("last_synced_at", now_iso)
    return result_data


def sync_facebook_post_engagement_db(post_id: str, cookie: Optional[str] = None) -> dict:
    """
    Cào lại dữ liệu Like, Comment, Share từ Facebook và cập nhật đè 4 trường dữ liệu vào DB.
    """
    supabase: Client = get_supabase_client()
    
    post_res = (
        supabase.table("internal_engagement_custom_posts")
        .select("*")
        .eq("id", post_id)
        .execute()
    )

    if not post_res.data:
        raise Exception("Không tìm thấy bài viết hoặc bài viết đã bị xóa.")

    post = post_res.data[0]
    if post.get("is_deleted"):
        raise Exception("Bài viết này đã bị xóa khỏi hệ thống.")

    link_post = post.get("link_post")
    if not link_post:
        raise Exception("Bài viết không có link liên kết Facebook hợp lệ.")

    meta = fetch_facebook_post_metadata(link_post, cookie=cookie)
    stats = extract_facebook_post_engagement_stats(meta)

    now_iso = datetime.now(timezone.utc).isoformat()
    update_data: dict = {
        "fb_total_likes": stats["likes"],
        "fb_total_comments": stats["comments"],
        "fb_total_shares": stats["shares"],
        "last_synced_at": now_iso,
        "updated_at": now_iso,
    }

    res = (
        supabase.table("internal_engagement_custom_posts")
        .update(update_data)
        .eq("id", post_id)
        .execute()
    )

    result_data = res.data[0] if res.data else {**post, **update_data}
    result_data["public_likes"] = result_data.get("fb_total_likes", stats["likes"])
    result_data["public_comments"] = result_data.get("fb_total_comments", stats["comments"])
    result_data["public_shares"] = result_data.get("fb_total_shares", stats["shares"])
    result_data["synced_at"] = result_data.get("last_synced_at", now_iso)
    return result_data