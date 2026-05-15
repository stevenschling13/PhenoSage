import "server-only";

// Default timezone used whenever a user has no `user_preferences` row,
// has an unrecognised zone configured, or `Intl.DateTimeFormat` rejects
// the supplied IANA name. UTC is the safest fallback because it matches
// the historical pre-tz-support behaviour of the daily-summary cron.
export const DEFAULT_TIMEZONE = "UTC";

// `Intl.DateTimeFormat` rejects unknown IANA zones with a RangeError.
// We treat ANY rejection as "fall back to UTC" so a misconfigured row
// can't crash the cron.
export function isValidTimezone(zone: string): boolean {
  if (!zone || typeof zone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Format an instant as a YYYY-MM-DD calendar date in the supplied IANA
// timezone. The cron uses this to compute each user's local
// `notifications.occurred_on` so dedupe and "today's summary" copy
// match the user's expectation rather than UTC midnight.
export function formatOccurredOnInZone(now: Date, zone: string): string {
  const safeZone = isValidTimezone(zone) ? zone : DEFAULT_TIMEZONE;
  // `en-CA` always emits YYYY-MM-DD with hyphen separators across
  // every Node/ICU build, which is exactly the shape Postgres `date`
  // accepts without a parse hint. Avoids a manual zero-pad that would
  // have to handle locale digits.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}
