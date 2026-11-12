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
    monkeypatch.setenv("PUBLIC_CRAWL_ROTATE_WAIT_SEC", "5")
    monkeypatch.setenv("PUBLIC_CRAWL_PROXIES", "203.0.113.10:1080:simuser:secretpass")

    meta_updates: list[dict[str, Any]] = []
    saved_batches: list[int] = []
    probe_seq = ["14.251.210.10", "14.251.210.10", "171.246.187.203", "42.117.16.99"]

    async def fake_probe(proxy_url: str, timeout: float = 12.0):
        ip = probe_seq.pop(0) if probe_seq else "42.117.16.99"
        return {"ok": True, "egressIp": ip, "latencyMs": 42}

    async def fake_fb_probe(proxy_url: str, timeout: float = 12.0):
        return {"fbOk": True, "fbStatus": 200, "fbLatencyMs": 120}

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
        pool = svc.RotatingProxyPool(probe_fn=fake_probe, fb_probe_fn=fake_fb_probe)
        sims = pool.sync_nodes()
        assert len(sims) == 1
        sim = sims[0]
        assert sim.id == "proxy-01"
        assert sim.console_url is None  # Strictly decoupled from Mobile Phone Bridge
        assert sim.socks_url == "socks5://simuser:secretpass@203.0.113.10:1080"
        pub = sim.to_public_dict()
        assert "secretpass" not in json.dumps(pub)
        sim.last_egress_ip = "14.251.210.10"

        # Verify wait_for_ip_rotation polls quickly in unit test
        orig_wait = pool.wait_for_ip_rotation

        async def fast_wait(node_id, **kw):
            kw.setdefault("poll_interval", 0.01)
            return await orig_wait(node_id, **kw)

        pool.wait_for_ip_rotation = fast_wait  # type: ignore[method-assign]

        logs: list[tuple[str, str, str]] = []
        bumps: list[dict[str, int]] = []

        async with svc.GuestPublicGroupWorker(
            sim=sim,
            rotator=pool,
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
            # 1. Login wall triggers wait_for_ip_rotation -> IP changes 14.251.210.10 -> 171.246.187.203
            res1 = await worker.process_group({"id": "g-wall", "group_name": "Wall Group", "group_url": "https://www.facebook.com/groups/gwall"})
            assert res1["status"] == "rotated_retry"
            assert res1["posts_saved"] == 1
            assert sim.last_egress_ip == "171.246.187.203"
            assert sim.groups_in_epoch == 1

            # 2. Private group marks visibility='private' and skips extra checks
            res2 = await worker.process_group({"id": "g-priv", "group_name": "Priv Group", "group_url": "https://www.facebook.com/groups/gpriv"})
            assert res2["status"] == "private_skipped"
            assert any(m["group_id"] == "g-priv" and m["mark_private"] is True for m in meta_updates)

            # 3. Second public group reaches groups_per_ip_rotate=2 -> passive probe records rollover to 42.117.16.99
            res3 = await worker.process_group({"id": "g-ok2", "group_name": "OK Group 2", "group_url": "https://www.facebook.com/groups/gok2"})
            assert res3["status"] == "ok"
            assert sim.last_egress_ip == "42.117.16.99"
            assert sim.groups_in_epoch == 0
            assert sum(b.get("ip_rotations", 0) for b in bumps) >= 2

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


def test_rotating_proxy_pool_formats_masking_fast_ssr_and_limit_groups(monkeypatch):
    # 1. Verify host:port:user:pass parsing & masking
    assert (
        bridge_mod.parse_proxy_entry("203.0.113.10:1080:myuser:mysecret!")
        == "socks5://myuser:mysecret%21@203.0.113.10:1080"
    )
    assert bridge_mod.parse_proxy_entry("http://u:p@1.2.3.4:8080") == "http://u:p@1.2.3.4:8080"
    masked = bridge_mod.mask_proxy_url("203.0.113.10:1080:proxyuser01:supersecret")
    assert "supersecret" not in masked
    assert "203.0.113.10:1080" in masked

    # 2. Ensure Public Crawler module has ZERO mobile_proxy phone bridge imports
    import inspect
    src = inspect.getsource(svc)
    assert "mobile_proxy" not in src

    monkeypatch.setenv("PUBLIC_CRAWL_ROTATE_WAIT_SEC", "5")
    monkeypatch.setattr(bridge_mod, "_is_running_in_docker", lambda: True)

    probe_ips = ["14.160.1.10", "14.160.1.10", "14.231.9.88"]

    async def fake_probe(proxy_url: str, timeout: float = 12.0):
        ip = probe_ips.pop(0) if probe_ips else "14.231.9.88"
        return {"ok": True, "egressIp": ip, "latencyMs": 35}

    async def fake_fb_probe(proxy_url: str, timeout: float = 12.0):
        return {"fbOk": True, "fbStatus": 200, "fbLatencyMs": 850}

    pool = svc.RotatingProxyPool(probe_fn=fake_probe, fb_probe_fn=fake_fb_probe)
    sims = pool.sync_nodes(["127.0.0.1:41081:u:p"])
    assert sims[0].console_url is None
    assert sims[0].socks_url == "socks5://u:p@host.docker.internal:41081"

    orig_wait = pool.wait_for_ip_rotation

    async def fast_wait(node_id, **kw):
        kw.setdefault("poll_interval", 0.01)
        return await orig_wait(node_id, **kw)

    pool.wait_for_ip_rotation = fast_wait  # type: ignore[method-assign]

    test_res = asyncio.run(pool.test_proxy(do_rotate=True, proxy_urls=["127.0.0.1:41081:u:p"]))
    assert test_res["ok"] is True
    node_res = test_res["results"][0]
    assert node_res["socksOk"] is True
    assert node_res["fbOk"] is True
    assert node_res["fbStatus"] == 200
    assert node_res["rotated"] is True
    assert node_res["egressIpBefore"] == "14.160.1.10"
    assert node_res["egressIpAfter"] == "14.231.9.88"
    assert node_res["ipChanged"] is True

    # 3. Verify HTTPX SSR Fast-Path catches 302 /login in 1 request & short-circuits 200 OK without scroll
    class _MockResp:
        def __init__(self, status_code: int, text: str = "", headers: dict[str, str] | None = None):
            self.status_code = status_code
            self.text = text
            self.headers = headers or {}

    mock_responses: list[_MockResp] = []

    class _MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url: str):
            return mock_responses.pop(0)

    monkeypatch.setattr(svc.httpx, "AsyncClient", _MockAsyncClient)
    worker_fast = svc.GuestPublicGroupWorker(
        sim=sims[0],
        rotator=pool,
        config={"max_posts_per_group": 25, "max_scrolls_per_group": 0},
        log_cb=lambda *_: None,
        stop_check=lambda: False,
        progress_cb=lambda *_: None,
    )
    mock_responses.append(_MockResp(302, headers={"location": "https://www.facebook.com/login/?next=abc"}))
    r_wall = asyncio.run(
        worker_fast._fetch_group_ssr_fast(
            "https://www.facebook.com/groups/g1",
            "https://www.facebook.com/groups/g1/?sorting_setting=CHRONOLOGICAL",
            known_urls=set(),
            known_ids=set(),
            max_posts=25,
            max_scrolls=0,
        )
    )
    assert r_wall["state"] == "login_wall"
    assert r_wall["need_playwright"] is False

    now_ts = int(datetime.now(timezone.utc).timestamp())
    ssr_html = '<script type="application/json">' + json.dumps(
        {
            "node": {
                "__typename": "Story",
                "post_id": "5566778899",
                "creation_time": now_ts - 45,
                "message": {"text": "Can tim don vi chay quang cao Web"},
            }
        }
    ) + "</script>"
    mock_responses.append(_MockResp(200, text=ssr_html))
    r_ok = asyncio.run(
        worker_fast._fetch_group_ssr_fast(
            "https://www.facebook.com/groups/g1",
            "https://www.facebook.com/groups/g1/?sorting_setting=CHRONOLOGICAL",
            known_urls=set(),
            known_ids=set(),
            max_posts=25,
            max_scrolls=0,
        )
    )
    assert r_ok["state"] == "ok"
    assert len(r_ok["posts"]) == 1
    assert r_ok["need_playwright"] is False

    # 4. Verify start_run limit_groups=3 picks oldest 3 public groups deterministically
    orch = svc.PublicCrawlOrchestrator()
    captured: list[str] = []
    cfg_with_proxy = {**svc.DEFAULT_PUBLIC_CRAWL_CONFIG, "proxy_urls": ["203.0.113.10:1080:u:pass99"]}
    masked_cfg = orch.mask_config_for_api(cfg_with_proxy)
    assert "pass99" not in json.dumps(masked_cfg)
    assert masked_cfg["proxies_configured"] == 1

    monkeypatch.setattr(orch, "get_config_sync", lambda: dict(cfg_with_proxy))
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

    # Unconfigured DB + env must yield empty list (no phantom node)
    monkeypatch.delenv("PUBLIC_CRAWL_PROXIES", raising=False)
    assert pool.sync_nodes([]) == []


def test_httpx_graphql_cursor_pagination_collects_22_posts_with_reconnect_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify SSR metadata extraction + HTTPX GraphQL cursor chain yielding 20+ posts + transport retry."""
    from datetime import datetime, timezone
    from app.modules.all_platform.services import fb_story_parser as parser
    from app.modules.all_platform.services import public_4g_crawler_service as svc

    now_ts = int(datetime.now(timezone.utc).timestamp())
    ssr_html = (
        '<script>"LSD",[],{"token":"TEST_LSD_TOKEN_123"},"server_revision":1054229999,'
        '"hsi":"70001","haste_session":"19999.HYP","__spin_r":1054229999,"__spin_b":"trunk","__spin_t":1700000000</script>'
        '<script type="application/json">'
        + json.dumps(
            {
                "node": {
                    "__typename": "Story",
                    "post_id": "1000000",
                    "creation_time": now_ts - 30,
                    "message": {"text": "Post SSR 00"},
                }
            }
        )
        + "</script>"
        '<script type="application/json">'
        + json.dumps(
            {
                "group_feed": {
                    "page_info": {
                        "end_cursor": "Cg8T_CURSOR_PAGE_01_ABCDEF",
                        "has_next_page": True,
                    }
                }
            }
        )
        + "</script>"
    )

    meta = parser.extract_ssr_feed_metadata(ssr_html, group_url="https://www.facebook.com/groups/9988776655/")
    assert meta["group_id"] == "9988776655"
    assert meta["lsd"] == "TEST_LSD_TOKEN_123"
    assert meta["end_cursor"] == "Cg8T_CURSOR_PAGE_01_ABCDEF"
    assert meta["has_next_page"] is True

    class _MockResp:
        def __init__(self, status_code: int, text: str = "", headers: dict[str, str] | None = None):
            self.status_code = status_code
            self.text = text
            self.headers = headers or {}

    def _make_gql_page(page_idx: int, has_next: bool) -> str:
        stories = [
            {
                "data": {
                    "node": {
                        "__typename": "Story",
                        "post_id": f"{page_idx}{slot}",
                        "creation_time": now_ts - (page_idx * 100 + slot * 10),
                        "message": {"text": f"GQL post page {page_idx} slot {slot}"},
                    }
                }
            }
            for slot in range(1, 4)
        ]
        page_info = {
            "data": {
                "page_info": {
                    "end_cursor": f"Cg8T_CURSOR_PAGE_{page_idx + 1:02d}_XYZ",
                    "has_next_page": has_next,
                }
            }
        }
        return "for (;;);\n" + "\n".join(json.dumps(chunk) for chunk in [*stories, page_info])

    post_call_count = 0

    class _MockGqlClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url: str):
            return _MockResp(200, text=ssr_html)

        async def post(self, url: str, data: str = "", headers: dict[str, str] | None = None):
            nonlocal post_call_count
            post_call_count += 1
            # Simulate transient 60s proxy rotation disconnect on first GraphQL POST attempt
            if post_call_count == 1:
                raise svc.httpx.RemoteProtocolError("Server disconnected without sending a response.")
            page_num = post_call_count - 1
            if page_num == 1:
                assert headers and headers.get("X-FB-LSD") == "TEST_LSD_TOKEN_123"
            return _MockResp(200, text=_make_gql_page(page_num, has_next=(page_num < 8)))

    monkeypatch.setattr(svc.httpx, "AsyncClient", _MockGqlClient)

    sim = svc.SimNodeRuntime(
        id="proxy-01",
        label="Proxy Xoay #1",
        socks_url="socks5://u:p@203.0.113.10:1080",
    )
    pool = svc.RotatingProxyPool()
    worker = svc.GuestPublicGroupWorker(
        sim=sim,
        rotator=pool,
        config={"max_posts_per_group": 22, "max_scrolls_per_group": 2},
        log_cb=lambda *_: None,
        stop_check=lambda: False,
        progress_cb=lambda *_: None,
    )

    res = asyncio.run(
        worker._fetch_group_ssr_fast(
            "https://www.facebook.com/groups/9988776655/",
            "https://www.facebook.com/groups/9988776655/?sorting_setting=CHRONOLOGICAL",
            known_urls=set(),
            known_ids=set(),
            max_posts=22,
            max_scrolls=2,
        )
    )
    assert res["state"] == "ok"
    assert res["need_playwright"] is False
    assert res["method"] == "httpx_gql"
    # 1 SSR + 7 pages x 3 posts = 22 posts collected without Playwright!
    assert len(res["posts"]) >= 20
    assert post_call_count == 8  # 1 failed keep-alive + 7 successful GraphQL pages

    # Calling sync_nodes(None) preserves active pool states; sync_nodes([]) explicitly clears
    pool.sync_nodes(["203.0.113.10:1080:u:p"])
    assert len(pool.sync_nodes(None)) == 1
    assert pool.sync_nodes([]) == []


def test_safer_config_bounds_proxy_sync_and_due_interval(monkeypatch):
    """Ensure safer upper/lower limits cannot be exceeded, and edits always take effect."""
    monkeypatch.delenv("PUBLIC_CRAWL_PROXIES", raising=False)

    # 1. Aggressive old/dirty values clamp strictly down to safer limits & match real proxy count
    clamped_one_proxy = svc.clamp_public_crawl_config(
        {
            "max_posts_per_group": 100,
            "max_scrolls_per_group": 10,
            "groups_per_ip_rotate": 50,
            "cycle_interval_min": 5,
            "concurrent_sims": 8,
            "proxy_urls": ["203.0.113.10:1080:u:p"],
        }
    )
    assert clamped_one_proxy["max_posts_per_group"] == 25
    assert clamped_one_proxy["max_scrolls_per_group"] == 3
    assert clamped_one_proxy["groups_per_ip_rotate"] == 6
    assert clamped_one_proxy["cycle_interval_min"] == 15
    assert clamped_one_proxy["concurrent_sims"] == 1
    assert clamped_one_proxy["max_allowed_concurrent_sims"] == 1

    # Adding 3 proxies raises concurrent cap to 3; gentler (lower/slower) user values stay intact
    clamped_gentler = svc.clamp_public_crawl_config(
        {
            "max_posts_per_group": 15,
            "max_scrolls_per_group": 1,
            "groups_per_ip_rotate": 3,
            "cycle_interval_min": 45,
            "concurrent_sims": 2,
            "proxy_urls": [
                "203.0.113.10:1080:u:p",
                "203.0.113.11:1080:u:p",
                "203.0.113.12:1080:u:p",
            ],
        }
    )
    assert clamped_gentler["max_posts_per_group"] == 15
    assert clamped_gentler["max_scrolls_per_group"] == 1
    assert clamped_gentler["groups_per_ip_rotate"] == 3
    assert clamped_gentler["cycle_interval_min"] == 45
    assert clamped_gentler["concurrent_sims"] == 2
    assert clamped_gentler["max_allowed_concurrent_sims"] == 3

    # 2. Pagination page budget obeys BOTH max_scrolls_per_group and max_posts_per_group
    assert svc.compute_gql_page_budget(25, 0) == 0
    assert svc.compute_gql_page_budget(25, 1) == 4
    assert svc.compute_gql_page_budget(25, 2) == 9
    assert svc.compute_gql_page_budget(25, 3) == 10
    assert svc.compute_gql_page_budget(6, 3) == 3

    # 3. _select_due_groups_sync honors global cycle_interval_min (ignores stale DB DEFAULT 30)
    now = datetime.now(timezone.utc)
    fake_rows = [
        {
            "id": "g-20m",
            "group_url": "https://www.facebook.com/groups/20m",
            "visibility": "public",
            "public_crawl_enabled": True,
            "public_crawl_interval_min": 30,  # Legacy SQL default must NOT shadow global 15m setting
            "last_public_crawled_at": (now - timedelta(minutes=20)).isoformat(),
        },
        {
            "id": "g-5m",
            "group_url": "https://www.facebook.com/groups/5m",
            "visibility": "public",
            "public_crawl_enabled": True,
            "public_crawl_interval_min": 30,
            "last_public_crawled_at": (now - timedelta(minutes=5)).isoformat(),
        },
    ]

    class _FakeExec:
        def __init__(self, data):
            self.data = data

    class _FakeTable:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def execute(self):
            return _FakeExec(fake_rows)

    class _FakeSb:
        def table(self, _name):
            return _FakeTable()

    monkeypatch.setattr(svc, "get_supabase_client", lambda: _FakeSb())
    orch = svc.PublicCrawlOrchestrator()
    due_15m = orch._select_due_groups_sync(group_ids=None, default_interval_min=15, only_due=True)
    assert [r["id"] for r in due_15m] == ["g-20m"]
    due_60m = orch._select_due_groups_sync(group_ids=None, default_interval_min=60, only_due=True)
    assert due_60m == []

    # 4. API Pydantic validation rejects values more aggressive than safer limits (HTTP 422)
    app = FastAPI()
    app.include_router(public_crawler.router, prefix="/api/all-platform/public-crawler")
    app.dependency_overrides[auth_deps.get_current_user] = lambda: {"id": "u-adm", "role": "admin"}
    monkeypatch.setattr(auth_deps, "get_current_user", lambda _req, _auth=None: {"id": "u-adm", "role": "admin"})
    client = TestClient(app)
    try:
        assert client.put("/api/all-platform/public-crawler/config", json={"max_posts_per_group": 26}).status_code == 422
        assert client.put("/api/all-platform/public-crawler/config", json={"max_scrolls_per_group": 4}).status_code == 422
        assert client.put("/api/all-platform/public-crawler/config", json={"groups_per_ip_rotate": 7}).status_code == 422
        assert client.put("/api/all-platform/public-crawler/config", json={"cycle_interval_min": 5}).status_code == 422
        assert client.put("/api/all-platform/public-crawler/config", json={"concurrent_sims": 5}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_crawled_post_audit_and_ai_check_endpoint(monkeypatch):
    """Verify Public 4G posts + AI check outcomes (kept & deleted) persist for both UI tables."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.modules.all_platform import auth_deps
    from app.modules.all_platform.routers import public_crawler
    from app.modules.all_platform.services import (
        auto_seeding_comment_service as auto_cmt,
        crawled_post_audit_service as audit_svc,
        lead_score_service as lead_svc,
        post_ingest_service as ingest_svc,
    )
    from app.modules.all_platform.websocket import manager

    audit_svc.clear_memory_audit_for_tests()

    audit_store: dict[tuple[str, str], dict] = {}
    deleted_ids: list[str] = []
    updated_ids: list[str] = []

    class _FakeResp:
        def __init__(self, data):
            self.data = data

    class _FakeAuditTable:
        def __init__(self):
            self._rows = None
            self._in_urls = None

        def select(self, *_args):
            return self

        def in_(self, col, vals):
            if col == "post_url":
                self._in_urls = set(vals or [])
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args):
            return self

        def upsert(self, rows, **_kwargs):
            self._rows = rows if isinstance(rows, list) else [rows]
            return self

        def execute(self):
            if self._rows is not None:
                for r in self._rows:
                    key = (str(r.get("platform") or "facebook"), str(r.get("post_url") or ""))
                    prev = audit_store.get(key, {})
                    audit_store[key] = {**prev, **r}
                return _FakeResp(list(self._rows))
            rows = list(audit_store.values())
            if self._in_urls is not None:
                rows = [r for r in rows if r.get("post_url") in self._in_urls]
            return _FakeResp(rows)

    class _FakePostsTable:
        def __init__(self):
            self._mode = "select"
            self._eq_id = None

        def select(self, *_args):
            self._mode = "select"
            return self

        def in_(self, *_args):
            return self

        def not_(self):
            return self

        def delete(self):
            self._mode = "delete"
            return self

        def update(self, _fields):
            self._mode = "update"
            return self

        def eq(self, col, val):
            if col == "id":
                self._eq_id = str(val)
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args):
            return self

        def execute(self):
            if self._mode == "delete" and self._eq_id:
                deleted_ids.append(self._eq_id)
            elif self._mode == "update" and self._eq_id:
                updated_ids.append(self._eq_id)
            return _FakeResp([])

    class _FakeSb:
        def table(self, name):
            if name == "crawled_post_audit_logs":
                return _FakeAuditTable()
            return _FakePostsTable()

    monkeypatch.setattr(audit_svc, "get_supabase_client", lambda: _FakeSb())
    monkeypatch.setattr(lead_svc, "get_supabase_client", lambda: _FakeSb())
    monkeypatch.setattr(lead_svc, "is_lead_scoring_configured", lambda: True)
    monkeypatch.setattr(
        ingest_svc,
        "sync_process_and_save_posts_db",
        lambda payload, legacy=False: (
            2,
            [p.post_url or "" for p in payload.posts],
            [
                {
                    "id": f"fb-post-{idx + 1}",
                    "group_id": "grp-1",
                    "content": p.content or "",
                    "post_url": p.post_url or "",
                }
                for idx, p in enumerate(payload.posts)
            ],
        ),
    )

    scheduled_coros = []

    def _capture_task(coro):
        scheduled_coros.append(coro)
        return None

    async def _noop_broadcast(_payload):
        return None

    monkeypatch.setattr(ingest_svc.asyncio, "create_task", _capture_task)
    monkeypatch.setattr(manager, "broadcast", _noop_broadcast)

    now_iso = datetime.now(timezone.utc).isoformat()
    req = ingest_svc.ExtensionCrawlRequest(
        group_name="Hội Thiết Kế Website",
        group_url="https://www.facebook.com/groups/thietkeweb",
        group_id="grp-1",
        worker_id="public-4g:proxy-01",
        post_limit=25,
        posts=[
            ingest_svc.ExtensionPost(
                post_url="https://www.facebook.com/groups/thietkeweb/posts/1001/",
                author_name="Nguyen Khach",
                timestamp_raw=now_iso,
                content="Mình cần tìm đơn vị thiết kế website bán hàng gấp",
                reactions=4,
                comments=2,
            ),
            ingest_svc.ExtensionPost(
                post_url="https://www.facebook.com/groups/thietkeweb/posts/1002/",
                author_name="Agency Quang Cao",
                timestamp_raw=now_iso,
                content="Bên em chuyên nhận thiết kế website giá rẻ inbox tư vấn 24/7",
                reactions=1,
                comments=0,
            ),
        ],
    )

    async def _run_ingest_and_ai():
        ingest_res = await ingest_svc.ingest_facebook_posts(
            req,
            event_name="public_4g_crawl_saved",
            extra_broadcast_fields={"source": "public_4g", "sim_node": "proxy-01"},
        )
        assert ingest_res["count"] == 2
        assert len(scheduled_coros) == 1

        # Before AI runs, Table 1 shows 2 pending 4G posts
        before_overview = audit_svc.list_crawled_posts_overview_sync()
        assert before_overview["summary"]["total_4g_posts"] == 2
        assert before_overview["summary"]["pending_ai_count"] == 2

        async def _fake_score_text(content: str, *, keywords=None):
            if "Mình cần tìm" in content:
                return {
                    "score": 88,
                    "is_competitor": False,
                    "is_buyer": True,
                    "reason": "Khách thật đang cần thuê làm website bán hàng",
                    "need_category": "website",
                    "contact_phone": None,
                }
            return {
                "score": 0,
                "is_competitor": True,
                "is_buyer": False,
                "reason": "Đối thủ chào hàng dịch vụ làm web",
                "need_category": None,
                "contact_phone": None,
            }

        async def _fake_auto_comment(**_kw):
            return {"id": "auto-cmt-1"}

        monkeypatch.setattr(lead_svc, "score_text_for_lead", _fake_score_text)
        monkeypatch.setattr(auto_cmt, "maybe_create_auto_seeding_comment", _fake_auto_comment)

        ai_summary = await scheduled_coros[0]
        assert ai_summary == {"total": 2, "high": 1, "deleted": 1}
        assert deleted_ids == ["fb-post-2"]
        assert updated_ids == ["fb-post-1"]

    asyncio.run(_run_ingest_and_ai())

    # Query API endpoint for both UI tables
    app = FastAPI()
    app.include_router(public_crawler.router, prefix="/api/all-platform/public-crawler")
    app.dependency_overrides[auth_deps.get_current_user] = lambda: {"id": "u-adm", "role": "admin"}
    client = TestClient(app)
    try:
        resp = client.get("/api/all-platform/public-crawler/crawled-posts?time_range=all")
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["total_4g_posts"] == 2
        assert body["summary"]["pending_ai_count"] == 0
        assert body["summary"]["ai_checked_total"] == 2
        assert body["summary"]["ai_lead_high_count"] == 1
        assert body["summary"]["ai_deleted_count"] == 1
        assert body["summary"]["auto_seeding_count"] == 1
        assert len(body["public_4g_posts"]) == 2
        assert len(body["ai_checked_posts"]) == 2

        resp_deleted = client.get(
            "/api/all-platform/public-crawler/crawled-posts?ai_filter=deleted&source_filter=public_4g"
        )
        assert resp_deleted.status_code == 200
        del_rows = resp_deleted.json()["ai_checked_posts"]
        assert len(del_rows) == 1
        assert del_rows[0]["ai_status"] == "deleted_competitor"
        assert del_rows[0]["proxy_node"] == "proxy-01"
    finally:
        app.dependency_overrides.clear()
        audit_svc.clear_memory_audit_for_tests()
