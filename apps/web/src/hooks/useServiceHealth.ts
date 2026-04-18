"use client";

import { useEffect, useState } from "react";

export type HealthStatus = "ok" | "degraded" | "down" | "loading";

export interface ServiceHealth {
  status: HealthStatus;
  lastChecked: string | null;
  detail?: string;
}

const POLL_INTERVAL_MS = 15_000;

async function fetchReady(signal: AbortSignal): Promise<ServiceHealth> {
  try {
    const res = await fetch("/api/ready", {
      method: "GET",
      signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
    };
    if (res.ok && body.status === "ok") {
      return { status: "ok", lastChecked: new Date().toISOString() };
    }
    const base: ServiceHealth = {
      status: res.status === 503 ? "degraded" : "down",
      lastChecked: new Date().toISOString(),
    };
    if (body.status) base.detail = body.status;
    return base;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { status: "loading", lastChecked: null };
    }
    return {
      status: "down",
      lastChecked: new Date().toISOString(),
      detail: (err as Error).message,
    };
  }
}

/**
 * Polls /api/ready every 15s and returns the latest health snapshot.
 * Intended for a top-bar status badge — does not throw.
 */
export function useServiceHealth(): ServiceHealth {
  const [health, setHealth] = useState<ServiceHealth>({
    status: "loading",
    lastChecked: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function tick(): Promise<void> {
      const result = await fetchReady(controller.signal);
      if (!cancelled) setHealth(result);
    }

    void tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  return health;
}
