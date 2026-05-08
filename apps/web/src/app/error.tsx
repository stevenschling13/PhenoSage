"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertIcon } from "@/components/icons";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[app/error] uncaught exception:", error);
    }
  }, [error]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-16 outline-none sm:px-6 lg:px-8"
    >
      <Card className="w-full">
        <CardContent
          role="alert"
          aria-live="assertive"
          className="flex flex-col items-start gap-5 p-8 sm:p-10"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] border border-border bg-surface text-destructive shadow-sm">
            <AlertIcon className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Something went wrong
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl">
              We hit an unexpected error.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              The page failed to load. This may be a transient issue with one of
              our upstream services. Try again in a moment, or return to the
              dashboard. If the problem persists, our team has been notified.
            </p>
            {error.digest ? (
              <p className="text-xs text-muted-foreground/70">
                Reference: <code className="font-mono">{error.digest}</code>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={buttonStyles({})}
              onClick={() => reset()}
            >
              Try again
            </button>
            <Link
              className={buttonStyles({ variant: "surface" })}
              href="/dashboard"
            >
              Back to dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
