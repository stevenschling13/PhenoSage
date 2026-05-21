# Supabase Migration Drift Runbook

## Context

On 2026-05-21, production Supabase was missing the RPC required by the orphan-signup reconciliation cron introduced in PR #247:

- `public.find_users_without_default_grow(integer)`
- Used by `/api/internal/cron/reconcile-onboarding`
- Intended canonical migration: `supabase/migrations/20260521190000_find_users_without_default_grow.sql`

A connector-applied emergency migration created the function in production as:

- `20260521214403 reconcile_onboarding_missing_rpc`

The application tolerates both raw UUID rows and row objects with an `id` field, so production is functionally safe. The repo migration remains the canonical desired shape.

## Verification SQL

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result,
  p.prosecdef as security_definer,
  p.proacl::text as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'find_users_without_default_grow';
```

Expected production-safe requirements:

- `security_definer = true`
- `service_role` has execute
- `public`, `anon`, and `authenticated` do not have execute
- Function returns orphan user identifiers consumable by `reconcileOnboarding()`

## Current production-safe emergency shape

The emergency function returns a row object containing at least an `id` field. This is compatible with `apps/web/src/lib/server/onboarding.ts`, which accepts either raw UUID strings or row objects with an `id` property from the RPC result.

## Canonical repair policy

Only align the production function signature through the normal reviewed migration workflow. Do not perform ad hoc destructive function replacement during an incident unless the current function is broken.

The canonical desired definition is the one checked into:

- `supabase/migrations/20260521190000_find_users_without_default_grow.sql`

Before making any repair, verify that `apps/web/src/lib/server/onboarding.ts` still accepts the selected RPC result shape.

## Related source files

- `supabase/migrations/20260521190000_find_users_without_default_grow.sql`
- `apps/web/src/lib/server/onboarding.ts`
- `apps/web/src/app/api/internal/cron/reconcile-onboarding/route.ts`
- `apps/web/vercel.json`
