import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
REPO = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)

    # Check root docker-compose
    stdin, stdout, stderr = client.exec_command(
        f"cat {REPO}/docker-compose.yml 2>&1 | head -80",
        timeout=15
    )
    print("=== Root docker-compose.yml ===")
    print(stdout.read().decode("utf-8", errors="replace"))

    # Also check if there's a separate docker-compose for linkedin-crawler-ui
    stdin2, stdout2, stderr2 = client.exec_command(
        f"find {REPO} -name 'docker-compose*.yml' 2>/dev/null",
        timeout=15
    )
    print("\n=== All docker-compose files ===")
    print(stdout2.read().decode("utf-8", errors="replace"))

finally:
    client.close()
