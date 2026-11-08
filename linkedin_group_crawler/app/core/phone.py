"""Convert SĐT Việt Nam về dạng E.164 (+84) để gọi ZCA findUser.

SĐT Việt Nam:
  - Mobile (09x, 03x, 05x, 07x, 08x-di-dong): 10 chữ số, vd 0939108906
  - Cố định (02x-HN, 08x-mien-tay/TPHCM-cu): 11 chữ số, vd 0839108906
  - Tất cả local bắt đầu bằng '0'

E.164 VN:
  - Mobile: '+84' + 9 chữ số = 12 ký tự, vd +84939108906
  - Cố định: '+84' + 10 chữ số = 13 ký tự, vd +842439108906
"""

from __future__ import annotations

import re
import unicodedata


def _ascii_digits(s: str) -> str:
    """Doi cac ky tu so Unicode (full-width, Arabic-Indic...) ve ASCII 0-9.

    Ban phim ao / IME tren mobile doi khi chen ky tu so khong phai ASCII (vd
    full-width "０-９"). re.sub(r"\\D", ...) ben duoi la Unicode-aware nen KHONG
    loai duoc cac ky tu nay (chung duoc coi la \\d), khien SDT bi sai dinh
    dang ma khong bi strip - gay loi "khong hop le" chi tren mobile du nguoi
    dung go/nhin thay cung 1 so nhu tren may tinh.
    """
    return "".join(
        str(unicodedata.digit(ch)) if unicodedata.category(ch) == "Nd" else ch
        for ch in s
    )


def vn_phone_to_e164(value: str | None) -> str | None:
    """Trả về SĐT dạng E.164 nếu là SĐT VN hợp lệ, ngược lại trả None.

    Chấp nhận đầu vào (mobile + cố định):
      - '0839108906'        -> '+842439108906' (cố định 11 số)
      - '0939108906'        -> '+84939108906'  (mobile 10 số)
      - '2439108906'        -> '+842439108906' (cố định bỏ 0)
      - '+84939108906'      -> '+84939108906'  (giữ nguyên)
      - '+84 391 089 06'    -> '+8439108906'   (bỏ space/dash)
      - '0084 391 089 06'   -> '+8439108906'   (bỏ 00 đầu)
      - ' 0839 108 906 '    -> '+8439108906'   (trim)

    Trả None nếu:
      - Không phải SĐT VN (sai độ dài, sai prefix)
      - Chứa ký tự lạ
    """
    if not value:
        return None

    s = _ascii_digits(str(value).strip())
    if not s:
        return None

    # 1) Giữ lại chỉ chữ số và dấu '+' đầu chuỗi
    if s.startswith("+"):
        s = "+" + re.sub(r"\D", "", s[1:])
    else:
        s = re.sub(r"\D", "", s)

    if not s:
        return None

    # 2) Chuẩn hoá các dạng prefix
    if s.startswith("00"):
        # 0084... -> +84...
        s = "+" + s[2:]
    elif s.startswith("+84"):
        # Đã đúng định dạng +84
        pass
    elif s.startswith("+"):
        # Mã quốc gia khác -> không phải VN
        return None
    elif s.startswith("0"):
        # Local 0xxxxxxxxx -> +84xxxxxxxxx (bỏ số 0)
        s = "+84" + s[1:]
    elif s.startswith("84"):
        # 84xxxxxxxxx -> +84xxxxxxxxx
        s = "+" + s
    else:
        # 9 chữ số không có prefix (vd: 391089006) -> +84
        s = "+84" + s

    # 3) Validate
    # E.164 VN:
    #   - Mobile: '+84' + 9 chữ số = 12 ký tự  (vd: +84939108906)
    #   - Cố định (HN/TPHCM 02x/08x): '+84' + 10 chữ số = 13 ký tự  (vd: +842439108906)
    if not re.fullmatch(r"\+84\d{9,10}", s):
        return None

    return s


def is_valid_vn_phone(value: str | None) -> bool:
    """True nếu value là SĐT VN hợp lệ."""
    return vn_phone_to_e164(value) is not None


# ---------------- Test ----------------
if __name__ == "__main__":
    cases = [
        # input, expected
        # Mobile (10 số local)
        ("0939108906", "+84939108906"),
        ("939108906", "+84939108906"),
        ("+84939108906", "+84939108906"),
        ("+84 939 108 906", "+84939108906"),
        ("+84-939-108-906", "+84939108906"),
        ("0084 939 108 906", "+84939108906"),
        ("0939.108.906", "+84939108906"),
        ("  0939108906  ", "+84939108906"),
        # Cố định 11 số local (02x HN, 08x mien tay)
        ("0839108906", "+84839108906"),
        ("02439108906", "+842439108906"),
        ("2439108906", "+842439108906"),
        ("+842439108906", "+842439108906"),
        # Negative
        ("12345", None),                # quá ngắn
        ("+1xxxxxxxxx", None),          # Mỹ, không phải VN
        ("abcdefghij", None),           # không phải số
        ("", None),
        (None, None),
        ("+8423910890X", None),        # chứa chữ
        ("+84", None),                 # rỗng
    ]

    ok = 0
    failed: list[tuple[object, object | None]] = []
    for raw, expected in cases:
        got = vn_phone_to_e164(raw)
        if got == expected:
            ok += 1
        else:
            failed.append((raw, got, expected))
        mark = "OK  " if got == expected else "FAIL"
        print(f"[{mark}] {raw!r:30} -> {got!r}  (expected {expected!r})")
    print(f"\n{ok}/{len(cases)} passed")
    if failed:
        print("\nFailed:")
        for raw, got, expected in failed:
            print(f"  {raw!r}: got {got!r}, expected {expected!r}")
