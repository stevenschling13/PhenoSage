"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function AssistantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      eyebrow="Assistant error"
      title="The grow copilot is unavailable right now."
      description="Your grow data is safe. Try again, or return to the dashboard and continue from there. If the issue persists, the chat service may be temporarily down."
      error={error}
      reset={reset}
      secondaryHref="/dashboard"
      secondaryLabel="Back to dashboard"
    />
  );
}
