import "server-only";
import type { HealthTrendPoint } from "@/components/health-trend-chart";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";

// ─── Grow Health Trend ─────────────────────────────────────────────────────
//
// Aggregates per-image `overall_health_score` rows from `plant_analyses`
// for every plant under a grow into a single daily-averaged time series.
// Designed to drop straight into the existing `HealthTrendChart` component,
// which already handles empty / single-point / hover states.
//
// Authorization piggy-backs on RLS: the user-scoped supabase client only
// returns analyses for grows the user owns or collaborates on. No manual
// membership check is needed here.

const DEFAULT_WINDOW_DAYS = 30;
const MAX_ANALYSES = 1000;

type AnalysisRow = {
  overall_health_score: number;
  analyzed_at: string;
};

export interface GrowHealthTrend {
  points: HealthTrendPoint[];
  totalAnalyses: number;
  windowDays: number;
}

const EMPTY_TREND: GrowHealthTrend = {
  points: [],
  totalAnalyses: 0,
  windowDays: DEFAULT_WINDOW_DAYS,
};

function startOfDayUtc(value: string): string {
  // Bucket by UTC date — the chart only needs a stable per-day key.
  // Using UTC keeps the bucketing deterministic regardless of the user's
  // browser locale, which matters because the score is averaged on the
  // server and re-rendered without further timezone math.
  const d = new Date(value);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  ).toISOString();
}

export async function getGrowHealthTrend(
  growId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<GrowHealthTrend> {
  if (!growId) return { ...EMPTY_TREND, windowDays };

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "grow health trend client init failed", {
      growId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY_TREND, windowDays };
  }

  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("plant_analyses")
    .select("overall_health_score,analyzed_at")
    .eq("grow_id", growId)
    .gte("analyzed_at", since)
    .order("analyzed_at", { ascending: true })
    .limit(MAX_ANALYSES);

  if (error) {
    logServerEvent("error", "grow health trend query failed", {
      growId,
      error: error.message,
    });
    return { ...EMPTY_TREND, windowDays };
  }

  const rows = (data ?? []) as AnalysisRow[];
  if (rows.length === 0) {
    return { points: [], totalAnalyses: 0, windowDays };
  }

  // Bucket by UTC day, then average. Map insertion order matches the
  // `analyzed_at ASC` order from the query, so we get a sorted timeline
  // for free.
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const key = startOfDayUtc(row.analyzed_at);
    const current = buckets.get(key);
    if (current) {
      current.sum += Number(row.overall_health_score);
      current.count += 1;
    } else {
      buckets.set(key, {
        sum: Number(row.overall_health_score),
        count: 1,
      });
    }
  }

  const points: HealthTrendPoint[] = Array.from(buckets.entries()).map(
    ([analyzedAt, { sum, count }]) => ({
      analyzedAt,
      score: sum / count,
    }),
  );

  return { points, totalAnalyses: rows.length, windowDays };
}
