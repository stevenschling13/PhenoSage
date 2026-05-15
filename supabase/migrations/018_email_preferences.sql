-- Migration: 018_email_preferences
--
-- Tier 2.2 — Resend-backed transactional email for daily summary
-- and critical finding alerts. Two additive changes:
--
--   1. Three new columns on `user_preferences` so each user can
--      opt out of daily summary email and tune the severity floor
--      below which we don't email a finding alert. Defaults are
--      chosen to deliver value out of the box (transactional emails
--      tied to the user's verified Supabase Auth address — no
--      bulk/marketing concern).
--
--   2. One new column on `notifications.email_sent_at` so the cron
--      can short-circuit a same-day re-run without consulting an
--      external "EmailsSent" table. Combined with the partial UNIQUE
--      from migration 014 (user_id, kind, occurred_on) this gives us
--      cross-run idempotency without a second table.
--
-- Access model:
--   * `user_preferences` columns inherit the existing self-read +
--     self-upsert/update RLS from migration 017. No new policies.
--   * `notifications.email_sent_at` is service-role-only (the column
--     restriction trigger from migration 014 already disallows users
--     from updating any column other than `read_at`).
--
-- Index choice:
--   * The cron's lookup is "did we already email this notification?"
--     against a freshly-inserted row that the cron itself owns. We
--     don't need a covering index — a partial WHERE email_sent_at
--     IS NULL filtered to recent rows would be tiny and rarely used.
--     Skip it for now; revisit if the cron's wall-clock per user
--     creeps up.
--
-- Validation:
--   * `email_alert_severity_floor` is constrained to the same
--     enum-of-strings the rest of the codebase uses for severity.
--     Default `'critical'` keeps the email firehose calm out of the
--     box; users can lower it through the settings UI.
--
-- Rollback (do NOT run unless explicitly approved):
--   alter table notifications drop column if exists email_sent_at;
--   alter table user_preferences drop column if exists email_alert_severity_floor;
--   alter table user_preferences drop column if exists email_finding_alerts;
--   alter table user_preferences drop column if exists email_daily_summary;

alter table user_preferences
  add column if not exists email_daily_summary boolean not null default true,
  add column if not exists email_finding_alerts boolean not null default true,
  add column if not exists email_alert_severity_floor text not null default 'critical';

alter table user_preferences
  add constraint user_preferences_email_alert_severity_floor_check
    check (email_alert_severity_floor in ('info', 'low', 'medium', 'high', 'critical'));

alter table notifications
  add column if not exists email_sent_at timestamptz;

-- Re-publish the column-restriction trigger from migration 014 so the
-- new `email_sent_at` column is also immutable from a user-context
-- UPDATE. Service-role writes (where auth.uid() is null) keep the
-- bypass exactly as before — the cron stamps `email_sent_at` after
-- every successful Resend dispatch.
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

  if new.user_id        is distinct from old.user_id
     or new.kind        is distinct from old.kind
     or new.priority    is distinct from old.priority
     or new.title       is distinct from old.title
     or new.body        is distinct from old.body
     or new.payload     is distinct from old.payload
     or new.occurred_on is distinct from old.occurred_on
     or new.created_at  is distinct from old.created_at
     or new.email_sent_at is distinct from old.email_sent_at
  then
    raise exception 'notifications: only read_at may be modified by users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on column user_preferences.email_daily_summary is
  'When true (default), the daily-summary cron also emails the digest after writing the in-app notification.';
comment on column user_preferences.email_finding_alerts is
  'When true (default), high/critical finding_alert notifications are also emailed (gated by email_alert_severity_floor).';
comment on column user_preferences.email_alert_severity_floor is
  'Minimum severity that triggers a finding_alert email. One of info|low|medium|high|critical. Defaults to critical to avoid email noise.';
comment on column notifications.email_sent_at is
  'Set by the email pipeline once a transactional email has been dispatched for this notification. Service-role write only; user-context UPDATE is blocked by the column-restriction trigger from migration 014.';
