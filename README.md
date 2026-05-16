# PhenoSage

AI-powered cannabis grow operating system. Web-first, mobile-compatible, with secure image upload, persisted plant analyses, timeline tracking, and a grow-aware chatbot that keeps its own thread history.

## What is PhenoSage?

PhenoSage is not just a grow journal. It is an **AI grow operating system** built around four pillars:

1. **Visual Grow Doctor** — Upload plant photos and receive structured, professional AI evaluations
2. **Longitudinal Plant Intelligence** — Compare new photos to prior uploads; track health over time
3. **Grow-aware Chat Copilot** — A chatbot scoped to your actual grow data
4. **Proactive Recommendations & Alerts** — Daily summaries, reminders, task generation

## Architecture Overview

```
Browser (Next.js)
    └── Vercel (apps/web — the only public origin)
            ├── /api/chat          → proxies OpenAI
            ├── /api/uploads/sign  → proxies Supabase Storage signed URLs
            └── /api/plants/*/     → proxies analysis service + DB

Supabase         Railway
(auth/db/images) (FastAPI analysis service — never called by the browser directly)
```

## Tech Stack

| Layer            | Technology                                             |
| ---------------- | ------------------------------------------------------ |
| Web app          | Next.js 16 App Router, TypeScript strict, Tailwind CSS |
| Analysis service | FastAPI (Python 3.12)                                  |
| Shared types     | TypeScript package                                     |
| Auth             | Supabase Auth                                          |
| Database         | Supabase Postgres (pgvector-ready)                     |
| Storage          | Supabase Storage (private buckets)                     |
| Web deploy       | Vercel                                                 |
| Analysis deploy  | Railway                                                |

## Monorepo Structure

```
phenosage/
├── apps/
│   ├── web/          # Next.js App Router web application
│   └── analysis/     # FastAPI Python analysis service
├── packages/
│   └── shared/       # Shared TypeScript types and schemas
├── supabase/
│   └── migrations/   # SQL migrations
├── docs/             # Product docs
└── .github/
    └── workflows/    # CI
```

## Local Setup

### Prerequisites

- Node.js 20.x
- pnpm 9.15.9
- Python >= 3.12
- Docker (for analysis service)
- Supabase CLI

### Install dependencies

```bash
pnpm install --frozen-lockfile
```

### Environment variables

Copy the root `.env.example` and fill in your values:

```bash
cp .env.example .env.local
```

For Supabase operations and MCP access, the root env example now includes:

- `SUPABASE_PROJECT_REF` — project ref used by `.mcp.json`, `supabase link`, and the migrations workflow
- `SUPABASE_DB_PASSWORD` — direct Postgres password for CLI/admin flows
- `SUPABASE_DB_URL` — direct Postgres connection string (`db.<ref>.supabase.co:5432`) for admin sessions and recovery work

The checked-in `.mcp.json` already points at the production Supabase MCP endpoint for `yjemotnclrnlxgcfntaf`; full MCP read/write access is granted through the Supabase OAuth consent flow in your agent, not by committing secrets into the repo.

See each app's `.env.example` for service-specific variables.

### Run web app

```bash
pnpm --filter web dev
```

### Run analysis service

```bash
cd apps/analysis
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Or with Docker:

```bash
cd apps/analysis
docker build -t phenosage-analysis .
docker run -p 8000:8000 --env-file .env phenosage-analysis
```

## Environment Variables

See [docs/deployment.md](docs/deployment.md) for the full list of required environment variables per service.

The contract is enforced in two places:

- `scripts/check-env-contract.mjs` (run via `pnpm run check:env`) — fails CI if any required key is missing from `.env.example`, or if a server-only key leaks into client code.
- `apps/web/src/lib/server/env.ts` — runtime validator for Route Handlers; call `assertServerEnv()` at the top of a server entry to fail loudly on misconfiguration.

## Testing

| Layer                   | Command                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| Unit (web + shared)     | `pnpm turbo run test`                                                     |
| Type-check + lint       | `pnpm turbo run type-check lint`                                          |
| Pre-merge guardrails    | `pnpm run validate`                                                       |
| Route security audit    | `pnpm run security:routes`                                                |
| End-to-end (Playwright) | `pnpm --filter web exec playwright install && pnpm --filter web test:e2e` |

The auth flow is covered by unit tests in `apps/web/src/app/auth/__tests__/actions.test.ts`, including network-failure (`TypeError: fetch failed`) and DNS-failure (`ENOTFOUND`) paths so a misconfigured Supabase URL never reaches the user as a raw "fetch failed" error.

## Current Deployment Posture

- The browser only talks to the Next.js app on Vercel. It does not call Railway directly.
- Plant image uploads are signed server-side and uploaded straight to Supabase Storage.
- Plant analyses are persisted in `plant_analyses` and `plant_findings`.
- Analysis responses can fall back to an inconclusive mode when storage or OpenAI is unavailable. Treat those as non-diagnostic and retry once the upstream dependency is healthy.

## Documentation

- [Product Spec](docs/product-spec.md)
- [Deployment Guide](docs/deployment.md)
- [Roadmap](docs/roadmap.md)
