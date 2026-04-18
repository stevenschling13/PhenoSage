# PhenoSage — Deployment Guide

---

## Services Overview

| Service | Platform | Purpose |
|---|---|---|
| `apps/web` | Vercel | Next.js web app — the only public origin |
| `apps/analysis` | Railway | FastAPI analysis service — private, never browser-callable |
| Database | Supabase (Postgres) | All application data with RLS |
| Storage | Supabase Storage | Private plant images |
| Auth | Supabase Auth | User accounts and sessions |

---

## Guiding Principle

> Vercel is the only public origin. The browser never calls Railway or uses the Supabase service role key.

---

## Environment Variables

### apps/web (Vercel)

Set these in Vercel project settings → Environment Variables.

Mark server-only variables as **Server** exposure only (not Preview/Production client-side).

| Variable | Exposure | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon/public key |
| `NEXT_PUBLIC_APP_URL` | Public | App base URL (e.g. `https://phenosage.vercel.app`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Supabase service role — bypasses RLS |
| `ANALYSIS_SERVICE_URL` | **Server only** | Railway analysis service base URL |
| `ANALYSIS_SERVICE_API_KEY` | **Server only** | Shared secret for proxy auth |
| `OPENAI_API_KEY` | **Server only** | OpenAI API key |
| `CRON_SECRET` | **Server only** | Protects `/api/internal/cron/*` endpoints |

### apps/analysis (Railway)

Set these in Railway project → Variables.

| Variable | Description |
|---|---|
| `API_KEY` | Shared secret — must match `ANALYSIS_SERVICE_API_KEY` in Vercel |
| `OPENAI_API_KEY` | OpenAI API key for Vision analysis |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (to fetch private images) |
| `APP_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `PORT` | Set automatically by Railway |

---

## Vercel Setup

1. Connect your GitHub repo to Vercel
2. Set root directory to `apps/web`
3. Set install command to `pnpm install --frozen-lockfile` (from repo root)
4. Set build command to `pnpm build`
5. Add all environment variables (server-only variables: mark as **Server** only)
6. Deploy

Vercel Cron is configured in `apps/web/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/internal/cron/daily-summary",
      "schedule": "0 8 * * *"
    }
  ]
}
```

---

## Railway Setup

1. Create a new Railway project
2. Add a service from GitHub → select the repo → set root directory to `apps/analysis`
3. Railway will detect the `Dockerfile` automatically
4. Add all environment variables (see table above)
5. Set the `API_KEY` to a strong random secret
6. Copy the Railway public URL → set as `ANALYSIS_SERVICE_URL` in Vercel
7. Deploy

---

## Supabase Setup

1. Create a new Supabase project
2. Run migrations:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. In Supabase Storage → create bucket `plant-images` (private)
4. Enable Email Auth (or your preferred provider) in Supabase Auth settings
5. Copy the project URL and keys to Vercel environment variables

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

- **Web**: type-check, lint, build
- **Analysis**: ruff lint, mypy type-check, pytest
- **Shared**: type-check

Merging to `main` triggers automatic Vercel and Railway deployments.
