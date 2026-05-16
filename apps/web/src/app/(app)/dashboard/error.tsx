"use client";

import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

// Route-scoped error boundary for /dashboard. With the dashboard page's
// post-#175 Promise.allSettled defences, the server-side render of this
// page should never throw — getCurrentProfile falls back to null and
// getWorkspaceOverview returns EMPTY_WORKSPACE_OVERVIEW on any error.
// The only realistic remaining failure modes are:
//
//   1. A client-side throw during hydration (e.g., a realtime hook
//      can't initialise because public Supabase env vars haven't
//      finished syncing). These show `digest === undefined`.
//   2. A truly unexpected Server Component throw that escapes the
//      defences (defence-in-depth backstop, not the expected path).
//      These show a populated `digest` we can grep in Vercel logs.
//
// This boundary keeps the user moving — they can refresh the page,
// jump to a known-good surface, or read off the digest for support.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="app-page">
      <section className="rounded-[1.15rem] border border-warning/40 bg-warning/10 px-5 py-5 text-sm leading-6 text-foreground">
        <p className="text-base font-semibold">
          We hit a snag loading your dashboard.
        </p>
        <p className="mt-2 text-muted-foreground">
          Your data is safe. Refresh this surface, or jump straight to a grow,
          plant, or the copilot — they&apos;re all reachable from here.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className={buttonStyles({ size: "md" })}
            onClick={reset}
            type="button"
          >
            Refresh dashboard
          </button>
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href="/grows"
          >
            Open grows
          </Link>
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href="/plants"
          >
            Open plants
          </Link>
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href="/assistant"
          >
            Open copilot
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Reference: <code className="font-mono">{error.digest}</code>
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            This looked like a client-side hiccup (no server reference). A
            refresh almost always fixes it.
          </p>
        )}
      </section>
    </main>
  );
}
