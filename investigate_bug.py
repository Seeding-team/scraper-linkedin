import paramiko
import re

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Find all files that use zalo_messages
print("=== Searching for zalo_messages references ===")
stdin, stdout, stderr = client.exec_command(
    f"cd {CWD} && grep -r 'zalo_messages' --include='*.py' -l 2>/dev/null",
    timeout=30
)
files = stdout.read().decode().strip().split("\n")
for f in files:
    if f:
        print(f)

# Search for uuid cast or .eq() with zalo_id
print("\n=== Searching for uuid usage with zalo ===")
stdin, stdout, stderr = client.exec_command(
    f"cd {CWD} && grep -r 'uuid\\|uuid_\\|zalo_id\\|zalo_id.*eq\\|eq.*zalo_id' --include='*.py' -n 2>/dev/null | head -50",
    timeout=30
)
print(stdout.read().decode("utf-8", errors="replace"))

# Search for broadcast in zalo routes
print("\n=== Zalo broadcast/broadcasts route ===")
stdin, stdout, stderr = client.exec_command(
    f"cd {CWD} && find . -name '*.py' | xargs grep -l 'broadcast' 2>/dev/null | head -20",
    timeout=30
)
print(stdout.read().decode("utf-8", errors="replace"))

client.close()
