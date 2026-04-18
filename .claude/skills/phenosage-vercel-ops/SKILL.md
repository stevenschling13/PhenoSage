---
name: phenosage-vercel-ops
description: Deploy, roll back, and inspect the PhenoSage web app on Vercel. Use when a deploy fails, a preview needs triage, or env vars need to be synced.
---

# phenosage-vercel-ops

## Preview deploy

```bash
vercel pull --environment=preview
vercel deploy
```

Every PR automatically gets a preview URL via the Vercel GitHub integration — prefer that over manual deploys.

## Production deploy

Production deploys happen automatically on push to `main`. Manual override:

```bash
vercel deploy --prod
```

## Rollback

1. `vercel ls` — find the previous healthy deployment hash.
2. `vercel promote <url>` — promote that deployment to production.
3. Run `scripts/smoke-test-prod.ps1` (or the equivalent bash) against the new URL.

## Env sync

```bash
# list
vercel env ls production
# add
vercel env add <NAME> production
# pull into .env.local for local dev against the real vars
vercel env pull .env.local
```

Every server-only env (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANALYSIS_SERVICE_*`, `CRON_SECRET`, `SENTRY_*`) must exist in Production. `NEXT_PUBLIC_*` vars must exist in all three (development/preview/production).

## Build log triage

- `Function size exceeded` → check `apps/web/next.config.mjs` for stray dep inclusion; review `packages/shared` for bundled-in JSON.
- `Middleware not allowed` → we deliberately have no `middleware.ts`. Check `scripts/check-route-boundaries.mjs`.
- CSP violations in the browser console → adjust `buildCSP()` in `apps/web/next.config.mjs`.
