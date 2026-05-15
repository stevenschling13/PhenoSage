import { beforeEach, describe, expect, it, vi } from "vitest";

const generateFindingEmbeddings = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../embeddings", () => ({
  generateFindingEmbeddings: (...args: unknown[]) =>
    generateFindingEmbeddings(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

import { findSimilarGrowFindings } from "../semantic-findings";

const vector = Array.from({ length: 1536 }, (_, index) => index / 1536);
type SearchClient = Parameters<typeof findSimilarGrowFindings>[0]["supabase"];

function makeRpcClient(result: {
  data: unknown[] | null;
  error: { message: string } | null;
}) {
  const abortSignal = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn(() => ({ abortSignal }));
  return { abortSignal, client: { rpc }, rpc };
}

function makeThrowingRpcClient(error: Error) {
  const abortSignal = vi.fn().mockRejectedValue(error);
  const rpc = vi.fn(() => ({ abortSignal }));
  return { abortSignal, client: { rpc }, rpc };
}

describe("semantic findings search", () => {
  beforeEach(() => {
    generateFindingEmbeddings.mockReset();
    logServerEvent.mockReset();
    generateFindingEmbeddings.mockResolvedValue({
      ok: true,
      embeddings: [vector],
      providerRequestId: "provider-req-1",
    });
  });

  it("embeds the query and calls the RLS-scoped search RPC", async () => {
    const { client, rpc, abortSignal } = makeRpcClient({
      data: [
        {
          id: "finding-1",
          plant_id: "plant-1",
          plant_name: "Blue Dream #1",
          category: "nutrient_deficiency",
          severity: "medium",
          title: "Lower fan yellowing",
          description: "Yellowing lower leaves",
          recommendation: null,
          source: "ai",
          created_at: "2026-05-01T00:00:00Z",
          similarity: 0.86,
        },
      ],
      error: null,
    });

    const result = await findSimilarGrowFindings({
      supabase: client as unknown as SearchClient,
      growId: "grow-1",
      query: "yellowing lower leaves",
      limit: 99,
      requestId: "req-1",
    });

    expect(result).toEqual({
      ok: true,
      data: [
        expect.objectContaining({
          id: "finding-1",
          plantId: "plant-1",
          plantName: "Blue Dream #1",
          similarity: 0.86,
        }),
      ],
    });
    expect(generateFindingEmbeddings).toHaveBeenCalledWith(
      ["yellowing lower leaves"],
      { requestId: "req-1" },
    );
    expect(rpc).toHaveBeenCalledWith(
      "match_similar_grow_findings",
      expect.objectContaining({
        p_grow_id: "grow-1",
        p_match_count: 10,
        p_match_threshold: 0.72,
        p_query_embedding: expect.stringMatching(/^\[/),
      }),
    );
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("returns an unavailable result when embedding generation fails", async () => {
    generateFindingEmbeddings.mockResolvedValue({
      ok: false,
      code: "circuit_open",
    });
    const { client, rpc } = makeRpcClient({ data: [], error: null });

    await expect(
      findSimilarGrowFindings({
        supabase: client as unknown as SearchClient,
        growId: "grow-1",
        query: "yellowing lower leaves",
        requestId: "req-1",
      }),
    ).resolves.toEqual({ ok: false, code: "circuit_open" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hides raw database errors from callers", async () => {
    const { client } = makeRpcClient({
      data: null,
      error: { message: "function match_similar_grow_findings missing" },
    });

    await expect(
      findSimilarGrowFindings({
        supabase: client as unknown as SearchClient,
        growId: "grow-1",
        query: "yellowing lower leaves",
        requestId: "req-1",
      }),
    ).resolves.toEqual({ ok: false, code: "semantic_search_unavailable" });
  });

  it("hides thrown RPC timeout errors from callers", async () => {
    const { client, abortSignal } = makeThrowingRpcClient(
      new Error("AbortError: operation timed out"),
    );

    await expect(
      findSimilarGrowFindings({
        supabase: client as unknown as SearchClient,
        growId: "grow-1",
        query: "yellowing lower leaves",
        requestId: "req-1",
      }),
    ).resolves.toEqual({ ok: false, code: "semantic_search_unavailable" });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "semantic finding search threw",
      expect.objectContaining({
        requestId: "req-1",
        growId: "grow-1",
      }),
    );
  });
});
