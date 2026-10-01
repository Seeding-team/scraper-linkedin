"""Quick check remote structure."""
import paramiko
HOST = "10.120.80.45"
USER = "seeding"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASS, timeout=30, allow_agent=False)
stdin, stdout, stderr = client.exec_command("ls /home/seeding/service/", timeout=10)
print(stdout.read().decode().strip())
stdin2, stdout2, stderr2 = client.exec_command("ls /home/seeding/", timeout=10)
print(stdout2.read().decode().strip())
client.close()
