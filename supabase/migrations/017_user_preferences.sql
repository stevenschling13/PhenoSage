-- Migration: 017_user_preferences
--
-- One-row-per-user preferences table. Today only `timezone` is stored
-- (used by the daily-summary cron to compute each user's local
-- `occurred_on` calendar date instead of forcing UTC across the board).
-- The table is intentionally separate from `profiles` so that future
-- preference additions (email opt-ins, notification severity floor,
-- etc.) don't widen the profile contract that other server reads rely
-- on.
--
-- Access model:
--   * SELECT: a signed-in user reads ONLY their own row (auth.uid()
--     = user_id). Service-role traffic bypasses RLS so the cron can
--     batch-load every active user's tz in one query.
--   * INSERT/UPDATE: a signed-in user may upsert ONLY their own row.
--     A BEFORE INSERT/UPDATE trigger validates `timezone` against
--     `pg_timezone_names` (Postgres does not permit subqueries in a
--     CHECK constraint, so a trigger is the idiomatic guard here) and
--     raises `22023` (invalid_parameter_value) on a bogus zone.
--   * DELETE: cascade with auth.users; no user-issued deletes today.
--
-- Idempotency / dedupe:
--   * Primary key on user_id makes upsert(onConflict: "user_id") the
--     natural write path; no partial unique index needed.
--
-- Future-proofing:
--   * Add new preference columns with `alter table user_preferences
--     add column ... default <safe>` in a follow-up migration. Keep
--     defaults so existing rows don't need a backfill.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop trigger if exists user_preferences_set_updated_at_trigger on user_preferences;
--   drop trigger if exists user_preferences_validate_timezone_trigger on user_preferences;
--   drop function if exists user_preferences_set_updated_at();
--   drop function if exists user_preferences_validate_timezone();
--   drop policy if exists "user_preferences: self read" on user_preferences;
--   drop policy if exists "user_preferences: self upsert" on user_preferences;
--   drop policy if exists "user_preferences: self update" on user_preferences;
--   drop table if exists user_preferences;

create table user_preferences (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table user_preferences enable row level security;

-- ─── Validation trigger ──────────────────────────────────────────────
-- pg_timezone_names is a system view; a CHECK constraint cannot reference
-- it (no subqueries in CHECK). A BEFORE trigger is the standard way to
-- validate values against system catalog data at write time.
create or replace function user_preferences_validate_timezone()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = new.timezone
     )
  then
    raise exception 'user_preferences: % is not a recognised IANA timezone', new.timezone
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger user_preferences_validate_timezone_trigger
  before insert or update of timezone on user_preferences
  for each row
  execute function user_preferences_validate_timezone();

-- ─── Policies ────────────────────────────────────────────────────────

create policy "user_preferences: self read"
  on user_preferences for select
  using (auth.uid() = user_id);

create policy "user_preferences: self upsert"
  on user_preferences for insert
  with check (auth.uid() = user_id);

create policy "user_preferences: self update"
  on user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── updated_at trigger ──────────────────────────────────────────────

create or replace function user_preferences_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_preferences_set_updated_at_trigger
  before update on user_preferences
  for each row
  execute function user_preferences_set_updated_at();
