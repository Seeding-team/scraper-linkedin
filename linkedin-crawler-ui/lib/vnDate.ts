const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * Ngày lịch "hôm nay" theo giờ Việt Nam (UTC+7, không DST), dạng "YYYY-MM-DD".
 *
 * KHÔNG dùng `new Date().toISOString().slice(0, 10)` — chuỗi đó lấy theo UTC, nên trong
 * khung 00:00-06:59 giờ VN mỗi ngày (UTC vẫn còn ở ngày lịch VN hôm trước), preset "Hôm nay"/
 * "Tuần này"/... và `max` của input chọn ngày sẽ nhầm sang ngày hôm qua theo giờ VN.
 *
 * `now` nhận tham số để test được (mock thời điểm) thay vì luôn đọc đồng hồ hệ thống.
 */
export function vnTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VN_TIME_ZONE }).format(now);
}
