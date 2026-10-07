"""Driver chạy end-to-end Viber Chat qua HTTP thật tới backend local (cổng 8099).
In ra PASS/FAIL cho từng testcase để dựng walkthrough."""
import hashlib
import hmac
import json
import threading
import time

import httpx

BASE = "http://127.0.0.1:8099/api/all-platform/viber"
MOCK = "http://127.0.0.1:8900"
TOKEN = "4453b6ac12345678-e02c5f12174805f9-daec9cbb5448c51f"
USER = "01234567890A/+b=="  # id Viber khách, có '/','+','='

_n = [0]
_fail = [0]


def check(name, cond, extra=""):
    _n[0] += 1
    status = "PASS" if cond else "FAIL"
    if not cond:
        _fail[0] += 1
    print(f"[{status}] TC{_n[0]:02d} {name}" + (f"  | {extra}" if extra else ""))


def wait_for(fn, timeout=6.0, interval=0.15):
    """Webhook xử lý nền (trả 200 ngay) -> poll cho tới khi điều kiện đúng thay vì sleep cố định."""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    return last


def sign(body: bytes) -> str:
    return hmac.new(TOKEN.encode(), body, hashlib.sha256).hexdigest()


def webhook(c, account_id, event, signature=None):
    raw = json.dumps(event).encode()
    sig = signature if signature is not None else sign(raw)
    return c.post(f"{BASE}/webhook/{account_id}", content=raw, headers={"X-Viber-Content-Signature": sig})


def main():
    c = httpx.Client(timeout=30)

    # Dọn account cũ của member này (chạy lại nhiều lần)
    for a in c.get(f"{BASE}/accounts").json()["data"]:
        c.delete(f"{BASE}/accounts/{a['id']}")

    print("\n===== VIBER CHAT — WALKTHROUGH (backend that + Supabase local + mock Viber) =====\n")

    # TC1
    r = c.get(f"{BASE}/accounts")
    check("GET /accounts ban đầu rỗng", r.status_code == 200 and r.json()["data"] == [], f"data={r.json()['data']}")

    # TC2 connect
    r = c.post(f"{BASE}/accounts/connect", json={"auth_token": TOKEN, "label": "CSKH"})
    data = r.json().get("data", {})
    acc = data.get("id")
    check("POST connect -> connected", r.status_code == 200 and data.get("status") == "connected", f"bot={data.get('display_name')} uri={data.get('bot_uri')}")
    check("connect KHÔNG lộ auth_token", "auth_token" not in data)
    mock_log = c.get(f"{MOCK}/__log").json()
    check("webhook đã đăng ký với Viber", mock_log["set_webhook"][-1].endswith(f"/viber/webhook/{acc}"), mock_log["set_webhook"][-1])

    # TC3 idempotent
    r2 = c.post(f"{BASE}/accounts/connect", json={"auth_token": TOKEN})
    check("connect lại cùng bot -> không tạo trùng", r2.json()["data"]["id"] == acc and len(c.get(f"{BASE}/accounts").json()["data"]) == 1)

    # TC4 incoming text
    r = webhook(c, acc, {"event": "message", "timestamp": 1760000000000, "message_token": 4912661846655238145,
                         "sender": {"id": USER, "name": "Khách A", "avatar": f"{MOCK}/viberfiles/av.png", "country": "VN"},
                         "message": {"type": "text", "text": "Chào shop, xem báo giá https://markee.vn giúp mình"}})
    check("webhook tin đến (chữ ký đúng) -> 200", r.status_code == 200)

    # TC5 bad signature
    r = webhook(c, acc, {"event": "message", "message_token": 1, "sender": {"id": USER}, "message": {"type": "text", "text": "x"}}, signature="deadbeef")
    check("webhook sai chữ ký -> 401", r.status_code == 401)

    # TC6 dialogs (poll vì webhook ghi nền)
    dialogs = wait_for(lambda: (c.get(f"{BASE}/accounts/{acc}/dialogs").json()["data"] or None) and
                       [d for d in c.get(f"{BASE}/accounts/{acc}/dialogs").json()["data"] if d.get("unread_count") == 1]) or []
    d0 = dialogs[0] if dialogs else {}
    check("GET dialogs hiện khách + unread", len(dialogs) == 1 and d0.get("unread_count") == 1 and d0.get("name") == "Khách A", f"preview={d0.get('last_message_preview')}")

    # TC7 messages + clear unread
    msgs = c.get(f"{BASE}/accounts/{acc}/messages", params={"viber_user_id": USER}).json()["data"]
    check("GET messages trả tin đến", len(msgs) == 1 and msgs[0]["is_outgoing"] is False and "markee.vn" in msgs[0]["text"])
    unread_after = c.get(f"{BASE}/accounts/{acc}/dialogs").json()["data"][0]["unread_count"]
    check("mở hội thoại -> unread về 0", unread_after == 0)

    # TC8 incoming picture (media host boi Viber -> backend tai ve rehost)
    webhook(c, acc, {"event": "message", "timestamp": 1760000001000, "message_token": 4912661846655238146,
                     "sender": {"id": USER, "name": "Khách A"},
                     "message": {"type": "picture", "media": f"{MOCK}/viberfiles/photo.png", "text": ""}})
    def _find_pic():
        got = [m for m in c.get(f"{BASE}/accounts/{acc}/messages", params={"viber_user_id": USER}).json()["data"] if m["message_token"] == "4912661846655238146"]
        return got[0] if got else None
    pic = wait_for(_find_pic) or {}
    check("tin ảnh đến -> media rehost về storage", pic["media_type"] == "picture" and pic["media_url"].startswith(f"{MOCK}/storage/"), pic["media_url"])
    check("ảnh rehost tải lại được", c.get(pic["media_url"]).status_code == 200)

    # TC9 send text
    r = c.post(f"{BASE}/messages/send", json={"account_id": acc, "viber_user_id": USER, "text": "Dạ em gửi báo giá ngay ạ"})
    sent = r.json()["data"]
    check("POST send text -> gửi 1 tin outgoing", r.status_code == 200 and len(sent) == 1 and sent[0]["is_outgoing"] and sent[0]["sender_name"] == "Sale A")
    last_send = c.get(f"{MOCK}/__log").json()["send_message"][-1]
    check("mock Viber nhận đúng receiver + sender", last_send["receiver"] == USER and last_send["sender"]["name"] == "Markee CSKH")
    reply_token = sent[0]["message_token"]

    # TC10 long text chunk
    r = c.post(f"{BASE}/messages/send", json={"account_id": acc, "viber_user_id": USER, "text": "A" * 7001})
    check("text 7001 ký tự -> chia 2 tin", len(r.json()["data"]) == 2)

    # TC11 send picture
    png = open(__file__, "rb").read()[:500]
    r = c.post(f"{BASE}/messages/send-media", data={"account_id": acc, "viber_user_id": USER, "caption": "Bảng giá"},
               files={"file": ("banggia.png", png, "image/png")})
    md = c.get(f"{MOCK}/__log").json()["send_message"][-1]
    check("send-media ảnh nhỏ -> type picture + caption", r.status_code == 200 and md["type"] == "picture" and md["text"] == "Bảng giá")

    # TC12 big -> file
    r = c.post(f"{BASE}/messages/send-media", data={"account_id": acc, "viber_user_id": USER},
               files={"file": ("hopdong.pdf", b"%PDF-1.4" + b"0" * (2 * 1024 * 1024), "application/pdf")})
    md = c.get(f"{MOCK}/__log").json()["send_message"][-1]
    check("send-media PDF -> type file", r.status_code == 200 and md["type"] == "file" and md["file_name"] == "hopdong.pdf")

    # TC13 oversize reject
    r = c.post(f"{BASE}/messages/send-media", data={"account_id": acc, "viber_user_id": USER},
               files={"file": ("huge.bin", b"0" * (50 * 1024 * 1024 + 1), "application/octet-stream")})
    check("send-media > 50MB -> 400", r.status_code == 400, r.json().get("message", ""))

    # TC14 delivered/seen no-downgrade
    webhook(c, acc, {"event": "seen", "timestamp": 1, "message_token": int(reply_token), "user_id": USER})
    webhook(c, acc, {"event": "delivered", "timestamp": 1, "message_token": int(reply_token), "user_id": USER})
    def _seen():
        got = [m for m in c.get(f"{BASE}/accounts/{acc}/messages", params={"viber_user_id": USER}).json()["data"] if m["message_token"] == reply_token]
        return got[0] if got and got[0]["status"] == "seen" else None
    st = wait_for(_seen) or {}
    check("trạng thái seen giữ nguyên dù delivered tới sau (atomic, không race)", st.get("status") == "seen", f"status={st.get('status')}")

    # TC15 SSE realtime
    got = {"evt": None}

    def listen():
        try:
            with httpx.Client(timeout=10) as sc, sc.stream("GET", f"{BASE}/events/stream") as s:
                for line in s.iter_lines():
                    if line.startswith("data:") and "viber-message" not in line and '"type"' in line:
                        got["evt"] = line
                        return
        except Exception as e:
            got["evt"] = f"ERR {e}"

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    time.sleep(0.8)  # chờ subscribe
    webhook(c, acc, {"event": "message", "timestamp": 1760000009000, "message_token": 4912661846655238200,
                     "sender": {"id": USER, "name": "Khách A"}, "message": {"type": "text", "text": "realtime nhé"}})
    t.join(timeout=5)
    check("SSE đẩy event khi có tin mới", got["evt"] is not None and "realtime" in (got["evt"] or ""), (got["evt"] or "")[:80])

    # TC16 reconnect
    before = len(c.get(f"{MOCK}/__log").json()["set_webhook"])
    r = c.post(f"{BASE}/accounts/{acc}/reconnect")
    after = len(c.get(f"{MOCK}/__log").json()["set_webhook"])
    check("reconnect -> đăng ký lại webhook", r.status_code == 200 and after == before + 1)

    # TC17 disconnect
    r = c.delete(f"{BASE}/accounts/{acc}")
    check("DELETE account -> 200", r.status_code == 200)
    check("gỡ webhook khỏi Viber (set url rỗng)", c.get(f"{MOCK}/__log").json()["set_webhook"][-1] == "")
    check("account đã biến mất", c.get(f"{BASE}/accounts").json()["data"] == [])

    print(f"\n===== KẾT QUẢ: {_n[0] - _fail[0]}/{_n[0]} PASS, {_fail[0]} FAIL =====")
    raise SystemExit(1 if _fail[0] else 0)


if __name__ == "__main__":
    main()
