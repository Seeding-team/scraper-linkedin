"""Unit & integration tests for Zero-Account Public 4G Crawler."""

from __future__ import annotations

import asyncio
import json
import struct
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform import auth_deps
from app.modules.all_platform.mobile_proxy import client as mobile_proxy_client
from app.modules.all_platform.routers import extension_crawl, public_crawler
from app.modules.all_platform.services import (
    fb_story_parser,
    public_4g_crawler_service as svc,
    socks5_http_bridge as bridge_mod,
)

_VN_TZ = timezone(timedelta(hours=7))


def test_rewrite_proxy_url_for_docker_and_local(monkeypatch):
    monkeypatch.delenv("PUBLIC_CRAWL_KEEP_LOCALHOST_PROXY", raising=False)
    monkeypatch.setenv("DOCKER_CONTAINER", "0")
    monkeypatch.setattr(bridge_mod.os.path, "exists", lambda _p: False)
    assert (
        bridge_mod.rewrite_proxy_url_for_runtime("socks5://user:p%40ss@127.0.0.1:4101")
        == "socks5://user:p%40ss@127.0.0.1:4101"
    )

    monkeypatch.setenv("DOCKER_CONTAINER", "1")
    monkeypatch.setenv("PUBLIC_CRAWL_DOCKER_HOST", "host.docker.internal")
    assert (
        bridge_mod.rewrite_proxy_url_for_runtime("socks5://user:p%40ss@127.0.0.1:4101")
        == "socks5://user:p%40ss@host.docker.internal:4101"
    )
    # Non-loopback host stays intact
    assert (
        bridge_mod.rewrite_proxy_url_for_runtime("socks5://u:p@103.1.2.3:4101")
        == "socks5://u:p@103.1.2.3:4101"
    )


def test_socks5_http_bridge_rfc1929_auth_and_connect_tunnel():
    async def _run() -> None:
        observed: dict[str, Any] = {}

        async def _mock_socks5_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            try:
                ver, n_methods = struct.unpack("!BB", await reader.readexactly(2))
                methods = await reader.readexactly(n_methods)
                assert ver == 5
                assert 2 in methods
                writer.write(b"\x05\x02")
                await writer.drain()

                auth_ver, u_len = struct.unpack("!BB", await reader.readexactly(2))
                username = (await reader.readexactly(u_len)).decode("utf-8")
                p_len = (await reader.readexactly(1))[0]
                password = (await reader.readexactly(p_len)).decode("utf-8")
                assert auth_ver == 1
                observed["auth"] = (username, password)
                writer.write(b"\x01\x00" if (username, password) == ("simuser", "simpass") else b"\x01\x01")
                await writer.drain()

                r_ver, cmd, _rsv, atyp = struct.unpack("!BBBB", await reader.readexactly(4))
                assert (r_ver, cmd, atyp) == (5, 1, 3)
                d_len = (await reader.readexactly(1))[0]
                domain = (await reader.readexactly(d_len)).decode("utf-8")
                port = struct.unpack("!H", await reader.readexactly(2))[0]
                observed["target"] = f"{domain}:{port}"

                writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
                await writer.drain()

                data = await reader.read(1024)
                writer.write(b"ECHO:" + data)
                await writer.drain()
            finally:
                writer.close()

        mock_server = await asyncio.start_server(_mock_socks5_client, "127.0.0.1", 0)
        socks_port = mock_server.sockets[0].getsockname()[1]

        async with bridge_mod.Socks5HttpBridge(f"socks5://simuser:simpass@127.0.0.1:{socks_port}") as http_url:
            host_port = http_url.replace("http://", "")
            b_host, b_port_s = host_port.split(":")
            c_reader, c_writer = await asyncio.open_connection(b_host, int(b_port_s))
            c_writer.write(b"CONNECT m.facebook.com:443 HTTP/1.1\r\nHost: m.facebook.com:443\r\n\r\n")
            await c_writer.drain()
            head = await c_reader.readuntil(b"\r\n\r\n")
            assert b"200 Connection Established" in head

            c_writer.write(b"HELLO_4G")
            await c_writer.drain()
            if c_writer.can_write_eof():
                c_writer.write_eof()
            echoed = await c_reader.read(1024)
            assert echoed == b"ECHO:HELLO_4G"
            c_writer.close()

        mock_server.close()
        await mock_server.wait_closed()
        assert observed["auth"] == ("simuser", "simpass")
        assert observed["target"] == "m.facebook.com:443"

    asyncio.run(_run())


def test_fb_story_parser_ssr_graphql_and_state_classification():
    now_ts = int(datetime.now(timezone.utc).timestamp())
    ssr_payload = {
        "require": [
            [
                "RelayPrefetchedStreamCache",
                "next",
                [
                    {
                        "group_feed": {
                            "edges": [
                                {
                                    "node": {
                                        "__typename": "Story",
                                        "post_id": "9988776655",
                                        "creation_time": now_ts - 120,
                                        "url": "https://www.facebook.com/groups/12345/posts/9988776655/?__cft__=abc",
                                        "actors": [{"name": "Nguyen Van A", "url": "https://www.facebook.com/nguyenvana"}],
                                        "message": {"text": "Can tim don vi thiet ke web ban hang"},
                                        "reaction_count": {"count": 7},
                                        "total_comment_count": 3,
                                        "share_count": {"count": 1},
                                        "attachments": [
                                            {"media": {"photo_image": {"uri": "https://scontent.xx.fbcdn.net/pic1.jpg"}}}
                                        ],
                                        "interesting_top_level_comments": [
                                            {
                                                "__typename": "Story",
                                                "post_id": "11111111",
                                                "creation_time": now_ts - 60,
                                                "message": {"text": "Comment story must not leak"},
                                            }
                                        ],
                                    }
                                },
                                {
                                    "node": {
                                        "__typename": "Story",
                                        "post_id": "4455667788",
                                        "creation_time": now_ts - 86400 * 30,
                                        "is_pinned_post": True,
                                        "message": {"text": "Noi quy nhom (bai ghim)"},
                                    }
                                },
                            ]
                        }
                    }
                ],
            ]
        ]
    }
    html = f'<html><body><script type="application/json">{json.dumps(ssr_payload)}</script></body></html>'
    seen: set[str] = set()
    posts = fb_story_parser.parse_fb_html_embedded_stories(
        html, group_url="https://www.facebook.com/groups/12345", seen_ids=seen
    )
    assert len(posts) == 2
    assert posts[0]["post_id"] == "9988776655"
    assert posts[0]["author_name"] == "Nguyen Van A"
    assert posts[0]["reactions"] == 7
    assert posts[0]["comments"] == 3
    assert posts[0]["images"] == ["https://scontent.xx.fbcdn.net/pic1.jpg"]
    assert all(p["post_id"] != "11111111" for p in posts)
    assert posts[1]["is_pinned"] is True

    # GraphQL stream dedupes already seen story and parses new story
    gql_raw = "for (;;);\n" + json.dumps(
        {
            "data": {
                "node": {
                    "__typename": "Story",
                    "post_id": "2233445566",
                    "creation_time": now_ts - 30,
                    "message": {"text": "Bai tu stream GraphQL"},
                }
            }
        }
    )
    more = fb_story_parser.parse_fb_graphql_text(
        gql_raw, group_id="12345", group_url="https://www.facebook.com/groups/12345", seen_ids=seen
    )
    assert len(more) == 1
    assert more[0]["post_id"] == "2233445566"

    assert (
        fb_story_parser.normalize_group_crawl_url("https://www.facebook.com/groups/abc")
        == "https://www.facebook.com/groups/abc/?sorting_setting=CHRONOLOGICAL"
    )
    assert fb_story_parser.classify_guest_page_state("https://www.facebook.com/groups/a", "", 0, 429) == "rate_limit"
    assert (
        fb_story_parser.classify_guest_page_state(
            "https://www.facebook.com/groups/a", "Đây là Nhóm riêng tư. Tham gia nhóm để xem bài viết.", 0, 200
        )
        == "private_group"
    )
    assert (
        fb_story_parser.classify_guest_page_state(
            "https://www.facebook.com/login/?next=...", "Bạn phải đăng nhập để tiếp tục", 0, 200
        )
        == "login_wall"
    )
    assert (
        fb_story_parser.classify_guest_page_state(
            "https://www.facebook.com/groups/a", "Public group content", 2, 200
        )
        == "ok"
    )


def test_watermark_early_stop_ignores_pinned_and_stops_on_known_or_old():
    now_vn = datetime.now(_VN_TZ)
    today_str = now_vn.strftime("%Y-%m-%d")
    now_ts = int(now_vn.timestamp())
    yesterday_ts = int((now_vn - timedelta(days=2)).timestamp())

    posts = [
        {"post_id": "pin1", "post_url": "https://www.facebook.com/groups/g/posts/pin1/", "creation_time": yesterday_ts, "is_pinned": True},
        {"post_id": "new1", "post_url": "https://www.facebook.com/groups/g/posts/new1/", "creation_time": now_ts - 60, "is_pinned": False},
        {"post_id": "old_db1", "post_url": "https://www.facebook.com/groups/g/posts/old_db1/", "creation_time": now_ts - 120, "is_pinned": False},
        {"post_id": "old_db2", "post_url": "https://www.facebook.com/groups/g/posts/old_db2/", "creation_time": now_ts - 180, "is_pinned": False},
    ]
    stop, reason = svc.evaluate_watermark_early_stop(
        posts,
        known_urls=set(),
        known_post_ids={"old_db1", "old_db2"},
        today_vn_str=today_str,
        max_posts=25,
    )
    assert stop is True
    assert reason == "known_watermark"

    # Only fresh today posts (plus pinned announcement) -> should NOT early-stop yet
    stop2, _ = svc.evaluate_watermark_early_stop(
        posts[:2],
        known_urls=set(),
        known_post_ids=set(),
        today_vn_str=today_str,
        max_posts=25,
    )
    assert stop2 is False


def test_worker_reactive_rotate_proactive_rotate_and_private_isolation(monkeypatch):
    monkeypatch.setenv("PUBLIC_CRAWL_ROTATE_SETTLE_SEC", "0")
    monkeypatch.setenv("MOBILE_PROXY_NODES", "sim-01")
    monkeypatch.setenv("MOBILE_PROXY_CONSOLE_URL", "http://10.0.0.2:8080")
    monkeypatch.setenv("MOBILE_PROXY_SOCKS_URL_VPS", "socks5://u:p@10.0.0.2:4101")
    monkeypatch.setenv("MOBILE_PROXY_SIM_01_CONSOLE_URL", "http://10.0.0.2:8080")
    monkeypatch.setenv("MOBILE_PROXY_SIM_01_SOCKS_URL_VPS", "socks5://u:p@10.0.0.2:4101")
    monkeypatch.setenv("MOBILE_PROXY_CONSOLE_API_KEY", "test-key")

    rotate_calls: list[str] = []
    meta_updates: list[dict[str, Any]] = []
    saved_batches: list[int] = []

    async def fake_console(method: str, path: str, base_url: str, api_key: str | None = None, timeout: float = 90.0):
        rotate_calls.append(f"{method} {path} {base_url}")
        return {"ok": True, "egressIp": f"171.244.1.{len(rotate_calls) + 10}"}

    async def fake_probe(proxy_url: str, timeout: float = 8.0):
        return {"ok": True, "egressIp": "171.244.1.99", "latencyMs": 42}

    async def fake_ingest(req, **_kwargs):
        saved_batches.append(len(req.posts))
        return {"success": True, "count": len(req.posts), "post_urls": [p.post_url for p in req.posts]}

    monkeypatch.setattr(svc, "get_group_post_watermarks", lambda **_kw: {"urls": set(), "post_ids": set()})
    monkeypatch.setattr(svc, "ingest_facebook_posts", fake_ingest)
    monkeypatch.setattr(svc, "_update_group_crawl_meta_sync", lambda **kw: meta_updates.append(kw))

    now_iso = datetime.now(timezone.utc).isoformat()
    sample_post = {
        "post_id": "777001",
        "post_url": "https://www.facebook.com/groups/g1/posts/777001/",
        "author_name": "Tester",
        "author_url": "https://www.facebook.com/tester",
        "creation_time": int(datetime.now(timezone.utc).timestamp()),
        "timestamp_raw": now_iso,
        "content": "Can thue team SEO website",
        "reactions": 5,
        "comments": 2,
        "shares": 0,
        "images": [],
        "video_url": None,
        "is_pinned": False,
        "crawled_at": now_iso,
    }

    async def fake_fetcher(_sim, group, _watermarks, attempt: int):
        gid = group["id"]
        if gid == "g-wall":
            if attempt == 0:
                return {"state": "login_wall", "posts": []}
            return {"state": "ok", "posts": [sample_post], "early_stop_reason": ""}
        if gid == "g-priv":
            return {"state": "private_group", "posts": []}
        return {"state": "ok", "posts": [sample_post], "early_stop_reason": ""}

    async def _run() -> None:
        rotator = svc.MobileProxyRotator(console_fn=fake_console, probe_fn=fake_probe)
        sims = rotator.sync_nodes()
        assert len(sims) == 1
        sim = sims[0]
        logs: list[tuple[str, str, str]] = []
        bumps: list[dict[str, int]] = []

        async with svc.GuestPublicGroupWorker(
            sim=sim,
            rotator=rotator,
            config={
                "groups_per_ip_rotate": 2,
                "max_posts_per_group": 25,
                "max_scrolls_per_group": 2,
                "auto_skip_private": True,
                "headless": True,
            },
            log_cb=lambda lvl, sid, msg: logs.append((lvl, sid, msg)),
            stop_check=lambda: False,
            progress_cb=lambda d: bumps.append(d),
            attempt_fetcher=fake_fetcher,
        ) as worker:
            # 1. Login wall triggers reactive rotate & succeeds on retry
            res1 = await worker.process_group({"id": "g-wall", "group_name": "Wall Group", "group_url": "https://www.facebook.com/groups/gwall"})
            assert res1["status"] == "rotated_retry"
            assert res1["posts_saved"] == 1
            assert len(rotate_calls) == 1  # reactive rotate fired
            assert sim.groups_in_epoch == 1

            # 2. Private group marks visibility='private' and does NOT consume proactive rotate needlessly
            res2 = await worker.process_group({"id": "g-priv", "group_name": "Priv Group", "group_url": "https://www.facebook.com/groups/gpriv"})
            assert res2["status"] == "private_skipped"
            assert any(m["group_id"] == "g-priv" and m["mark_private"] is True for m in meta_updates)
            assert len(rotate_calls) == 1

            # 3. Second public group reaches groups_per_ip_rotate=2 -> proactive rotate triggers!
            res3 = await worker.process_group({"id": "g-ok2", "group_name": "OK Group 2", "group_url": "https://www.facebook.com/groups/gok2"})
            assert res3["status"] == "ok"
            assert len(rotate_calls) == 2
            assert sim.groups_in_epoch == 0

    asyncio.run(_run())
    assert sum(saved_batches) == 2


def test_public_crawler_router_rbac_and_extension_compat(monkeypatch):
    app = FastAPI()
    app.include_router(public_crawler.router, prefix="/api/all-platform/public-crawler")
    app.include_router(extension_crawl.router, prefix="/api/all-platform/extension")

    monkeypatch.setattr(svc.public_crawl_orchestrator, "get_config_sync", lambda: dict(svc.DEFAULT_PUBLIC_CRAWL_CONFIG))
    monkeypatch.setattr(svc.public_crawl_orchestrator, "update_config_sync", lambda patch, updated_by=None: {**svc.DEFAULT_PUBLIC_CRAWL_CONFIG, **patch})
    monkeypatch.setattr(svc.public_crawl_orchestrator, "get_recent_runs_sync", lambda limit=12: [])
    monkeypatch.setattr(svc.public_crawl_orchestrator, "list_groups_sync", lambda **_kw: [{"id": "g1", "group_name": "Public G", "visibility": "public"}])

    async def fake_start_run(**kw):
        return {
            "started": True,
            "run_id": "run-123",
            "total_groups": kw.get("limit_groups") or 1,
            "sim_nodes": ["sim-01"],
        }

    async def fake_test_proxy(**_kw):
        return {"ok": True, "results": [{"id": "sim-01", "socksOk": True, "consoleOk": True, "egressIpBefore": "1.2.3.4"}]}

    monkeypatch.setattr(svc.public_crawl_orchestrator, "start_run", fake_start_run)
    monkeypatch.setattr(svc.public_crawl_orchestrator.rotator, "test_proxy", fake_test_proxy)

    client = TestClient(app)

    # 1. Unauthenticated -> 401
    assert client.get("/api/all-platform/public-crawler/status").status_code == 401
    assert client.post("/api/all-platform/public-crawler/run", json={}).status_code == 401

    # 2. Member role -> can read status/groups, 403 on write/run/config/proxy-test
    active_user = {"id": "u-mem", "role": "member"}
    app.dependency_overrides[auth_deps.get_current_user] = lambda: active_user
    monkeypatch.setattr(auth_deps, "get_current_user", lambda _req, _auth=None: active_user)
    try:
        assert client.get("/api/all-platform/public-crawler/status").status_code == 200
        assert client.get("/api/all-platform/public-crawler/groups").status_code == 200
        assert client.post("/api/all-platform/public-crawler/run", json={}).status_code == 403
        assert client.put("/api/all-platform/public-crawler/config", json={"groups_per_ip_rotate": 4}).status_code == 403
        assert client.post("/api/all-platform/public-crawler/proxy/test", json={}).status_code == 403

        # 3. Leader / Admin -> full control (200)
        active_user["id"] = "u-lead"
        active_user["role"] = "leader"
        assert client.put("/api/all-platform/public-crawler/config", json={"groups_per_ip_rotate": 4}).json()["config"]["groups_per_ip_rotate"] == 4
        assert client.post("/api/all-platform/public-crawler/run", json={"limit_groups": 3}).json()["total_groups"] == 3
        assert client.post("/api/all-platform/public-crawler/proxy/test", json={"do_rotate": False}).json()["ok"] is True
    finally:
        app.dependency_overrides.clear()

    # 4. Extension backward compatibility check
    async def fake_ext_save(payload, event_name, legacy=False):
        return {"success": True, "count": len(payload.posts), "post_urls": [p.post_url for p in payload.posts]}

    monkeypatch.setattr(extension_crawl, "process_and_save_posts", fake_ext_save)
    assert client.post("/api/all-platform/extension/save-posts", json={"posts": []}).status_code == 403
    ok_res = client.post(
        "/api/all-platform/extension/save-posts",
        headers={"x-api-key": "markee-extension-key-2024"},
        json={"posts": [{"post_url": "https://www.facebook.com/groups/1/posts/2/"}]},
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["count"] == 1


def test_mobile_proxy_rotator_docker_loopback_retry_and_limit_groups(monkeypatch):
    monkeypatch.setenv("PUBLIC_CRAWL_ROTATE_SETTLE_SEC", "0")
    monkeypatch.setenv("MOBILE_PROXY_NODES", "sim-01")
    monkeypatch.setenv("MOBILE_PROXY_CONSOLE_URL", "http://127.0.0.1:4320")
    monkeypatch.setenv("MOBILE_PROXY_SOCKS_URL_VPS", "socks5://u:p@127.0.0.1:41081")
    monkeypatch.delenv("MOBILE_PROXY_SIM_01_CONSOLE_URL", raising=False)
    monkeypatch.delenv("MOBILE_PROXY_SIM_01_SOCKS_URL_VPS", raising=False)

    monkeypatch.setattr(bridge_mod, "_is_running_in_docker", lambda: True)
    seen_urls: list[str] = []

    # Verify console_request itself rewrites 127.0.0.1 -> host.docker.internal inside Docker
    captured_http_urls: list[str] = []

    class _DummyResp:
        status_code = 200
        content = b'{"ok": true}'

        @staticmethod
        def json():
            return {"ok": True}

    class _DummyAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def request(self, _method: str, url: str, headers=None):
            captured_http_urls.append(url)
            return _DummyResp()

    monkeypatch.setattr(mobile_proxy_client.httpx, "AsyncClient", _DummyAsyncClient)
    asyncio.run(mobile_proxy_client.console_request("POST", "/api/rotate", "http://127.0.0.1:4320"))
    assert captured_http_urls == ["http://host.docker.internal:4320/api/rotate"]
    rotate_attempt = 0

    async def fake_console(method: str, path: str, base_url: str, api_key: str | None = None, timeout: float = 90.0):
        nonlocal rotate_attempt
        seen_urls.append(base_url)
        if path == "/api/status":
            return {"ok": True, "directMobileIp": "14.160.1.10"}
        if path == "/api/rotate":
            rotate_attempt += 1
            if rotate_attempt == 1:
                return {"ok": False, "error": "ADB transient reconnect"}
            return {"ok": True, "directMobileIp": "14.231.9.88"}
        return {"ok": True}

    probe_ips = ["14.160.1.10", "14.231.9.88"]

    async def fake_probe(proxy_url: str, timeout: float = 8.0):
        ip = probe_ips.pop(0) if probe_ips else "14.231.9.88"
        return {"ok": True, "egressIp": ip, "latencyMs": 35}

    rotator = svc.MobileProxyRotator(console_fn=fake_console, probe_fn=fake_probe)
    sims = rotator.sync_nodes()
    assert sims[0].console_url == "http://host.docker.internal:4320"
    assert sims[0].socks_url == "socks5://u:p@host.docker.internal:41081"

    test_res = asyncio.run(rotator.test_proxy(do_rotate=True))
    assert test_res["ok"] is True
    assert rotate_attempt == 2  # auto-retried after ok=false
    node_res = test_res["results"][0]
    assert node_res["rotated"] is True
    assert node_res["egressIpBefore"] == "14.160.1.10"
    assert node_res["egressIpAfter"] == "14.231.9.88"
    assert node_res["ipChanged"] is True
    assert all(u == "http://host.docker.internal:4320" for u in seen_urls)

    # Verify start_run limit_groups=3 picks oldest 3 public groups deterministically
    orch = svc.PublicCrawlOrchestrator()
    captured: list[str] = []

    monkeypatch.setattr(orch, "get_config_sync", lambda: dict(svc.DEFAULT_PUBLIC_CRAWL_CONFIG))
    monkeypatch.setattr(
        orch,
        "_select_due_groups_sync",
        lambda **_kw: [
            {"id": "g1", "group_url": "https://www.facebook.com/groups/1"},
            {"id": "g2", "group_url": "https://www.facebook.com/groups/2"},
            {"id": "g3", "group_url": "https://www.facebook.com/groups/3"},
            {"id": "g4", "group_url": "https://www.facebook.com/groups/4"},
        ],
    )
    monkeypatch.setattr(orch, "_create_run_record_sync", lambda **_kw: "run-quick-3")
    monkeypatch.setattr(orch, "_finish_run_record_sync", lambda **_kw: None)
    monkeypatch.setattr(orch.rotator, "sync_nodes", lambda: [svc.SimNodeRuntime(id="sim-01", label="SIM 1", socks_url="socks5://u:p@host.docker.internal:41081", console_url="http://host.docker.internal:4320")])

    async def fake_execute(*, groups, **_kw):
        captured.extend(g["id"] for g in groups)
        orch.is_running = False

    monkeypatch.setattr(orch, "_execute_run_task", fake_execute)

    async def _run_quick() -> dict[str, Any]:
        res = await orch.start_run(limit_groups=3)
        await asyncio.sleep(0)
        return res

    res = asyncio.run(_run_quick())
    assert res["started"] is True
    assert res["total_groups"] == 3
    assert captured == ["g1", "g2", "g3"]

    # Unconfigured env must NOT yield a phantom unconfigured sim-01 node
    for env_key in list(
        (
            "MOBILE_PROXY_NODES",
            "MOBILE_PROXY_CONSOLE_URL",
            "MOBILE_PROXY_SOCKS_URL_VPS",
            "MOBILE_PROXY_SOCKS_URL_OFFICE",
            "MOBILE_PROXY_SOCKS_URL_LOCAL_PC",
            "MOBILE_PROXY_VPS_HOST",
            "MOBILE_PROXY_OFFICE_HOST",
            "MOBILE_PROXY_SOCKS_PORT",
        )
    ):
        monkeypatch.delenv(env_key, raising=False)
    assert rotator.sync_nodes() == []
