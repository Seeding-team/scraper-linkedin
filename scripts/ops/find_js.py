import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"
LOCAL_JS = r"D:\CrawlDataLinkedin\realtime_explore\zca_fixed_local.js"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Find where zca_persistent_listener.js lives in the git repo
print("=== Find JS file in git repo ===")
cmd = f"cd {CWD} && find . -name 'zca_persistent_listener.js' 2>/dev/null | head -5"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Check if it's in the repo
cmd = f"cd {CWD} && git ls-files | grep zca_persistent"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(f"Git tracked: {out.decode('utf-8','replace')}")

# Check directory structure
print("\n=== CWD contents ===")
cmd = f"ls {CWD}/linkedin_group_crawler/ | head -10"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# The JS file might be in the linkedin_group_crawler/scripts folder
cmd = f"ls {CWD}/linkedin_group_crawler/scripts/ 2>/dev/null | head -10"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(f"Scripts dir: {out.decode('utf-8','replace')}")

client.close()
