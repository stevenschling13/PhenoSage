"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

/**
 * Subscribes to Supabase Realtime INSERT events on `plant_analyses` and
 * `plant_findings` for the user's grows and triggers a Next App Router
 * `router.refresh()` whenever a new row lands. This is what makes the
 * `/plants/[id]`, `/dashboard`, and `/grows` pages update on their own
 * after the chat composer kicks off an analysis on a fresh image — no
 * manual reload required.
 *
 * Implementation notes:
 * - Postgres-changes filters only support `eq.` (and similar single-value
 *   ops). They do NOT support `in.()`. We therefore subscribe to one
 *   channel per grow_id and let RLS enforce read access if anyone tries
 *   to spoof. For zero growIds we no-op (no subscriptions, no refresh).
 * - We debounce refreshes with a short trailing window — a single
 *   analysis can produce N findings rows in quick succession and we only
 *   need one server re-render to pick them all up.
 * - The supabase_realtime publication must include these tables; that
 *   ALTER PUBLICATION call lives in `supabase/migrations/006_chat_attachments.sql`.
 */
export function useLiveAnalysis({ growIds }: { growIds: string[] }) {
  const router = useRouter();
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (growIds.length === 0) return;
    // `createSupabaseBrowserClient` throws when the public env vars
    // aren't bundled (e.g. a Vercel deploy that built before the
    // Supabase integration synced its keys). Swallow that throw so a
    // live-update side-effect can never take the entire dashboard
    // page down via React's error boundary — losing realtime is a
    // graceful degradation; losing the page isn't.
    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(
          "useLiveAnalysis: browser supabase client unavailable, realtime disabled",
          err,
        );
      }
      return;
    }

    const scheduleRefresh = () => {
      setLastEventAt(Date.now());
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.refresh();
      }, 300);
    };

    const channels = growIds.map((growId) => {
      const channel = supabase
        .channel(`live-analysis:${growId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "plant_analyses",
            filter: `grow_id=eq.${growId}`,
          },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "plant_findings",
            // plant_findings has no grow_id column; we just listen for
            // any insert and let the upstream debounce + RLS handle the
            // rest. RLS ensures we only receive findings for plants in
            // grows the user can read.
          },
          scheduleRefresh,
        )
        .subscribe();
      return channel;
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const ch of channels) {
        void supabase.removeChannel(ch);
      }
    };
  }, [growIds, router]);

  return { lastEventAt };
}
