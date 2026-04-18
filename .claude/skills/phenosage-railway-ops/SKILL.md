---
name: phenosage-railway-ops
description: Deploy and operate the analysis service on Railway — logs, restarts, env sync. Use when the FastAPI service is unhealthy, slow, or rejecting requests.
---

# phenosage-railway-ops

The analysis service (`apps/analysis`) is a FastAPI app deployed to Railway from the monorepo root with `railway.toml`.

## Deploy

Push to `main` triggers a Railway redeploy via the GitHub integration.

Manual:

```bash
railway up --service phenosage-analysis
```

## Health

```bash
curl -fsS "$ANALYSIS_SERVICE_URL/health"
curl -fsS "$ANALYSIS_SERVICE_URL/ready" | jq .
```

`/ready` returns 503 if `OPENAI_API_KEY`, `SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` is missing — that's the platform's signal to drain the instance.

## Logs

```bash
railway logs --service phenosage-analysis --deployment latest
railway logs --service phenosage-analysis -n 200
```

## Env sync

```bash
railway variables
railway variables --set OPENAI_API_KEY=<value>
```

Required: `ANALYSIS_SERVICE_API_KEY` (shared with Vercel), `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS=https://<vercel-prod-url>`.

## Restart

```bash
railway restart --service phenosage-analysis
```

## Rollback

Use the Railway dashboard → Deployments → redeploy a previous successful build. Railway does not expose a stable CLI rollback as of this writing.
