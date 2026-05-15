-- Migration: 014_notifications
--
-- Per-user notification feed. Today only `daily_summary` rows are
-- written (by the /api/internal/cron/daily-summary handler running
-- under the service role), but the table is shaped to accept future
-- categories (findings alerts, collaborator invites, system messages)
-- without another migration.
--
-- Access model:
--   * SELECT: a signed-in user reads ONLY their own rows (auth.uid()
--     = user_id). Service-role traffic bypasses RLS so the cron
--     writes freely.
--   * INSERT: no user policy — writes go through service role only.
--     The cron handler enforces "one row per (user_id, kind, occurred_on)"
--     application-side via the partial UNIQUE index below.
--   * UPDATE: signed-in user may flip read_at on their own rows only.
--     No other column is updatable from the client; the trigger guards
--     all immutable columns.
--
-- Idempotency / dedupe:
--   * Partial UNIQUE on (user_id, kind, occurred_on) WHERE occurred_on
--     IS NOT NULL prevents a cron re-run on the same calendar day from
--     producing duplicate daily summaries. The cron uses
--     occurred_on = CURRENT_DATE at the user's local midnight (UTC for
--     now; user-tz support is a follow-up).
--   * INSERT path uses ON CONFLICT DO NOTHING so a re-run during the
--     same day is a no-op rather than an error.
--
-- Future-proofing:
--   * `payload` is jsonb so future kinds (e.g. invite tokens, finding
--     IDs to deep-link to) can stash structured data without another
--     column.
--   * `priority` lets the UI sort or highlight; current rows write
--     'info' by default.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop trigger if exists notifications_user_update_guard_trigger on notifications;
--   drop function if exists notifications_user_update_guard();
--   drop policy if exists "notifications: self read" on notifications;
--   drop policy if exists "notifications: self resolve" on notifications;
--   drop table if exists notifications;
--   drop type if exists notification_kind;
--   drop type if exists notification_priority;

create type notification_kind as enum (
  'daily_summary',
  'finding_alert',
  'collaborator_invite',
  'system'
);

create type notification_priority as enum ('info', 'warning', 'critical');

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          notification_kind not null,
  priority      notification_priority not null default 'info',
  title         text not null,
  body          text,
  payload       jsonb,
  -- `occurred_on` is the *logical* day the event belongs to, used for
  -- dedupe of daily summaries. Other kinds may leave it null.
  occurred_on   date,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

alter table notifications enable row level security;

-- One daily-summary row per user per day, regardless of how many cron
-- attempts hit. Partial so non-daily kinds aren't constrained.
create unique index notifications_unique_per_kind_per_day
  on notifications (user_id, kind, occurred_on)
  where occurred_on is not null;

-- Hot path: dashboard reads the most recent N notifications for the
-- signed-in user.
create index idx_notifications_user_created_at
  on notifications (user_id, created_at desc);

-- Hot path: badge counter — unread for a user.
create index idx_notifications_user_unread
  on notifications (user_id, created_at desc)
  where read_at is null;

-- ─── Policies ────────────────────────────────────────────────────────

create policy "notifications: self read"
  on notifications for select
  using (auth.uid() = user_id);

create policy "notifications: self resolve"
  on notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Column-restriction trigger ──────────────────────────────────────
-- Only `read_at` may change from a user-context UPDATE. Service-role
-- traffic (auth.uid() is null) bypasses the guard so the cron can
-- overwrite freely.
create or replace function notifications_user_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.user_id      is distinct from old.user_id
     or new.kind      is distinct from old.kind
     or new.priority  is distinct from old.priority
     or new.title     is distinct from old.title
     or new.body      is distinct from old.body
     or new.payload   is distinct from old.payload
     or new.occurred_on is distinct from old.occurred_on
     or new.created_at  is distinct from old.created_at
  then
    raise exception 'notifications: only read_at may be modified by users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger notifications_user_update_guard_trigger
  before update on notifications
  for each row
  execute function notifications_user_update_guard();
