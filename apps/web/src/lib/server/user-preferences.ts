import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerEvent } from "./request-id";
import { DEFAULT_TIMEZONE, isValidTimezone } from "./timezone";

// Per-user preference shape persisted in `user_preferences`. Keep the
// surface narrow: only fields the application actually reads should
// land here so a schema bump doesn't quietly leak to clients.
export interface UserPreferences {
  timezone: string;
}

// Normalise a row from `user_preferences` so that callers always get a
// usable timezone. A row with a malformed `timezone` value (possible
// only via direct SQL today; the trigger guards the API path) silently
// degrades to UTC.
function normalisePreferences(
  row: { timezone?: string | null } | null,
): UserPreferences {
  const tz = row?.timezone;
  if (typeof tz === "string" && isValidTimezone(tz)) return { timezone: tz };
  return { timezone: DEFAULT_TIMEZONE };
}

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
    .select("user_id,timezone")
    .in("user_id", userIds);

  if (error) {
    logServerEvent("error", "user_preferences: bulk load failed", {
      error: error.message,
      userCount: userIds.length,
    });
    // Fall through to defaults rather than throwing — the cron is
    // best-effort and a missing tz means UTC.
  }

  for (const row of data ?? []) {
    const userId = (row as { user_id?: string }).user_id;
    if (typeof userId !== "string") continue;
    out.set(userId, normalisePreferences(row as { timezone?: string | null }));
  }

  // Backfill any user id that wasn't returned so callers can rely on
  // the map being total over `userIds`.
  for (const id of userIds) {
    if (!out.has(id)) out.set(id, { timezone: DEFAULT_TIMEZONE });
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
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logServerEvent("error", "user_preferences: load failed", {
      error: error.message,
      userId,
    });
    return { timezone: DEFAULT_TIMEZONE };
  }
  return normalisePreferences(data as { timezone?: string | null } | null);
}
