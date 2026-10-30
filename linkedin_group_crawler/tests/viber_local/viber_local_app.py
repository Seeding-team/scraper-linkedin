"""Chạy BACKEND THẬT của module Viber (router + service + repo) trên máy local:
- DB: Supabase local (supabase_db_linkedin_group_crawler)
- Viber API: trỏ sang mock_viber (127.0.0.1:8900)
- Supabase Storage local không có -> thay upload_media bằng kho của mock.
- Auth: override get_current_user = 1 member thật trong DB (RBAC/repo vẫn chạy thật).
"""
import os
import subprocess
import time

import jwt

_secret = [l.split("=", 1)[1] for l in subprocess.check_output(
    ["docker", "exec", "supabase_auth_linkedin_group_crawler", "env"], text=True).splitlines()
    if l.startswith("GOTRUE_JWT_SECRET=")][0]
os.environ["SUPABASE_URL"] = "http://127.0.0.1:54321"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = jwt.encode(
    {"role": "service_role", "iss": "supabase-demo", "exp": int(time.time()) + 36000}, _secret, algorithm="HS256")
os.environ["VIBER_API_BASE"] = "http://127.0.0.1:8900/pa"
os.environ["VIBER_WEBHOOK_BASE_URL"] = "https://seeding.example.com"
os.environ["VIBER_SUPABASE_STORAGE_BUCKET"] = "viber-media"

import httpx
from fastapi import FastAPI

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.viber.api.routes.viber import router
from app.modules.all_platform.viber.services import viber_repo

MOCK = "http://127.0.0.1:8900"
MEMBER = {"id": "94754896-3c84-4ce8-a25d-d8c3df75d28e", "role": "member", "full_name": "Sale A"}


async def _upload(path, data, content_type):  # thay Supabase Storage bằng kho mock
    async with httpx.AsyncClient() as c:
        await c.put(f"{MOCK}/storage/{path}", content=data,
                    headers={"content-type": content_type or "application/octet-stream"})
    return f"{MOCK}/storage/{path}"


viber_repo.upload_media = _upload

app = FastAPI(title="Viber Chat local")
app.include_router(router, prefix="/api/all-platform/viber")
app.dependency_overrides[get_current_user] = lambda: MEMBER


@app.get("/__health")
def health():
    return {"ok": True}
