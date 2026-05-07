# PhenoSage — Playwright E2E

Golden-path browser tests. Runs against a local Next.js dev server by default;
set `E2E_BASE_URL` to target a Vercel preview.

## Run locally

```bash
pnpm --filter web exec playwright install --with-deps
pnpm --filter web test:e2e
```

## Run the authenticated persistence smoke

This seeded smoke path creates a temporary Supabase user, grow, and plant with
the service role, signs in through the real auth page, uploads a test image,
verifies `/api/plants/[plantId]/analyze`, `/analysis/latest`, `/timeline`, and
confirms grounded chat thread/message persistence.

Required environment:

- `E2E_AUTH_SMOKE=1`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Before running this against a preview or production deployment, verify the app
is actually ready:

```bash
pnpm run check:ready -- --url https://phenosage-<deployment>.vercel.app
```

For a Vercel-protected preview, pass a full `/api/ready` URL that already
includes the bypass or share query string instead of a bare deployment URL.

If `/api/ready` reports missing server env such as
`ANALYSIS_SERVICE_API_KEY`, stop there and fix the deployment environment
first. The authenticated smoke should validate persistence and grounded flows,
not discover a broken runtime contract.

The target app must already have its normal auth/runtime env configured
correctly, including the public Supabase keys and OpenAI where applicable.

```bash
E2E_AUTH_SMOKE=1 \
  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role> \
  pnpm --filter web test:e2e
```

## Run against a preview

```bash
E2E_BASE_URL=https://phenosage-<hash>-stevenschling13.vercel.app \
  E2E_SKIP_WEBSERVER=1 \
  pnpm --filter web test:e2e
```

Authenticated preview smoke:

```bash
E2E_BASE_URL=https://phenosage-<hash>-stevenschling13.vercel.app \
  E2E_SKIP_WEBSERVER=1 \
  E2E_AUTH_SMOKE=1 \
  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role> \
  pnpm --filter web test:e2e
```
