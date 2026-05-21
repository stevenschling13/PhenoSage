-- Migration: find_users_without_default_grow
--
-- Adds a SECURITY DEFINER function that lets the application server
-- (service_role) enumerate `auth.users` rows with zero `grows` rows.
-- Used by the new `/api/internal/cron/reconcile-onboarding` daily cron
-- to defend against the `pg_net`-backed Database Webhook silently
-- dropping an `auth.users` INSERT event (pg_net is in beta, response
-- retention is 6h, the unlogged queue table is not crash-safe).
--
-- Why a SECURITY DEFINER function instead of querying `auth.users`
-- directly via PostgREST: Supabase's PostgREST default exposes only
-- `public`, `storage`, and `graphql_public`. The `auth` schema is
-- unreachable from the REST layer even with the service-role key.
-- The hotfix in #240 removed an attempt to query `auth.users` from
-- the auth webhook handler for the same reason; this function is the
-- correct shape for that read pattern.
--
-- Access model:
--   * `revoke execute ... from public/authenticated` — end users
--     cannot call this RPC.
--   * `grant execute ... to service_role` — the daily cron's
--     route handler (using SUPABASE_SERVICE_ROLE_KEY) is the only
--     caller.
--
-- Rollback: drop the function. No app code depends on it until the
-- reconciliation cron PR lands.

create or replace function find_users_without_default_grow(
  p_limit integer default 1000
)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  left join grows g on g.owner_id = u.id
  where g.id is null
  order by u.created_at asc
  limit greatest(coalesce(p_limit, 1000), 1);
$$;

revoke execute on function find_users_without_default_grow(integer) from public;
revoke execute on function find_users_without_default_grow(integer) from authenticated;
grant execute on function find_users_without_default_grow(integer) to service_role;
