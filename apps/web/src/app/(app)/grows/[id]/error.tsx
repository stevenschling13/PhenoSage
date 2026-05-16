"use client";

import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

// Route-scoped error boundary for /grows/[id]. The May 15 2026 audit
// surfaced a flow where clicking "Create grow" succeeded server-side
// (the row landed in `grows`) but the post-create redirect to the
// detail page hit a render error, leaving the user on a generic
// "Server Components render" page. From the user's perspective the
// grow "was never created" — they bounced away before the just_created
// banner could confirm the save.
//
// This boundary catches any render failure inside the detail page
// (data fetch, query timeout, RLS edge case) and shows the user a
// clear "your grow IS saved, here's how to see it" path. The grow
// registry (`/grows`) lists every accessible grow, so the user is
// never stranded.
//
// The boundary is intentionally minimal and dependency-free so it can
// never throw itself. Logging is left to the server-side hook that
// triggered the throw — the client boundary's job is to keep the user
// moving.
export default function GrowDetailError({
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
          Your grow was saved — but we hit a snag loading its detail page.
        </p>
        <p className="mt-2 text-muted-foreground">
          The new grow is already in your registry. Open it from there or try
          this page again.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link className={buttonStyles({ size: "md" })} href="/grows">
            Open the grow registry
          </Link>
          <button
            className={buttonStyles({ size: "md", variant: "surface" })}
            onClick={reset}
            type="button"
          >
            Try this page again
          </button>
        </div>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
