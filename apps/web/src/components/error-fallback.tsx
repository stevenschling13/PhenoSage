"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertIcon } from "@/components/icons";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface ErrorFallbackProps {
  /**
   * Short label shown above the heading (e.g. "Dashboard error").
   * Keep it specific so users know which surface failed.
   */
  eyebrow?: string;
  /** Heading. Plain language. No exception text. */
  title?: string;
  /** Body copy. Explains what's wrong and what the user can do. */
  description?: string;
  /** The error from a Next.js error boundary. Optional. */
  error?: Error & { digest?: string };
  /** Reset callback wired by a Next.js error boundary. Optional. */
  reset?: () => void;
  /**
   * Optional secondary link shown next to "Try again". Defaults to a link
   * back to the dashboard for authenticated surfaces.
   */
  secondaryHref?: string;
  secondaryLabel?: string;
}

const DEFAULT_TITLE = "Something stopped working on this page.";
const DEFAULT_DESCRIPTION =
  "We hit an unexpected error. Your data is safe. Try again, or head back to a known surface and continue from there.";

export function ErrorFallback({
  eyebrow = "Unexpected error",
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  error,
  reset,
  secondaryHref = "/dashboard",
  secondaryLabel = "Open dashboard",
}: ErrorFallbackProps) {
  useEffect(() => {
    if (error) {
      console.error("[error-boundary]", {
        message: error.message,
        digest: error.digest,
      });
    }
  }, [error]);

  const digest = error?.digest;

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-4 py-12 sm:px-6">
      <Card className="w-full">
        <CardContent className="flex flex-col items-start gap-5 p-8 sm:p-10">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-[1rem] border border-border bg-surface text-accent shadow-sm"
            aria-hidden="true"
          >
            <AlertIcon className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {eyebrow}
            </p>
            <h1
              role="alert"
              className="text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl"
            >
              {title}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              {description}
            </p>
            {digest ? (
              <p className="text-xs text-muted-foreground/80">
                Reference code: <code className="font-mono">{digest}</code>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            {reset ? (
              <button
                type="button"
                className={buttonStyles({})}
                onClick={() => reset()}
              >
                Try again
              </button>
            ) : null}
            <Link
              className={buttonStyles({ variant: "surface" })}
              href={secondaryHref}
            >
              {secondaryLabel}
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
