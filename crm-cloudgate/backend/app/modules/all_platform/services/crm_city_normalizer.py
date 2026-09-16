from __future__ import annotations

import re
import unicodedata
from typing import Any


_VIETNAM_CITIES: tuple[tuple[str, str], ...] = (
    ("An_Giang", "An Giang"),
    ("Ba_Ria_Vung_Tau", "B\u00e0 R\u1ecba - V\u0169ng T\u00e0u"),
    ("Bac_Lieu", "B\u1ea1c Li\u00eau"),
    ("Bac_Giang", "B\u1eafc Giang"),
    ("Bac_Kan", "B\u1eafc K\u1ea1n"),
    ("Bac_Ninh", "B\u1eafc Ninh"),
    ("Ben_Tre", "B\u1ebfn Tre"),
    ("Binh_Dinh", "B\u00ecnh \u0110\u1ecbnh"),
    ("Binh_Duong", "B\u00ecnh D\u01b0\u01a1ng"),
    ("Binh_Phuoc", "B\u00ecnh Ph\u01b0\u1edbc"),
    ("Binh_Thuan", "B\u00ecnh Thu\u1eadn"),
    ("Ca_Mau", "C\u00e0 Mau"),
    ("Cao_Bang", "Cao B\u1eb1ng"),
    ("Can_Tho", "C\u1ea7n Th\u01a1"),
    ("Da_Nang", "\u0110\u00e0 N\u1eb5ng"),
    ("Dak_Lak", "\u0110\u1eafk L\u1eafk"),
    ("Dak_Nong", "\u0110\u1eafk N\u00f4ng"),
    ("Dien_Bien", "\u0110i\u1ec7n Bi\u00ean"),
    ("Dong_Nai", "\u0110\u1ed3ng Nai"),
    ("Dong_Thap", "\u0110\u1ed3ng Th\u00e1p"),
    ("Gia_Lai", "Gia Lai"),
    ("Ha_Giang", "H\u00e0 Giang"),
    ("Ha_Nam", "H\u00e0 Nam"),
    ("Ha_Noi", "H\u00e0 N\u1ed9i"),
    ("Ha_Tinh", "H\u00e0 T\u0129nh"),
    ("Hai_Duong", "H\u1ea3i D\u01b0\u01a1ng"),
    ("Hai_Phong", "H\u1ea3i Ph\u00f2ng"),
    ("Hau_Giang", "H\u1eadu Giang"),
    ("Hoa_Binh", "H\u00f2a B\u00ecnh"),
    ("Hung_Yen", "H\u01b0ng Y\u00ean"),
    ("Khanh_Hoa", "Kh\u00e1nh H\u00f2a"),
    ("Kien_Giang", "Ki\u00ean Giang"),
    ("Kon_Tum", "Kon Tum"),
    ("Lai_Chau", "Lai Ch\u00e2u"),
    ("Lam_Dong", "L\u00e2m \u0110\u1ed3ng"),
    ("Lang_Son", "L\u1ea1ng S\u01a1n"),
    ("Lao_Cai", "L\u00e0o Cai"),
    ("Long_An", "Long An"),
    ("Nam_Dinh", "Nam \u0110\u1ecbnh"),
    ("Nghe_An", "Ngh\u1ec7 An"),
    ("Ninh_Binh", "Ninh B\u00ecnh"),
    ("Ninh_Thuan", "Ninh Thu\u1eadn"),
    ("Phu_Tho", "Ph\u00fa Th\u1ecd"),
    ("Phu_Yen", "Ph\u00fa Y\u00ean"),
    ("Quang_Binh", "Qu\u1ea3ng B\u00ecnh"),
    ("Quang_Nam", "Qu\u1ea3ng Nam"),
    ("Quang_Ngai", "Qu\u1ea3ng Ng\u00e3i"),
    ("Quang_Ninh", "Qu\u1ea3ng Ninh"),
    ("Quang_Tri", "Qu\u1ea3ng Tr\u1ecb"),
    ("Soc_Trang", "S\u00f3c Tr\u0103ng"),
    ("Son_La", "S\u01a1n La"),
    ("Tay_Ninh", "T\u00e2y Ninh"),
    ("Thai_Binh", "Th\u00e1i B\u00ecnh"),
    ("Thai_Nguyen", "Th\u00e1i Nguy\u00ean"),
    ("Thanh_Hoa", "Thanh H\u00f3a"),
    ("Thua_Thien_Hue", "Th\u1eeba Thi\u00ean Hu\u1ebf"),
    ("Tien_Giang", "Ti\u1ec1n Giang"),
    ("Ho_Chi_Minh", "TP. H\u1ed3 Ch\u00ed Minh"),
    ("Tra_Vinh", "Tr\u00e0 Vinh"),
    ("Tuyen_Quang", "Tuy\u00ean Quang"),
    ("Vinh_Long", "V\u0129nh Long"),
    ("Vinh_Phuc", "V\u0129nh Ph\u00fac"),
    ("Yen_Bai", "Y\u00ean B\u00e1i"),
)


def _key(value: str) -> str:
    text = unicodedata.normalize("NFD", value)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("\u0110", "D").replace("\u0111", "d").lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def _repair_mojibake(value: str) -> str:
    for encoding in ("cp1252", "latin1"):
        try:
            repaired = value.encode(encoding).decode("utf-8")
        except Exception:
            continue
        if repaired != value and "\ufffd" not in repaired:
            return repaired
    return value


_CITY_BY_KEY: dict[str, str] = {}
for code, name in _VIETNAM_CITIES:
    _CITY_BY_KEY[_key(code)] = name
    _CITY_BY_KEY[_key(name)] = name
    _CITY_BY_KEY[_key(name.replace("TP. ", ""))] = name
    ascii_loss = "".join(ch if ord(ch) < 128 else "?" for ch in name)
    _CITY_BY_KEY[_key(ascii_loss.replace("?", ""))] = name

_SPECIAL_CITY_BY_KEY = {
    "klk": "\u0110\u1eafk L\u1eafk",
    "daklak": "\u0110\u1eafk L\u1eafk",
    "aklak": "\u0110\u1eafk L\u1eafk",
    "knng": "\u0110\u1eafk N\u00f4ng",
    "daknong": "\u0110\u1eafk N\u00f4ng",
    "aknong": "\u0110\u1eafk N\u00f4ng",
}


def normalize_vietnam_city(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    repaired = _repair_mojibake(text)
    return (
        _CITY_BY_KEY.get(_key(repaired))
        or _SPECIAL_CITY_BY_KEY.get(_key(repaired.replace("?", "")))
        or _SPECIAL_CITY_BY_KEY.get(_key(repaired))
        or repaired
    )


def normalize_city_fields(row: dict[str, Any]) -> dict[str, Any]:
    if "city" in row:
        row["city"] = normalize_vietnam_city(row.get("city"))
    return row
