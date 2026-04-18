---
name: phenosage-env-check
description: Validate .env files against the canonical contract in scripts/check-env-contract.mjs. Flags missing keys, malformed URLs, and secrets leaked into NEXT_PUBLIC_ variables.
---

# phenosage-env-check

Runs the env contract validator and reports drift against `.env.example`.

## Steps

1. `pnpm run check:env` — compares `.env.example` and source to the contract.
2. Inspect Vercel env (`vercel env ls`) and Railway env (`railway variables`) manually; diff against `.env.example`.
3. For each missing var in a remote environment: add with `vercel env add <NAME> production` or `railway variables --set <NAME>=<value>`.

## Red flags

- Any `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, or `ANALYSIS_SERVICE_API_KEY` showing up in client code → hard fail.
- `NEXT_PUBLIC_*` variables holding values that look like secrets (`sk-…`, `eyJ…`, JWT) → hard fail.
- New variable in `apps/*/src` but missing from `.env.example` → add to the contract.
