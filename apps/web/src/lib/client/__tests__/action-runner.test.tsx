// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

import {
  useActionWithRecovery,
  type ServerActionResult,
} from "@/lib/client/action-runner";

type Result = ServerActionResult & {
  fieldErrors?: Record<string, string[]>;
};

const initial: Result = { status: "idle" };

beforeEach(() => {
  push.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useActionWithRecovery", () => {
  it("on success: records recoveryUrl from redirectTo and calls router.push", async () => {
    const { result } = renderHook(() => useActionWithRecovery<Result>(initial));
    const action = vi.fn().mockResolvedValue({
      status: "success",
      redirectTo: "/dashboard",
    } satisfies Result);

    await act(async () => {
      await result.current.run(action);
    });

    expect(result.current.state.status).toBe("success");
    expect(result.current.state.recoveryUrl).toBe("/dashboard");
    expect(result.current.state.attempt).toBe(0);
    expect(result.current.isPending).toBe(false);
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("on success without redirectTo: falls back to options.fallbackUrl for recoveryUrl and does not navigate", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<Result>(initial, { fallbackUrl: "/plants" }),
    );
    await act(async () => {
      await result.current.run(async () => ({ status: "success" }) as Result);
    });

    expect(result.current.state.status).toBe("success");
    expect(result.current.state.recoveryUrl).toBe("/plants");
    expect(push).not.toHaveBeenCalled();
  });

  it("on validation error (status:'error'): surfaces result unchanged and does NOT retry", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<Result>(initial, { transientRetries: 3 }),
    );
    const action = vi.fn().mockResolvedValue({
      status: "error",
      message: "Name is required",
      fieldErrors: { name: ["Name is required"] },
    } satisfies Result);

    await act(async () => {
      await result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.message).toBe("Name is required");
    expect(result.current.state.attempt).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("retries transient errors with exponential backoff up to transientRetries, then surfaces error state", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useActionWithRecovery<Result>(initial, {
        transientRetries: 2,
        baseRetryDelayMs: 100,
        fallbackUrl: "/safe",
      }),
    );

    const transient = Object.assign(new Error("Failed to fetch"), {
      name: "NetworkError",
    });
    const action = vi.fn().mockRejectedValue(transient);

    let runPromise: Promise<Result> | undefined;
    act(() => {
      runPromise = result.current
        .run(action)
        .catch(() => ({ status: "error" }) as Result);
    });

    // Drain microtasks + both backoff delays (100ms then 200ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      await runPromise;
    });

    expect(action).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.message).toBe("Failed to fetch");
    expect(result.current.state.attempt).toBe(2);
    expect(result.current.state.recoveryUrl).toBe("/safe");
    expect(result.current.isPending).toBe(false);
  });

  it("does not retry non-transient thrown errors", async () => {
    const { result } = renderHook(() =>
      useActionWithRecovery<Result>(initial, { transientRetries: 5 }),
    );
    const action = vi.fn().mockRejectedValue(new Error("RLS denied insert"));

    await act(async () => {
      await result.current.run(action).catch(() => undefined);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.message).toBe("RLS denied insert");
  });

  it("provides a generic fallback message when a non-Error value is thrown", async () => {
    const { result } = renderHook(() => useActionWithRecovery<Result>(initial));
    const action = vi.fn().mockRejectedValue("string failure");

    await act(async () => {
      await result.current.run(action).catch(() => undefined);
    });

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.message).toMatch(/something went wrong/i);
  });

  it("succeeds even when router.push throws — recoveryUrl remains for the manual CTA", async () => {
    push.mockImplementation(() => {
      throw new Error("navigation blocked");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { result } = renderHook(() => useActionWithRecovery<Result>(initial));
    await act(async () => {
      await result.current.run(
        async () =>
          ({
            status: "success",
            redirectTo: "/grow/123",
          }) as Result,
      );
    });

    expect(result.current.state.status).toBe("success");
    expect(result.current.state.recoveryUrl).toBe("/grow/123");
    expect(warn).toHaveBeenCalledWith(
      "useActionWithRecovery: router.push failed",
      expect.any(Error),
    );

    warn.mockRestore();
  });

  it("stale-run guard: a second run() supersedes the first, only the latest result lands in state", async () => {
    const { result } = renderHook(() => useActionWithRecovery<Result>(initial));

    let resolveFirst!: (_r: Result) => void;
    const firstAction = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondAction = vi
      .fn()
      .mockResolvedValue({ status: "success", message: "second" } as Result);

    let firstPromise!: Promise<Result>;
    act(() => {
      firstPromise = result.current.run(firstAction);
    });

    await act(async () => {
      await result.current.run(secondAction);
    });
    expect(result.current.state.message).toBe("second");

    // Now resolve the first (stale) call — state must NOT regress.
    await act(async () => {
      resolveFirst({ status: "error", message: "first (stale)" } as Result);
      await firstPromise;
    });

    expect(result.current.state.message).toBe("second");
  });

  it("reset() returns to initial state and bumps runId so any in-flight call becomes stale", async () => {
    const { result } = renderHook(() => useActionWithRecovery<Result>(initial));

    await act(async () => {
      await result.current.run(
        async () =>
          ({
            status: "success",
            message: "first",
          }) as Result,
      );
    });
    expect(result.current.state.status).toBe("success");

    act(() => {
      result.current.reset();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("idle");
      expect(result.current.state.attempt).toBe(0);
      expect(result.current.isPending).toBe(false);
    });
  });
});
