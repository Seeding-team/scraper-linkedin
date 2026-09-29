import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Restart containers to use new images
print("=== Restarting containers ===")
stdin, stdout, stderr = client.exec_command(
    f"cd {CWD} && docker compose down && docker compose up -d 2>&1",
    timeout=120
)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print(out)
if err:
    print("STDERR:", err[-2000:])

# Check status
print("\n=== Container status ===")
stdin, stdout, stderr = client.exec_command(f"cd {CWD} && docker compose ps 2>&1", timeout=30)
print(stdout.read().decode("utf-8", errors="replace"))

# Health check
print("\n=== Health check ===")
stdin, stdout, stderr = client.exec_command("curl -s http://localhost:8000/health 2>&1", timeout=15)
print(stdout.read().decode("utf-8", errors="replace"))

client.close()
print("\nDone.")
