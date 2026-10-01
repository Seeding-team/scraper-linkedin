import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Get openapi directly
print("=== OpenAPI paths ===")
cmd = 'curl -s "http://localhost:8000/openapi.json" --max-time 5 2>&1 > /tmp/openapi.json'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print("Downloaded")

# Parse it
cmd2 = 'python3 -c "import json; d=json.load(open(\'/tmp/openapi.json\')); paths=list(d.get(\"paths\",{}).keys()); print(f\\"Total paths: {len(paths)}\\"); [print(p) for p in paths[:20]]"'
stdin, stdout, stderr = client.exec_command(cmd2, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Check for zalo
cmd3 = 'python3 -c "import json; d=json.load(open(\'/tmp/openapi.json\')); [print(p) for p in d.get(\"paths\",{}).keys() if \"zalo\" in p.lower() or \"event\" in p.lower() or \"listener\" in p.lower() or \"all-platform\" in p.lower()]"'
stdin, stdout, stderr = client.exec_command(cmd3, timeout=15)
out = stdout.read()
print("Zalo paths:", out.decode("utf-8", errors="replace"))

# Show all-platform router prefix
print("\n=== all_platform_router prefix ===")
cmd4 = "grep -n 'all_platform_router.*prefix\\|prefix.*=.*api\\|/api/all-platform' /opt/apps/seeding_markeeai/scraper-linkedin/linkedin_group_crawler/app/modules/all_platform/router.py | head -5"
stdin, stdout, stderr = client.exec_command(cmd4, timeout=10)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

client.close()
