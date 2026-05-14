// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { useActionWithRecovery } from "../client/action-runner";

type R = {
  status: "success" | "error" | "idle";
  redirectTo?: string;
  message?: string;
};

const INITIAL: R = { status: "idle" };

describe("useActionWithRecovery", () => {
  beforeEach(() => {
    push.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("happy path: surfaces success state and calls router.push with redirectTo", async () => {
    const { result } = renderHook(() => useActionWithRecovery<R>(INITIAL));

    const action = vi
      .fn()
      .mockResolvedValue({ status: "success", redirectTo: "/grows?id=1" });

    await act(async () => {
      await result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/grows?id=1");
    expect(result.current.state.status).toBe("success");
    expect(result.current.state.recoveryUrl).toBe("/grows?id=1");
    expect(result.current.isPending).toBe(false);
  });

  it("validation errors bypass retry and surface unchanged", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<R>(INITIAL, { transientRetries: 3 }),
    );

    const action = vi.fn().mockResolvedValue({
      status: "error",
      message: "Fix the highlighted fields and try again.",
    });

    await act(async () => {
      await result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.message).toMatch(/highlighted fields/i);
  });

  it("retries a transient throw and succeeds on the second attempt", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<R>(INITIAL, {
        transientRetries: 1,
        baseRetryDelayMs: 1,
      }),
    );

    const action = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ status: "success", redirectTo: "/grows" });

    await act(async () => {
      await result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith("/grows");
    expect(result.current.state.status).toBe("success");
    expect(result.current.state.attempt).toBe(1);
  });

  it("non-transient throws are NOT retried — they surface immediately", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<R>(INITIAL, {
        transientRetries: 5,
        baseRetryDelayMs: 1,
        fallbackUrl: "/grows",
      }),
    );

    const action = vi
      .fn()
      .mockRejectedValue(new Error("RLS denied: bogus value for stage"));

    await act(async () => {
      await expect(result.current.run(action)).rejects.toThrow(/RLS denied/);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.recoveryUrl).toBe("/grows");
  });

  it("after retries exhausted, exposes the fallbackUrl as recoveryUrl", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<R>(INITIAL, {
        transientRetries: 1,
        baseRetryDelayMs: 1,
        fallbackUrl: "/grows",
      }),
    );

    const action = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await act(async () => {
      await expect(result.current.run(action)).rejects.toThrow(
        /Failed to fetch/,
      );
    });

    expect(action).toHaveBeenCalledTimes(2); // initial + 1 retry
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.recoveryUrl).toBe("/grows");
  });

  it("preserves success state even if router.push throws synchronously", async () => {
    push.mockImplementation(() => {
      throw new Error("router exploded");
    });
    const { result } = renderHook(() =>
      useActionWithRecovery<R>(INITIAL, { fallbackUrl: "/grows" }),
    );

    const action = vi
      .fn()
      .mockResolvedValue({ status: "success", redirectTo: "/grows?id=1" });

    await act(async () => {
      await result.current.run(action);
    });

    // The success state survives the router throw — recoveryUrl is the
    // user's escape hatch when navigation fails.
    expect(result.current.state.status).toBe("success");
    expect(result.current.state.recoveryUrl).toBe("/grows?id=1");
  });

  it("falls back to the fallbackUrl when the action succeeds without a redirectTo", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<R>(INITIAL, { fallbackUrl: "/grows" }),
    );

    const action = vi.fn().mockResolvedValue({ status: "success" });

    await act(async () => {
      await result.current.run(action);
    });

    expect(push).not.toHaveBeenCalled();
    expect(result.current.state.recoveryUrl).toBe("/grows");
  });

  it("reset() returns state to the initial shape", async () => {
    const { result } = renderHook(() => useActionWithRecovery<R>(INITIAL));

    const action = vi.fn().mockResolvedValue({
      status: "error",
      message: "boom",
    });

    await act(async () => {
      await result.current.run(action);
    });
    expect(result.current.state.status).toBe("error");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.message).toBeUndefined();
  });
});
