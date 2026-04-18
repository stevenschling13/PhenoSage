---
name: phenosage-migration
description: Scaffold a new Supabase migration with safety checks (RLS policies, rollback block, pgvector considerations). Use whenever the schema needs to change.
---

# phenosage-migration

## Before writing any SQL

1. Read `supabase/migrations/001_initial_schema.sql`, `002_storage_buckets.sql`, `003_production_optimizations.sql`. Existing migrations are **frozen** — never edit.
2. Confirm the change can be expressed as additive DDL (add column, add index, add policy). If it must drop or alter, pair with a backfill and a rollback.

## Scaffold

```bash
ts=$(date -u +%Y%m%d%H%M%S)
slug=<short-description>
file="supabase/migrations/${ts}_${slug}.sql"
```

Template:

```sql
-- Migration: <slug>
-- Purpose:   <why>
-- Rollback:  <exact statements to undo>

begin;

-- 1. Schema change
alter table public.plant_findings add column if not exists sort_order int not null default 0;

-- 2. RLS policy (if creating a new table)
-- alter table public.<new_table> enable row level security;
-- create policy "<name>" on public.<new_table> for select using (...);

-- 3. Index (consider CONCURRENTLY on large tables — requires no transaction)
-- create index if not exists ... on public.<table> (...);

commit;
```

## After writing

- `supabase db push --dry-run` — review planned DDL.
- `supabase db lint`.
- Add a corresponding query in `packages/shared/src/types.ts` if columns are exposed to the web.
- Test roll-forward and rollback against a throwaway branch (`supabase db reset` on a feature branch is fine).

## Red flags

- Adding a `NOT NULL` column without a default → breaks existing rows.
- Dropping a column used by `apps/web` or `apps/analysis` → ship code change first.
- Modifying `storage.*` buckets — requires `002_storage_buckets.sql` review and must preserve signed-URL paths.
