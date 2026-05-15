import "server-only";

import type { FindingSeverity } from "@phenosage/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerEvent } from "./request-id";
import { DEFAULT_TIMEZONE, isValidTimezone } from "./timezone";

// Per-user preference shape persisted in `user_preferences`. Keep the
// surface narrow: only fields the application actually reads should
// land here so a schema bump doesn't quietly leak to clients.
export interface UserPreferences {
  timezone: string;
  emailDailySummary: boolean;
  emailFindingAlerts: boolean;
  emailAlertSeverityFloor: FindingSeverity;
}

// Default to the most-conservative-yet-useful posture: send email by
// default (these are transactional, tied to the user's verified
// Supabase Auth address) but only on `critical` severity. Users tune
// this through the settings page.
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  timezone: DEFAULT_TIMEZONE,
  emailDailySummary: true,
  emailFindingAlerts: true,
  emailAlertSeverityFloor: "critical",
};

const VALID_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

interface PreferenceRow {
  timezone?: string | null;
  email_daily_summary?: boolean | null;
  email_finding_alerts?: boolean | null;
  email_alert_severity_floor?: string | null;
}

// Normalise a row from `user_preferences` so that callers always get a
// usable timezone + email defaults. A row with malformed data (only
// possible via direct SQL today; the trigger + check constraint guard
// the API path) silently degrades to the safe default.
function normalisePreferences(row: PreferenceRow | null): UserPreferences {
  const tz = row?.timezone;
  const timezone =
    typeof tz === "string" && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;

  const emailDailySummary =
    typeof row?.email_daily_summary === "boolean"
      ? row.email_daily_summary
      : DEFAULT_USER_PREFERENCES.emailDailySummary;

  const emailFindingAlerts =
    typeof row?.email_finding_alerts === "boolean"
      ? row.email_finding_alerts
      : DEFAULT_USER_PREFERENCES.emailFindingAlerts;

  const floorRaw = row?.email_alert_severity_floor;
  const emailAlertSeverityFloor: FindingSeverity =
    typeof floorRaw === "string" &&
    VALID_SEVERITIES.has(floorRaw as FindingSeverity)
      ? (floorRaw as FindingSeverity)
      : DEFAULT_USER_PREFERENCES.emailAlertSeverityFloor;

  return {
    timezone,
    emailDailySummary,
    emailFindingAlerts,
    emailAlertSeverityFloor,
  };
}

const PREFERENCE_COLUMNS =
  "user_id,timezone,email_daily_summary,email_finding_alerts,email_alert_severity_floor";
const PREFERENCE_COLUMNS_NO_ID =
  "timezone,email_daily_summary,email_finding_alerts,email_alert_severity_floor";

// Bulk-load preferences for a set of user ids. Used by the daily-summary
// cron so we avoid issuing N round-trips to Supabase across the user
// fan-out. Missing rows resolve to defaults; a query error logs and
// returns an all-defaults map so the cron still runs (UTC is a safe
// fallback for `occurred_on`).
export async function loadUserPreferencesBulk(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, UserPreferences>> {
  const out = new Map<string, UserPreferences>();
  if (userIds.length === 0) return out;

  const { data, error } = await supabase
    .from("user_preferences")
    .select(PREFERENCE_COLUMNS)
    .in("user_id", userIds);

  if (error) {
    logServerEvent("error", "user_preferences: bulk load failed", {
      error: error.message,
      userCount: userIds.length,
    });
    // Fall through to defaults rather than throwing — the cron is
    // best-effort and a missing row means defaults.
  }

  for (const row of data ?? []) {
    const userId = (row as { user_id?: string }).user_id;
    if (typeof userId !== "string") continue;
    out.set(userId, normalisePreferences(row as PreferenceRow));
  }

  // Backfill any user id that wasn't returned so callers can rely on
  // the map being total over `userIds`.
  for (const id of userIds) {
    if (!out.has(id)) out.set(id, { ...DEFAULT_USER_PREFERENCES });
  }
  return out;
}

// Single-user variant. Used by the settings page when reading the
// current value to render the timezone selector. Uses the supabase
// client passed in (which may be an RLS-scoped user client) so the
// caller controls authorization.
export async function loadUserPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select(PREFERENCE_COLUMNS_NO_ID)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logServerEvent("error", "user_preferences: load failed", {
      error: error.message,
      userId,
    });
    return { ...DEFAULT_USER_PREFERENCES };
  }
  return normalisePreferences(data as PreferenceRow | null);
}
