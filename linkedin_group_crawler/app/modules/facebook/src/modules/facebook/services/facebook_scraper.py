import os
import time
import random
from dataclasses import dataclass
from typing import List, Optional, Callable
import sys

from playwright.sync_api import sync_playwright

from app.modules.facebook.src.modules.crawl_fb.models.post import Post
from app.modules.facebook.src.modules.facebook.services.facebook_auth import FacebookAuth
from app.modules.facebook.src.modules.facebook.services.post_extractor import PostExtractor
from app.modules.facebook.src.core.utils.facebook_parsers import classify_timestamp

import re
from datetime import datetime, timedelta

def _vn_now() -> datetime:
    # UTC+7
    return datetime.utcnow() + timedelta(hours=7)

def _ts_hint_to_vn_datetime(ts_hint: str) -> Optional[datetime]:
    """Parse timestamp hint returned by extract_ts_hint into VN datetime.

    Supported hints match patterns in facebook_parsers.classify_timestamp:
    - "vừa xong"
    - "N phút" / "N giờ"
    - "Hôm qua lúc HH:MM"
    - "N ngày" / "N tuần"
    - "N tháng M lúc HH:MM" (optionally with "năm YYYY")
    - "YYYY" (year-only)

    Returns None if unknown/unparseable.
    """
    if not ts_hint:
        return None
    t = ts_hint.lower().strip()
    now = _vn_now()

    try:
        if "vừa xong" in t:
            return now

        m = re.search(r"(\\d+)\\s*phút", t)
        if m:
            return now - timedelta(minutes=int(m.group(1)))

        m = re.search(r"(\\d+)\\s*giờ", t)
        if m:
            return now - timedelta(hours=int(m.group(1)))

        if "hôm qua" in t:
            time_match = re.search(r"lúc\\s*(\\d{1,2}):(\\d{2})", t)
            base = now - timedelta(days=1)
            if time_match:
                h, mm = int(time_match.group(1)), int(time_match.group(2))
                base = base.replace(hour=h, minute=mm, second=0, microsecond=0)
            else:
                base = base.replace(hour=0, minute=0, second=0, microsecond=0)
            return base

        m = re.search(r"(\\d+)\\s*ngày", t)
        if m and "hôm nay" not in t:
            return now - timedelta(days=int(m.group(1)))

        m = re.search(r"(\\d+)\\s*tuần", t)
        if m:
            return now - timedelta(weeks=int(m.group(1)))

        if "tháng" in t:
            day_month = re.search(r"(\\d{1,2})\\s*tháng\\s*(\\d{1,2})", t)
            if day_month:
                day = int(day_month.group(1))
                month = int(day_month.group(2))
                year_match = re.search(r"năm\\s*(\\d{4})", t)
                year = int(year_match.group(1)) if year_match else now.year
                base = now.replace(year=year, month=month, day=day, hour=0, minute=0, second=0, microsecond=0)
                time_match = re.search(r"lúc\\s*(\\d{1,2}):(\\d{2})", t)
                if time_match:
                    h, mm = int(time_match.group(1)), int(time_match.group(2))
                    base = base.replace(hour=h, minute=mm, second=0, microsecond=0)
                # prevent future
                if base > now:
                    base = base.replace(year=year - 1)
                return base

        # year-only
        m = re.search(r"(\\d{4})", t)
        if m and "ngày" not in t and "tháng" not in t and "năm" in t:
            y = int(m.group(1))
            if y < now.year:
                return now.replace(year=y)

        return None
    except Exception:
        return None

def _is_same_vn_calendar_day(ts_hint: str, today_vn: datetime) -> bool:
    dt = _ts_hint_to_vn_datetime(ts_hint)
    if not dt:
        return False
    return dt.date() == today_vn.date()


def _pick_by_keywords_and_threshold(
    *,
    posts_in_day: list[Post],
    keywords: list[str],
    post_limit: Optional[int],
) -> list[Post]:
    # DEBUG: keyword vs content matching
    logger.info(
        "[DEBUG pick_by_keywords] keywords(raw)=%s type=%s post_limit(raw)=%s posts_in_day_count=%s",
        keywords,
        type(keywords).__name__,
        post_limit,
        len(posts_in_day) if posts_in_day is not None else None,
    )

    # A: match any keyword in content (substring, case-insensitive)
    kws = [k.strip().lower() for k in (keywords or []) if k and k.strip()]
    logger.info("[DEBUG pick_by_keywords] Normalized keywords=%s", kws)

    # In content của từng bài trong posts_in_day (rút gọn 50 ký tự)
    for idx, p in enumerate(posts_in_day or []):
        c = p.content if p is not None else None
        c_preview = (c[:50] if isinstance(c, str) else str(c)) if c is not None else None
        logger.info(
            "[DEBUG pick_by_keywords] posts_in_day[%s] url=%s content_preview=%s",
            idx,
            getattr(p, "url", None),
            c_preview,
        )


    # No keywords => áp dụng NGƯỠNG CŨ theo yêu cầu:

    # - posts_in_day > 10  => lấy 3
    # - posts_in_day 3-10  => lấy 2
    # - posts_in_day < 3   => lấy 1
    if not kws:
        b_count = len(posts_in_day)
        if post_limit is not None and post_limit > 0:
            limit_no_kw = post_limit
        elif b_count > 10:
            limit_no_kw = 3
        elif 3 <= b_count <= 10:
            limit_no_kw = 2
        else:
            limit_no_kw = 1 if b_count > 0 else 0

        return sorted(posts_in_day, key=lambda p: p.score, reverse=True)[:limit_no_kw]

    # Có keyword: CHỈ giữ các bài thực sự khớp với từ khóa mà người dùng đã chọn.
    # Không tự động lấy bài lệch từ khóa (fallback/backfill) để tránh lưu bài rác sai chủ đề.
    target = post_limit if (post_limit is not None and post_limit > 0) else 20

    def matches(p: Post) -> bool:
        content = (p.content or "").lower()
        if not content:
            return False
        matched_any = False
        for kw in kws:
            ok = kw in content
            logger.info(
                "[DEBUG pick_by_keywords] keyword_match url=%s kw=%r ok=%s content_preview=%r",
                getattr(p, "url", None),
                kw,
                ok,
                content[:50],
            )
            if ok:
                matched_any = True
        return matched_any

    matched = [p for p in posts_in_day if matches(p)]

    logger.info(
        "[DEBUG pick_by_keywords] STRICT match target=%s matched_count=%s posts_in_day_count=%s",
        target,
        len(matched),
        len(posts_in_day),
    )

    if not matched:
        return []

    matched_sorted = sorted(matched, key=lambda p: p.score, reverse=True)
    return matched_sorted[:target]

from app.modules.facebook.src.core.utils.logger import setup_logger

from app.modules.facebook.src.modules.crawl_fb.models.GroupSummary import GroupSummary
from .human_behavior import HumanBehavior

logger = setup_logger(__name__)

cancel_registry = {}

@dataclass
class GroupTarget:
    """Entity để truyền dữ liệu đầu vào cho các Group cần cào"""
    name: str
    url: str
    Intent:str
    id_member: str = ""
    keywords: Optional[List[str]] = None
    post_limit: Optional[int] = None

class FacebookScraper:
    def __init__(self, config):
        self.config = config
        self.auth = FacebookAuth(config)
       
    def scrape_groups(
        self, 
        groups: List[GroupTarget], 
        custom_email: Optional[str] = None, 
        custom_pass: Optional[str] = None,
        client_id: Optional[str] = None,
        custom_2fa: Optional[str] = None,
        on_group_crawled: Optional[Callable[[GroupSummary], None]] = None,
    ) -> List[GroupSummary]:
        
        results: List[GroupSummary] = []
        
        with sync_playwright() as p:
            # ── CẤU HÌNH HEADLESS TỐI ƯU CHO VPS PRODUCTION ────────────────────
            # Đổi headless=True tiết kiệm RAM, thêm các cờ chống dội tài nguyên
            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox', 
                    '--window-size=1920,1080',
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            )
            
            # ── 1. LOGIC QUẢN LÝ CONTEXT ───────────────────────────────────────
            context_args = {
                "viewport": {"width": 1920, "height": 1080},
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "locale": "vi-VN",
                "timezone_id": "Asia/Ho_Chi_Minh"
            }
            # Lấy đường dẫn file cookie tương ứng (Nếu có custom_email thì lấy file riêng, không thì lấy mặc định)
            cookie_path = self.auth.get_cookie_path(custom_email) 
            
            # Nếu là default account (custom_email trống), luôn cố sử dụng default cookie
            # Nếu là custom account, yêu cầu cookie đã tồn tại
            if custom_email and custom_email.strip():
                # Custom account: cookie phải tồn tại
                if not os.path.exists(cookie_path):
                    browser.close()
                    raise ValueError("Tài khoản chưa đăng nhập hoặc không tìm thấy phiên làm việc. Vui lòng đăng nhập tài khoản này trước!")
                context = browser.new_context(storage_state=cookie_path, **context_args)
            else:
                # Default account: luôn dùng default cookie (dù tồn tại hay không)
                if os.path.exists(cookie_path):
                    logger.info(f"🚀 Mở phiên làm việc từ file Cookie: {cookie_path}")
                    context = browser.new_context(storage_state=cookie_path, **context_args)
                else:
                    # Cookie mặc định không tồn tại -> Mở context trắng để login
                    logger.warning("⚠️ Không tìm thấy Cookie mặc định. Mở trình duyệt trắng để Login lại...")
                    context = browser.new_context(**context_args)

            
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            """)

            page = context.new_page()
            
            

            # ── 2. KIỂM TRA VÀ ĐĂNG NHẬP ──────────────────────────────────────
            logger.info("Khởi động trình duyệt và kiểm tra trạng thái đăng nhập...")
            page.goto("https://www.facebook.com/", wait_until="domcontentloaded", timeout=30_000)
            
            if self.auth._is_bot_check_screen(page):
                logger.error("🛑 Phát hiện bị chặn Bot/Captcha ngay sau khi load Cookie!")
                if os.path.exists(cookie_path):
                    try:
                        os.remove(cookie_path)
                        logger.warning(f"🗑️ Đã XÓA FILE COOKIE bị đánh dấu lỗi: {cookie_path}")
                    except Exception as file_err:
                        logger.error(f"⚠️ Lỗi khi xóa file cookie vật lý: {file_err}")
                        pass
                else:
                    logger.debug("File Cookie không tồn tại để xóa.")
                    pass
                browser.close()
                raise ValueError("LOGIN_FAILED")
            HumanBehavior.act_like_reading(page) 
            # ── [THÊM MỚI] XỬ LÝ MÀN HÌNH CHỌN TÀI KHOẢN (ACCOUNT CHOOSER) ──────
            try:
                # Sử dụng Regex để bắt text tiếng Việt hoặc tiếng Anh
                # Facebook đôi khi dùng thẻ <div> hoặc <a> cho nút này
                another_acc_btn = page.locator("text=/Đăng nhập bằng tài khoản khác|Log Into Another Account|Log in to another account/i").first
                
                if another_acc_btn.count() > 0 and another_acc_btn.is_visible():
                    logger.info("Phát hiện màn hình One-Tap Login, đang click 'Đăng nhập bằng tài khoản khác'...")
                    another_acc_btn.click(timeout=5000)
                    # Chờ 1 chút để form email/pass truyền thống xuất hiện lại trên DOM
                    page.wait_for_timeout(2000)
            except Exception as e:
                # Nếu không tìm thấy nút này hoặc có lỗi thì cứ bỏ qua và đi tiếp
                logger.debug(f"Không có màn hình chọn tài khoản: {e}")
                pass
            is_logged_in = False
            try:
                page.wait_for_selector('div[role="navigation"]', timeout=5000)
                if page.locator(self.config.AUTH_SELECTORS["email"]).count() == 0:
                    is_logged_in = True
            except:
                is_logged_in = False

            if not is_logged_in:
                if custom_email:
                    # Nếu có email FE mà cookie hết hạn (không vào được feed) -> Thử login lại bằng thông tin FE gửi
                    logger.info(f"⚠️ Cookie của {custom_email} hết hạn. Đang thử login lại...")
                    login_success = self.auth.login(
                        page=page, context=context, 
                        custom_email=custom_email, custom_pass=custom_pass, custom_2fa=custom_2fa
                    )
                else:
                    # Nếu không có email FE -> Gọi hàm LOGIN MẶC ĐỊNH
                    logger.info("⚠️ Chưa đăng nhập tài khoản hệ thống. Đang login mặc định...")
                    login_success = self.auth.default_login(page=page, context=context)
                
                if not login_success:
                    logger.error("🛑 Đăng nhập thất bại. Kết thúc.")
                    browser.close()
                    raise ValueError("LOGIN_FAILED")
            else:
                logger.info("✅ Đã đăng nhập sẵn (Cookie còn hiệu lực).")
                pass
            try:
                        context.storage_state(path=str(cookie_path))
                        logger.info(f"🔄 Đã cập nhật/gia hạn Cookie thành công vào: {cookie_path}")
            except Exception as e:
                        logger.error(f"⚠️ Lỗi khi cập nhật cookie: {e}")
                        pass
            # ── 3. LẶP QUA MẢNG CÁC GROUP (SỐ LƯỢNG NGẪU NHIÊN) ───────────────
            for index, group in enumerate(groups):
                if client_id and cancel_registry.get(client_id):
                    logger.info(f"🛑 Đã nhận lệnh hủy cào dữ liệu cho client {client_id}.")
                    
                    break
                if index > 0:
                    # Nghỉ ngẫu nhiên từ 30 giây đến 60 giây (1-3 phút)
                    macro_delay = random.uniform(10, 20)
                    logger.info(f"⏳ Giãn cách an toàn: Đang nghỉ ngơi {macro_delay:.0f} giây trước khi vào {group.name}...")
                    
                    # Chia nhỏ thời gian sleep để vẫn có thể nhận lệnh hủy (cancel_registry) giữa chừng
                    for _ in range(int(macro_delay)):
                        if client_id and cancel_registry.get(client_id):
                            break
                        time.sleep(1)
                logger.info(f"🚀 Bắt đầu cào group: {group.name}")
                try:
                    url = group.url
                    if 'sorting_setting=CHRONOLOGICAL' not in url:
                        url += ('&' if '?' in url else '?') + 'sorting_setting=CHRONOLOGICAL'
                    
                    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                    
                    time.sleep(random.uniform(3, 5))
                    
                    all_valid_posts: List[Post] = []
                    seen_urls = set()
                    consecutive_old = 0
                    should_stop = False
                    
                    last_scroll_height = 0
                    scroll_stuck_count = 0
                    MAX_STUCK_LIMIT = 3
                    # Không còn giới hạn theo SAFE_LIMIT nữa.
                    # Dừng scroll khi đã lướt qua toàn bộ bài thuộc đúng ngày VN (UTC+7).

                    while not should_stop:

                        if client_id and cancel_registry.get(client_id):
                            should_stop = True
                            break

                        try:
                            page.wait_for_selector(self.config.FB_POST_CONTAINER, timeout=5_000)
                        except:
                            pass
                        
                        blocks = page.locator(self.config.FB_POST_CONTAINER).all()
                        
                        for block in blocks:
                            try:
                                # block.scroll_into_view_if_needed()
                                
                                
                                post_url, post_date = PostExtractor.get_info(block)
                                
                                if not post_url or post_url in seen_urls:
                                    continue
                                page.wait_for_timeout(random.randint(50, 100))
                                age = classify_timestamp(post_date)
                                if age == 'old':
                                    consecutive_old += 1
                                    if consecutive_old >= self.config.MAX_OLD_POSTS_LIMIT:
                                        should_stop = True
                                        break
                                    seen_urls.add(post_url)
                                    continue
                                else:
                                    consecutive_old = 0
                                logger.info(f"👉 Đang bóc bài: URL={post_url} | DATE={post_date} | Lịch sử Seen={len(seen_urls)}")
                                seen_urls.add(post_url)
                                
                                stats = PostExtractor.get_stats(block)
                                score = stats['comments']*2 + stats["reactions"] + stats["shares"]*3
                                media_url = PostExtractor.get_media(block, post_url)
                                image_urls = PostExtractor.get_images(block)
                                content = PostExtractor.get_content(block)

                                post = Post(
                                    url=post_url, date=post_date,
                                    reactions=stats['reactions'], comments=stats['comments'],
                                    shares=stats['shares'], score=score, content=content,
                                    media_url=media_url, images=image_urls,
                                )
                                all_valid_posts.append(post)

                                # Không còn giới hạn theo SAFE_LIMIT.
                                # Dừng scroll theo điều kiện thời gian/hiện diện bài viết trong ngày VN (UTC+7)
                                # sẽ được điều khiển thông qua logic classify_timestamp + consecutive_old.
                                
                                # (cố tình xóa điều kiện dừng theo safe_limit để đúng yêu cầu gốc)
                                
                                # if len(seen_urls) >= safe_limit:
                                #     should_stop = True
                                #     break
                            except Exception as e:
                                logger.debug(f"[block error] {e}")
                                continue

                        if should_stop: break

                        last_scroll_height = page.evaluate("document.documentElement.scrollHeight")
                        
                        for _ in range(random.randint(1, 2)):
                            HumanBehavior.random_scroll(page, max_distance=self.config.SCROLL_DISTANCE)
                        
                        HumanBehavior.gamma_delay(mean=self.config.SCROLL_SLEEP_MIN, shape=2)
                        
                        new_scroll_height = page.evaluate("document.documentElement.scrollHeight")
                        if new_scroll_height == last_scroll_height:
                            scroll_stuck_count += 1
                            if scroll_stuck_count >= MAX_STUCK_LIMIT:
                                break
                        else:
                            scroll_stuck_count = 0

                    # 4. Tổng hợp Group hiện tại
                    today_vn = _vn_now()
                    posts_in_day = [p for p in all_valid_posts if p.date and _is_same_vn_calendar_day(p.date, today_vn)]
                    selected_posts = _pick_by_keywords_and_threshold(
                        posts_in_day=posts_in_day,
                        keywords=getattr(group, "keywords", None) or [],
                        post_limit=getattr(group, "post_limit", None),
                    )
                    sorted_posts = sorted(all_valid_posts, key=lambda x: x.score, reverse=True)
                    summary = GroupSummary(
                        group_name=group.name,
                        link_group=group.url,
                        total_posts_24h=len(all_valid_posts),
                        Intent=group.Intent,
                        id_member=group.id_member,
                        hot_post=selected_posts[0] if selected_posts else (sorted_posts[0] if sorted_posts else None),
                        selected_posts=selected_posts,
                    )
                    results.append(summary)
                    if on_group_crawled:
                        on_group_crawled(summary)
                    

                except Exception as e:
                    logger.error(f"❌ Lỗi group {group.name}: {e}")
                    summary = GroupSummary(
                        group_name=group.name,
                        link_group=group.url,
                        total_posts_24h=0,
                        Intent=group.Intent,
                        id_member=group.id_member,
                        hot_post=None
                    )
                    results.append(summary)
                    if on_group_crawled:
                        on_group_crawled(summary)

            browser.close()
            return results