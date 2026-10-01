import paramiko
import sys

HOST = "10.30.50.29"
USER = "vmadmin"
PASS = __import__("os").environ["SSH_PASS"]  # đặt biến môi trường SSH_PASS (mật khẩu ở docs/INFRASTRUCTURE.md local, không commit)
REPO_PATH = "/opt/apps/seeding_markeeai/scraper-linkedin"

# During merge: --ours = current branch (HEAD, what we want), --theirs = incoming branch
# Accept our (local/HEAD) version for all conflicted files
CMDS = [
    f"cd {REPO_PATH} && git checkout --ours linkedin_group_crawler/app/modules/all_platform/zalo/api/routes/accounts.py",
    f"cd {REPO_PATH} && git checkout --ours linkedin_group_crawler/scripts/zca_persistent_listener.js",
    f"cd {REPO_PATH} && git checkout --ours linkedin-crawler-ui/services/zaloCrawlerService.ts",
    f"cd {REPO_PATH} && git checkout --ours linkedin-crawler-ui/hooks/useZaloCrawlerFlow.ts",
    f"cd {REPO_PATH} && git add linkedin_group_crawler/app/modules/all_platform/zalo/api/routes/accounts.py linkedin_group_crawler/scripts/zca_persistent_listener.js linkedin-crawler-ui/services/zaloCrawlerService.ts linkedin-crawler-ui/hooks/useZaloCrawlerFlow.ts",
    f"cd {REPO_PATH} && git commit -m 'resolve: accept our version for RBAC and zca listener fixes'",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASS, timeout=30)
    for cmd in CMDS:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
        print(f"CMD: {cmd}")
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        if out.strip():
            print(out)
        if err.strip():
            print("STDERR:", err)
        ec = stdout.channel.recv_exit_status()
        print(f"Exit: {ec}\n")
        if ec != 0:
            print("FAILED!", file=sys.stderr)
            break
    else:
        print("=== MERGE RESOLVED ===")
finally:
    client.close()
