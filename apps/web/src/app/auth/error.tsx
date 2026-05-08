"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      eyebrow="Sign-in error"
      title="The sign-in page didn't load."
      description="We hit an unexpected error preparing the sign-in form. Try again in a moment, or return home and try a different entry point."
      error={error}
      reset={reset}
      secondaryHref="/"
      secondaryLabel="Go home"
    />
  );
}
