import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Search ALL py files for any id= or id.in. pattern near zalo_messages
# This finds any place that queries zalo_messages with an id parameter
print("=== Lines with id= near zalo_messages ===")
cmd = f"""cd {CWD}/linkedin_group_crawler && grep -rn 'zalo_messages' --include='*.py' app/ | grep -v __pycache__ | grep -v supabase_service.py"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
stdout_bytes = stdout.read()
with open(r"D:\CrawlDataLinkedin\all_zalo_lines.txt", "wb") as f:
    f.write(stdout_bytes)
print(f"Read {len(stdout_bytes)} bytes, {stdout_bytes.decode('utf-8','replace').count(chr(10))} lines")

# Also search for fetch_message_by_id (singular) anywhere
print("\n=== fetch_message_by_id calls ===")
cmd2 = f"""cd {CWD}/linkedin_group_crawler && grep -rn 'fetch_message_by_id\\|get_message_by_id\\|load_message_by' --include='*.py' app/"""
stdin, stdout, stderr = client.exec_command(cmd2, timeout=30)
stdout_bytes2 = stdout.read()
with open(r"D:\CrawlDataLinkedin\fetch_by_id.txt", "wb") as f:
    f.write(stdout_bytes2)
print(f"Read {len(stdout_bytes2)} bytes")

# Search for calls to fetch_messages_by_ids with message_id parameter
print("\n=== fetch_messages_by_ids calls ===")
cmd3 = f"""cd {CWD}/linkedin_group_crawler && grep -rn 'fetch_messages_by_ids\\|fetch_message_by_ids' --include='*.py' app/"""
stdin, stdout, stderr = client.exec_command(cmd3, timeout=30)
stdout_bytes3 = stdout.read()
with open(r"D:\CrawlDataLinkedin\fetch_by_ids_calls.txt", "wb") as f:
    f.write(stdout_bytes3)
print(f"Read {len(stdout_bytes3)} bytes")

# Check conversations.py around line 1074 for the message_id usage
print("\n=== conversations.py lines 1060-1090 ===")
cmd4 = f"sed -n '1060,1090p' {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/api/routes/conversations.py"
stdin, stdout, stderr = client.exec_command(cmd4, timeout=15)
stdout_bytes4 = stdout.read()
with open(r"D:\CrawlDataLinkedin\conv_1070.txt", "wb") as f:
    f.write(stdout_bytes4)
print(f"Read {len(stdout_bytes4)} bytes")

client.close()
