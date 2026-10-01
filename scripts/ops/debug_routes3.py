import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Check paths in openapi
print("=== Paths from openapi ===")
cmd = "python3 -c \"\nimport json\nwith open('/tmp/openapi.json') as f:\n    d = json.load(f)\npaths = d.get('paths', {})\nprint('Total paths:', len(paths))\nfor p in sorted(paths.keys())[:30]:\n    print(' ', p)\n\""
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Look for zalo paths specifically
print("\n=== Zalo paths ===")
cmd = "python3 -c \"\nimport json\nwith open('/tmp/openapi.json') as f:\n    d = json.load(f)\npaths = d.get('paths', {})\nfor p in sorted(paths.keys()):\n    if 'zalo' in p.lower() or 'event' in p.lower() or 'listener' in p.lower() or 'broadcast' in p.lower():\n        print(' ', p)\n\""
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Check the router file - is main.py importing the router correctly?
print("\n=== main.py router imports ===")
cmd = "grep -n 'include_router\\|all_platform_router' /opt/apps/seeding_markeeai/scraper-linkedin/linkedin_group_crawler/app/main.py"
stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Check if the events router has the right prefix
print("\n=== events router prefix ===")
cmd = "grep -n 'prefix\\|events_router\\|events' /opt/apps/seeding_markeeai/scraper-linkedin/linkedin_group_crawler/app/modules/all_platform/zalo/api/routes/events.py | head -10"
stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

client.close()
