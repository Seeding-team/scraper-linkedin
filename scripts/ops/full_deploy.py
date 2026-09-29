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

    # Step 1: Free disk space if needed
    print("=== FREEING DISK SPACE ===")
    stdin, stdout, stderr = client.exec_command("docker system prune -af 2>&1 | tail -5", timeout=120)
    print(stdout.read().decode("utf-8", errors="replace"))

    # Step 2: Git pull
    print("\n=== GIT PULL ===")
    stdin2, stdout2, stderr2 = client.exec_command(f"cd {REPO} && git pull origin restyle-form 2>&1", timeout=60)
    out2 = stdout2.read().decode("utf-8", errors="replace")
    print(out2[-500:] if len(out2) > 500 else out2)
    print("Exit:", stdout2.channel.recv_exit_status())

    # Step 3: Build backend
    print("\n=== BUILDING BACKEND ===")
    stdin3, stdout3, stderr3 = client.exec_command(
        f"cd {REPO} && docker compose build backend 2>&1",
        timeout=600
    )
    out3 = stdout3.read().decode("utf-8", errors="replace")
    lines3 = out3.split('\n')
    print('\n'.join(lines3[-10:]))
    print("Exit:", stdout3.channel.recv_exit_status())

    # Step 4: Build frontend
    print("\n=== BUILDING FRONTEND ===")
    stdin4, stdout4, stderr4 = client.exec_command(
        f"cd {REPO} && docker compose build frontend 2>&1",
        timeout=600
    )
    out4 = stdout4.read().decode("utf-8", errors="replace")
    lines4 = out4.split('\n')
    print('\n'.join(lines4[-10:]))
    print("Exit:", stdout4.channel.recv_exit_status())

    # Step 5: Restart both
    print("\n=== RESTARTING SERVICES ===")
    stdin5, stdout5, stderr5 = client.exec_command(
        f"cd {REPO} && docker compose up -d --no-deps backend frontend 2>&1",
        timeout=120
    )
    print(stdout5.read().decode("utf-8", errors="replace").strip())

    print("\nWaiting 25s for services to start...")
    time.sleep(25)

    # Check status
    stdin6, stdout6, stderr6 = client.exec_command(
        f"cd {REPO} && docker compose ps 2>&1",
        timeout=30
    )
    print("\n=== STATUS ===")
    print(stdout6.read().decode("utf-8", errors="replace"))

    stdin7, stdout7, stderr7 = client.exec_command(
        f"cd {REPO} && docker compose logs --tail=20 backend 2>&1",
        timeout=30
    )
    print("\n=== BACKEND LOGS ===")
    print(stdout7.read().decode("utf-8", errors="replace"))

finally:
    client.close()
