import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

# Find correct repo path and docker-compose location
CMDS = [
    "find /home -maxdepth 4 -type d -name '.git' 2>/dev/null | head -10",
    "find /opt -maxdepth 4 -type d -name '.git' 2>/dev/null | head -10",
    "find /root -maxdepth 4 -type d -name '.git' 2>/dev/null | head -10",
    "ls /home/ 2>/dev/null",
    "ls / 2>/dev/null | head -30",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)
    for cmd in CMDS:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        if out:
            print(f"CMD: {cmd}\n{out}\n")
        if err and "find" not in err.lower():
            print(f"STDERR: {err}\n")
finally:
    client.close()
