import paramiko
import sys

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Prune docker images
print("=== Pruning Docker images ===")
stdin, stdout, stderr = client.exec_command(
    "docker image prune -a -f 2>&1",
    timeout=120
)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print(out)
if err:
    print("STDERR:", err[-2000:])

# Check space again
print("\n=== Disk space after prune ===")
stdin, stdout, stderr = client.exec_command("df -h /", timeout=15)
print(stdout.read().decode("utf-8", errors="replace"))

# Prune build cache too
print("\n=== Pruning build cache ===")
stdin, stdout, stderr = client.exec_command("docker builder prune -f 2>&1", timeout=60)
print(stdout.read().decode("utf-8", errors="replace"))

# Check space
print("\n=== Disk space ===")
stdin, stdout, stderr = client.exec_command("df -h /", timeout=15)
print(stdout.read().decode("utf-8", errors="replace"))

client.close()
