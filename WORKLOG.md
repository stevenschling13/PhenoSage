# WORKLOG

Handoff log between sessions. Keep entries short. Newest at top.

---

## 2026-04-19 — End-to-end vertical slice (Claude Opus 4.7)

**Landed on `claude/complete-core-loop-6tDQM`**

- `feat(upload)` — `POST /api/uploads/sign` issues Supabase signed upload URLs
  scoped to `{growId}/{plantId}/…`, strict MIME allowlist, UUID validation.
- `feat(images)` — `POST /api/plants/:id/images` verifies the uploaded object
  exists in Storage before persisting the `plant_images` row.
- `feat(analyze)` — real FastAPI proxy w/ snake_case wire contract and
  camelCase response mapping; `POST /api/plants/:id/analyze` persists
  `plant_analyses` + `plant_findings`; optional previous-image comparison.
- `feat(analysis-service)` — OpenAI Vision (`gpt-4o`) with fallback on storage
  or vision failure; blended score; structured access logging and correlation
  ID middleware.
- `feat(ui)` — `/plants/[id]` server page renders photo grid with signed URLs,
  latest analysis card, findings list; client `PhotoUploader` drives the full
  sign → upload → register → analyze flow.
- `feat(chat)` — `POST /api/chat` loads grow + plants + recent findings via
  service role, persists `chat_threads` + `chat_messages`, returns grounded
  assistant reply; `/assistant` rendered as working client chat UI.
- `feat(observability)` — `apps/web/instrumentation.ts` with optional Sentry
  - stderr fallback; `correlationIdFromRequest` + `createLogger` threaded
    through every mutating route; `x-request-id` round-tripped to FastAPI.
- `feat(db)` — migration `002_plant_analyses.sql` adds analysis-history table
  with member-read RLS and supporting indexes.
- `test` — added vitest coverage for uploads/sign, plants/images, analyze,
  timeline, analysis/latest, chat, analysis-proxy; new pytest coverage for
  the vision + comparison services.
- `docs(env)` — `apps/web/.env.example` now matches the root contract
  (NEXT_PUBLIC_APP_ENV, CRON_SECRET, SENTRY_DSN, LOG_LEVEL).

**Known-unblocked follow-ups**

- Stream assistant replies — current `/api/chat` waits for the full completion
  before responding; streaming would improve perceived latency.
- Daily-summary cron (`/api/internal/cron/daily-summary`) is still a no-op
  stub with auth + request-ID logging.
- `/ready` remains env-only; a deeper probe (Supabase + analysis service
  reachability) would catch credential drift earlier.

---

## 2026-04-18 — Production-hardening sweep (Claude Opus 4.7)

**Landed on `main`**

- `build(tooling)` — Turbo, Prettier, Husky, commitlint, tsconfig.base
- `test` — Vitest (web+shared), Playwright scaffolding, pytest-cov
- `ci` — parallel jobs, harden-runner, bundle size, route security audit
- `feat(observability)` — `/ready` endpoints, telemetry bootstrap, `useServiceHealth`
- `feat(security)` — CSP, env validator, rate limiter, security-audit script
- `chore(claude)` — 10 skills, 2 hooks, contract-guardian agent, 2 commands
- `docs` — CLAUDE.md, AGENTS.md, CHANGELOG.md, this file, runbooks
- `feat(pr-guardian)` — file/line caps + PR template revision

**Known-unblocked follow-ups**

- Playwright: `@playwright/test` not installed; wire into CI after a deliberate
  browser-install step (adds ~200MB to CI cache).
- Sentry DSN not yet provisioned — `SENTRY_DSN` is read at boot, so the moment
  DSNs land in Vercel + Railway env, error reporting starts without a deploy.
- `format:check` is advisory in CI — flip to hard once the tree is fully
  Prettier-formatted (the pre-commit hook keeps new files in line).
- `pnpm audit` wired into `scripts/security-audit.mjs` — currently 2 moderate
  advisories on `main` per GitHub Dependabot; review and patch.

**Dead ends (don't repeat)**

- `exactOptionalPropertyTypes: true` at the base TS config breaks
  `fetch(..., { body: undefined })` patterns. Fix is to build the `RequestInit`
  imperatively (see `apps/web/src/lib/server/analysis-proxy.ts:22`).
- Husky v9 deprecates the `#!/usr/bin/env sh` + `source husky.sh` preamble.
  Hooks are now single-line commands (`.husky/pre-commit`, `.husky/commit-msg`).
- `asyncio_mode = "auto"` conflicts with existing explicit `@pytest.mark.asyncio`
  markers in `apps/analysis/tests`. Kept `strict`.

**Next session should…**

1. Trigger a Vercel prod redeploy (push to `main` above already did) and
   verify `/api/health` + `/api/ready` return 200.
2. Redeploy Railway analysis and verify `/health` + `/ready`.
3. Open a throwaway PR to confirm `ci-status` job + PR template work.
4. If Sentry is desired, create project via Sentry MCP and drop DSNs into
   Vercel / Railway env. No code change required.
