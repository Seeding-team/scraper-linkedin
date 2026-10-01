import paramiko
import time

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
REPO = "/opt/apps/seeding_markeeai/scraper-linkedin"
BACKEND_DIR = f"{REPO}/linkedin_group_crawler"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)

    # Force remove broken container and rebuild from repo
    print("=== BUILDING from repo ===")
    stdin, stdout, stderr = client.exec_command(
        f"cd {BACKEND_DIR} && docker compose build --no-cache backend 2>&1",
        timeout=600
    )
    out = stdout.read().decode("utf-8", errors="replace")
    lines = out.split('\n')
    print('\n'.join(lines[-20:]))
    print("Exit:", stdout.channel.recv_exit_status())

    print("\n=== REMOVING OLD CONTAINER ===")
    stdin2, stdout2, stderr2 = client.exec_command(
        f"cd {BACKEND_DIR} && docker compose rm -f backend 2>&1",
        timeout=60
    )
    print(stdout2.read().decode("utf-8", errors="replace").strip())

    print("\n=== STARTING FRESH ===")
    stdin3, stdout3, stderr3 = client.exec_command(
        f"cd {BACKEND_DIR} && docker compose up -d backend 2>&1",
        timeout=120
    )
    print(stdout3.read().decode("utf-8", errors="replace").strip())

    time.sleep(25)

    stdin4, stdout4, stderr4 = client.exec_command(
        f"cd {BACKEND_DIR} && docker compose ps backend 2>&1",
        timeout=30
    )
    print("\n=== STATUS ===")
    print(stdout4.read().decode("utf-8", errors="replace"))

    stdin5, stdout5, stderr5 = client.exec_command(
        f"cd {BACKEND_DIR} && docker compose logs --tail=25 backend 2>&1",
        timeout=30
    )
    print("\n=== LOGS ===")
    print(stdout5.read().decode("utf-8", errors="replace"))

finally:
    client.close()
