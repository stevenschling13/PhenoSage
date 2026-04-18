# CLAUDE.md

AI entry point for anyone — Claude, Copilot, human — working on PhenoSage.
Keep this short. Long context lives in `docs/`.

## What PhenoSage is

Plant-health AI for cannabis cultivators. Four capabilities:

1. **Visual doctor** — analyze a plant photo, return findings + recommendations.
2. **Longitudinal intelligence** — compare images over time, detect trends.
3. **Chat** — LLM grounded in the grower's findings and grow log.
4. **Alerts** — a daily cron aggregates new findings into a summary.

## Architecture (one screen)

```
browser ──► apps/web (Next.js 15, Vercel)
              │
              ├─► Supabase (auth, Postgres + RLS, Storage w/ signed URLs)
              │
              └─► apps/analysis (FastAPI, Railway) ──► OpenAI
```

- Browser **never** calls Railway or Supabase service-role APIs directly.
- All outbound AI / analysis traffic goes through `apps/web/src/app/api/**` Route Handlers.
- Shared contracts: `packages/shared/src/types.ts` (TS) ↔ `apps/analysis/app/models/**` (pydantic).

## Ports + commands

| What                    | Command                                                                   | Port |
| ----------------------- | ------------------------------------------------------------------------- | ---- |
| Web (dev)               | `pnpm --filter web dev`                                                   | 3000 |
| Analysis (dev)          | `cd apps/analysis && uvicorn app.main:app --reload`                       | 8000 |
| All tests               | `pnpm turbo run test`                                                     | —    |
| Type-check + lint       | `pnpm turbo run type-check lint`                                          | —    |
| Validate guardrails     | `pnpm run validate`                                                       | —    |
| Route security audit    | `pnpm run security:routes`                                                | —    |
| E2E (requires browsers) | `pnpm --filter web exec playwright install && pnpm --filter web test:e2e` | —    |

## Environment

Source of truth: `.env.example`. Validator: `scripts/check-env-contract.mjs` + `apps/web/src/lib/env.ts`.

Server-only (never expose to browser): `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANALYSIS_SERVICE_URL`, `ANALYSIS_SERVICE_API_KEY`, `CRON_SECRET`, `SENTRY_AUTH_TOKEN`.

Public (prefix `NEXT_PUBLIC_`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`.

## Sensitive paths — touch with care

Any edit here requires `pnpm run validate && pnpm turbo run test`:

- `supabase/migrations/**` — **frozen**; only add new numbered files.
- `packages/shared/src/**` — breaking changes ripple to web + analysis.
- `apps/web/src/lib/server/**` — server-only modules; must not be imported by client code.
- `apps/web/next.config.mjs` — CSP + security headers.
- `apps/web/src/lib/env.ts` + `scripts/check-env-contract.mjs` — env contract.
- `apps/analysis/app/routers/**` + `apps/analysis/app/models/**` — API contract.
- `.github/workflows/**`, `railway.toml`, `apps/web/vercel.json` — deploy config.
- `.claude/**` — AI tooling.

## Non-negotiable rules

See `.github/copilot-instructions.md` for the full list; the load-bearing ones:

1. Don't add a `middleware.ts` to `apps/web`. The boundary lives in Route Handlers.
2. Don't call the analysis service from a client component. Always go through `apps/web/src/lib/server/analysis-proxy.ts`.
3. Don't put a secret in a `NEXT_PUBLIC_*` var.
4. Don't edit existing migrations. Add new ones.
5. Never disable RLS to "debug". Copy rows with the service role, inspect off-line.

## Next steps for a new session

1. Open `WORKLOG.md` — last-session context is there.
2. Run `/phenosage-morning-ops` (slash command) for a CI + deploy briefing.
3. If the task touches a sensitive path, spawn the `contract-guardian` agent first.

## Cross-links

- `.github/copilot-instructions.md` — canonical non-negotiable rules
- `AGENTS.md` — universal agent playbook (this file's cousin)
- `docs/supabase-guide.md` — Supabase operations
- `docs/deployment.md` — Vercel + Railway deploy details
- `docs/roadmap.md` — product direction
- `docs/product-spec.md` — feature scope
- `docs/playbooks/contract-safe-change-playbook.md` — how to evolve a contract
- `docs/runbooks/` — incident / rollback / on-call
