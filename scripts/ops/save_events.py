import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)

    # Save events.py from container to check current state
    stdin, stdout, stderr = client.exec_command(
        "docker exec seeding-backend cat /app/app/modules/all_platform/zalo/api/routes/events.py > /tmp/events_container.py 2>&1 && echo done",
        timeout=30
    )
    print("Save:", stdout.read().decode("utf-8", errors="replace").strip())

    sftp = client.open_sftp()
    sftp.get("/tmp/events_container.py", r"D:\CrawlDataLinkedin\events_container.py")
    sftp.close()
    print("Downloaded events_container.py")

finally:
    client.close()
