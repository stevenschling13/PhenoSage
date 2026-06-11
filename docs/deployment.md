# PhenoSage — Deployment Guide

---

## Services Overview

| Service         | Platform            | Purpose                                                    |
| --------------- | ------------------- | ---------------------------------------------------------- |
| `apps/web`      | Vercel              | Next.js web app — the only public origin                   |
| `apps/analysis` | Railway             | FastAPI analysis service — private, never browser-callable |
| Database        | Supabase (Postgres) | All application data with RLS                              |
| Storage         | Supabase Storage    | Private plant images                                       |
| Auth            | Supabase Auth       | User accounts and sessions                                 |

---

## Guiding Principle

> Vercel is the only public origin. The browser never calls Railway or uses the Supabase service role key.

## Runtime Contract

- Node.js: `20.x`
- pnpm: `9.15.9`
- `package.json#engines.node` is the source of truth for Vercel. Keep the Vercel project setting aligned with it rather than letting the dashboard drift to a newer default.

---

## Environment Variables

### apps/web (Vercel)

Set these in Vercel project settings → Environment Variables.

Mark server-only variables as **Server** exposure only (not Preview/Production client-side).

The **Sensitive?** column flags secrets that must also be created with Vercel's [Sensitive Environment Variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables) toggle on. A sensitive value is unreadable from the Vercel dashboard, the CLI, or API after creation — only its existence is exposed. This is the production-safe default for any secret that, if leaked from a compromised `VERCEL_TOKEN`, would let an attacker forge requests against PhenoSage or its upstreams. Public `NEXT_PUBLIC_*` vars and non-secret config like `ANALYSIS_SERVICE_URL` do not need the toggle.

| Variable                          | Exposure        | Sensitive? | Description                                                                 |
| --------------------------------- | --------------- | ---------- | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | Public          | —          | Supabase project URL                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Public          | —          | Supabase anon/public key                                                    |
| `NEXT_PUBLIC_APP_URL`             | Public          | —          | App base URL (e.g. `https://phenosage.vercel.app`)                          |
| `NEXT_PUBLIC_APP_ENV`             | Public          | —          | `production` / `preview` / `development` (gates `requiredInProduction` env) |
| `SUPABASE_SERVICE_ROLE_KEY`       | **Server only** | **Yes**    | Supabase service role — bypasses RLS                                        |
| `ANALYSIS_SERVICE_URL`            | **Server only** | —          | Railway analysis service base URL (not a secret; URL only)                  |
| `ANALYSIS_SERVICE_API_KEY`        | **Server only** | **Yes**    | Shared secret for proxy auth                                                |
| `ANALYSIS_SERVICE_TIMEOUT_MS`     | **Server only** | —          | Optional Railway proxy timeout override in milliseconds                     |
| `ANALYSIS_WEBHOOK_SECRET`         | **Server only** | **Yes**    | HMAC key for analysis-complete callback (Railway → web)                     |
| `SUPABASE_AUTH_WEBHOOK_SECRET`    | **Server only** | **Yes**    | Bearer for Supabase Database Webhook on `auth.users` INSERT                 |
| `SUPABASE_STORAGE_WEBHOOK_SECRET` | **Server only** | **Yes**    | Bearer for Supabase Database Webhook on `storage.objects` INSERT            |
| `GITHUB_WEBHOOK_SECRET`           | **Server only** | **Yes**    | HMAC key for GitHub repo webhook → Discord forwarder                        |
| `DISCORD_WEBHOOK_URL`             | **Server only** | **Yes**    | Discord channel webhook URL (target for GitHub event forwarder)             |
| `READINESS_PROBE_SECRET`          | **Server only** | **Yes**    | Protects `/api/internal/ready` readiness checks                             |
| `GEMINI_API_KEY`                  | **Server only** | **Yes**    | Google Gemini API key (chat) — free tier from aistudio.google.com           |
| `CRON_SECRET`                     | **Server only** | **Yes**    | Protects `/api/internal/cron/*` endpoints                                   |
| `SENTRY_DSN`                      | **Server only** | —          | Optional Sentry DSN — not a write credential                                |
| `SENTRY_AUTH_TOKEN`               | **Server only** | **Yes**    | Source-map upload token; required for the Sentry release-tag CI step        |
| `SENTRY_TRACES_SAMPLE_RATE`       | **Server only** | —          | Optional trace sample rate                                                  |

**How to mark an existing var Sensitive** (operator action — can't be done in code):

1. Vercel → `pheno-sage-web` → Settings → Environment Variables.
2. Find the secret → … menu → **Delete**.
3. Re-add the same name + value, ticking **Sensitive** before save. Note: Vercel restricts Sensitive variables to the **Production** environment only — they cannot be enabled for Preview or Development. Preview and Development continue to use plain env vars, and the env contract validator (`apps/web/src/lib/env.ts`) keeps preview deploys honest via the `requiredInProduction` gate.
4. Redeploy to pick up the new env binding.

Doing this for the 11 rows tagged **Yes** above closes the agent-flagged Vercel hardening gap from the 2026-05-21 deployment best-practices review.

### apps/analysis (Railway)

Set these in Railway project → Variables.

| Variable                      | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `ANALYSIS_SERVICE_API_KEY`    | Shared secret — must match `ANALYSIS_SERVICE_API_KEY` in Vercel |
| `READINESS_PROBE_SECRET`      | Optional shared secret for `/ready` readiness checks            |
| `OPENAI_API_KEY`              | OpenAI API key for Vision analysis                              |
| `SUPABASE_URL`                | Supabase project URL                                            |
| `SUPABASE_SERVICE_ROLE_KEY`   | Supabase service role (to fetch private images)                 |
| `APP_ENV`                     | `production`                                                    |
| `LOG_LEVEL`                   | `info`                                                          |
| `SENTRY_DSN`                  | Optional Sentry DSN                                             |
| `SENTRY_TRACES_SAMPLE_RATE`   | Optional trace sample rate                                      |
| `OTEL_ENABLED`                | Optional flag to enable OTLP export                             |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OTLP HTTP endpoint                                     |
| `OTEL_SERVICE_NAME`           | Optional OTEL service name override                             |
| `PORT`                        | Set automatically by Railway                                    |

---

## Vercel Setup

1. Connect your GitHub repo to Vercel
2. Set root directory to `apps/web`
3. Set Node.js Version to `20.x`
4. Set install command to `pnpm install --frozen-lockfile` (from repo root)
5. Set build command to `pnpm build`
6. Add all environment variables (server-only variables: mark as **Server** only)
7. Deploy

Vercel Cron is configured in `apps/web/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/internal/cron/daily-summary",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/internal/cron/reconcile-onboarding",
      "schedule": "30 7 * * *"
    }
  ]
}
```

Both crons authenticate with `Authorization: Bearer ${CRON_SECRET}`. After
a production deploy, confirm both appear under Vercel → `pheno-sage-web` →
Settings → Cron Jobs (the Hobby plan caps projects at two cron jobs, so
both slots are in use).

---

## Railway Setup

1. Create a new Railway project
2. Add a service from GitHub → select the repo → set root directory to `apps/analysis`
3. Railway will detect the `Dockerfile` automatically
4. Add all environment variables (see table above)
5. Set `ANALYSIS_SERVICE_API_KEY` to a strong random secret
6. **Healthcheck path: `/ready`** (not `/health`). `/ready` is config-aware
   — it returns 503 when required environment is missing, so Railway will
   refuse to promote a deploy with broken configuration. `/health` is a
   liveness probe only and returns 200 even when downstream config is
   incomplete.
7. Copy the Railway public URL → set as `ANALYSIS_SERVICE_URL` in Vercel
8. Deploy

---

## Container Images

The repository includes root-level Dockerfiles for CI and operators who need to
run the same images outside Vercel/Railway:

```bash
docker build -f Dockerfile.web -t phenosage-web:local .
docker build -f Dockerfile.analysis -t phenosage-analysis:local .
POSTGRES_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')" \
  READINESS_PROBE_SECRET=dev-readiness-secret \
  docker compose -f docker-compose.ci.yml up --build
```

`docker-compose.ci.yml` starts a pgvector-enabled Postgres service, the FastAPI
analysis container, and the Next.js web container. Health checks use
`READINESS_PROBE_SECRET` against `apps/analysis` `/ready` and `apps/web`
`/api/internal/ready`; keep that value server-only in production.

The async analysis enqueue RPC lives in `supabase/migrations/005_analysis_jobs.sql`.
`enqueue_analysis_job(...)` is service-role-only, idempotent when an
`idempotency_key` is supplied, and writes rows that authenticated users can read
through the `analysis_jobs: grow member read` RLS policy.

---

## Reliability: Error Envelopes, Retries, and Circuit Breaker

Every `apps/web` JSON API route returns errors in a single envelope so the
browser can render them uniformly without ever seeing raw upstream text:

```json
{
  "error": {
    "code": "UPSTREAM_UNAVAILABLE",
    "message": "Analysis service is temporarily unavailable.",
    "requestId": "9e2658fe-b81b-4c56-aae8-573bfe8c67d0"
  }
}
```

`code` is a stable enum (`apps/web/src/lib/server/api-errors.ts`). Pair the
client-visible `requestId` with `x-request-id` in the response headers and
the structured server logs (look for `requestId` in the JSON log lines) to
trace a single user-reported failure end-to-end. When the upstream sends
`Retry-After`, it is forwarded as `Retry-After` on the envelope response.

### Retry policy

`apps/web/src/lib/server/resilience.ts` is the single retry/timeout policy
used by every upstream call:

- Per-attempt deadline (`AbortSignal.timeout(timeoutMs)`).
- Full-jitter exponential backoff:
  `delay = random(0, min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)))`.
- Honours `Retry-After` from the upstream when present.
- Retries **only** transient transport errors and the configured retryable
  HTTP statuses (`408`, `429`, `500`, `502`, `503`, `504`).
- Never retries `400`, `401`, `403`, `404`, `409`, validation errors, or
  configuration errors.
- `maxAttempts > 1` requires the call to be naturally idempotent or carry
  an `idempotencyKey`. Calling the helper otherwise throws a programmer
  error, by design — silent duplicate side effects on the upstream are
  worse than a loud failure.

Direct analysis-service `POST /analyze` calls are retried up to 2 attempts by
the server-only proxy when used by background workers because
`runAndPersistPlantAnalysis` upserts on `plant_analyses.image_id`
(uniqueness enforced by migration 004) and replaces findings by `image_id`
in a single transaction — a retried call cannot create duplicate rows.

### Circuit breaker

`apps/web/src/lib/server/circuit-breaker.ts` wraps the analysis-service
proxy. It opens after 5 failures within 60s, then fails fast with
`UPSTREAM_UNAVAILABLE` for a 30s cooldown before allowing a single probe.
**Limitation**: state is in-memory per Vercel function instance — a cold
start resets the breaker. This is acceptable for the MVP hardening tier
because it still protects a warm instance from amplifying a request burst
against a known-bad upstream. Lifting the breaker into Redis is tracked
separately.

### Analysis fallback semantics

The analysis service distinguishes two failure classes (see
`apps/analysis/app/errors.py`):

- **Expected dependency failures** (`StorageUnavailable`, `ModelUnavailable`,
  `ModelRateLimited`, `ModelBadResponse`, `ConfigurationError`) trigger a
  **non-diagnostic fallback response** with `is_fallback=true` and a
  stable `fallback_reason` code (e.g. `"STORAGE_UNAVAILABLE"`). The reason
  codes are part of the API contract — they are safe to log and surface in
  diagnostics.
- **Unexpected programmer errors** (e.g. `TypeError`, `AttributeError`)
  intentionally propagate. The plant-health output discipline forbids
  re-skinning a bug as a confident inconclusive diagnosis — see
  `.github/copilot-instructions.md` §9.

Typed errors are mapped to a safe JSON envelope by the FastAPI exception
handler in `apps/analysis/app/main.py`:

```json
{
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "The analysis model is temporarily unavailable.",
    "request_id": "..."
  },
  "retryable": true
}
```

---

## Observability — Distributed traces

`apps/web/instrumentation.ts` registers `@vercel/otel` at boot. When
`ANALYSIS_SERVICE_URL` is set, the registration wires Next.js's underlying
OpenTelemetry runtime so any outgoing `fetch()` call to the analysis service
carries a W3C `traceparent` header. The analysis service already reads
`traceparent` (`apps/analysis/app/telemetry.py`) and continues the same trace,
so a single user request shows as one trace tree across both platforms in any
OTLP-compatible backend (Honeycomb, Tempo, Vercel's own runtime trace viewer,
etc).

Configuration:

- **Production**: nothing to do — registration auto-fires because
  `ANALYSIS_SERVICE_URL` is required. To export traces somewhere other than
  Vercel's default sink, set `OTEL_EXPORTER_OTLP_ENDPOINT` on the project.
- **Local dev**: `OTEL_ENABLED=true` force-registers OTel even without
  `ANALYSIS_SERVICE_URL` so an operator can validate spans against a local
  OTLP collector.
- **Sentry coexistence**: the file initializes OTel first, then Sentry if
  `SENTRY_DSN` is set. `@sentry/nextjs` v8+ composes with `@vercel/otel`
  cleanly — Sentry attaches as a span processor instead of replacing the
  TracerProvider.

If `@vercel/otel` is absent (e.g. the package was removed by an audit), the
instrumentation hook logs a `warn — web OTel register skipped` line and the
app continues to boot. Traces just stop crossing the Vercel ↔ Railway
boundary in that case.

Docs (as of 2026-05-21):

- [Vercel OTel instrumentation](https://vercel.com/docs/tracing/instrumentation)
- [Next.js instrumentation hook](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation)

---

## Smoke Checks

After every preview / production deploy, run:

```bash
PHENOSAGE_BASE_URL=https://your-preview.vercel.app pnpm run smoke:preview
```

`scripts/smoke-preview.mjs` verifies:

- `GET /api/healthz` returns 200 JSON with `status="ok"`.
- `POST /api/chat` and `POST /api/uploads/sign` without auth return a
  **structured 401 JSON** envelope with `x-request-id` (not an HTML 500).
- Malformed JSON requests return a structured 400/401, never an HTML
  error page.
- No response body contains forbidden substrings: `fetch failed`, raw env
  var names (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
  `GEMINI_API_KEY`, `ANALYSIS_SERVICE_API_KEY`), signed Supabase storage
  URL paths, or stack-trace fragments.

Exit code 0 on success, 1 on any failure — wire it into your deploy
promotion gate.

---

## Supabase Setup

1. Create a new Supabase project
2. Connect local tooling:

   **MCP (repo-scoped).** `.mcp.json` is already checked in with:

   ```json
   {
     "mcpServers": {
       "supabase": {
         "type": "http",
         "url": "https://mcp.supabase.com/mcp?project_ref=yjemotnclrnlxgcfntaf"
       }
     }
   }
   ```

   The first MCP use still requires completing the Supabase OAuth consent
   flow in your agent. That consent is what grants read/write scopes; do not
   commit service-role keys or database passwords into `.mcp.json`.

   **CLI / direct Postgres.** Copy the root `.env.example` and set:
   - `SUPABASE_PROJECT_REF=yjemotnclrnlxgcfntaf`
   - `SUPABASE_DB_PASSWORD=<database-password>`
   - `SUPABASE_DB_URL=postgresql://postgres:<password>@db.yjemotnclrnlxgcfntaf.supabase.co:5432/postgres`

   Use the direct `db.<ref>.supabase.co:5432` URL for admin sessions,
   migration recovery, and other non-browser operations. If you are on an
   IPv4-only network, switch to the Supabase session pooler URL instead.

3. Run migrations. Two paths:

   **From GitHub Actions (recommended for production).** The
   [`Database migrations`](../.github/workflows/db-migrations.yml)
   workflow applies pending migrations via `workflow_dispatch` so any
   maintainer can ship them with one click without installing the
   Supabase CLI locally. It defaults to dry-run; flip the `dry_run`
   input to `false` to actually apply. Requires three repo secrets:
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and
   `SUPABASE_DB_PASSWORD`. Failures open a tracking issue
   automatically.

   **From a workstation (initial bring-up or recovery).**

   ```bash
   supabase login
   supabase link --project-ref "$SUPABASE_PROJECT_REF"
   supabase db push
   ```

4. In Supabase Storage → create bucket `plant-images` (private)
5. Enable Email Auth (or your preferred provider) in Supabase Auth settings
6. **Enable leaked-password protection.** Dashboard → Project Settings →
   Auth → Password Strength → toggle **HaveIBeenPwned compromise check**
   on. This is a Supabase-managed setting (no SQL knob exposed), so the
   `Database migrations` workflow can't apply it — it's a one-click
   manual step per project. Without it, `get_advisors` keeps reporting
   `auth_leaked_password_protection`.
7. Copy the project URL and keys to Vercel environment variables

---

## Local Development

```bash
# Install all workspace dependencies
pnpm install

# Copy env files
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
cp apps/analysis/.env.example apps/analysis/.env

# Start web app
pnpm --filter web dev

# Start analysis service (separate terminal)
cd apps/analysis
pip install -r requirements.txt
uvicorn app.main:app --reload

# Or with Docker
cd apps/analysis
docker build -t phenosage-analysis .
docker run -p 8000:8000 --env-file .env phenosage-analysis
```

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR:

- **Web**: type-check, lint, test, build
- **Analysis**: ruff lint, mypy type-check, pytest
- **Shared**: type-check

### Required status checks for `main`

The following PR-level checks should be marked as **required** in branch
protection so a PR cannot merge unless they pass. Branch protection cannot be
configured from code — an operator must set this in repo Settings.

- `CI / *` (existing build/lint/test matrix from `ci.yml`)
- `CodeQL`
- `Gitleaks / Secret scan`
- `Pre-deploy checklist / Verify` — enforces the PR template's
  **Validation**, **Architecture & Forbidden Changes**, and **Rollback**
  checklists. Skipped automatically for draft PRs and for PRs labelled
  `guardian:approved`. Source: `.github/workflows/pre-deploy-checklist.yml`
  (parser: `scripts/check-pr-checklist.mjs`).

**How to mark the checklist gate as required** (operator action):

1. GitHub → repo → Settings → Branches → `main` rule.
2. Tick **Require status checks to pass before merging**.
3. Search for `Pre-deploy checklist` and add the **Verify** check.
4. Save. The check now blocks merge for non-draft, non-waived PRs whose
   bodies do not have all required checklist items ticked.

## Production deploy lifecycle

Every push to `main` triggers Vercel to build and deploy production. The
following workflows then fire automatically:

1. **`post-deploy-smoke.yml`** — runs `scripts/smoke-test-prod.ps1`
   against the new deployment. On failure it:
   - Auto-rolls-back to the previous successful production deploy via
     Vercel's promote API (requires `VERCEL_TOKEN` +
     `VERCEL_PROJECT_ID` secrets).
   - Opens a GitHub issue with the bad SHA + rollback receipt.
   - Posts to Discord (requires `DISCORD_WEBHOOK_URL` secret).
2. **`release-on-prod-deploy.yml`** — tags the deployed SHA as
   `vYYYY.MM.DD-N` and creates a GitHub Release with auto-generated
   notes (PRs merged since the previous tag).

### Required GitHub secrets

| Secret                     | Purpose                                                         | How to get it                                                                                       |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`             | Auto-rollback can call the promote API.                         | Vercel → Account Settings → Tokens → Create (full scope, or scoped to the `pheno-sage-web` project) |
| `VERCEL_PROJECT_ID`        | Identifies the project for the promote call.                    | `prj_XtNTJz3FT3PGokPxlyE3bm5XHp2V` (visible in any deployment metadata)                             |
| `VERCEL_TEAM_ID`           | Team scope for the promote call.                                | `team_1jHeAEF8oKm2Z46fqRMdu5uL`                                                                     |
| `DISCORD_WEBHOOK_URL`      | Channel webhook for ✅ / 🚨 deploy alerts.                      | Discord channel → Edit Channel → Integrations → Webhooks → Copy URL                                 |
| `VERCEL_PROTECTION_BYPASS` | Optional — lets smoke reach pages behind Deployment Protection. | Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation → Add        |

All five listed secrets, including `VERCEL_PROTECTION_BYPASS`, are safe
to leave unset — any workflow that depends on one will skip that step and
log a warning instead of failing the deploy.

### Enabling Vercel Rolling Releases (operator action)

Rolling Releases gradually shift traffic from the previous production
deploy to the new one (e.g. 5% → 25% → 100%) instead of cutting over
instantly. A bad deploy then affects only the canary cohort, and you
can use Vercel's built-in **Instant Rollback** to revert before more
users hit it.

**Status as of 2026-05-21: documented but not flipped on.** This is the
last open item from the May 2026 deployment best-practices review.
The phase-1 auto-rollback path in `.github/workflows/post-deploy-smoke.yml`
already calls Vercel's promote API on failure, so enabling Rolling Releases
narrows the blast radius of any deploy that slips past smoke.

To enable:

1. Vercel → `pheno-sage-web` → Settings → Rolling Releases → Enable.
2. Start with a single stage: **5% canary for 10 min, then 100%**.
3. In **Settings → General**, confirm **Skew Protection** is on
   (Next 14.1.4+ enables it for free; double-check the toggle is on
   for this project). Without it, an in-flight `/api/...` request from
   a canary client can land on the previous deploy and fail because
   chunk hashes don't match.
4. Over time, layer Speed Insights / Sentry comparisons into the
   promotion gate (see `docs/runbooks/slo.md` for the SLO numbers
   that should drive auto-promote vs auto-rollback decisions).

Docs (as of 2026-05-21):

- [Vercel Rolling Releases](https://vercel.com/docs/rolling-releases)
- [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)
- [Vercel Skew Protection](https://vercel.com/docs/skew-protection)

## Pre-deploy readiness

Preview and production deploys should be considered ready only after `/api/ready` on the web app and `/ready` on the analysis service both return healthy responses with the expected request IDs in headers.

Run the repo-level readiness check before the authenticated smoke so missing
server env is caught immediately:

```bash
pnpm run check:ready -- --url https://phenosage-<deployment>.vercel.app
```

For a Vercel-protected preview, pass a full `/api/ready` URL that already
includes your bypass or share query string instead of a bare base URL.

If this fails on `ANALYSIS_SERVICE_API_KEY`, `SUPABASE_*`, or other server env,
stop there and fix the deployment environment first. The authenticated smoke is
meant to validate the functional slice after the deployment is actually ready,
not to diagnose a broken env contract.

For a higher-signal preview check, run the authenticated Playwright smoke in
`apps/web/e2e/authenticated-workspace.spec.ts`. It seeds a temporary user,
grow, and plant via the Supabase service role, signs in through `/auth`,
uploads a test image, verifies persisted analysis through
`/api/plants/[plantId]/analysis/latest` and `/timeline`, then confirms
grounded chat thread/message persistence.

Example:

```bash
E2E_BASE_URL=https://phenosage-<hash>-stevenschling13.vercel.app \
E2E_SKIP_WEBSERVER=1 \
E2E_AUTH_SMOKE=1 \
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role> \
pnpm --filter web test:e2e
```
