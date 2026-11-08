"""Tạo/resolve user kỹ thuật "Web Intake" cho tích hợp Project 2 (web Learn) + sinh khoá API mạnh.

User này CHỈ để xác thực tích hợp:
  - role = member, KHÔNG có quote_business_role (không phải Sale/Presale), KHÔNG có quyền duyệt báo giá,
  - mật khẩu là hash của chuỗi ngẫu nhiên đã bị bỏ đi → không thể đăng nhập bằng mật khẩu,
  - chỉ ghi được bản ghi do chính nó tạo (can_write_deal theo leaded_by) và chỉ gọi được allowlist endpoint trong
    app/modules/all_platform/auth_deps.py.

Chạy (idempotent):
    python scripts/provision_web_intake_user.py                  # chỉ tạo/resolve user, in id
    python scripts/provision_web_intake_user.py --write-env      # + sinh khoá, ghi vào .env.local của backend
    python scripts/provision_web_intake_user.py --write-env --project2-env ../../central-web/.env.local

Khoá KHÔNG bao giờ được in ra màn hình, không commit. Mỗi môi trường (local / staging / production) phải sinh khoá riêng,
đừng dùng lại khoá của môi trường khác.
"""
from __future__ import annotations

import argparse
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import bcrypt  # noqa: E402

EMAIL = "web-intake@integration.markeeai.local"
NAME = "Web Intake (integration)"


def make_client(env_file: str | None):
    """Không có --env-file: dùng cấu hình như lúc backend chạy local (.env rồi .env.local override).
    Có --env-file: CHỈ đọc đúng file đó (vd .env = production), bỏ qua .env.local."""
    if not env_file:
        import app.core.config  # noqa: F401
        from app.core.supabase_client import get_supabase_client

        return get_supabase_client()
    from supabase import create_client

    text = Path(env_file).read_text(encoding="utf-8")
    def get(name: str) -> str:
        m = re.search(rf"^{name}=(.+)$", text, flags=re.M)
        if not m:
            raise SystemExit(f"{name} không có trong {env_file}")
        return m.group(1).strip().strip('"').strip("'")
    return create_client(get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"))


def resolve_user(supabase) -> dict:
    found = supabase.table("app_users").select("id,email,role,is_active").eq("email", EMAIL).execute().data
    if found:
        user = found[0]
        # Giữ user ở trạng thái quyền tối thiểu nếu ai đó lỡ đổi.
        patch = {}
        if user.get("role") != "member":
            patch["role"] = "member"
        if not user.get("is_active", True):
            patch["is_active"] = True
        if patch:
            supabase.table("app_users").update(patch).eq("id", user["id"]).execute()
        return user
    row = {
        "email": EMAIL,
        "name": NAME,
        "role": "member",
        "is_active": True,
        # Hash của chuỗi ngẫu nhiên không lưu ở đâu cả → không ai đăng nhập bằng mật khẩu được.
        "password": bcrypt.hashpw(secrets.token_urlsafe(48).encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
    }
    return supabase.table("app_users").insert(row).execute().data[0]


def upsert_env(path: Path, values: dict[str, str]) -> None:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    for key, value in values.items():
        line = f"{key}={value}"
        if re.search(rf"^{re.escape(key)}=", text, flags=re.M):
            text = re.sub(rf"^{re.escape(key)}=.*$", line, text, flags=re.M)
        else:
            text = text.rstrip("\n") + ("\n" if text else "") + line + "\n"
    path.write_text(text, encoding="utf-8")


def existing_key(path: Path, name: str) -> str | None:
    if not path.exists():
        return None
    m = re.search(rf"^{re.escape(name)}=(.+)$", path.read_text(encoding="utf-8"), flags=re.M)
    return m.group(1).strip() if m else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-env", action="store_true", help="sinh khoá và ghi vào backend .env.local")
    ap.add_argument("--rotate", action="store_true", help="sinh khoá mới kể cả khi đã có")
    ap.add_argument("--env-file", help="file .env chứa SUPABASE_URL/SERVICE_ROLE_KEY của môi trường đích (bỏ qua .env.local)")
    ap.add_argument("--out", help="ghi WEB_INTAKE_* vào file này (nên nằm NGOÀI repo) thay vì .env.local của backend")
    ap.add_argument("--project2-env", help="đường dẫn .env.local của Project 2 để ghi CRM_WEB_INTAKE_KEY")
    args = ap.parse_args()

    user = resolve_user(make_client(args.env_file))
    print(f"Web Intake user: id={user['id']} email={user['email']} role=member (không có quote_business_role)")
    if not args.write_env:
        return

    backend_env = Path(args.out).resolve() if args.out else ROOT / ".env.local"
    key = None if args.rotate else existing_key(backend_env, "WEB_INTAKE_API_KEY")
    key = key or secrets.token_urlsafe(48)
    upsert_env(backend_env, {"WEB_INTAKE_USER_ID": user["id"], "WEB_INTAKE_API_KEY": key})
    print(f"Đã ghi WEB_INTAKE_USER_ID + WEB_INTAKE_API_KEY vào {backend_env} (khoá {len(key)} ký tự, không in ra)")
    if args.project2_env:
        p2 = Path(args.project2_env).resolve()
        upsert_env(p2, {"CRM_WEB_INTAKE_KEY": key})
        print(f"Đã ghi CRM_WEB_INTAKE_KEY vào {p2}")


if __name__ == "__main__":
    main()
