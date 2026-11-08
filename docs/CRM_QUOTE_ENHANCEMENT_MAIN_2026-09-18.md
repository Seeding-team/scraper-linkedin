# Quote enhancement — Main implementation

Status: Main code implemented; automated checks passed where noted. **Not approved for clone port or production rollout.** No commit, push or deploy performed.

## Persistence

- `quote_items.warranty_scope`, nullable text, normalized empty input to NULL. Request schema, create insert, update RPC, version-copy RPC, internal/public mapping and FE item payload retain it.
- Migration `141_quote_item_warranty_scope.sql` carries the current update RPC from 110 and version RPC from 114, including soft-deleted draft exclusion. Only adds warranty constructor fields; no fake warranty backfill.
- Standard form capability `enableDynamicPaymentPlan: true`, selected by `STANDARD_DEFAULT_QUOTE_FORM`, not display label. Seed and migration enable it; existing draft snapshots are enabled, approved snapshots are not changed.
- `quotes.data.paymentPlan`: `id`, `phase`, `percent`, `condition`, `note`. Backend strips any client `amount` and validates finite percentage in [0,100]. Editor/renderer derive money from `calculateOverallDiscountSummary(...).grandTotal` after item/global discount and VAT.
- Both flows use the existing `CustomBlocksEditor`, canonical `data.customBlocks`. Project warranty label changes, `kind: warranty` retained. Red draft preserves legacy scope/terms, editor singleton blocks take precedence without duplicate kinds.
- Red description popup and white item-detail action edit work description plus warranty without adding a warranty price-table column.
- Renderer hides blank warranty/payment plan and preserves shared preview/detail/public/print output. Public data allowlist explicitly retains paymentPlan only for capable schemas, never internal notes.

## Verification completed

- Frontend `tsc --noEmit`: PASS.
- Docker backend build and final frontend production build: PASS (latest review-lock guard included). Backend quote schema/service/seed compile: PASS.
- `node scripts/test-quote-enhancement.cjs`: PASS decimal total 33.33+33.33+33.34; reactive discounted/VAT amounts; zero amount; empty hide; shared renderer HTML in four modes; independent item/project warranties; Villa dynamic section remains absent.
- Backend `tests/test_quote_enhancement.py`: 12 PASS in network-disabled Docker container using current mounted source and `/source` working directory.
- Migration applied twice to **crm_quote_regression** in local **crm-test-db**: PASS idempotence.
- `local-test-db/verify_quote_rpc.sql`: PASS first/second save, child warranty, payment/custom snapshot, version-copy warranty/data, deleted draft exclusion. Each test wrapped in rollback. Temp item map reset between simulated version requests because real HTTP requests have separate transactions.
- Sweep isolated regression DB: 0 quotes, 0 items, 0 forms remain.
- `git diff --check`: PASS (only line-ending warnings).

## Initial remaining gates (superseded by local readiness update below)

- Authenticated create/update/API regression and cross-tenant direct-ID acceptance remain unverified for these quote changes.
- Browser Save → F5 → Edit → second Save → Preview → actual Print/PDF remains unverified. Computer-use failed twice to initialize: `failed to write kernel assets ... os error 3`. HTML renderer assertions are not browser or PDF visual acceptance.
- Full existing Villa authenticated save/print regression remains unverified (only schema validation and renderer smoke assertions passed).
- Migration has **not** been applied to app local `crm_test` or production. App fixture originally lacks quote_items and full quote workflow dependencies; regression uses a separate guarded minimal DB, not a substitute for app acceptance.
- Built images are not automatically activated. Do not recreate app backend against an incomplete fixture without first preparing quote dependencies.
- No clone files changed for this quote enhancement; unrelated dirty hydration changes were preserved. Main approval required before sequential crm-module → CloudGate → SecurityZone port.

## Reproduce pure checks

Frontend: `node scripts/test-quote-enhancement.cjs`, `npx tsc --noEmit`.

Backend: run pytest with source mounted read-only, network disabled and working directory `/source` (otherwise `/app` can import an older image source).

RPC: guarded fixture requires database `crm_quote_regression`; apply fixture, migration 141 and verify SQL with `ON_ERROR_STOP=1`. Never use production for test mutations.

## Local readiness update — 2026-09-18 13:09

UI follow-up: user reported missing payment/custom sections specifically in the red request workspace. Source and active bundle contain both editors; local Standard form has enableDynamicPaymentPlan=true. Added explicit collapsible workspace cards labelled “Kế hoạch thanh toán” and “Nội dung bổ sung” below item pricing and before technical handoff, reusing existing editors and unchanged state/save handlers. Payment remains capability-gated; custom blocks are not template-gated. Type-check and pure renderer/payment tests PASS. Actual browser visibility is still unverified: browser tool initialization failed (kernel assets path error); do not claim the user's missing-UI root cause conclusively resolved without manual verification.

- `Initialize-QuoteTest.ps1` upgraded app `crm_test` atomically using canonical Main quote/catalog/project migrations, records hashes and skips applied files. No reset/deletion of existing fixtures. Migration141 now applied locally, never production.
- FE/BE recreated, router restarted. Effective guards: APP_ENV=test; SUPABASE_URL=TEST_SUPABASE_URL=http://crm-test-api; instance markee. Backend health200. Host FE login HTTP200, Next assets served.
- Guarded `seed_quote_local.py`: four existing Main templates, MARKEE default standard capability, two E2E_QUOTE_DEMO catalog components and a Presale demo user, intentionally retained for manual testing.
- Warranty added to existing backend technical-field authorization group; backend rebuilt and activated after this update.
- Authenticated API PASS: forms/issuers/catalog/quote-center; Standard create/GET/unrelated edit/Save2/GET; parent+child warranty, payment/custom snapshots, no stored amount, overall discount, invalid percentage422, related endpoints, member read denial, warranty edit denial for creator without technical rights, cross-tenant direct-ID GET/PUT no read/write.
- Tenant denial is success:false (HTTP200 or404); tests check response data and persisted row, not status alone.
- Full regression FAIL remains: existing Villa data-only PUT resets total800000 to0, while fixed phases survive. Original110 RPC has no solutionItems total branch, same as current constructors. Not fixed in this environment-preparation scope; no full Main PASS/clone-port approval claimed.
- Adversarial fixture also exposed existing global quote_number uniqueness vs tenant-scoped allocation collision; fixture is restored before subsequent create. No numbering logic changed.
- Test cleanup: tracked IDs + marker checks via soft-delete and admin hard-delete business endpoints. Quote/item rows swept to0. Deletion audit intentionally retained. Demo/unrelated fixtures preserved.
- Browser Save/F5/Preview/actual Print still manual/pending. No push, deploy or quote clone port.

Login: http://localhost:8080/auth/login. Admin `e2e_admin@crm-test.local`; Sale `e2e_sale@crm-test.local`; Presale `e2e_presale@crm-test.local`. Local demo password: `E2E-Lead-Local-2026!`. Open Quote Center and choose MARKEE + Mẫu báo giá chuẩn. Use E2E_QUOTE_DEMO catalog items and existing E2E customer fixtures. Start with Standard; Villa has the known edit-total issue above.

## Villa total-reset bug — fixed and reverified live — 2026-09-18 (follow-up)

The Villa "data-only PUT resets total to 0" issue above is fixed. `update_quote()`
in `supabase_quote_service.py` now recomputes `_calculate_villa_totals()` from the
effective merged `data.solutionItems` (current row + payload) and writes
`subtotal_amount`/`vat_amount`/`total_amount` back onto `quotes` right after the
shared `quote_update` RPC call, since that RPC always zeroes totals from `p_items`
(empty for Villa, which keeps its commercial rows in `data.solutionItems`, not
`quote_items`) — Standard quotes remain entirely RPC-calculated, unaffected.

Reran `local-test-db/verify_quote_local.py` live against the authenticated Main
test stack (`seeding-backend`/`seeding-frontend`/`seeding-router`, `crm_test` DB)
twice, back to back: both runs exit 0, no `KNOWN FAIL` line, no assertion failure
at the final `assert villa_total_ok` gate. Villa create → data-only PUT → GET now
retains `totalAmount == 800000` alongside the previously-passing fixed-phase and
cross-tenant checks. Tracked E2E fixtures cleaned up by the script itself both
runs (0 rows left).

Remaining open gate, unchanged from above: actual browser Save → F5 → Print/PDF
visual acceptance is still not verified (no browser/computer-use or Playwright
tooling available in this environment to drive it). Everything the renderer
outputs for print is otherwise covered by the existing pure HTML-renderer test
(`scripts/test-quote-enhancement.cjs`) — this gap is specifically the human-eye
layout/pagination check, not a functional/data-correctness gap.
