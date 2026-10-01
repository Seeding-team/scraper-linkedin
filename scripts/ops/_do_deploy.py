"""Deploy Facebook inbox endpoints to remote seeding service via SFTP."""
import paramiko
import sys
import io
from pathlib import Path

HOST = "10.120.80.45"
PORT = 22
USER = "seeding"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

REMOTE_BASE = "/home/seeding/service"
FILES = [
    ("api/routes.py", "api/routes.py"),
    ("sse/routes.py", "sse/routes.py"),
    ("inbox/worker.py", "inbox/worker.py"),
    ("config.py", "config.py"),
    ("main.py", "main.py"),
]

def deploy():
    local_base = Path(r"D:\service_fb_seeding\service")
    print(f"Local base: {local_base}")
    print(f"Connecting to {USER}@{HOST}:{PORT}...")

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, port=PORT, username=USER, password=PASS, timeout=30, allow_agent=False)
        print("Connected!")
    except Exception as e:
        print(f"SSH connect failed: {e}")
        sys.exit(1)

    sftp = client.open_sftp()

    for local_rel, remote_rel in FILES:
        local_path = local_base / local_rel
        remote_path = f"{REMOTE_BASE}/{remote_rel}"

        print(f"\n--- Deploying {local_rel} ---")
        if not local_path.exists():
            print(f"  SKIP: {local_path} not found")
            continue

        content = local_path.read_text(encoding="utf-8")
        print(f"  Local: {local_path.stat().st_size} bytes, {len(content.splitlines())} lines")

        # Backup remote first
        try:
            stdin, stdout, stderr = client.exec_command(f"cp {remote_path} {remote_path}.bak 2>/dev/null; echo ok")
            bak_result = stdout.read().decode().strip()
            print(f"  Backup: {bak_result}")
        except:
            print("  Backup: skipped")

        # Upload via SFTP
        buf = io.StringIO(content)
        sftp.putfo(buf, remote_path)
        print(f"  Uploaded OK")

        # Verify
        stdin, stdout, stderr = client.exec_command(f"wc -l {remote_path}")
        lines = stdout.read().decode().strip()
        print(f"  Remote: {lines} lines")

    sftp.close()

    # Restart service
    print("\n--- Restarting service ---")
    commands = [
        "cd /home/seeding && pkill -f 'uvicorn' 2>/dev/null; echo killed",
        "sleep 2",
        "cd /home/seeding && nohup python3 -m uvicorn service.main:app --host 0.0.0.0 --port 8000 --workers 2 > service.log 2>&1 &",
        "sleep 4",
        "curl -s http://localhost:8000/health 2>&1 || echo 'health check failed'",
    ]
    for cmd in commands:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        if out:
            print(f"  {cmd[:60]}: {out}")
        if err:
            print(f"  ERR: {err}")

    # Check if service is running
    stdin, stdout, stderr = client.exec_command("pgrep -f uvicorn 2>&1 || echo no-uvicorn", timeout=10)
    pids = stdout.read().decode().strip()
    print(f"  uvicorn pids: {pids}")

    client.close()
    print("\nDeploy complete!")

if __name__ == "__main__":
    deploy()
