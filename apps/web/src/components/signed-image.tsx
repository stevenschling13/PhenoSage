"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Image wrapper that auto-refreshes a Supabase signed URL on expiry.
 *
 * Pages render an initial signed URL into `initialSrc` at SSR time
 * (typically with a 10-60 minute TTL). If the user leaves the page
 * open past that window, Supabase returns 403 for the next fetch and
 * the `<img>` fires an `error` event. This component catches that
 * event exactly once and asks `/api/uploads/refresh` for a fresh URL
 * bound to `(plantId, imageId)`. If the refresh also fails — network
 * error, true 404, ownership revoked — the component renders the
 * supplied `fallback` (or nothing) instead of looping.
 *
 * Why a one-shot retry rather than unlimited:
 *   - A broken image whose URL can't be refreshed (deleted, RLS
 *     revoked, network down) would otherwise loop forever, hammering
 *     the refresh endpoint and the rate limiter.
 *   - Legitimate expiry is a single event per render — one retry
 *     covers it; anything beyond is the failure mode above.
 *
 * Resetting state when a different image is shown: this component
 * does NOT watch `initialSrc` for changes. If a caller wants the
 * one-shot retry budget reset (e.g. because the visible image
 * changed), they should pass `key={imageId}` so React unmounts and
 * remounts. That's the standard "reset state by changing key" pattern
 * and it keeps this component free of the cascading-render hazard
 * that a useEffect-driven reset would introduce.
 */

type SignedImageProps = {
  plantId: string;
  imageId: string;
  /** The initial server-rendered signed URL. */
  initialSrc: string;
  /** Required for accessibility. */
  alt: string;
  /** Optional class for the underlying `<img>`. */
  className?: string;
  /** Element to render when both the initial URL and a refresh fail. */
  fallback?: React.ReactNode;
  /**
   * Test seam: override the refresh fetcher. Production callers should
   * not pass this — the default hits `/api/uploads/refresh` with the
   * standard envelope.
   */
  refreshFn?: (_params: {
    plantId: string;
    imageId: string;
  }) => Promise<{ signedUrl: string } | null>;
  /**
   * Optional callback so wider error logging / Sentry breadcrumbs can
   * be wired without depending on a global logger from a client
   * component. Called once when the second URL also fails.
   */
  onPermanentFailure?: (_reason: "initial-and-refresh-failed") => void;
};

async function defaultRefresh(params: {
  plantId: string;
  imageId: string;
}): Promise<{ signedUrl: string } | null> {
  try {
    const res = await fetch("/api/uploads/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { signedUrl?: string };
    return data.signedUrl ? { signedUrl: data.signedUrl } : null;
  } catch {
    // Network errors collapse to "couldn't refresh" — the caller's
    // fallback UI is the right place to surface that to the user.
    return null;
  }
}

export function SignedImage({
  plantId,
  imageId,
  initialSrc,
  alt,
  className,
  fallback = null,
  refreshFn = defaultRefresh,
  onPermanentFailure,
}: SignedImageProps) {
  const [src, setSrc] = useState(initialSrc);
  const [failed, setFailed] = useState(false);
  // `refreshedRef` tracks whether we've already issued a refresh for
  // *this mount*. Using a ref rather than state means the value
  // updates synchronously inside `handleError`, so a rapid double
  // `onError` (browser quirks, devtools throttling) can't fire two
  // refresh calls.
  const refreshedRef = useRef(false);

  const handleError = useCallback(async () => {
    if (refreshedRef.current) {
      // Second failure: the refresh URL didn't work either. Surface
      // the failure to the caller (for logging) and render the
      // fallback. No more network calls — we don't want to feed a
      // hot-loop into the rate limiter.
      setFailed(true);
      onPermanentFailure?.("initial-and-refresh-failed");
      return;
    }
    refreshedRef.current = true;
    // `.catch(() => null)` guarantees a refreshFn that throws — a
    // test seam that synchronously rejects, a network error not
    // already caught by `defaultRefresh` — never escapes this async
    // event handler as an unhandled rejection. A thrown error and a
    // null return funnel through the same fallback path.
    const result = await refreshFn({ plantId, imageId }).catch(() => null);
    if (!result) {
      setFailed(true);
      onPermanentFailure?.("initial-and-refresh-failed");
      return;
    }
    setSrc(result.signedUrl);
  }, [refreshFn, plantId, imageId, onPermanentFailure]);

  if (failed) {
    return <>{fallback}</>;
  }

  // next/image is unsuitable here: it requires the dynamic signed-URL
  // host to be whitelisted at build time, and it doesn't expose an
  // `onError` hook compatible with our refresh-on-403 swap. Plain
  // `<img>` is the right primitive for this use case.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onError={handleError} />
  );
}
