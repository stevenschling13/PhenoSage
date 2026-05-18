import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimit = vi.fn();
vi.mock("../rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

const logServerEvent = vi.fn();
vi.mock("../request-id", async () => {
  const actual =
    await vi.importActual<typeof import("../request-id")>("../request-id");
  return {
    ...actual,
    logServerEvent: (...args: unknown[]) => logServerEvent(...args),
  };
});

import {
  PER_TOOL_RATE_LIMITS,
  checkPerToolRateLimit,
} from "../chat-tool-policies";

beforeEach(() => {
  rateLimit.mockReset();
  logServerEvent.mockReset();
});

describe("PER_TOOL_RATE_LIMITS", () => {
  it("declares the expected expensive-tool budgets", () => {
    // These are the tools the policy is explicitly designed to protect; if
    // someone removes or renames an entry it should be a conscious decision.
    expect(PER_TOOL_RATE_LIMITS["trigger_plant_analysis"]).toEqual({
      limit: 6,
      windowMs: 60_000,
    });
    expect(PER_TOOL_RATE_LIMITS["create_plants"]).toEqual({
      limit: 10,
      windowMs: 60_000,
    });
    expect(PER_TOOL_RATE_LIMITS["create_grow"]).toEqual({
      limit: 10,
      windowMs: 60_000,
    });
    expect(PER_TOOL_RATE_LIMITS["record_image_finding"]).toEqual({
      limit: 20,
      windowMs: 60_000,
    });
    expect(PER_TOOL_RATE_LIMITS["search_similar_findings"]).toEqual({
      limit: 20,
      windowMs: 60_000,
    });
  });
});

describe("checkPerToolRateLimit", () => {
  it("passes through (ok: true) for tools with no configured policy without touching the rate limiter", async () => {
    const result = await checkPerToolRateLimit("list_grows", {
      userId: "user-1",
      requestId: "req-1",
    });
    expect(result).toEqual({ ok: true });
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("delegates to rateLimit with the configured limit, window and a user-scoped key", async () => {
    rateLimit.mockResolvedValue({ ok: true });
    const result = await checkPerToolRateLimit("trigger_plant_analysis", {
      userId: "user-1",
      requestId: "req-1",
    });
    expect(result).toEqual({ ok: true });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(rateLimit).toHaveBeenCalledWith({
      key: "chat-tool:trigger_plant_analysis:user-1",
      limit: 6,
      windowMs: 60_000,
    });
    expect(logServerEvent).not.toHaveBeenCalled();
  });

  it("uses 'anonymous' as the subject when userId is null", async () => {
    rateLimit.mockResolvedValue({ ok: true });
    await checkPerToolRateLimit("create_grow", {
      userId: null,
      requestId: "req-2",
    });
    expect(rateLimit).toHaveBeenCalledWith({
      key: "chat-tool:create_grow:anonymous",
      limit: 10,
      windowMs: 60_000,
    });
  });

  it("returns a user-readable retry hint and logs a warn event when rate-limited", async () => {
    const now = Date.now();
    // resetAt 12s in the future → ceil(12.4) === 13
    const resetAt = now + 12_400;
    rateLimit.mockResolvedValue({ ok: false, resetAt });

    const result = await checkPerToolRateLimit("trigger_plant_analysis", {
      userId: "user-1",
      requestId: "req-3",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(
      /rate limit: too many trigger_plant_analysis calls/,
    );
    expect(result.ok === false && result.error).toMatch(/retry in ~\d+s/);

    expect(logServerEvent).toHaveBeenCalledTimes(1);
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "chat tool rate-limited",
      expect.objectContaining({
        requestId: "req-3",
        userId: "user-1",
        tool: "trigger_plant_analysis",
        resetAt,
      }),
    );
  });

  it("never reports a negative retry hint even when resetAt is already in the past", async () => {
    rateLimit.mockResolvedValue({ ok: false, resetAt: Date.now() - 5_000 });
    const result = await checkPerToolRateLimit("create_plants", {
      userId: "user-1",
      requestId: "req-4",
    });
    expect(result.ok).toBe(false);
    // Floor of the hint is 1s — verify by parsing the integer back out.
    const match =
      result.ok === false ? /retry in ~(\d+)s/.exec(result.error) : null;
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(1);
  });
});
