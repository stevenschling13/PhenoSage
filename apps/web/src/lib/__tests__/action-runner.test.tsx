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

  it("surfaces a generic message when a non-Error value is thrown", async () => {
    const { result } = renderHook(() => useActionWithRecovery<R>(INITIAL));
    const action = vi.fn().mockRejectedValue("string failure");

    await act(async () => {
      await expect(result.current.run(action)).rejects.toBeDefined();
    });

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.message).toMatch(/something went wrong/i);
  });

  it("stale-run guard: a later run() supersedes an in-flight earlier one", async () => {
    const { result } = renderHook(() => useActionWithRecovery<R>(INITIAL));

    let resolveFirst!: (_value: R) => void;
    const firstAction = vi.fn(
      () =>
        new Promise<R>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondAction = vi
      .fn()
      .mockResolvedValue({ status: "success", message: "second" } as R);

    let firstPromise!: Promise<R>;
    act(() => {
      firstPromise = result.current.run(firstAction);
    });

    await act(async () => {
      await result.current.run(secondAction);
    });
    expect(result.current.state.message).toBe("second");

    // Resolving the first (stale) call must NOT regress state.
    await act(async () => {
      resolveFirst({ status: "error", message: "first (stale)" } as R);
      await firstPromise;
    });

    expect(result.current.state.message).toBe("second");
  });

  it("reset() bumps the run id so an in-flight call's result is ignored", async () => {
    const { result } = renderHook(() => useActionWithRecovery<R>(INITIAL));

    let resolvePending!: (_value: R) => void;
    const pendingAction = vi.fn(
      () =>
        new Promise<R>((resolve) => {
          resolvePending = resolve;
        }),
    );

    let runPromise!: Promise<R>;
    act(() => {
      runPromise = result.current.run(pendingAction);
    });
    expect(result.current.isPending).toBe(true);

    // Reset BEFORE the action settles. This is the contract reset() owes
    // callers — if the user navigates away or dismisses the form mid-
    // flight, the late result must not overwrite the freshly-reset state.
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.status).toBe("idle");
    expect(result.current.isPending).toBe(false);

    await act(async () => {
      resolvePending({
        status: "success",
        redirectTo: "/somewhere",
        message: "late winner",
      } as R);
      await runPromise;
    });

    // State stayed at the post-reset idle shape; router.push was suppressed.
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.message).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });
});
