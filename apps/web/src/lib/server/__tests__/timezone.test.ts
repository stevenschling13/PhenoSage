import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TIMEZONE,
  __resetTimezoneFormatterCacheForTests,
  formatOccurredOnInZone,
  isValidTimezone,
} from "../timezone";

beforeEach(() => {
  __resetTimezoneFormatterCacheForTests();
});

describe("isValidTimezone", () => {
  it("accepts well-known IANA zones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
  });

  it("rejects bogus or empty values", () => {
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone(undefined as unknown as string)).toBe(false);
  });
});

describe("formatOccurredOnInZone", () => {
  it("emits a YYYY-MM-DD calendar date", () => {
    const out = formatOccurredOnInZone(new Date("2026-05-15T15:00:00Z"), "UTC");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toBe("2026-05-15");
  });

  it("shifts to the user's local calendar day", () => {
    // 2026-05-15 02:00 UTC = 2026-05-14 19:00 in America/Los_Angeles
    const instant = new Date("2026-05-15T02:00:00Z");
    expect(formatOccurredOnInZone(instant, "America/Los_Angeles")).toBe(
      "2026-05-14",
    );
    expect(formatOccurredOnInZone(instant, "UTC")).toBe("2026-05-15");
  });

  it("falls back to UTC for an unrecognised zone", () => {
    const instant = new Date("2026-05-15T02:00:00Z");
    expect(formatOccurredOnInZone(instant, "Mars/Olympus_Mons")).toBe(
      "2026-05-15",
    );
  });

  it("DEFAULT_TIMEZONE is UTC", () => {
    expect(DEFAULT_TIMEZONE).toBe("UTC");
  });
});

describe("formatter cache", () => {
  it("reuses Intl.DateTimeFormat across calls for the same zone", () => {
    // Spy on the Intl.DateTimeFormat constructor to assert we only
    // build a formatter the first time a zone is seen. This is the
    // optimization that makes the daily-summary cron O(unique-zones)
    // instead of O(users) on formatter constructions.
    const original = Intl.DateTimeFormat;
    let constructed = 0;
    const Spied = function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ) {
      constructed += 1;
      // `Reflect.construct` preserves the `new.target` semantics that
      // the real `Intl.DateTimeFormat` relies on internally.
      return Reflect.construct(original, args, Spied as unknown as Function);
    } as unknown as { prototype: object } & typeof Intl.DateTimeFormat;
    Spied.prototype = original.prototype;
    Spied.supportedLocalesOf = original.supportedLocalesOf.bind(original);
    (globalThis as unknown as { Intl: typeof Intl }).Intl = {
      ...original,
      DateTimeFormat: Spied,
    } as unknown as typeof Intl;
    try {
      const instant = new Date("2026-05-15T15:00:00Z");
      // First call constructs.
      expect(formatOccurredOnInZone(instant, "America/Los_Angeles")).toBe(
        "2026-05-15",
      );
      const afterFirst = constructed;
      // Second call for the same zone must NOT construct again.
      formatOccurredOnInZone(instant, "America/Los_Angeles");
      formatOccurredOnInZone(instant, "America/Los_Angeles");
      expect(constructed).toBe(afterFirst);
      // A different zone constructs exactly once more.
      formatOccurredOnInZone(instant, "Europe/Berlin");
      expect(constructed).toBe(afterFirst + 1);
      // isValidTimezone hits the same cache — no new construction.
      isValidTimezone("America/Los_Angeles");
      isValidTimezone("Europe/Berlin");
      expect(constructed).toBe(afterFirst + 1);
    } finally {
      (globalThis as unknown as { Intl: typeof Intl }).Intl = {
        ...original,
        DateTimeFormat: original,
      } as unknown as typeof Intl;
    }
  });

  it("does not cache invalid zones (no negative entries)", () => {
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    // A repeated invalid lookup must remain `false`; behaviour-only
    // assertion since the cache is positive-only by design.
    expect(
      formatOccurredOnInZone(
        new Date("2026-05-15T02:00:00Z"),
        "Mars/Olympus_Mons",
      ),
    ).toBe("2026-05-15");
  });
});
