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

    // Realtime is a non-critical UX nicety: losing it should degrade to
    // "no auto-refresh" — never to "the whole page crashed into the
    // workspace error boundary." Wrap the entire setup body in
    // try/catch so any synchronous throw from supabase-js (env vars
    // missing, breaking API change in `.channel().on().subscribe()`,
    // malformed filter string) becomes a console.warn instead of
    // taking the dashboard or grows surface down via React's error
    // boundary on hydration.
    type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;
    type RealtimeChannel = ReturnType<SupabaseBrowserClient["channel"]>;
    let supabase: SupabaseBrowserClient | undefined;
    let channels: RealtimeChannel[] = [];
    try {
      supabase = createSupabaseBrowserClient();
      const client = supabase;

      const scheduleRefresh = () => {
        setLastEventAt(Date.now());
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          router.refresh();
        }, 300);
      };

      // Build channels with a for-of + push (not `.map`) so that if any
      // `.subscribe()` throws partway through the list, the channels
      // array reflects what actually subscribed and the catch block
      // can clean them up. A `.map` would discard the partial result
      // on throw and leak the already-subscribed channels.
      for (const growId of growIds) {
        const channel = client
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
              // plant_findings has no grow_id column; we just listen
              // for any insert and let the upstream debounce + RLS
              // handle the rest. RLS ensures we only receive findings
              // for plants in grows the user can read.
            },
            scheduleRefresh,
          )
          .subscribe();
        channels.push(channel);
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(
          "useLiveAnalysis: realtime setup failed, live updates disabled",
          err,
        );
      }
      // Best-effort cleanup of anything that did get subscribed before
      // the throw.
      if (supabase) {
        for (const ch of channels) {
          try {
            void supabase.removeChannel(ch);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!supabase) return;
      for (const ch of channels) {
        try {
          void supabase.removeChannel(ch);
        } catch (err) {
          if (typeof console !== "undefined") {
            console.warn("useLiveAnalysis: channel teardown failed", err);
          }
        }
      }
    };
  }, [growIds, router]);

  return { lastEventAt };
}
