"use client";

import { useLiveAnalysis } from "@/lib/use-live-analysis";

/**
 * Tiny client island that subscribes to live analysis events for the
 * given grows and triggers `router.refresh()` when new analyses or
 * findings land. Render this from any server component that wants its
 * data to update automatically when the chat composer (or any other
 * surface) creates a new analysis.
 *
 * Returns nothing visible — it's pure side effect. Place it at the
 * bottom of the page so it doesn't affect layout.
 */
export function LiveAnalysisRefresher({ growIds }: { growIds: string[] }) {
  useLiveAnalysis({ growIds });
  return null;
}
