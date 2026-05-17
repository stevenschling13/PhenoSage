# PhenoSage Production-Readiness & Optimization Plan

**Status:** Phase 0 + Phase 1 in progress on `claude/app-optimization-review-VxsEM`.
**Owner:** Lead engineering.
**Audit basis:** Full-codebase survey performed 2026-05-17 — see WORKLOG for the
raw notes.

This plan is sequenced by **risk-to-revenue**. Phase 0 and Phase 1 prevent the
most user-visible failures and are the only phases meant to land on the current
optimization branch; later phases are tracked as follow-up issues / PRs.

---

## Phase 0 — Triage: stop silent failures

Stubbed code paths that look like they work but return synthetic/null data
erode user trust without any error signal. After the audit, the actual state
of these items is:

| # | Item | Actual state | Action |
|---|------|-------------|--------|
| 0.1 | Image-comparison stub returns "not yet implemented" | `image_comparison.compare_images` is never wired into `run_analysis`; the active code path hardcodes `comparison_summary=None`. UI conditionally renders only when truthy. | Add a comment + lint to keep it that way until Milestone 2 ships. |
| 0.2 | UI must clearly mark fallback results | Already implemented: `plants/[plantId]/page.tsx` renders a warning-toned `<StatusPill>` and explanatory copy when `isFallback === true`. | No change needed; covered by E2E expansion in Phase 6. |
| 0.3 | Severity-weighted health score | Already implemented in `scoring.py` with weights `info:0, low:5, medium:15, high:30, critical:50`. The TODO docstring is stale. | Remove stale TODO comment so it isn't audited as a gap again. |
| 0.4 | Other `TODO (Milestone 2)` markers | `image_comparison.py` and `prompts.py` are the only two. Neither is reachable from prod UI. | Track in Milestone 2 issue, not on this branch. |

---

## Phase 1 — Reliability & resilience

The single biggest production risk is transient upstream failures becoming
permanent user-visible errors. Web side already has bounded retries and a
circuit breaker (`apps/web/src/lib/server/resilience.ts`,
`circuit-breaker.ts`, applied via `analysis-proxy.ts:380`). The remaining
hole is the **analysis service itself**, which has no retries on its
Supabase fetch or OpenAI call.

### 1.1 Backend retries (this branch)

- New: `apps/analysis/app/services/retry.py` — async `with_retry` helper.
  - Bounded attempts with full-jitter exponential backoff.
  - Retries only `AnalysisError` subclasses where `retryable=True` (already
    set on `StorageUnavailable`, `ModelUnavailable`, `ModelRateLimited`).
  - Never retries `ConfigurationError`, `ModelBadResponse`,
    `InvalidStoragePath`, `ImageQualityInconclusive` — those need an
    operator/user action, not a retry.
  - No new third-party dep; we don't need `tenacity` for this scope.
  - Injectable `sleep` for tests.
- Wire it around `_fetch_storage_image` and `_run_model_analysis` in
  `run_analysis()`.
- Structured log on every retry (`upstream call retrying`) and on
  exhaustion (`upstream call failed`).

### 1.2 Idempotency at the DB layer (follow-up PR)

- New migration adding `UNIQUE (user_id, idempotency_key)` to
  `analysis_jobs` and `chat_messages`.
- App treats `23505` (unique violation) as "already accepted" and returns
  the existing row.

### 1.3 Rate-limit hardening (follow-up PR)

- The current fail-open behavior in `rate-limit.ts` is **intentional** and
  documented; we don't change it for read endpoints.
- Add a stricter, fail-closed limiter for **auth** routes (5 sign-in
  attempts / 15 min / IP).
- Add per-endpoint quotas separate from the default.

### 1.4 Signed-URL auto-refresh (follow-up PR)

- New endpoint `POST /api/uploads/refresh` that re-signs a path after
  validating ownership.
- New client component `<SignedImage>` that catches a 403 once and
  refetches via the refresh endpoint.

---

## Phase 2 — Observability (follow-up PRs)

- Promote `SENTRY_DSN` to required when `NEXT_PUBLIC_APP_ENV=production`
  (`apps/web/src/lib/server/env.ts`).
- W3C `traceparent` propagation: browser → Next route handler →
  FastAPI → OpenAI.
- Structured per-route timing logs: `{requestId, userId, route, durationMs, status}`.
- Sentry alerts: `/api/analyze` p95 > 15s for 5 min, error rate > 2% over
  10 min, any 5xx on `/api/internal/cron/*`.
- `/api/ready` probes Supabase, Upstash, analysis service individually.

---

## Phase 3 — Performance (follow-up PRs)

- Bundle analysis pass (`@next/bundle-analyzer`); target first-load JS
  < 200 KB on `/dashboard`.
- Eliminate N+1 in `plants.ts:340-353` via a `get_plant_timeline` RPC.
- Cursor pagination on `/api/plants/[plantId]/timeline`,
  `/api/grows/[id]/plants`, `/api/notifications`.
- Streaming chat response (`ReadableStream` + Vercel AI SDK).
- `Cache-Control: private, no-store` on every authed API route;
  `public, max-age=60, stale-while-revalidate=300` on health/marketing.
- `EXPLAIN ANALYZE` sweep on top-10 queries; missing indexes added.
- pgvector switch to HNSW once >10k embeddings exist.
- Move runtime-safe routes to `runtime = "edge"`.

---

## Phase 4 — Error handling & UX (follow-up PRs)

- Move zod schemas from `lib/server/schemas.ts` to
  `packages/shared/src/schemas.ts` (the project's shared package
  intentionally has no runtime deps — adding zod is a justified
  exception, since contract drift is a known risk).
- Forms adopt `react-hook-form` + `@hookform/resolvers/zod` against the
  shared schemas. Field-level errors render immediately.
- One `<Toaster />` at the root layout. Every fetch wrapper maps the
  `{error: {code, message, requestId}}` envelope to a coded toast with a
  "Details" disclosure exposing `requestId`.
- Mutations use `useMutation` with optimistic update and a one-tap retry.
- Granular `<Suspense>` boundaries inside `(app)/grows/[id]/page.tsx` and
  `(app)/plants/[plantId]/page.tsx`.
- Realtime subscription to `notifications` so resolve/dismiss propagates
  across tabs.
- Upload progress bar via `XMLHttpRequest.onprogress`; exponential-backoff
  retry up to 3 attempts on transient failures.

---

## Phase 5 — Security hardening (follow-up PRs)

| # | Item |
|---|------|
| 5.1 | Auth rate-limit: 5 failed sign-ins / 15 min / IP. |
| 5.2 | Magic-bytes MIME sniffing on uploads (first 12 bytes), not just `Content-Type`/extension. |
| 5.3 | `Content-Length` cap enforced in the shared `parseJsonBody` wrapper (10 MB image, 64 KB JSON). |
| 5.4 | Nonce-based CSP — generated per-response, no global `middleware.ts`. |
| 5.5 | Key-rotation runbook in `docs/runbooks/key-rotation.md`. |
| 5.6 | `pnpm run security:routes` made a required PR check. |

---

## Phase 6 — Testing expansion (follow-up PRs)

- Playwright specs for: invalid login, expired session, analysis 5xx,
  rate-limit hit, multi-user grow collaboration (RLS), signed-URL
  refresh, offline retry.
- 80% line coverage threshold on `apps/web/src/lib/server/**` and
  `apps/analysis/app/**` enforced in CI.
- k6 script at `tests/load/analyze.js` — 50 RPS for 5 min, p95 < 8s,
  error rate < 1%.
- Cross-language contract test: same JSON sample feeds the pydantic
  `AnalyzeRequest` and the zod `AnalyzeRequestSchema`; both must accept
  or reject identically.

---

## Phase 7 — CI/CD & deploy safety (follow-up PRs)

- Migration dry-run job: `supabase db diff --linked` + `supabase db lint`
  on PR; blocks merge on errors.
- Post-deploy smoke runs within 60s of prod deploy; on failure, opens a
  rollback PR or hits the Vercel rollback API.
- New `deploy-analysis.yml` workflow tied to `apps/analysis/**` changes.
- Lockstep check: block merges to main if `packages/shared` changes
  without a matching pydantic update.
- Pre-commit hook (`.husky/pre-commit`) runs `pnpm run validate`.

---

## Phase 8 — Runbook & documentation (follow-up PRs)

- `docs/runbooks/incident-response.md` — high-error-rate, OpenAI outage,
  Supabase degradation.
- `docs/runbooks/rollback.md` — Vercel, Railway, migration rollback.
- `docs/runbooks/key-rotation.md`.
- `docs/runbooks/onboarding-call.md` — dashboards, log queries, Sentry
  links.

---

## Effort summary

| Phase | Eng-days | Risk if skipped |
|-------|---------|-----------------|
| 0 — Triage | 1 | High — silent failures |
| 1 — Reliability | 3–5 | High — transient outages become user errors |
| 2 — Observability | 2–3 | High — flying blind in prod |
| 3 — Performance | 3–5 | Medium |
| 4 — Error UX | 3–4 | Medium |
| 5 — Security | 2 | Medium-High |
| 6 — Testing | 3–4 | Medium |
| 7 — CI/CD | 2 | Medium |
| 8 — Docs | 1 | Low (but cheap) |
| **Total** | **~20–28 days** | |

---

## What's landing on `claude/app-optimization-review-VxsEM`

1. This plan doc.
2. Stale TODO removed from `scoring.py`.
3. Defensive guard on `image_comparison.compare_images` so it cannot be
   wired into a production path by accident.
4. New `apps/analysis/app/services/retry.py` — async `with_retry` helper.
5. `run_analysis` retries `_fetch_storage_image` and `_run_model_analysis`
   on retryable `AnalysisError`s.
6. Tests covering: retry-then-succeed, retry-then-exhaust, non-retryable
   passes through immediately, programmer defects still propagate.

Everything else is tracked here for follow-up PRs.
