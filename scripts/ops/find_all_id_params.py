import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Search for ALL supabase calls that might pass a message_id as UUID
# Focus on id= or id.in. patterns
print("=== All id= params in zalo supabase_service ===")
stdin, stdout, stderr = client.exec_command(
    f"grep -n '\"id\"\\|id.*eq\\|id.*in' {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/services/supabase_service.py | head -40",
    timeout=15
)
stdout_bytes = stdout.read()
with open(r"D:\CrawlDataLinkedin\id_params.txt", "wb") as f:
    f.write(stdout_bytes)

# Check if there's any single-message fetch (not by_ids) that uses id as UUID
print("\n=== fetch_message_by_id or similar ===")
stdin, stdout, stderr = client.exec_command(
    f"grep -n 'def fetch_message\\|def get_message\\|def load_message\\|async def get_' {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/services/supabase_service.py",
    timeout=15
)
stdout_bytes = stdout.read()
with open(r"D:\CrawlDataLinkedin\fetch_funcs.txt", "wb") as f:
    f.write(stdout_bytes)

client.close()
