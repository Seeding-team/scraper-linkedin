"""Mock Viber Bot API + kho media cục bộ để chạy thử Viber Chat không cần Viber thật.
- POST /pa/<method>: get_account_info / set_webhook / send_message (kiểm X-Viber-Auth-Token)
- PUT /storage/<path>, GET /storage/<path>: thay Supabase Storage (bản local không có)
- GET /viberfiles/<name>: giả làm media do Viber host (để test tải media đến)
- GET /__log: xem các lệnh bot đã gọi
"""
from fastapi import FastAPI, Request, Response, HTTPException
import uvicorn

TOKEN = "4453b6ac12345678-e02c5f12174805f9-daec9cbb5448c51f"
app = FastAPI()
LOG = {"get_account_info": 0, "set_webhook": [], "send_message": []}
STORE: dict[str, tuple[bytes, str]] = {}
_counter = [5000000000000000000]
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
       b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
       b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")


@app.post("/pa/{method}")
async def pa(method: str, request: Request):
    if request.headers.get("X-Viber-Auth-Token") != TOKEN:
        return {"status": 2, "status_message": "invalidAuthToken"}
    body = await request.json()
    if method == "get_account_info":
        LOG["get_account_info"] += 1
        return {"status": 0, "status_message": "ok", "id": "pa:123", "name": "Markee CSKH",
                "uri": "markeecskh", "icon": "http://127.0.0.1:8900/viberfiles/icon.png", "subscribers_count": 5}
    if method == "set_webhook":
        LOG["set_webhook"].append(body.get("url"))
        return {"status": 0, "status_message": "ok", "event_types": body.get("event_types", [])}
    if method == "send_message":
        _counter[0] += 1
        LOG["send_message"].append(body)
        return {"status": 0, "status_message": "ok", "message_token": _counter[0]}
    raise HTTPException(404, method)


@app.put("/storage/{path:path}")
async def put_storage(path: str, request: Request):
    STORE[path] = (await request.body(), request.headers.get("content-type", "application/octet-stream"))
    return {"ok": True}


@app.get("/storage/{path:path}")
async def get_storage(path: str):
    if path not in STORE:
        raise HTTPException(404)
    data, ct = STORE[path]
    return Response(content=data, media_type=ct)


@app.get("/viberfiles/{name}")
async def viberfiles(name: str):
    return Response(content=PNG, media_type="image/png")


@app.get("/__log")
async def log():
    return LOG


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8900, log_level="warning")
