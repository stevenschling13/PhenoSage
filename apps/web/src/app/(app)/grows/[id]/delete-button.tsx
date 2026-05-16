"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useActionWithRecovery } from "@/lib/client/action-runner";
import { deleteGrowAction } from "./actions";
import {
  deleteGrowActionInitialState,
  type DeleteGrowActionResult,
} from "./action-state";

// Destructive island. Two-step UI: the "Delete grow" CTA reveals an
// inline confirmation that requires the user to retype the grow name.
// Match is case- and whitespace-insensitive so trivial typos still
// pass — but the user must produce the actual word, not "yes" or "y".
//
// On success the action returns a redirectTo (/grows?deleted=1) and
// the recovery hook fires router.push automatically. If push fails
// the runner still records `recoveryUrl` and we surface a manual
// link so the user is never stranded on a dead detail page.
export function DeleteGrowButton({
  growId,
  growName,
}: {
  growId: string;
  growName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const { state, isPending, run } =
    useActionWithRecovery<DeleteGrowActionResult>(
      deleteGrowActionInitialState,
      { fallbackUrl: "/grows" },
    );

  const trimmed = typed.trim();
  const matches = trimmed.toLowerCase() === growName.trim().toLowerCase();

  async function onSubmit() {
    if (!matches) return;
    try {
      await run(() => deleteGrowAction(growId, trimmed));
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("deleteGrowAction failed after retries", err);
      }
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Button
          onClick={() => setOpen(true)}
          size="sm"
          type="button"
          variant="destructive"
        >
          Delete grow
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Permanently removes the grow plus all plants, photos, analyses, and
          tasks. Assistant chats scoped here are kept (unscoped). Cannot be
          undone — prefer Archive if you might want it back.
        </p>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="confirm-delete-name"
        >
          Type{" "}
          <span className="font-semibold text-danger">
            &ldquo;{growName}&rdquo;
          </span>{" "}
          to confirm
        </label>
        <input
          autoComplete="off"
          autoFocus
          className="mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
          id="confirm-delete-name"
          name="confirmName"
          onChange={(event) => setTyped(event.target.value)}
          placeholder={growName}
          type="text"
          value={typed}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          aria-busy={isPending || undefined}
          disabled={isPending || !matches}
          size="sm"
          type="submit"
          variant="destructive"
        >
          {isPending ? "Deleting…" : "Confirm delete"}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
          size="sm"
          type="button"
          variant="surface"
        >
          Cancel
        </Button>
      </div>

      {state.status === "error" && state.message ? (
        <p
          aria-live="polite"
          className="text-sm leading-6 text-danger"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
