# PhenoSage — Deployment Guide

---

## Services Overview

| Service         | Platform            | Purpose                                                    |
| --------------- | ------------------- | ---------------------------------------------------------- |
| `apps/web`      | Vercel              | Next.js web app — the only public origin                   |
| `apps/analysis` | Railway             | FastAPI analysis service — private, never browser-callable |
| Database        | Supabase (Postgres) | All application data with RLS                              |
| Storage         | Supabase Storage    | Private plant images                                       |
| Auth            | Supabase Auth       | User accounts and sessions                                 |

---

## Guiding Principle

> Vercel is the only public origin. The browser never calls Railway or uses the Supabase service role key.

## Runtime Contract

- Node.js: `20.x`
- pnpm: `9.15.9`
- Keep the root `package.json`, `apps/web/package.json`, CI workflow, and Vercel project setting aligned to this contract.

---

## Environment Variables

### apps/web (Vercel)

Set these in Vercel project settings → Environment Variables.

Mark server-only variables as **Server** exposure only (not Preview/Production client-side).

| Variable                        | Exposure        | Description                                        |
| ------------------------------- | --------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public          | Supabase project URL                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public          | Supabase anon/public key                           |
| `NEXT_PUBLIC_APP_URL`           | Public          | App base URL (e.g. `https://phenosage.vercel.app`) |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server only** | Supabase service role — bypasses RLS               |
| `ANALYSIS_SERVICE_URL`          | **Server only** | Railway analysis service base URL                  |
| `ANALYSIS_SERVICE_API_KEY`      | **Server only** | Shared secret for proxy auth                       |
| `OPENAI_API_KEY`                | **Server only** | OpenAI API key                                     |
| `CRON_SECRET`                   | **Server only** | Protects `/api/internal/cron/*` endpoints          |

### apps/analysis (Railway)

Set these in Railway project → Variables.

| Variable                    | Description                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `API_KEY`                   | Shared secret — must match `ANALYSIS_SERVICE_API_KEY` in Vercel |
| `OPENAI_API_KEY`            | OpenAI API key for Vision analysis                              |
| `SUPABASE_URL`              | Supabase project URL                                            |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (to fetch private images)                 |
| `APP_ENV`                   | `production`                                                    |
| `LOG_LEVEL`                 | `info`                                                          |
| `PORT`                      | Set automatically by Railway                                    |

Run the env contract check before every PR and before promoting a deploy:

```bash
pnpm run check:env
```

---

## Vercel Setup

1. Connect your GitHub repo to Vercel
2. Set root directory to `apps/web`
3. Set Node.js Version to `20.x`
4. Set install command to `pnpm install --frozen-lockfile` (from repo root)
5. Set build command to `pnpm build`
6. Add all environment variables (server-only variables: mark as **Server** only)
7. Deploy

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

- **Web**: type-check, lint, test, build
- **Analysis**: ruff lint, mypy type-check, pytest
- **Shared**: type-check, test

Post-deploy smoke coverage must keep these baseline checks green:

- `GET /`
- `GET /api/health`
- auth bootstrap at `GET /auth`

Merging to `main` triggers automatic Vercel and Railway deployments.

---

## PR Acceptance Criteria

Treat release PRs as failed unless all of the following are true:

- `package.json`, `apps/web/package.json`, CI, and Vercel all target Node.js `20.x`
- `pnpm install --frozen-lockfile` succeeds from the repo root
- `pnpm run check:env`
- `pnpm run check:routes`
- `pnpm run check:imports`
- `pnpm run security:routes`
- `pnpm --filter web lint`
- `pnpm --filter web type-check`
- `pnpm --filter web test`
- `pnpm --filter web build`
- `python -m ruff check .`
- `python -m mypy app/`
- `python -m pytest --cov=app --cov-report=xml --cov-report=term`
- smoke checks for `GET /`, `GET /api/health`, and `GET /auth`

If Vercel or Railway deploy behavior changes, update this runbook in the same PR.
