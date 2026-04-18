# PhenoSage — Playwright E2E

Golden-path browser tests. Runs against a local Next.js dev server by default;
set `E2E_BASE_URL` to target a Vercel preview.

## Run locally

```bash
pnpm --filter web exec playwright install --with-deps
pnpm --filter web test:e2e
```

## Run against a preview

```bash
E2E_BASE_URL=https://phenosage-<hash>-stevenschling13.vercel.app \
  E2E_SKIP_WEBSERVER=1 \
  pnpm --filter web test:e2e
```
