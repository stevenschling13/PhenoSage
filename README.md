# PhenoSage

AI-powered cannabis grow operating system. Web-first, mobile-compatible, professional plant analysis, timeline tracking, proactive alerts, and grow-aware chatbot.

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
| Web app          | Next.js 14 App Router, TypeScript strict, Tailwind CSS |
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

## Documentation

- [Product Spec](docs/product-spec.md)
- [Deployment Guide](docs/deployment.md)
- [Roadmap](docs/roadmap.md)
