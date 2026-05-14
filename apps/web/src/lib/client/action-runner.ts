"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Shared shape every server action result must satisfy. Each route can
// extend it with its own message + fieldErrors typing — the runner only
// reads the status + optional redirectTo.
export type ServerActionResult = {
  status: "success" | "error" | "idle";
  redirectTo?: string;
  message?: string;
};

export type RecoveryState<R extends ServerActionResult> = R & {
  // When the action succeeds with a redirectTo, this URL is preserved
  // alongside the navigation so the page can render a manual "Continue"
  // CTA. If router.push succeeds the user navigates away before the CTA
  // matters; if navigation fails (chunk load error, blocked transition,
  // user disabled JS routing) the CTA is their escape hatch.
  recoveryUrl?: string;
  // Incremented on every retry so callers can show "Retrying… (2/3)" if
  // they want richer feedback.
  attempt: number;
};

export type UseActionWithRecoveryOptions = {
  // Maximum number of automatic retries on transient errors. Default 1.
  // Validation / RLS errors are NEVER retried — only thrown errors that
  // look like network blips.
  transientRetries?: number;
  // Base delay in ms; the runner uses exponential backoff
  // (base * 2^attempt) capped at 4× base.
  baseRetryDelayMs?: number;
  // Fallback URL the caller wants exposed via recoveryUrl when the
  // action's redirectTo is missing. Useful for "if anything goes wrong,
  // send the user to a known-good page".
  fallbackUrl?: string;
};

// Heuristic: which thrown errors look like a transient network / chunk
// problem worth retrying? Validation errors are NEVER reachable here
// because the action returns them as a structured result (status:
// "error"), not a throw.
function isTransientError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const message = "message" in err ? String(err.message ?? "") : "";
  const name = "name" in err ? String(err.name ?? "") : "";
  return (
    /network|failed to fetch|chunkloaderror|load chunk|aborted/i.test(
      message,
    ) || /ChunkLoadError|NetworkError|AbortError/i.test(name)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generic action runner with retry-then-recover semantics. Used by any
// client form that calls a server action and expects either a structured
// result or a navigation target.
//
// Recovery model:
//   1. Validation errors (status: "error") surface to the UI unchanged —
//      the form re-renders with field errors, no retry.
//   2. Thrown errors that look transient are retried with exponential
//      backoff up to `transientRetries`. On final failure, status is
//      flipped to "error" with a user-readable message.
//   3. On success, the runner records `recoveryUrl` BEFORE calling
//      router.push(). If router.push succeeds the user navigates away
//      and never sees the recovery CTA. If push fails or hangs, the
//      caller can render <Link href={state.recoveryUrl}> as an escape
//      hatch so the user never gets stranded on a stale form.
export function useActionWithRecovery<R extends ServerActionResult>(
  initialState: R,
  options: UseActionWithRecoveryOptions = {},
) {
  const { transientRetries = 1, baseRetryDelayMs = 250, fallbackUrl } = options;

  const router = useRouter();
  const [state, setState] = useState<RecoveryState<R>>({
    ...initialState,
    attempt: 0,
  });
  const [isPending, setPending] = useState(false);
  // Track the latest run so a fast double-submit can't cross streams.
  const runIdRef = useRef(0);

  const run = useCallback(
    async (action: () => Promise<R>): Promise<R> => {
      const myRunId = ++runIdRef.current;
      setPending(true);

      let lastError: unknown;
      for (let attempt = 0; attempt <= transientRetries; attempt++) {
        try {
          const result = await action();
          // Stale run — newer submission supersedes this one.
          if (runIdRef.current !== myRunId) return result;

          if (result.status === "success") {
            const recoveryUrl = result.redirectTo ?? fallbackUrl;
            setState({
              ...result,
              ...(recoveryUrl !== undefined ? { recoveryUrl } : {}),
              attempt,
            });
            setPending(false);
            // Kick off navigation. Wrapped in a try so a thrown router
            // failure (rare but possible) doesn't undo the success state
            // — the recoveryUrl CTA is still rendered.
            if (result.redirectTo) {
              try {
                router.push(result.redirectTo);
              } catch (navErr) {
                // The recoveryUrl in state is already set; the form
                // will surface a manual "Continue" CTA. Log so we can
                // diagnose post-hoc.
                if (typeof console !== "undefined") {
                  console.warn(
                    "useActionWithRecovery: router.push failed",
                    navErr,
                  );
                }
              }
            }
            return result;
          }

          // Validation / RLS error: surface unchanged, no retry.
          setState({ ...result, attempt });
          setPending(false);
          return result;
        } catch (err) {
          lastError = err;
          if (
            runIdRef.current === myRunId &&
            attempt < transientRetries &&
            isTransientError(err)
          ) {
            const delay = Math.min(
              baseRetryDelayMs * 2 ** attempt,
              baseRetryDelayMs * 4,
            );
            await sleep(delay);
            continue;
          }
          break;
        }
      }

      // All retries exhausted (or the error wasn't transient). Surface a
      // user-readable failure with the fallbackUrl wired up so the form
      // can offer a manual continue.
      if (runIdRef.current === myRunId) {
        const message =
          lastError instanceof Error
            ? lastError.message
            : "Something went wrong. Please try again in a moment.";
        const next: RecoveryState<R> = {
          ...initialState,
          status: "error",
          message,
          attempt: transientRetries,
        };
        if (fallbackUrl !== undefined) next.recoveryUrl = fallbackUrl;
        setState(next);
        setPending(false);
      }
      // Re-throw so callers that want their own try/catch can still see
      // it. The component-level state has already been updated.
      throw lastError;
    },
    [transientRetries, baseRetryDelayMs, fallbackUrl, initialState, router],
  );

  const reset = useCallback(() => {
    runIdRef.current++;
    setState({ ...initialState, attempt: 0 });
    setPending(false);
  }, [initialState]);

  return { state, isPending, run, reset };
}
