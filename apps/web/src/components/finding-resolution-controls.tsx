"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FindingResolutionState } from "@phenosage/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface FindingResolutionControlsProps {
  plantId: string;
  findingId: string;
  initialState: FindingResolutionState;
}

const STATE_LABEL: Record<FindingResolutionState, string> = {
  pending: "Needs review",
  confirmed: "Confirmed",
  rejected: "Rejected",
  false_positive: "False positive",
};

const STATE_TONE: Record<
  FindingResolutionState,
  "default" | "success" | "warning" | "danger" | "accent"
> = {
  pending: "warning",
  confirmed: "success",
  rejected: "default",
  false_positive: "danger",
};

export function FindingResolutionControls({
  plantId,
  findingId,
  initialState,
}: FindingResolutionControlsProps) {
  const router = useRouter();
  const [state, setState] = useState<FindingResolutionState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit(next: FindingResolutionState) {
    if (isPending || next === state) {
      return;
    }
    setError(null);
    // Optimistic — server confirms on success; revert on failure so the
    // ledger never lies about what the server thinks.
    const previous = state;
    setState(next);

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/plants/${plantId}/findings/${findingId}/resolution`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: next }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: { resolutionState?: FindingResolutionState };
          error?: { message?: string };
        };
        if (!response.ok) {
          setState(previous);
          setError(
            payload.error?.message ??
              "Could not save your decision. Try again shortly.",
          );
          return;
        }
        if (payload.data?.resolutionState) {
          setState(payload.data.resolutionState);
        }
        // Refresh server data so the linked task's status (auto-dismissed
        // by the resolution_dismiss_task trigger when next is rejected /
        // false_positive) reflects the new state on the next render.
        router.refresh();
      } catch {
        setState(previous);
        setError("Network error. Try again shortly.");
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          aria-pressed={state === "confirmed"}
          disabled={isPending || state === "confirmed"}
          onClick={() => submit("confirmed")}
          size="sm"
          variant="surface"
        >
          Confirm
        </Button>
        <Button
          aria-pressed={state === "rejected"}
          disabled={isPending || state === "rejected"}
          onClick={() => submit("rejected")}
          size="sm"
          variant="surface"
        >
          Reject
        </Button>
        <Button
          aria-pressed={state === "false_positive"}
          disabled={isPending || state === "false_positive"}
          onClick={() => submit("false_positive")}
          size="sm"
          variant="surface"
        >
          Mark false positive
        </Button>
        {state !== "pending" ? (
          <Button
            disabled={isPending}
            onClick={() => submit("pending")}
            size="sm"
            variant="ghost"
          >
            Undo
          </Button>
        ) : null}
      </div>
      {error ? (
        <div
          aria-live="assertive"
          role="alert"
          className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
