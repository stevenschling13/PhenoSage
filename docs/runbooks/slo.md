# Service Level Objectives — PhenoSage

The numbers below define what "healthy" means in production. They exist
so post-deploy smoke can fail / auto-rollback on an objective threshold
instead of vibes, and so on-call has a clear bar for "is this an
incident?".

> Solo-maintainer reality check: SLOs aren't there to punish missed
> targets. They're a forcing function for asking "did this deploy make
> things worse?" and a tripwire for catching slow regressions before
> users do.

## Availability — `99.5%` monthly

The browser must be able to load the dashboard and act on it. Measured
across:

- `GET /` — landing page renders 200 (public).
- `GET /api/health` — returns 200 with `{ status: "ok" }`.
- `GET /api/ready` — returns 200 with `status: "ok"` (deeper check
  that Supabase, the analysis service, and required env are reachable).

A request that completes with a 4xx that the user _caused_ (e.g. 401
because they're logged out) does not count against availability. A 5xx
or a timeout does.

99.5% over 30 days = budget of **~3h 36m** of unavailability per month.
If that budget is exhausted, the next deploy goes through a heavier
pre-merge gate (manual approval + explicit "I read the failing-deploy
post-mortem" checkbox).

## Latency — `p95 < 1.2s` server response

Measured via Vercel Speed Insights on the production deployment.
Server response time only (TTFB), not full page load, since asset
delivery is dominated by the CDN.

If the p95 server response time for `/dashboard`, `/grows`, or
`/grows/[id]` rises above 1.2 s over a 24h window, treat it as a
latency regression — open an issue and bisect.

Mobile users on 5G should not experience > 2.5s LCP on any (app)
surface. This is the Core Web Vitals "good" threshold per Google.

## Error rate — `< 1%` of authenticated requests

A request is an "error" if:

- The server returns 5xx.
- A Server Component throws, surfacing as `(app)/error.tsx` or a
  route-specific boundary.
- A client component throws during hydration, caught by the same
  boundaries (these don't carry a server-side digest — see PR #182).

Measured via Vercel runtime logs + Sentry (when configured). A bad
deploy that immediately spikes errors past 1% should auto-rollback —
see `post-deploy-smoke.yml`.

## Deploy reliability — `change failure rate < 15%`

> A failed deployment is one where the production smoke step fails or
> a hotfix has to ship within 6 hours of the deploy.

DORA categorises 0-15% CFR as **elite** for small teams. This is the
metric to push down over time. The `track-followups.yml` workflow can
post the rolling 30-day number to a CHANGELOG block weekly once Phase 2
ships.

## Recovery — `< 15 min` MTTR for SEV-1 / SEV-2

If `/api/health` is failing or auth is broken, the rollback path
should be under 15 minutes from "I'm aware" to "production is healthy
again". With the auto-rollback step in `post-deploy-smoke.yml`, the
common case is now sub-minute — the long pole is the operator noticing
the Discord alert.

See `docs/runbooks/rollback.md` for the manual procedure when
auto-rollback didn't fire.

## What we don't promise

- **Realtime updates have no SLO.** The `useLiveAnalysis` hook fails
  open — if Supabase Realtime is unreachable, the dashboard still
  renders but no longer auto-refreshes. The user can refresh manually.
- **Daily summary cron has no SLO.** If the cron misses a day, the
  user notices the missing email but no other surface degrades. This
  is intentional — we don't page anyone over a missed digest.
- **Analysis service availability is decoupled.** The web app stays up
  even if Railway is down; analysis requests degrade per the Sentry
  hooks in `analysis-proxy.ts`. SEV-2 not SEV-1.

## Where to look

- Vercel Speed Insights (latency, error rate).
- Vercel runtime logs (error counts per route).
- Supabase project metrics (RLS denials, slow queries).
- Sentry (client + server exceptions, once the DSN is set).
- `docs/runbooks/on-call.md` for daily 60-second check.

## Changing these numbers

SLO changes require a PR. Don't tune them down to make the dashboard
look green — that defeats the point. If a target is consistently
missed, fix the underlying issue or document why the target was wrong
in the first place.
