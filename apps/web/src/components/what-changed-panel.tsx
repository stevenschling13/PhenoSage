"use client";

import { useCallback, useState } from "react";
import type { ImageComparisonResult, UniformityDelta } from "@phenosage/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageComparison } from "@/components/image-comparison";

interface ComparisonFrame {
  imageId: string;
  signedUrl: string;
  label: string;
}

interface WhatChangedPanelProps {
  plantId: string;
  before: ComparisonFrame;
  after: ComparisonFrame;
}

type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: ImageComparisonResult }
  | { status: "error"; message: string; retryable: boolean };

const UNIFORMITY_LABEL: Record<UniformityDelta, string> = {
  improved: "Improved",
  unchanged: "Unchanged",
  declined: "Declined",
  unknown: "Unknown",
};

const UNIFORMITY_TONE: Record<
  UniformityDelta,
  "accent" | "warning" | "danger" | "default"
> = {
  improved: "accent",
  unchanged: "default",
  declined: "danger",
  unknown: "warning",
};

/**
 * "What Changed?" panel: side-by-side images plus an on-demand AI
 * description of the differences. The comparison is computed server-side
 * via `POST /api/plants/[plantId]/what-changed` and is intentionally NOT
 * persisted — every fresh click re-runs the vision call, gated by the
 * 6/min/user rate limit on that route. Result is cached client-side per
 * `(beforeImageId, afterImageId)` so the user can flip away from the
 * card and back without paying again.
 */
export function WhatChangedPanel({
  plantId,
  before,
  after,
}: WhatChangedPanelProps) {
  const [state, setState] = useState<RequestState>({ status: "idle" });

  const fetchComparison = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/plants/${encodeURIComponent(plantId)}/what-changed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        const message =
          body?.error?.message ??
          (response.status === 429
            ? "Too many comparisons in a short window. Try again in a minute."
            : response.status === 422
              ? "Two captures are required before PhenoSage can compare."
              : "Could not generate a comparison. Please try again.");
        setState({
          status: "error",
          message,
          retryable: response.status >= 500 || response.status === 429,
        });
        return;
      }
      const body = (await response.json()) as {
        data: ImageComparisonResult;
      };
      setState({ status: "ready", result: body.data });
    } catch (_err) {
      setState({
        status: "error",
        message: "Network error while contacting PhenoSage.",
        retryable: true,
      });
    }
  }, [plantId]);

  return (
    <div className="space-y-4">
      <ImageComparison plantId={plantId} before={before} after={after} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={fetchComparison}
          disabled={state.status === "loading"}
          size="sm"
          variant="primary"
        >
          {state.status === "loading"
            ? "Analyzing changes…"
            : state.status === "ready"
              ? "Re-run comparison"
              : "What changed?"}
        </Button>
        {state.status === "ready" ? (
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {Math.round(state.result.confidence * 100)}% confidence ·{" "}
            {state.result.isFallback ? "Inconclusive" : "Model"}
          </span>
        ) : null}
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3 text-sm text-foreground"
        >
          {state.message}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <ComparisonReadout result={state.result} />
      ) : null}
    </div>
  );
}

function ComparisonReadout({ result }: { result: ImageComparisonResult }) {
  return (
    <div className="rounded-[1.25rem] border border-border/70 bg-background-subtle/70 p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={UNIFORMITY_TONE[result.uniformityDelta]}>
          {UNIFORMITY_LABEL[result.uniformityDelta]}
        </Badge>
        {result.isFallback ? (
          <Badge tone="warning">Fallback output</Badge>
        ) : null}
      </div>
      <p className="text-sm leading-7 text-foreground">{result.summary}</p>
      <ul className="space-y-2">
        {result.bullets.map((bullet, idx) => (
          <li
            key={`${idx}-${bullet.slice(0, 32)}`}
            className="flex gap-3 text-sm leading-6 text-foreground"
          >
            <span
              aria-hidden
              className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"
            />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      {result.isFallback ? (
        <p className="text-xs text-muted-foreground">
          The comparison service was unavailable. The output above is a
          placeholder — treat it as inconclusive.
        </p>
      ) : null}
    </div>
  );
}
