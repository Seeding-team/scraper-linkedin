import paramiko
import base64

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
CWD = "/opt/apps/seeding_markeeai/scraper-linkedin"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# Read Python file from VM
print("=== Read Python from VM ===")
cmd = f"cat {CWD}/linkedin_group_crawler/app/modules/all_platform/zalo/services/zca_persistent_listener.py"
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
content = stdout.read().decode("utf-8", errors="replace")
print(f"Size: {len(content)} bytes")

# Get base64
b64 = base64.b64encode(content.encode("utf-8")).decode()
print(f"Base64 length: {len(b64)}")

# Send to local via paramiko exec
import math
chunk_size = 45000
num_chunks = math.ceil(len(b64) / chunk_size)
print(f"Splitting into {num_chunks} chunks")

for i in range(num_chunks):
    chunk = b64[i*chunk_size:(i+1)*chunk_size]
    part = f"/tmp/py_part_{i}.b64"
    # Write via echo (base64 data may have special chars)
    # Use Python decode on VM
    cmd = f'python3 -c "import base64; open(\'{part}\', \'w\').write(\'{chunk}\')"'
    stdin2, stdout2, stderr2 = client.exec_command(cmd, timeout=30)
    err2 = stderr2.read()
    if err2:
        print(f"  Chunk {i} error: {err2.decode()[:100]}")
    else:
        print(f"  Chunk {i}: OK")

# Concatenate and decode
print("\n=== Concatenate and decode ===")
part_files = " ".join([f"/tmp/py_part_{i}.b64" for i in range(num_chunks)])
concat_cmd = f"python3 -c \"import base64; data=''.join(open(f).read() for f in [{','.join(chr(39)+'/tmp/py_part_'+str(i)+'.b64'+chr(39) for i in range(num_chunks))}]); open('/tmp/zca_persistent_listener_py.py', 'wb').write(base64.b64decode(data))\""
cmd = concat_cmd
stdin2, stdout2, stderr2 = client.exec_command(cmd, timeout=30)
err2 = stderr2.read()
out2 = stdout2.read()
print(f"  stdout: {out2.decode()[:200]}")
if err2:
    print(f"  stderr: {err2.decode()[:200]}")

# Copy to local machine using SFTP
print("\n=== Download to local ===")
sftp = client.open_sftp()
sftp.get("/tmp/zca_persistent_listener_py.py", r"D:\CrawlDataLinkedin\linkedin_group_crawler\app\modules\all_platform\zalo\services\zca_persistent_listener.py")
print("Downloaded!")
sftp.close()

# Verify
LOCAL_FILE = r"D:\CrawlDataLinkedin\linkedin_group_crawler\app\modules\all_platform\zalo\services\zca_persistent_listener.py"
with open(LOCAL_FILE, "r", encoding="utf-8") as f:
    local = f.read()
print(f"\n=== Local Python file verification ===")
print(f"Size: {len(local)} bytes")
print(f"Has drain: {'YES' if 'Drain any remaining' in local else 'NO'}")
print(f"Has max crash: {'YES' if 'restart_attempt > 10' in local else 'NO'}")
print(f"Has [5, 15: {'YES' if '_RESTART_BACKOFFS = [5, 15' in local else 'NO'}")

client.close()
print("\nDone!")
