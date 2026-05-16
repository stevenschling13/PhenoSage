-- Migration: 021_profiles_self_insert
--
-- Closes the missing-policy gap that forced every profile write path
-- to depend on the service-role key in production:
--
--   `profiles` enabled RLS in migration 001 with `owner read` (SELECT)
--   and `owner update` (UPDATE) policies, but NO INSERT policy. The
--   `handle_new_user()` trigger (also in 001) creates each user's
--   profile row at signup, so day-to-day reads/updates work. But the
--   Settings page "Save display name" action calls `upsert()`, which
--   supabase-js issues as `INSERT … ON CONFLICT DO UPDATE`. Postgres
--   requires the INSERT policy for the INSERT half of that statement
--   even when the row already exists — so the upsert fails with
--   42501 unless the caller bypasses RLS.
--
--   The production-test audit dated 2026-05-15 confirmed this: every
--   settings save reported "Something went wrong saving your display
--   name." Root cause was the action falling back to `getDbClient()`
--   (service role) and hitting a missing `SUPABASE_SERVICE_ROLE_KEY`
--   env var, but even with the env var set the right long-term fix is
--   to remove the service-role dependency from a self-write path.
--
-- This migration adds a tightly-scoped INSERT policy so the
-- authenticated user can upsert their own profile row through the
-- RLS-scoped client. The CHECK keeps the policy tight: `auth.uid() = id`
-- means the row's `id` must match the caller — a user can never
-- create a profile row for someone else.
--
-- Safety posture:
--   * Strictly additive. No existing rows touched, no policies dropped.
--   * The CHECK clause prevents cross-user inserts (same shape as the
--     `profiles: owner update` policy from migration 001).
--   * Re-running the migration is safe because `create policy` errors
--     loudly if the policy already exists; we guard with a DO block
--     that NO-OPs when the policy is present.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop policy if exists "profiles: self insert" on profiles;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles: self insert'
  ) then
    create policy "profiles: self insert"
      on profiles for insert
      with check (auth.uid() = id);
  end if;
end
$$;
