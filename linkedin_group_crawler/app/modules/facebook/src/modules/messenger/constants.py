"""Facebook Messenger API Constants & Configuration.

Bộ quy chuẩn phòng thủ Anti-Checkpoint và nhịp sinh học người thật (Human Behavior Simulation).
"""

from typing import Dict, Any

# Mã lỗi đặc trưng của Meta khi phát hiện bất thường
FB_ERROR_TEMPORARILY_BLOCKED = 1357004  # Bạn tạm thời bị chặn sử dụng tính năng này
FB_ERROR_CHECKPOINT = 405               # Tài khoản bị đẩy sang Checkpoint 282 / 956
FB_ERROR_RATE_LIMIT = 368               # Thao tác quá nhanh (Rate limit)
FB_ERROR_SESSION_EXPIRED = 190          # Token/Cookie hết hạn hoặc bị đăng xuất

# Hạn mức Warm-up tài khoản theo độ tuổi (Warm-up Quota Tiers)
WARM_UP_TIERS: Dict[int, Dict[str, Any]] = {
    1: {
        "tier_name": "Tài khoản mới nạp (< 1 tuần)",
        "daily_limit": 8,
        "min_interval_seconds": 180,   # Tối thiểu 3 phút/tin
        "max_interval_seconds": 360,   # Tối đa 6 phút/tin
    },
    2: {
        "tier_name": "Tài khoản ổn định (1 - 4 tuần)",
        "daily_limit": 20,
        "min_interval_seconds": 120,   # Tối thiểu 2 phút/tin
        "max_interval_seconds": 240,   # Tối đa 4 phút/tin
    },
    3: {
        "tier_name": "Tài khoản uy tín (> 1 tháng)",
        "daily_limit": 45,
        "min_interval_seconds": 60,    # Tối thiểu 1 phút/tin
        "max_interval_seconds": 120,   # Tối đa 2 phút/tin
    },
}

# Tốc độ gõ phím người thật (Human Typing Speed - WPM 35-50 từ/phút)
TYPING_CHAR_DELAY_MIN = 0.16   # 160ms / ký tự
TYPING_CHAR_DELAY_MAX = 0.24   # 240ms / ký tự
PUNCTUATION_PAUSE_MIN = 0.4    # Nghỉ 400ms ở dấu câu (., ,, !)
PUNCTUATION_PAUSE_MAX = 0.9    # Nghỉ tối đa 900ms

# Thời gian đọc tin và nán lại
READ_LATENCY_MIN = 1.5         # Đọc tin cũ 1.5s
READ_LATENCY_MAX = 3.2         # Đọc tin cũ tối đa 3.2s
LINGER_LATENCY_MIN = 1.5       # Nán lại sau khi gửi 1.5s
LINGER_LATENCY_MAX = 2.5       # Nán lại tối đa 2.5s

# Thời gian đóng băng Circuit Breaker khi gặp mã lỗi 1357004
CIRCUIT_BREAKER_FREEZE_HOURS = 24
