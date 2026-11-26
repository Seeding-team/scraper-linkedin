"""Comprehensive offline unit & integration test suite for Unified Multi-Platform Crawler Upgrade.

Covers all 4 phases with ZERO live network/Supabase mutations:
- Phase 1: Core 4G TLS impersonation fallback (`curl_cffi` -> `httpx`), dynamic GraphQL `doc_id`
           auto-discovery from SSR HTML, and `AdaptiveRateLimiter` backoff + circuit breaker.
- Phase 2: Instagram No-Acc Crawler (`/popular/<kw>/`, `/<user>/`, shortcode extraction,
           `/embed/captioned/` `contextJSON` + `.Caption` DOM fallback, state classification).
- Phase 3: LinkedIn No-Acc Crawler (`/jobs-guest/api` search + detail JD enrichment,
           DuckDuckGo `site:linkedin.com/posts` search index parser, `LinkedInGroupSafetyGuard`).
- Phase 4: Facebook `EAA` Token Fast-Lane Pool (Fernet encryption/masking, token type detection,
           `X-App-Usage` >= 65% proactive cooldown, Graph `190`/`368` auto-quarantine,
           Graph feed normalization, and FastAPI router security/zero-plaintext checks).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.routers.public_crawler import router as public_crawler_router
from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
    classify_graph_error,
    crawl_fb_group_feed_via_eaa,
    decrypt_eaa_token,
    detect_eaa_token_type,
    encrypt_eaa_token,
    extract_numeric_group_id,
    mask_eaa_token,
    normalize_graph_feed_posts,
    parse_x_app_usage_header,
    to_public_token_dict,
)
from app.modules.all_platform.services.instagram_no_acc_crawler_service import (
    build_instagram_embed_url,
    build_instagram_keyword_url,
    build_instagram_profile_url,
    classify_instagram_page_state,
    extract_instagram_shortcodes_from_html,
    normalize_instagram_username,
    parse_instagram_embed_html,
)
from app.modules.all_platform.services.linkedin_no_acc_crawler_service import (
    LinkedInGroupSafetyGuard,
    build_linkedin_job_detail_url,
    build_linkedin_jobs_guest_url,
    crawl_linkedin_no_acc_keyword,
    parse_duckduckgo_html_linkedin_results,
    parse_linkedin_job_detail_html,
    parse_linkedin_jobs_search_html,
)
from app.modules.all_platform.services.public_4g_crawler_service import (
    AdaptiveRateLimiter,
    create_tls_http_client,
    extract_gql_doc_id_from_html,
    get_active_gql_doc_id,
    update_active_gql_doc_id,
)


# ── Phase 1 Tests: Core 4G TLS, Dynamic doc_id & Adaptive Circuit Breaker ────

def test_phase1_tls_client_graceful_fallback_and_dynamic_doc_id():
    client, engine = create_tls_http_client(None, use_curl_cffi=False)
    assert engine == "httpx"
    assert isinstance(client, httpx.AsyncClient)
    asyncio.run(client.aclose())

    ssr_html = (
        '<script>{"name":"GroupsCometFeedRegularStoriesPaginationQuery",'
        '"id":"998877665544332211","metadata":{}}</script>'
    )
    discovered = extract_gql_doc_id_from_html(ssr_html)
    assert discovered == "998877665544332211"

    prev_doc_id = get_active_gql_doc_id()
    try:
        assert update_active_gql_doc_id("998877665544332211", persist=False) is True
        assert get_active_gql_doc_id() == "998877665544332211"
        assert update_active_gql_doc_id("not-a-number", persist=False) is False
    finally:
        update_active_gql_doc_id(prev_doc_id, persist=False)


def test_phase1_adaptive_rate_limiter_backoff_and_circuit_breaker():
    rl = AdaptiveRateLimiter(window_size=10, breaker_threshold=3, breaker_cooldown_sec=30.0)
    assert rl.is_circuit_open("proxy-01") is False
    assert rl.recommended_delay("proxy-01") == 0.0

    d1 = rl.record_rate_limit("proxy-01")
    d2 = rl.record_rate_limit("proxy-01")
    assert d1 > 0 and d2 > 0
    assert rl.is_circuit_open("proxy-01") is False

    rl.record_rate_limit("proxy-01")
    assert rl.is_circuit_open("proxy-01") is True
    assert rl.block_ratio("proxy-01") == 1.0

    rl.record_success("proxy-01")
    assert rl.is_circuit_open("proxy-01") is False


# ── Phase 2 Tests: Instagram No-Acc Discovery & Embed Captioned Parser ───────

def test_phase2_instagram_urls_shortcodes_and_embed_context_json():
    assert build_instagram_keyword_url("#Thiết Kế Web") == "https://www.instagram.com/popular/thi%E1%BA%BFt-k%E1%BA%BF-web/"
    assert normalize_instagram_username("https://www.instagram.com/Markee.AI/") == "markee.ai"
    assert build_instagram_profile_url("@Markee.AI") == "https://www.instagram.com/markee.ai/"
    assert build_instagram_embed_url("C9abcXYZ123") == "https://www.instagram.com/p/C9abcXYZ123/embed/captioned/"

    discovery_html = """
    <a href="/p/C9abcXYZ123/">Post 1</a>
    <a href="/reel/DA99887766/">Reel 2</a>
    <a href="/p/C9abcXYZ123/">Dup Post 1</a>
    """
    codes = extract_instagram_shortcodes_from_html(discovery_html)
    assert codes == ["C9abcXYZ123", "DA99887766"]

    context_obj = {
        "context": {
            "media": {
                "owner": {"username": "agency_vn", "full_name": "Agency VN"},
                "caption": "Cần tìm đối tác thiết kế web bán hàng chuẩn SEO, liên hệ 0909123456!",
                "likes_count": 148,
                "comments_count": 23,
                "taken_at_timestamp": 1764000000,
                "display_src": "https://scontent.cdninstagram.com/v/photo1.jpg",
            }
        }
    }
    escaped = json.dumps(json.dumps(context_obj, ensure_ascii=False))
    embed_html = f'<script>window.__s = {{"contextJSON":{escaped}}};</script>'
    parsed = parse_instagram_embed_html(embed_html, "C9abcXYZ123", keyword="thietkeweb", target_type="keyword")
    assert parsed is not None
    assert parsed["post_url"] == "https://www.instagram.com/p/C9abcXYZ123/"
    assert parsed["author_username"] == "agency_vn"
    assert "thiết kế web" in parsed["content"]
    assert parsed["reactions"] == 148
    assert parsed["comments"] == 23
    assert parsed["image_urls"] == ["https://scontent.cdninstagram.com/v/photo1.jpg"]

    # DOM fallback when contextJSON absent
    dom_embed = """
    <html><body>
      <span class="UsernameText">shop_hcm</span>
      <div class="Caption"><a class="CaptionUsername">shop_hcm</a>Cần làm app đặt lịch spa gấp!</div>
      <div class="SocialProof">1.2K likes</div>
      <img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/v/dom.jpg" />
    </body></html>
    """
    parsed_dom = parse_instagram_embed_html(dom_embed, "DOM1234567", keyword="app spa")
    assert parsed_dom is not None
    assert parsed_dom["author_username"] == "shop_hcm"
    assert "app đặt lịch spa" in parsed_dom["content"]
    assert parsed_dom["reactions"] == 1200

    st, rot, _ = classify_instagram_page_state(
        http_status=200,
        final_url="https://www.instagram.com/accounts/login/?next=/popular/web/",
        body_text="Log in to Instagram",
        shortcode_count=0,
    )
    assert st == "login_wall" and rot is True


# ── Phase 3 Tests: LinkedIn No-Acc Guest Jobs, Search Index & Safety Guard ───

def test_phase3_linkedin_jobs_guest_search_index_and_safety_guard():
    url = build_linkedin_jobs_guest_url("Cybersecurity", location="Vietnam", start=0)
    assert "linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search" in url
    assert build_linkedin_job_detail_url("4123456789") == "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4123456789"

    search_html = """
    <ul>
      <li>
        <div class="base-card" data-entity-urn="urn:li:jobPosting:4123456789">
          <a class="base-card__full-link" href="https://vn.linkedin.com/jobs/view/security-lead-4123456789"></a>
          <h3 class="base-search-card__title">Senior Cybersecurity Manager</h3>
          <h4 class="base-search-card__subtitle">Fintech Corp VN</h4>
          <span class="job-search-card__location">Ho Chi Minh City, Vietnam</span>
          <time datetime="2026-11-25">1 day ago</time>
        </div>
      </li>
    </ul>
    """
    summaries = parse_linkedin_jobs_search_html(search_html, limit=10)
    assert len(summaries) == 1
    assert summaries[0]["job_id"] == "4123456789"
    assert summaries[0]["company_name"] == "Fintech Corp VN"

    detail_html = """
    <div class="show-more-less-html__markup">
      We are deploying SOC, SIEM, and ISO 27001 audit across 200 endpoints in Q1.
    </div>
    <ul>
      <li class="description__job-criteria-item">
        <h3 class="description__job-criteria-subheader">Seniority level</h3>
        <span class="description__job-criteria-text">Mid-Senior level</span>
      </li>
    </ul>
    """
    enriched = parse_linkedin_job_detail_html(detail_html, summaries[0])
    assert enriched["post_kind"] == "job_intent"
    assert "Fintech Corp VN" in enriched["content"]
    assert "ISO 27001" in enriched["content"]

    ddg_html = """
    <div class="result">
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fposts%2Fnguyen-an_erp-crm-activity-7200112233">
        Cần tư vấn triển khai ERP cho nhà máy 500 nhân sự
      </a>
      <a class="result__snippet">Doanh nghiệp mình ở Bình Dương đang tìm đơn vị ERP uy tín.</a>
    </div>
    """
    pub_posts = parse_duckduckgo_html_linkedin_results(ddg_html, keyword="ERP")
    assert len(pub_posts) == 1
    assert pub_posts[0]["post_kind"] == "public_post"
    assert pub_posts[0]["post_url"] == "https://www.linkedin.com/posts/nguyen-an_erp-crm-activity-7200112233"

    # End-to-end mocked pure HTTP crawl
    mock_client = AsyncMock()
    r_search = MagicMock(status_code=200, text=search_html)
    r_detail = MagicMock(status_code=200, text=detail_html)
    r_ddg = MagicMock(status_code=200, text=ddg_html)
    mock_client.get = AsyncMock(side_effect=[r_search, r_detail])
    mock_client.post = AsyncMock(return_value=r_ddg)

    res = asyncio.run(
        crawl_linkedin_no_acc_keyword(
            "Cybersecurity",
            location="Vietnam",
            channel="both",
            max_jobs=5,
            http_client=mock_client,
        )
    )
    assert res.status == "ok"
    assert res.jobs_extracted == 1
    assert res.public_posts_extracted == 1
    assert len(res.posts) == 2

    # Safety Guard for `li_at` Group Accounts
    guard = LinkedInGroupSafetyGuard(max_groups_per_day=2, max_scrolls_per_day=5)
    ok_no_px, _ = guard.validate_and_bind_proxy("acc-1", None)
    assert ok_no_px is False
    ok_bind, _ = guard.validate_and_bind_proxy("acc-1", "http://1.2.3.4:8080")
    assert ok_bind is True
    ok_diff, _ = guard.validate_and_bind_proxy("acc-1", "http://9.9.9.9:8080")
    assert ok_diff is False
    assert guard.check_and_consume_quota("acc-1", scrolls=2)[0] is True
    assert guard.check_and_consume_quota("acc-1", scrolls=2)[0] is True
    assert guard.check_and_consume_quota("acc-1", scrolls=2)[0] is False  # exceeded daily cap


# ── Phase 4 Tests: Facebook EAA Token Encryption, 5 Guards & Router ──────────

def test_phase4_eaa_token_fernet_masks_usage_quarantine_and_feed_normalization():
    raw_tok = "EAAD6V7TestSecretTokenPayload1234567890ABCDEF9xK2"
    enc = encrypt_eaa_token(raw_tok)
    assert raw_tok not in enc
    assert decrypt_eaa_token(enc) == raw_tok
    assert detect_eaa_token_type(raw_tok) == "EAAD6V7"
    assert mask_eaa_token(raw_tok) == "EAAD6V7•••••9xK2"
    assert extract_numeric_group_id("https://www.facebook.com/groups/123456789012345/") == "123456789012345"

    pub = to_public_token_dict(
        {
            "id": "tok-1",
            "label": "VIA #01",
            "token_encrypted": enc,
            "token_masked": mask_eaa_token(raw_tok),
            "token_type": "EAAD6V7",
            "sticky_proxy_url": None,
            "hourly_quota": 80,
            "status": "active",
        }
    )
    assert "token_encrypted" not in pub
    assert "sticky_proxy_url" not in pub
    assert pub["proxy_warning"] is True

    assert parse_x_app_usage_header('{"call_count":72,"total_cputime":12,"total_time":45}') == 72.0
    assert classify_graph_error({"error": {"code": 190, "message": "Session expired"}}, 400)[2] == "quarantine"
    assert classify_graph_error({"error": {"code": 368, "message": "Temporarily blocked"}}, 400)[2] == "quarantine"
    assert classify_graph_error({"error": {"code": 613, "message": "Calls limit"}}, 400)[2] == "cooldown"

    graph_json = {
        "data": [
            {
                "id": "123456789_987654321",
                "message": "Mình cần làm app bán hàng tích hợp Zalo OA",
                "created_time": "2026-11-26T04:00:00+0000",
                "permalink_url": "https://www.facebook.com/groups/123456789/posts/987654321/",
                "from": {"id": "1000112233", "name": "Trần Minh"},
                "full_picture": "https://scontent.xx.fbcdn.net/v/p.jpg",
                "reactions": {"summary": {"total_count": 15}},
                "comments": {"summary": {"total_count": 4}},
            }
        ]
    }
    posts = normalize_graph_feed_posts(
        graph_json,
        group_id="123456789",
        group_url="https://www.facebook.com/groups/123456789/",
    )
    assert len(posts) == 1
    assert posts[0]["post_id"] == "987654321"
    assert posts[0]["author_name"] == "Trần Minh"
    assert posts[0]["reactions"] == 15
    assert posts[0]["crawl_source"] == "fb_eaa_token"

    # Test auto-quarantine on error 190 & proactive cooldown on X-App-Usage >= 65%
    token_row = {
        "id": "tok-q1",
        "label": "VIA Test",
        "token_encrypted": enc,
        "sticky_proxy_url": "http://10.0.0.2:8080",
        "requests_this_hour": 5,
        "total_requests": 10,
        "total_posts_saved": 20,
    }
    mock_190_client = AsyncMock()
    mock_190_client.get = AsyncMock(
        return_value=MagicMock(
            status_code=400,
            json=lambda: {"error": {"code": 190, "message": "Error validating access token"}},
            headers={},
            text="",
        )
    )
    with patch(
        "app.modules.all_platform.services.fb_eaa_token_crawler_service._persist_token_telemetry_sync"
    ) as mock_persist:
        res_190 = asyncio.run(
            crawl_fb_group_feed_via_eaa(
                token_row,
                group_id_or_url="https://www.facebook.com/groups/123456789/",
                apply_jitter=False,
                http_client=mock_190_client,
            )
        )
        assert res_190["ok"] is False
        assert res_190["state"] == "quarantined"
        assert mock_persist.call_args.kwargs["new_status"] == "quarantined"

    mock_usage_client = AsyncMock()
    mock_usage_client.get = AsyncMock(
        return_value=MagicMock(
            status_code=200,
            json=lambda: graph_json,
            headers={"X-App-Usage": '{"call_count":70,"total_cputime":15,"total_time":22}'},
            text="",
        )
    )
    with patch(
        "app.modules.all_platform.services.fb_eaa_token_crawler_service._persist_token_telemetry_sync"
    ) as mock_persist2:
        res_ok = asyncio.run(
            crawl_fb_group_feed_via_eaa(
                token_row,
                group_id_or_url="123456789",
                apply_jitter=False,
                http_client=mock_usage_client,
            )
        )
        assert res_ok["ok"] is True
        assert res_ok["app_usage_pct"] == 70.0
        assert len(res_ok["posts"]) == 1
        assert mock_persist2.call_args.kwargs["new_status"] == "cooldown"


def test_phase4_fastapi_routes_registered_cleanly():
    app = FastAPI()
    app.include_router(public_crawler_router, prefix="/api/all-platform/public-crawler")
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/all-platform/public-crawler/instagram-targets" in paths
    assert "/api/all-platform/public-crawler/linkedin-no-acc-targets" in paths
    assert "/api/all-platform/public-crawler/eaa-tokens" in paths
    assert "/api/all-platform/public-crawler/eaa-tokens/{token_id}/test" in paths
    assert "/api/all-platform/public-crawler/eaa-tokens/test-raw" in paths
