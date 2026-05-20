"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

/**
 * Subscribes to Supabase Realtime events that can change what the
 * `/triage` page shows and triggers a Next App Router `router.refresh()`
 * whenever one fires. Specifically:
 *
 *   * `plant_findings` INSERT  — a new pending finding lands.
 *   * `plant_findings` UPDATE  — a finding's resolution_state changed
 *     (confirm / reject / false-positive moves it out of the pending bucket).
 *   * `grow_tasks`     INSERT  — a new task spawned from a finding or
 *     manually created.
 *   * `grow_tasks`     UPDATE  — status transitions to/from open /
 *     in_progress / done / dismissed.
 *
 * RLS does the filtering for us — Realtime only delivers row changes
 * the user can SELECT, so we don't need to scope by growIds. This
 * mirrors the `useLiveAnalysis` precedent.
 *
 * Implementation notes:
 *   * Debounce with a short trailing window — a single confirm-finding
 *     action produces a finding UPDATE + a task UPDATE in quick
 *     succession; one refresh covers both.
 *   * The browser supabase client can throw if public env vars are
 *     missing (e.g. a deploy that built before the Supabase integration
 *     synced its keys). Swallow that throw so a missing realtime
 *     connection degrades gracefully instead of taking the page down.
 *   * Requires `plant_findings` and `grow_tasks` to be in the
 *     `supabase_realtime` publication. Added in
 *     `006_chat_attachments.sql` (findings) and
 *     `20260520170000_grow_tasks_realtime.sql` (tasks).
 */
export function useTriageRealtime() {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(
          "useTriageRealtime: browser supabase client unavailable, realtime disabled",
          err,
        );
      }
      return;
    }

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.refresh();
      }, 300);
    };

    const channel = supabase
      .channel("triage:inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "plant_findings" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "plant_findings" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "grow_tasks" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "grow_tasks" },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);
}
