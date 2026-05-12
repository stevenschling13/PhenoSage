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
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
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
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
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
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  SUPABASE_SERVICE_ROLE_KEY=<service-role> \
  pnpm --filter web test:e2e
```

## Run in CI

`.github/workflows/e2e-preview.yml` runs this spec automatically against every
successful Vercel **Preview** deploy. It is self-gating: if the test secrets
listed below are not set on the repository, the job exits cleanly without
failing, so adding the workflow is safe before secrets are provisioned.

The CI secrets use an `E2E_` prefix so they stay clearly separate from any
production-named secrets that might exist on the repo; the workflow maps each
one onto the `NEXT_PUBLIC_*` / `SUPABASE_*` env vars the Playwright helper
reads at test time.

Required GitHub repository secrets (Settings → Secrets and variables → Actions):

| Secret                                  | What it is                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_SUPABASE_URL`                      | A **non-production** Supabase project URL used only for smoke runs.                                                                            |
| `E2E_SUPABASE_ANON_KEY`                 | The same project's publishable anon key.                                                                                                       |
| `E2E_SUPABASE_SERVICE_ROLE_KEY`         | The same project's service role key. **NEVER point this at the production project** — the helper creates real auth users and writes real rows. |
| `VERCEL_PROTECTION_BYPASS` _(optional)_ | `x-vercel-protection-bypass` token if previews are gated by Vercel Deployment Protection / SSO.                                                |

The workflow can also be triggered manually via **Actions → E2E — Preview →
Run workflow** with a `target_url` input, useful for re-running against a
preview after fixing a flake.

Failed runs upload the Playwright HTML report as the artifact
`playwright-report-<run_id>` (retained 14 days) and post a single comment on
the associated PR with the run + artifact link.
