-- Migration: 022_fix_grow_rls_recursion
--
-- BLOCKER FIX. Restores `INSERT INTO public.grows` for authenticated
-- users by breaking the RLS-policy recursion cycle introduced (latently)
-- by migration 001:
--
--   * `grows: member read` (SELECT on grows) → EXISTS subquery against
--     `grow_members`.
--   * `grow_members: grow owner manage` (ALL on grow_members) → EXISTS
--     subquery against `grows`.
--
-- When a server action runs `.insert(...).select("id").single()`,
-- supabase-js issues `INSERT ... RETURNING id`, which Postgres evaluates
-- under both the `grows` INSERT policy AND the `grows` SELECT policy
-- (because RETURNING reads rows back). The SELECT half triggers
-- `grows: member read`, whose subquery evaluates `grow_members`'s ALL
-- policy, whose subquery re-evaluates the `grows` policies — infinite
-- recursion, terminated by Postgres with `42P17`.
--
-- This was a latent bug from migration 001. It only began firing in
-- production after #173 + #174 fixed the "use server" + try/catch issues
-- in createGrowAction — before those landed the action never reached
-- Supabase at all, so the recursion never executed.
--
-- Fix: wrap the cross-table EXISTS check in a SECURITY DEFINER function
-- that runs with the function owner's privileges, bypassing RLS on the
-- inner query and breaking the cycle. This is the Supabase-recommended
-- pattern for cross-table RLS predicates — see
-- https://supabase.com/docs/guides/database/postgres/row-level-security#authorize-functions-with-security-definer
--
-- The fix preserves both existing access patterns:
--   * Grow owners can manage their grow_members (now via the helper).
--   * Grow owners can read their own grows (`grows: owner write` ALL
--     policy already grants SELECT — unchanged).
--   * Grow MEMBERS can read shared grows (`grows: member read` —
--     replaced with a non-recursive form via a sibling helper).

-- ─── private schema ────────────────────────────────────────────────────
-- Housing for SECURITY DEFINER helpers so they don't leak into PostgREST
-- discovery (only public is exposed by default). Idempotent.
create schema if not exists private;

-- Lock down execute so only authenticated callers (or service role)
-- can invoke. Public should not be able to execute these.
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ─── private.is_grow_owner ─────────────────────────────────────────────
-- True iff the calling auth.uid() owns the given grow. SECURITY DEFINER
-- so the inner SELECT bypasses RLS on `grows`, which is what breaks the
-- recursive cycle with `grow_members: grow owner manage`.
create or replace function private.is_grow_owner(p_grow_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.grows
    where id = p_grow_id and owner_id = auth.uid()
  );
$$;

revoke all on function private.is_grow_owner(uuid) from public;
grant execute on function private.is_grow_owner(uuid) to authenticated, service_role;

-- ─── private.is_grow_member ────────────────────────────────────────────
-- True iff the calling auth.uid() has a grow_members row for the grow.
-- SECURITY DEFINER so the inner SELECT bypasses RLS on `grow_members`,
-- preventing the symmetric recursion in case any future write to
-- grow_members happens with RETURNING (Supabase-js does this by default
-- for insert/upsert/update/delete + select).
create or replace function private.is_grow_member(p_grow_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.grow_members
    where grow_id = p_grow_id and user_id = auth.uid()
  );
$$;

revoke all on function private.is_grow_member(uuid) from public;
grant execute on function private.is_grow_member(uuid) to authenticated, service_role;

-- ─── Replace the recursive policies ────────────────────────────────────
-- Drop-then-create rather than alter because CREATE OR REPLACE POLICY
-- doesn't exist in current Postgres.

drop policy if exists "grow_members: grow owner manage" on public.grow_members;
create policy "grow_members: grow owner manage"
  on public.grow_members
  for all
  using ( private.is_grow_owner(grow_id) )
  with check ( private.is_grow_owner(grow_id) );

drop policy if exists "grows: member read" on public.grows;
create policy "grows: member read"
  on public.grows
  for select
  using (
    auth.uid() = owner_id
    or private.is_grow_member(id)
  );
