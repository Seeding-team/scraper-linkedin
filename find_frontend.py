import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
REPO = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)

    # Check docker-compose.yml for frontend
    stdin, stdout, stderr = client.exec_command(
        f"cat {REPO}/linkedin_group_crawler/docker-compose.yml 2>&1 | head -80",
        timeout=15
    )
    print("=== docker-compose.yml ===")
    print(stdout.read().decode("utf-8", errors="replace"))

    # Find where frontend service is
    stdin2, stdout2, stderr2 = client.exec_command(
        f"grep -rn 'scraper-linkedin-frontend\\|linkedin-crawler-ui\\|frontend' {REPO}/linkedin_group_crawler/docker-compose*.yml 2>&1",
        timeout=15
    )
    print("\n=== Frontend in docker-compose ===")
    print(stdout2.read().decode("utf-8", errors="replace"))

    # Check what's in the linkedin-crawler-ui dir for docker stuff
    stdin3, stdout3, stderr3 = client.exec_command(
        f"find {REPO}/linkedin-crawler-ui -name 'docker-compose*.yml' -o -name 'Dockerfile' 2>/dev/null",
        timeout=15
    )
    print("\n=== Docker files in linkedin-crawler-ui ===")
    print(stdout3.read().decode("utf-8", errors="replace"))

finally:
    client.close()
