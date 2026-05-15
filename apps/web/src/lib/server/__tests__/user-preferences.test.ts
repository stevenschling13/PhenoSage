import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../request-id", () => ({
  logServerEvent: vi.fn(),
}));

import {
  loadUserPreferences,
  loadUserPreferencesBulk,
} from "../user-preferences";

type ChainResult = {
  data?: unknown[] | unknown | null;
  error?: { message: string } | null;
};

function makeBulkBuilder(result: ChainResult) {
  const builder: Record<string, (..._a: unknown[]) => unknown> = {};
  const passthrough = () => builder;
  builder.select = passthrough;
  builder.in = passthrough;
  (
    builder as unknown as { then: (_r: (_v: ChainResult) => void) => void }
  ).then = (resolve) => resolve(result);
  return builder;
}

function makeSingleBuilder(result: ChainResult) {
  const builder: Record<string, (..._a: unknown[]) => unknown> = {};
  const passthrough = () => builder;
  builder.select = passthrough;
  builder.eq = passthrough;
  builder.maybeSingle = () => Promise.resolve(result);
  return builder;
}

describe("loadUserPreferencesBulk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty map when given no user ids", async () => {
    const supabase = { from: vi.fn() };
    const out = await loadUserPreferencesBulk(supabase as never, []);
    expect(out.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("backfills users with no row to UTC default", async () => {
    const supabase = {
      from: vi.fn(() =>
        makeBulkBuilder({
          data: [{ user_id: "u1", timezone: "America/Los_Angeles" }],
          error: null,
        }),
      ),
    };
    const out = await loadUserPreferencesBulk(supabase as never, ["u1", "u2"]);
    expect(out.get("u1")?.timezone).toBe("America/Los_Angeles");
    expect(out.get("u2")?.timezone).toBe("UTC");
  });

  it("falls through to UTC for every id when the query errors", async () => {
    const supabase = {
      from: vi.fn(() =>
        makeBulkBuilder({ data: null, error: { message: "boom" } }),
      ),
    };
    const out = await loadUserPreferencesBulk(supabase as never, ["a", "b"]);
    expect(out.get("a")?.timezone).toBe("UTC");
    expect(out.get("b")?.timezone).toBe("UTC");
  });

  it("normalises malformed timezone strings to UTC", async () => {
    const supabase = {
      from: vi.fn(() =>
        makeBulkBuilder({
          data: [{ user_id: "u1", timezone: "Mars/Olympus_Mons" }],
          error: null,
        }),
      ),
    };
    const out = await loadUserPreferencesBulk(supabase as never, ["u1"]);
    expect(out.get("u1")?.timezone).toBe("UTC");
  });
});

describe("loadUserPreferences", () => {
  it("returns the stored timezone when present", async () => {
    const supabase = {
      from: vi.fn(() =>
        makeSingleBuilder({ data: { timezone: "Europe/Berlin" }, error: null }),
      ),
    };
    const out = await loadUserPreferences(supabase as never, "u1");
    expect(out.timezone).toBe("Europe/Berlin");
  });

  it("returns UTC when no row exists", async () => {
    const supabase = {
      from: vi.fn(() => makeSingleBuilder({ data: null, error: null })),
    };
    const out = await loadUserPreferences(supabase as never, "u1");
    expect(out.timezone).toBe("UTC");
  });

  it("returns UTC and logs when the query errors", async () => {
    const supabase = {
      from: vi.fn(() =>
        makeSingleBuilder({ data: null, error: { message: "boom" } }),
      ),
    };
    const out = await loadUserPreferences(supabase as never, "u1");
    expect(out.timezone).toBe("UTC");
  });
});
