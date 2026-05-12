# Rate-limit runbook

PhenoSage uses a sliding-window limiter on every user-facing API route.
The implementation lives in `apps/web/src/lib/server/rate-limit.ts` and
is consumed by:

| Route                                | Limit     | Window |
| ------------------------------------ | --------- | ------ |
| `POST /api/chat`                     | 20 / user | 1 min  |
| `POST /api/uploads/sign`             | 10 / user | 1 min  |
| `POST /api/plants/[plantId]/images`  | 10 / user | 1 min  |
| `POST /api/plants/[plantId]/analyze` | 5 / user  | 1 min  |

## Backends

1. **Upstash Redis (production).** Activated when both
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set in the
   Vercel environment. Cross-instance, the only mode safe for production.
2. **In-memory (dev / fallback).** Activated when either env var is
   missing. Per-instance map. On Vercel this means the effective limit is
   roughly `limit × N_instances` and is **not** safe for production.

On boot the limiter logs one structured event:

- `rate-limit using in-memory fallback` — Upstash env not set.
- `rate-limit distributed init failed` — `@upstash/*` import or Redis
  client construction threw.

## Failure mode: Redis unreachable

If a `limit()` call to Upstash throws (network blip, Upstash incident),
the limiter **fails open**: the request is allowed and a single warn log
is emitted with the offending key:

```
{ "level": "warn", "msg": "rate-limit distributed call failed; failing open", "key": "u:..." }
```

Failing closed would convert a Redis outage into a complete user-visible
outage of every rate-limited endpoint, which is worse than a temporary
loss of enforcement. The on-call signal is the warn log spike, not user
errors.

## Symptoms → first checks

| Symptom                                                | First check                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Users complaining about 429s                           | Check Sentry for `Too many … requests` — confirm vs the per-route table above.       |
| 429 floods after a marketing push                      | Expected. If sustained, raise the per-route `limit` in the relevant route handler.   |
| Warn-log spike `rate-limit distributed call failed`    | Upstash incident. Status: <https://status.upstash.com>. Limiter is failing open.     |
| Warn log `rate-limit using in-memory fallback` in prod | `UPSTASH_REDIS_REST_URL` / `_TOKEN` missing in Vercel env. Add and redeploy.         |
| Single user appears to bypass limits                   | Check whether they are unauthenticated — anon traffic is keyed by `x-forwarded-for`. |

## Rotating the Upstash credential

1. Create a new REST token in the Upstash console.
2. Update `UPSTASH_REDIS_REST_TOKEN` in Vercel (production + preview).
3. Trigger a redeploy (`vercel --prod` or push an empty commit).
4. Revoke the old token in Upstash once the deploy is healthy.

The limiter caches the constructed Upstash client per process, so a
redeploy is required for the new token to take effect.

## Local development

Leave `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` blank in
`.env.local`. The in-memory fallback is correct for single-process
`next dev`.

## Tests

`apps/web/src/lib/server/__tests__/rate-limit.test.ts` covers:

- In-memory enforcement, sliding window, isolation between keys.
- Distributed-mode delegation to a mocked Upstash client.
- Distributed-mode fail-open behaviour when the Upstash call rejects.
