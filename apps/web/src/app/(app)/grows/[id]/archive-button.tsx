"use client";

import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { useActionWithRecovery } from "@/lib/client/action-runner";
import { toggleGrowArchiveAction } from "./actions";
import {
  toggleArchiveActionInitialState,
  type ToggleArchiveActionResult,
} from "./action-state";

// Client island that hosts the archive / restore toggle. The form
// inherits the same auto-correction pattern as create-grow:
//   * Transient network errors retry once with backoff.
//   * Permanent errors surface the message + a manual link to /grows
//     so the user is never stranded on a stale detail page.
//   * On success router.push refreshes the page (server action also
//     revalidatePath's the route so the UI mirrors the new state).
//
// Owner-only by RLS — non-owners see the same form but the server
// action returns a "Only the grow owner can…" message.
export function ArchiveButton({
  growId,
  isArchived,
}: {
  growId: string;
  isArchived: boolean;
}) {
  const { state, isPending, run } =
    useActionWithRecovery<ToggleArchiveActionResult>(
      toggleArchiveActionInitialState,
      { fallbackUrl: "/grows" },
    );

  async function onSubmit() {
    try {
      await run(() => toggleGrowArchiveAction(growId, !isArchived));
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("toggleGrowArchiveAction failed after retries", err);
      }
    }
  }

  const label = isArchived ? "Restore grow" : "Archive grow";
  const verbing = isArchived ? "Restoring…" : "Archiving…";

  return (
    <div className="space-y-2">
      <form action={onSubmit}>
        <Button
          aria-busy={isPending || undefined}
          disabled={isPending}
          size="sm"
          type="submit"
          variant={isArchived ? "primary" : "surface"}
        >
          {isPending ? verbing : label}
        </Button>
      </form>
      {state.status === "error" && state.message ? (
        <p
          aria-live="polite"
          className="text-sm leading-6 text-danger"
          role="status"
        >
          {state.message}
          {state.recoveryUrl ? (
            <>
              {" "}
              <Link className="text-accent underline" href={state.recoveryUrl}>
                Back to grow registry
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p
          aria-live="polite"
          className="text-sm leading-6 text-muted-foreground"
          role="status"
        >
          {state.message}{" "}
          {state.recoveryUrl ? (
            <Link
              className={buttonStyles({ size: "sm", variant: "surface" })}
              href={state.recoveryUrl}
            >
              Refresh
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
