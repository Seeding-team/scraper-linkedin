# scraper-linkedin — LinkedIn Group Crawler

## Setup & run (Docker)

```bash
cp linkedin-crawler-ui/.env.example linkedin-crawler-ui/.env
cp linkedin_group_crawler/.env.example linkedin_group_crawler/.env
cp docker-compose.override.yml.example docker-compose.override.yml
# Fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET_KEY,
# MARKEE_FB_BASE_URL, MARKEE_FB_API_KEY, MARKEE_FB_EXTENSION_API_KEY
# in linkedin_group_crawler/.env (ask admin for real values)
docker compose up --build
# Open http://localhost:8080
```

## Architecture

```
linkedin_group_crawler/  FastAPI (Python 3.10, :8000)
  app/main.py            entrypoint, CORS, lifespan, 4 router mounts
  app/modules/linkedin/  LinkedIn crawl/react/comment endpoints
  app/modules/facebook/  Facebook automation (Markee service)
  app/modules/zalo/      Zalo messaging bridge
  app/modules/all_platform/  KPI, teams, auth (Supabase), unified posts
  app/core/              Playwright pool, config, logger
  app/shared/services/   Google Sheet, n8n webhook
linkedin-crawler-ui/     Next.js 16 + React 19 + Tailwind 4, App Router
  next.config.ts         output: "standalone", rewrites /api/* → :8000 (bare-metal only)
nginx-router/            :8080 → FE (:3000) + /api/* → BE (:8000)
```

Routers mounted in `app/main.py`: LinkedIn (no prefix), Facebook (`/facebook/api/v1`), All-Platform (`/api/all-platform`), WebSocket (in all_platform_router). CORS allows `chrome-extension://*`, `localhost:3000/8080`, plus `CORS_ORIGINS` env var.

## Critical gotchas

- **`NEXT_PUBLIC_*` vars are BUILD-TIME only** — .env changes don't affect Docker. Override via `docker-compose.override.yml` build args. The original `docker-compose.yml` hardcodes production URLs; local dev without override silently calls production API (CORS + auth cookie breakage).
- **`docker-compose.override.yml` must NOT be committed** — it's in `.gitignore`. Docker Compose auto-merges it (no `-f` needed). Committing it overrides production build-args to `localhost:8080` on deploy.
- **Backend env loading: `.env` then `.env.local`** — `app/core/config.py` loads `.env` first, then `.env.local` with `override=True`. Use `.env.local` for local overrides without touching committed `.env`.
- **Dev safeguards** — set these in local backend `.env` to avoid triggering production crawls: `DISABLE_SCHEDULER=1`, `DISABLE_ZCA_LISTENERS=1`, `DISABLE_ALL_PLATFORM_CRAWL_24H=1`.
- **Frontend `--build` required after code changes** — Dockerfile uses `sed` to strip `basePath`/`assetPrefix` at build time; `npm run build` runs `postbuild` (copies standalone assets via `scripts/copy-standalone-assets.mjs`).
- **Timezone** — `TZ: Asia/Ho_Chi_Minh` set in all docker-compose services. Alpine images (frontend, router) need `tzdata` package installed (`apk add tzdata`) for `TZ` to work. Backend (Ubuntu Jammy) has it pre-installed.
- **`setuptools<70`** required — `playwright-stealth==1.0.6` needs `pkg_resources` (dropped in setuptools ≥70).
- **`uvicorn[standard]`** required for WebSocket at `/facebook/api/v1/ws/CrawlFbForFE`.
- **Health check** — `GET /health` (port 8000 only; nginx doesn't proxy it).
- **`@/components/nguyen/*`** maps to `components/facebook-crawler/*`. Use `@/*` for new code.

## Commands

| What | Command | Where |
|------|---------|-------|
| Run all (Docker) | `docker compose up --build` | root |
| Deploy (zero-downtime + auto-rollback) | `bash deploy.sh [frontend\|backend\|all]` | root (on 10.30.50.29) |
| Frontend dev (bare metal) | `npm run dev` | `linkedin-crawler-ui/` |
| Frontend type-check + lint | `npm run check` | `linkedin-crawler-ui/` |
| Frontend build | `npm run build` | `linkedin-crawler-ui/` |
| Backend dev server | `uvicorn app.main:app --host 0.0.0.0 --port 8000` | `linkedin_group_crawler/` |
| Backend test | `python -m pytest tests/ -v` | `linkedin_group_crawler/` |

## CI

- **PR → `dev`/`ui-trial`/`main`**: build check (`npm run build` FE + `py_compile` BE), no deploy
- **Push → `dev`**: auto-deploy on self-hosted runner at 10.30.50.29
- **Manual trigger**: deploy to production (10.120.60.26)

## CodeGraph

CodeGraph indexes this repo (`.codegraph/` exists). **Must use before grep/Read.**

- **MUST** call `codegraph_explore` before `grep`/`find`/`Read`/Task — returns verbatim source + call paths in one call, far fewer tokens and round-trips.
- **Use natural-language queries** (e.g. "timezone config in Docker and Alpine containers"), not just symbol names.
- **NEVER** reach for grep/Read/Task as first step.

## GitNexus

Indexed as **scraper-linkedin** (11808 symbols). Refresh with `node .gitnexus/run.cjs analyze`.

- **MUST** run `impact` before editing any function/class/method; report blast radius.
- **MUST** run `detect_changes()` before committing.
- **MUST** warn user on HIGH/CRITICAL risk.
- **NEVER** rename symbols with find-and-replace — use `rename` (understands call graph).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
