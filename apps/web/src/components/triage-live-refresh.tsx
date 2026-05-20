"use client";

import { useTriageRealtime } from "@/lib/use-triage-realtime";

/**
 * Invisible side-effect component that mounts the triage Realtime
 * subscription. Lives as its own component so the page itself can
 * stay a Server Component — `useTriageRealtime` needs the browser
 * supabase client, which is client-only.
 */
export function TriageLiveRefresh() {
  useTriageRealtime();
  return null;
}
