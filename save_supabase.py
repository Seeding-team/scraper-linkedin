import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
sftp = None
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)
    sftp = client.open_sftp()

    # Read supabase_service.py list_zalo_accounts function
    stdin, stdout, stderr = client.exec_command(
        "docker exec seeding-backend cat /app/app/modules/all_platform/zalo/services/supabase_service.py 2>&1",
        timeout=30
    )
    content_bytes = stdout.read()
    with open(r"D:\CrawlDataLinkedin\container_supabase_service.py", "wb") as f:
        f.write(content_bytes)
    print(f"Written {len(content_bytes)} bytes to container_supabase_service.py")

finally:
    if sftp:
        sftp.close()
    client.close()
