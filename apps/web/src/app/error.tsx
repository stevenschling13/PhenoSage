"use client";

import { ErrorFallback } from "@/components/error-fallback";

/**
 * Segment-level error boundary. Catches uncaught exceptions thrown in any
 * server or client component below the root layout, including unhandled
 * fetch failures and rendering errors. Renders a recoverable fallback so
 * users see a clear message instead of a blank screen.
 *
 * Next.js automatically wraps every route segment with this file.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      eyebrow="Page error"
      title="We hit an unexpected error."
      description="The page failed to load. This may be a transient issue with one of our upstream services. Try again in a moment, or return to a known surface. If the problem persists, our team has been notified."
      error={error}
      reset={reset}
      secondaryHref="/dashboard"
      secondaryLabel="Back to dashboard"
    />
  );
}
