"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      eyebrow="Workspace error"
      title="We couldn't load this workspace view."
      description="Something went wrong while loading your data. Your work is safe. Try again, or return to the dashboard and pick another surface."
      error={error}
      reset={reset}
      secondaryHref="/dashboard"
      secondaryLabel="Open dashboard"
    />
  );
}
