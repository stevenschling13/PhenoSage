-- Migration: 015_fix_notifications_unique_index
--
-- The partial UNIQUE index from migration 014 used the predicate
-- `WHERE occurred_on IS NOT NULL`, which would conflict for any
-- notification kind that sets occurred_on (e.g. two finding_alert rows
-- on the same calendar day would violate the constraint even though they
-- are different notifications).  Scope the dedup constraint to
-- `daily_summary` rows only so other kinds can freely set occurred_on.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop index if exists notifications_unique_daily_summary_per_day;
--   create unique index notifications_unique_per_kind_per_day
--     on notifications (user_id, kind, occurred_on)
--     where occurred_on is not null;

drop index if exists notifications_unique_per_kind_per_day;

-- One daily_summary row per user per calendar day; all other kinds are
-- unconstrained on occurred_on.
create unique index notifications_unique_daily_summary_per_day
  on notifications (user_id, kind, occurred_on)
  where occurred_on is not null and kind = 'daily_summary';
