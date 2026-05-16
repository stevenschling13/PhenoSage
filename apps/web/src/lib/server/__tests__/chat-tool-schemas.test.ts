import { describe, expect, it } from "vitest";
import {
  escapeIlikePattern,
  LogPlantObservationArgs,
  quotedIlikeOrValue,
} from "../chat-tool-schemas";

describe("escapeIlikePattern", () => {
  it("escapes ILIKE wildcards and backslashes", () => {
    expect(escapeIlikePattern("50%")).toBe("50\\%");
    expect(escapeIlikePattern("a_b")).toBe("a\\_b");
    expect(escapeIlikePattern("a\\b")).toBe("a\\\\b");
  });

  it("caps very long inputs at 120 characters", () => {
    const long = "a".repeat(500);
    expect(escapeIlikePattern(long)).toHaveLength(120);
  });

  it("leaves plain text untouched", () => {
    expect(escapeIlikePattern("rosemary")).toBe("rosemary");
  });
});

describe("quotedIlikeOrValue", () => {
  it("wraps the pattern in double quotes with ILIKE wildcards", () => {
    expect(quotedIlikeOrValue("rosemary")).toBe('"%rosemary%"');
  });

  it("escapes ILIKE wildcards inside the quoted value", () => {
    // ILIKE-level: `%` → `\%` so it matches literally.
    // PostgREST-level: the resulting `\` must itself be escaped to `\\`
    // so the parser doesn't consume it as the start of an escape
    // sequence inside the double-quoted value.
    expect(quotedIlikeOrValue("50%")).toBe('"%50\\\\%%"');
  });

  it("escapes backslashes so PostgREST doesn't consume them", () => {
    // Input `\` would otherwise become a lone `\` inside the quoted
    // string and PostgREST would treat it as the start of an escape.
    expect(quotedIlikeOrValue("\\")).toBe('"%\\\\\\\\%"');
  });

  it("does not let comma/period delimiters break out of the value", () => {
    // A bare interpolation of `,is_archived.eq.true` would graft an
    // extra predicate onto the OR. Wrapped in quotes, PostgREST treats
    // the whole thing as a literal value. The interior `,` and `.`
    // delimiters must be preserved (escaped underscores are fine —
    // they're for the inner ILIKE, not the .or() parser).
    const out = quotedIlikeOrValue(",is_archived.eq.true");
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
    expect(out).toContain(",is");
    expect(out).toContain(".eq.true");
  });

  it("escapes embedded double quotes to defend the quoted-value form", () => {
    expect(quotedIlikeOrValue('a"b')).toBe('"%a\\"b%"');
  });
});

describe("LogPlantObservationArgs", () => {
  const base = { plantId: "plant-1", growId: "grow-1" };

  it("accepts heightCm alone", () => {
    expect(
      LogPlantObservationArgs.safeParse({ ...base, heightCm: 42 }).success,
    ).toBe(true);
  });

  it("accepts non-empty notes alone", () => {
    expect(
      LogPlantObservationArgs.safeParse({
        ...base,
        notes: "Pistils fattening",
      }).success,
    ).toBe(true);
  });

  it("rejects when both heightCm and notes are missing", () => {
    expect(LogPlantObservationArgs.safeParse(base).success).toBe(false);
  });

  it("rejects whitespace-only notes when heightCm is missing", () => {
    expect(
      LogPlantObservationArgs.safeParse({ ...base, notes: "   " }).success,
    ).toBe(false);
    expect(
      LogPlantObservationArgs.safeParse({ ...base, notes: "\t\n " }).success,
    ).toBe(false);
  });
});
