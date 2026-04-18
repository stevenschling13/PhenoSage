---
name: phenosage-setup
description: Bootstrap a PhenoSage development environment. Installs JS deps, Python deps for the analysis service, links Supabase, and copies .env.example. Use on first clone or after major dependency bumps.
---

# phenosage-setup

## What it does

1. Installs root JS deps with `pnpm install --frozen-lockfile`.
2. Creates/activates a Python venv for `apps/analysis` and installs `requirements.txt`.
3. Copies `.env.example` → `.env.local` (root) and `apps/analysis/.env` if missing.
4. Links Supabase (`supabase link`) using `SUPABASE_PROJECT_REF` from env.
5. Runs `pnpm validate` and `pnpm turbo run type-check test` to confirm the tree is green.

## When to use

- First clone.
- After a Node or Python version bump.
- After a dependabot batch lands and `pnpm install` fails mysteriously.

## Commands (reference)

```bash
pnpm install --frozen-lockfile
cd apps/analysis && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env.local 2>/dev/null || true
supabase link --project-ref "$SUPABASE_PROJECT_REF"
pnpm validate
pnpm turbo run type-check test
```

## What not to do

- Do NOT commit `.env.local` or `apps/analysis/.env`.
- Do NOT run `supabase db reset` without confirmation — it drops local data.
