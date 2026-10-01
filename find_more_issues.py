import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Check supabase_inbox_share_service.py line 364
print("=== supabase_inbox_share_service.py line 360-380 ===")
cmd = f"sed -n '355,385p' {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/services/supabase_inbox_share_service.py"
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
with open(r"D:\CrawlDataLinkedin\inbox_share.txt", "wb") as f:
    f.write(out)
print(f"Read {len(out)} bytes")

# Check _rest function itself - maybe the issue is with how params are encoded
# Let me search for any .eq. or .in. pattern that uses user-controlled data as a UUID type
print("\n=== All _rest calls with id= pattern ===")
cmd2 = f"""grep -n '_rest.*params.*id\\|"id"\\|id.*f\"' {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/services/supabase_service.py"""
stdin, stdout, stderr = client.exec_command(cmd2, timeout=15)
out2 = stdout.read()
with open(r"D:\CrawlDataLinkedin\rest_id_patterns.txt", "wb") as f:
    f.write(out2)
print(f"Read {len(out2)} bytes")

client.close()
