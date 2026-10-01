import paramiko

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Check openapi size and content
print("=== OpenAPI details ===")
cmd = 'wc -c /tmp/openapi.json && head -c 500 /tmp/openapi.json'
stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Try a simpler test
print("\n=== Test /api/all-platform/zalo/events/stream ===")
cmd = 'curl -s "http://localhost:8000/api/all-platform/zalo/events/stream?user_id=test&role=member" --max-time 3 -v 2>&1 | grep -E "HTTP|Content|error|not found" | head -10'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Check if there are any routes starting with /api/
print("\n=== Check openapi paths ===")
cmd = 'python3 -c "import json; d=json.load(open(\'/tmp/openapi.json\')); paths=list(d.get(\"paths\",{}).keys()); print(len(paths), \"paths\")"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Check the openapi size
print("\n=== File size ===")
cmd = 'ls -la /tmp/openapi.json'
stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

# Try hitting port 8001 (the old process) for openapi
print("\n=== Port 8001 openapi ===")
cmd = 'curl -s "http://localhost:8001/openapi.json" --max-time 5 > /tmp/openapi_old.json && python3 -c "import json; d=json.load(open(\'/tmp/openapi_old.json\')); paths=list(d.get(\"paths\",{}).keys()); print(len(paths), \"paths\"); [print(p) for p in paths if \'zalo\' in p.lower() or \'event\' in p.lower()]"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
out = stdout.read()
print(out.decode("utf-8", errors="replace"))

client.close()
