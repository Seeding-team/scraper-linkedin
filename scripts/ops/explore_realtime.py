import paramiko
import os

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"
LOCAL = r"D:\CrawlDataLinkedin\realtime_explore"

os.makedirs(LOCAL, exist_ok=True)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Find all files related to realtime
print("=== Files with realtime/websocket/listener ===")
stdin, stdout, stderr = client.exec_command(
    f"cd {CWD}/linkedin_group_crawler && find app -name '*.py' | xargs grep -l 'websocket\\|realtime\\|listener\\|poll\\|webhook\\|save_listener\\|notify\\|zalo_crawl\\|broadcast' 2>/dev/null | grep -v __pycache__ | grep -v '.pyc'",
    timeout=30
)
stdout_bytes = stdout.read()
with open(os.path.join(LOCAL, "realtime_files.txt"), "wb") as f:
    f.write(stdout_bytes)
files = [l.strip() for l in stdout_bytes.decode("utf-8", errors="replace").strip().split("\n") if l.strip()]
for f in files:
    print(f)

# Read websocket.py
print("\n=== websocket.py ===")
cmd = f"cat {CWD}/linkedin_group_crawler/app/modules/all_platform/websocket.py"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
with open(os.path.join(LOCAL, "websocket.py"), "wb") as f:
    f.write(out)
print(f"Read {len(out)} bytes")

# Read router.py - Zalo endpoints
print("\n=== router.py ===")
cmd = f"grep -n 'zalo\\|Zalo\\|broadcast\\|realtime\\|listener\\|poll\\|webhook' {CWD}/linkedin_group_crawler/app/modules/all_platform/router.py | head -50"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
with open(os.path.join(LOCAL, "router_zalo.txt"), "wb") as f:
    f.write(out)
print(f"Read {len(out)} bytes")

# Check crawler directory for zalo
print("\n=== Zalo crawler files ===")
stdin, stdout, stderr = client.exec_command(
    f"ls -la {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/crawler/ 2>/dev/null || echo 'no crawler dir'",
    timeout=15
)
out = stdout.read()
with open(os.path.join(LOCAL, "zalo_crawler_dir.txt"), "wb") as f:
    f.write(out)
print(out.decode("utf-8", errors="replace")[:500])

# Check zca broadcast sender
print("\n=== zca_broadcast_sender.py full ===")
cmd = f"cat {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/services/zca_broadcast_sender.py"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
with open(os.path.join(LOCAL, "zca_broadcast_sender.py"), "wb") as f:
    f.write(out)
print(f"Read {len(out)} bytes")

client.close()
