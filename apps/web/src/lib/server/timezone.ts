import "server-only";

// Default timezone used whenever a user has no `user_preferences` row,
// has an unrecognised zone configured, or `Intl.DateTimeFormat` rejects
// the supplied IANA name. UTC is the safest fallback because it matches
// the historical pre-tz-support behaviour of the daily-summary cron.
export const DEFAULT_TIMEZONE = "UTC";

// Per-process cache of YYYY-MM-DD formatters keyed by validated IANA
// zone. `Intl.DateTimeFormat` construction is ~10-100x slower than
// `.format()`; the daily-summary cron calls into this module twice per
// user (once for validation during bulk-load, once for formatting in
// the fan-out) but the universe of unique zones is tiny (≪ user count).
// Cache hits on both paths amortise validation + formatting to a single
// constructor call per zone per process. Bounded by IANA zone universe
// (~600 entries) so unbounded growth is not a concern.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function buildFormatter(zone: string): Intl.DateTimeFormat {
  // `en-CA` always emits YYYY-MM-DD with hyphen separators across
  // every Node/ICU build, which is exactly the shape Postgres `date`
  // accepts without a parse hint. Avoids a manual zero-pad that would
  // have to handle locale digits.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Returns a cached formatter for `zone`, or `null` if `zone` is not a
// recognised IANA name. `Intl.DateTimeFormat` rejects unknown zones
// with a RangeError; we treat ANY rejection as "fall back to UTC" so a
// misconfigured row can't crash the cron. The cache is positive-only
// (no negative entries) because misconfigured zones are vanishingly
// rare — the migration trigger validates them at write time.
function getFormatterForZone(zone: string): Intl.DateTimeFormat | null {
  if (!zone || typeof zone !== "string") return null;
  const cached = formatterCache.get(zone);
  if (cached) return cached;
  try {
    const formatter = buildFormatter(zone);
    formatterCache.set(zone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

// `Intl.DateTimeFormat` rejects unknown IANA zones with a RangeError.
// We treat ANY rejection as "fall back to UTC" so a misconfigured row
// can't crash the cron. Successful lookups warm the formatter cache
// so a follow-up `formatOccurredOnInZone` is constructor-free.
export function isValidTimezone(zone: string): boolean {
  return getFormatterForZone(zone) !== null;
}

// Format an instant as a YYYY-MM-DD calendar date in the supplied IANA
// timezone. The cron uses this to compute each user's local
// `notifications.occurred_on` so dedupe and "today's summary" copy
// match the user's expectation rather than UTC midnight.
export function formatOccurredOnInZone(now: Date, zone: string): string {
  const formatter = getFormatterForZone(zone);
  if (formatter) return formatter.format(now);
  // Fall back to UTC. Look it up through the cache too so the UTC
  // formatter is also memoised across the typical "everyone defaulted"
  // path on a fresh deploy.
  const utcFormatter =
    getFormatterForZone(DEFAULT_TIMEZONE) ?? buildFormatter(DEFAULT_TIMEZONE);
  return utcFormatter.format(now);
}

// Test-only hook. NOT exported from any barrel; production code must
// not reach for this. Lets the timezone unit test assert the cache
// is being populated without polluting the public surface.
export function __resetTimezoneFormatterCacheForTests(): void {
  formatterCache.clear();
}
