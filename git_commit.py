import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Git commit
print("=== Git commit ===")
cmd = f"cd {CWD} && git add -A && git commit -m 'fix: UUID validation for zalo message IDs in fetch_messages_by_ids\n\nUse strict UUID format regex instead of uuid.UUID() which incorrectly\naccepts numeric strings like 7954496956010 as valid UUIDs. Numeric IDs\nand short strings are now correctly routed to source_message_id queries.'"
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print(out)
if err:
    print("STDERR:", err[:500])

# Verify commit
print("\n=== Git log ===")
stdin, stdout, stderr = client.exec_command(f"cd {CWD} && git log -1 --oneline", timeout=10)
print(stdout.read().decode("utf-8", errors="replace").strip())

client.close()
