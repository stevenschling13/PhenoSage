import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMEZONE,
  formatOccurredOnInZone,
  isValidTimezone,
} from "../timezone";

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
