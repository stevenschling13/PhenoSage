"use client";

import type { GrowStage } from "@phenosage/shared";
import { Button } from "@/components/ui/button";
import { useActionWithRecovery } from "@/lib/client/action-runner";
import { advanceGrowStageAction } from "./actions";
import {
  advanceGrowStageActionInitialState,
  type AdvanceGrowStageActionResult,
} from "./action-state";

// Linear vocabulary order matches the create-grow form's option list.
// `dry_cure` is the terminal stage — beyond it there's no "next" step
// to offer, so the stepper renders nothing instead of a noop button.
const STAGE_ORDER: GrowStage[] = [
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
];

const STAGE_LABEL: Record<GrowStage, string> = {
  germination: "Germination",
  seedling: "Seedling",
  vegetative: "Vegetative",
  pre_flower: "Pre-flower",
  flower: "Flower",
  late_flower: "Late flower",
  harvest: "Harvest",
  dry_cure: "Dry / cure",
};

function nextStageOf(current: GrowStage | null): GrowStage | null {
  if (!current) return STAGE_ORDER[0]!;
  const idx = STAGE_ORDER.indexOf(current);
  if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1]!;
}

// One-click forward stage transition shown on the grow detail page.
// Owner-only by RLS; non-owners see the button but get a clean error
// message back. The owner-gating in the page also hides this for
// non-owners, so this is the destructive-action recovery path more
// than the primary UX.
export function StageStepper({
  growId,
  currentStage,
}: {
  growId: string;
  currentStage: GrowStage | null;
}) {
  const next = nextStageOf(currentStage);
  const { state, isPending, run } =
    useActionWithRecovery<AdvanceGrowStageActionResult>(
      advanceGrowStageActionInitialState,
      { fallbackUrl: `/grows/${growId}` },
    );

  if (!next) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        Final stage. Use Edit to change the stage manually.
      </p>
    );
  }

  async function onSubmit() {
    if (!next) return;
    try {
      await run(() => advanceGrowStageAction(growId, next));
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("advanceGrowStageAction failed after retries", err);
      }
    }
  }

  return (
    <div className="space-y-2">
      <form action={onSubmit}>
        <Button
          aria-busy={isPending || undefined}
          disabled={isPending}
          size="sm"
          type="submit"
          variant="surface"
        >
          {isPending ? "Advancing…" : `Advance to ${STAGE_LABEL[next]}`}
        </Button>
      </form>
      {state.status === "error" && state.message ? (
        <p
          aria-live="polite"
          className="text-sm leading-6 text-danger"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p
          aria-live="polite"
          className="text-sm leading-6 text-muted-foreground"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
