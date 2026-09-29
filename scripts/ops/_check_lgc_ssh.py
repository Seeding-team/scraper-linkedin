import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    return stdout.read().decode("utf-8", errors="replace"), stderr.read().decode("utf-8", errors="replace")

print("=== Backend LGC detailed check ===")

# Check all uvicorn processes with full command
out, err = run("ps aux | grep uvicorn | grep -v grep")
print(f"All uvicorn: {out}")

# Check the port 8808 openapi (the root one)
out, err = run("curl -s http://localhost:8808/openapi.json 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); paths=[p for p in d.get('paths',{}).keys()]; print('\\n'.join(sorted(paths)))\" 2>/dev/null || echo 'port 8808 not reachable'")
print(f"\nPort 8808 OpenAPI paths: {out[:3000]}")

# Check port 8000
out, err = run("curl -s http://localhost:8000/openapi.json 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); paths=[p for p in d.get('paths',{}).keys()]; print('\\n'.join(sorted(paths)))\" 2>/dev/null || echo 'port 8000 not reachable'")
print(f"\nPort 8000 OpenAPI paths: {out[:3000]}")

# Check docker containers
out, err = run("docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null")
print(f"\nDocker containers: {out}")

# Check if the seeding-backend container has the new router (try different container names)
container_names = ["seeding-backend", "linkedin-crawler", "crawl_fb", "backend"]
for cname in container_names:
    out, err = run(f"docker exec {cname} python3 -c \"from app.main import app; paths=[r.path for r in app.routes]; print('\\n'.join(sorted(set(paths))))\" 2>/dev/null || echo 'NOCONTAINER'")
    if "NOCONTAINER" not in out:
        print(f"\nContainer {cname} routes: {out[:2000]}")
        break
    else:
        print(f"\nContainer {cname}: not found or exec failed")

# Also check docker logs for seeding-backend
out, err = run("docker logs seeding-backend --tail 20 2>&1 | tail -30")
print(f"\nDocker logs seeding-backend: {out[-1000:]}")

# Check seeding-backend openapi via docker exec curl
out, err = run("docker exec seeding-backend curl -s http://localhost:8000/openapi.json 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); paths=[p for p in d.get('paths',{}).keys()]; print('\\n'.join(sorted(paths)))\" 2>/dev/null || echo 'seeding-backend openapi failed'")
print(f"\nSeeding-backend container openapi: {out[:3000]}")

client.close()
