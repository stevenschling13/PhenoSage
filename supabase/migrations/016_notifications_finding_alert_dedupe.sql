-- Migration: 016_notifications_finding_alert_dedupe
--
-- Tier-1 event-driven agent triggers (see docs/roadmap.md): when a high
-- or critical severity `plant_findings` row lands, the analysis pipeline
-- now writes a `finding_alert` notification immediately rather than
-- waiting for the 8 AM daily-summary cron. Each finding row should
-- produce at most one alert per user even if the analysis pipeline
-- replays (idempotent retries, chat-triggered re-analysis, etc.).
--
-- Migration 014 already provides DB-level dedupe for `daily_summary`
-- via a partial UNIQUE on (user_id, kind, occurred_on) WHERE
-- occurred_on IS NOT NULL. `finding_alert` rows leave `occurred_on`
-- NULL by design (they're event-keyed, not day-keyed), so that index
-- doesn't engage. This migration adds a parallel partial UNIQUE
-- keyed on payload->>'findingId' so callers can `ON CONFLICT DO
-- NOTHING` instead of doing a SELECT-then-INSERT race.
--
-- The expression `(payload->>'findingId')` is IMMUTABLE for jsonb,
-- so it's index-safe. The index is partial on kind = 'finding_alert'
-- so other notification kinds (e.g. system messages) are not
-- constrained.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop index if exists notifications_unique_finding_alert_per_user;

create unique index if not exists notifications_unique_finding_alert_per_user
  on notifications (user_id, (payload->>'findingId'))
  where kind = 'finding_alert' and (payload->>'findingId') is not null;
