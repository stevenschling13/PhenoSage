"use client";

import { useServiceHealth, type HealthStatus } from "@/hooks/useServiceHealth";
import { cn } from "@/lib/cn";

const TONE: Record<HealthStatus, { dot: string; label: string; ring: string }> =
  {
    ok: {
      dot: "bg-success",
      label: "All systems normal",
      ring: "ring-success/30",
    },
    degraded: {
      dot: "bg-warning",
      label: "Partial degradation",
      ring: "ring-warning/30",
    },
    down: {
      dot: "bg-destructive",
      label: "Service unavailable",
      ring: "ring-destructive/30",
    },
    loading: {
      dot: "bg-muted-foreground/40",
      label: "Checking service health…",
      ring: "ring-muted/30",
    },
  };

const SHORT: Record<HealthStatus, string> = {
  ok: "Online",
  degraded: "Degraded",
  down: "Offline",
  loading: "Checking",
};

export function HealthIndicator() {
  const health = useServiceHealth();
  const tone = TONE[health.status];

  const detail = health.lastChecked
    ? `Last checked ${new Date(health.lastChecked).toLocaleTimeString()}`
    : "Awaiting first check";

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`${tone.label}. ${detail}.`}
      title={`${tone.label}. ${detail}.`}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-2 w-2 rounded-full ring-2",
          tone.dot,
          tone.ring,
          health.status === "loading" && "animate-pulse-soft",
        )}
      />
      <span className="hidden sm:inline">{SHORT[health.status]}</span>
    </span>
  );
}
