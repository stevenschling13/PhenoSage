import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const createSupabaseServerClient = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

import { getGrowHealthTrend } from "../grow-health-trend";

type AnalysisRow = { overall_health_score: number; analyzed_at: string };
type Settled = {
  data: AnalysisRow[] | null;
  error: { message: string } | null;
};

function makeSupabase(settle: () => Settled | Promise<Settled>) {
  // Every grow-health-trend query is a single `from("plant_analyses")` →
  // builder chain, so we only need to model that one table.
  return {
    from: () => {
      const settled = async (): Promise<Settled> => settle();
      const builder: {
        select: () => typeof builder;
        eq: () => typeof builder;
        gte: () => typeof builder;
        order: () => typeof builder;
        limit: () => typeof builder;
        then: (
          _onfulfilled: (_value: Settled) => unknown,
          _onrejected?: (_reason: unknown) => unknown,
        ) => Promise<unknown>;
      } = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (onfulfilled, onrejected) =>
          settled().then(onfulfilled, onrejected),
      };
      return builder;
    },
  };
}

describe("getGrowHealthTrend", () => {
  beforeEach(() => {
    (createSupabaseServerClient as Mock).mockReset();
    (logServerEvent as Mock).mockReset();
  });

  it("returns an empty trend when no growId is provided", async () => {
    const trend = await getGrowHealthTrend("");
    expect(trend.points).toEqual([]);
    expect(trend.totalAnalyses).toBe(0);
    // The supabase client should never be initialized for an empty growId.
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns an empty trend if the supabase client init throws", async () => {
    createSupabaseServerClient.mockRejectedValue(new Error("boom"));
    const trend = await getGrowHealthTrend("g1");
    expect(trend.points).toEqual([]);
    expect(trend.totalAnalyses).toBe(0);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "grow health trend client init failed",
      expect.objectContaining({ error: "boom", growId: "g1" }),
    );
  });

  it("returns an empty trend (no log noise on empty result) when the grow has no analyses", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(() => ({ data: [], error: null })),
    );
    const trend = await getGrowHealthTrend("g1");
    expect(trend.points).toEqual([]);
    expect(trend.totalAnalyses).toBe(0);
    expect(logServerEvent).not.toHaveBeenCalled();
  });

  it("buckets analyses by UTC day and averages the score across plants", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(() => ({
        data: [
          // Two plants analyzed on the same UTC day -> one bucket, averaged.
          { overall_health_score: 80, analyzed_at: "2026-05-10T03:00:00Z" },
          { overall_health_score: 60, analyzed_at: "2026-05-10T18:30:00Z" },
          // Next day, single plant.
          { overall_health_score: 90, analyzed_at: "2026-05-11T09:15:00Z" },
        ],
        error: null,
      })),
    );
    const trend = await getGrowHealthTrend("g1");
    expect(trend.totalAnalyses).toBe(3);
    expect(trend.points).toHaveLength(2);
    // Bucket key is "noon UTC of the analysis day" for chart-stable rendering.
    expect(trend.points[0]).toEqual({
      analyzedAt: "2026-05-10T12:00:00.000Z",
      score: 70,
    });
    expect(trend.points[1]).toEqual({
      analyzedAt: "2026-05-11T12:00:00.000Z",
      score: 90,
    });
  });

  it("soft-degrades when the query errors", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(() => ({
        data: null,
        error: { message: "rls denied" },
      })),
    );
    const trend = await getGrowHealthTrend("g1");
    expect(trend.points).toEqual([]);
    expect(trend.totalAnalyses).toBe(0);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "grow health trend query failed",
      expect.objectContaining({ error: "rls denied", growId: "g1" }),
    );
  });

  it("honors a custom window in the returned summary", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(() => ({ data: [], error: null })),
    );
    const trend = await getGrowHealthTrend("g1", 7);
    expect(trend.windowDays).toBe(7);
  });
});
