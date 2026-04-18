---
name: phenosage-supabase-ops
description: Inspect and manage the PhenoSage Supabase project — RLS audits, seed data, pgvector health, and migration diffs. Use when schema drifts, RLS is suspected broken, or pgvector queries are slow.
---

# phenosage-supabase-ops

Day-2 operations for the Supabase project.

## RLS audit

```bash
supabase db lint --level=warning
psql "$SUPABASE_DB_URL" -c "select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public';"
```

Every `public.*` table must have `rowsecurity = t` and at least one policy per CRUD action.

## pgvector health

```sql
select relname, pg_size_pretty(pg_relation_size(oid)) as size
from pg_class where relkind = 'i' and relname like '%_embedding_%';
select name, setting from pg_settings where name ilike 'maintenance%';
```

If index size > 30% of table size, schedule `REINDEX INDEX CONCURRENTLY`.

## Migration diff

```bash
supabase db diff --use-migra -f 00X_<slug>
```

Manual review — never apply diffs blindly. Existing migrations in `supabase/migrations/` are frozen; create new numbered files (`00X_…`).

## Don'ts

- Never edit existing migrations in place.
- Never run `supabase db reset` against a linked remote.
- Never disable RLS to "debug" — copy a row with the service role key and inspect, instead.
