"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Last-resort error boundary. Replaces the entire root layout when an
 * exception is thrown in the layout itself or anywhere it cannot be caught
 * by `app/error.tsx`. Rendered without the app shell, so it must include
 * its own <html> and <body>.
 *
 * Keep dependencies minimal — this file runs when nothing else can.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[app/global-error] catastrophic failure:", error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: "#0f1411",
          color: "#e8efe7",
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{
            maxWidth: "32rem",
            padding: "2rem",
            borderRadius: "1rem",
            border: "1px solid #2a322a",
            background: "#161c18",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#9aa39a",
            }}
          >
            Application error
          </p>
          <h1
            style={{
              marginTop: "0.75rem",
              fontSize: "1.75rem",
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            PhenoSage failed to load.
          </h1>
          <p style={{ marginTop: "1rem", lineHeight: 1.6, color: "#b8c0b8" }}>
            We hit a fatal error rendering the page. Try reloading. If the
            problem persists, our team has been notified.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color: "#7a827a",
              }}
            >
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "0.6rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #3a423a",
                background: "#4a8a4a",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                padding: "0.6rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #3a423a",
                background: "transparent",
                color: "#e8efe7",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
